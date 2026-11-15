// chill-brain 的表演端（DSH 插件的消费者）。只用游戏自带资源：
//  - 动作：Animator.CrossFadeInFixedTime(state/clip 名)，id 由 AnimIdMap 还原（从游戏枚举生成）
//  - 字幕：自己画的 IMGUI 覆盖层，不碰游戏 UI
//  - 语音：播放大脑合成的 wav（音色取自游戏语音包）
// 不打任何 Harmony 补丁 → 游戏更新不失效。

using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using BepInEx;
using BepInEx.Configuration;
using BepInEx.Logging;
using UnityEngine;
using UnityEngine.Audio;
using UnityEngine.Networking;

namespace ChillPerformer
{
    [BepInPlugin(Guid, "ChillPerformer", "0.1.0")]
    public class Plugin : BaseUnityPlugin
    {
        public const string Guid = "local.chill.performer";

        internal static ManualLogSource Log;
        internal static ConfigEntry<string> BrainBaseUrl;
        internal static ConfigEntry<string> ApiToken;
        internal static ConfigEntry<bool> PullEnabled;
        internal static ConfigEntry<float> PullInterval;
        internal static ConfigEntry<string> AudioDir;
        internal static ConfigEntry<bool> LipsyncEnabled;
        internal static ConfigEntry<float> LipsyncGain;
        internal static ConfigEntry<bool> AutoShots;
        internal static ConfigEntry<bool> TestSweep;
        internal static ConfigEntry<float> MotionSpeed;
        internal static ConfigEntry<float> MotionWeight;
        internal static ConfigEntry<bool> MotionEnabled;
        internal static ConfigEntry<bool> NativeSubtitle;
        internal static ConfigEntry<bool> Probes;
        internal static ConfigEntry<bool> RespectGame;
        internal static ConfigEntry<bool> ForceBusy;
        internal static ConfigEntry<bool> Heartbeat;
        internal static ConfigEntry<int> HeartbeatMs;
        internal static ConfigEntry<float> MotionMaxDegPerSec;
        internal static ConfigEntry<float> VoiceVolume;
        internal static ConfigEntry<bool> FollowGameMixer;
        internal static ConfigEntry<string> MixerGroupMatch;
        internal static ConfigEntry<string> MixerGroupFallback;
        internal static ConfigEntry<bool> QueueEnabled;
        internal static ConfigEntry<int> QueueMax;
        internal static ConfigEntry<int> QueueTtlMs;
        internal static ConfigEntry<int> QueueGapMs;
        internal static ConfigEntry<bool> VerboseCues;
        internal static ConfigEntry<bool> ShowSubtitle;

        private void Awake()
        {
            Log = Logger;
            BrainBaseUrl = Config.Bind("brain", "BaseUrl", "http://127.0.0.1:10722/chill/v1",
                "chill-brain base url (DSH plugin). Keep the /chill/v1 prefix.");
            ApiToken = Config.Bind("brain", "Token", "",
                "Optional bearer token; leave empty unless chill-brain config sets one.");

            ShowSubtitle = Config.Bind("ui", "ShowSubtitle", true, "Draw the self-made subtitle overlay.");
            VoiceVolume = Config.Bind("audio", "Volume", 0.85f, "Relative volume of synthesized voice, multiplied on top of the game's own mixer level.");
            FollowGameMixer = Config.Bind("audio", "FollowGameMixer", true, "Route the synthesized voice through the game's own AudioMixer group, so the in-game volume slider and mute for that group apply to her voice too.");
            MixerGroupMatch = Config.Bind("audio", "MixerGroupMatch", "voice", "Keyword(s) that pick the mixer group, comma separated, case-insensitive. First match wins.");
            MixerGroupFallback = Config.Bind("audio", "MixerGroupFallback", "master", "Fallback keyword(s) when nothing matches MixerGroupMatch. Empty = leave the source unmixed (old behaviour).");
            QueueEnabled = Config.Bind("queue", "Enabled", true, "Queue incoming cues locally and play them one after another. False = old behaviour, only the newest item is performed.");
            QueueMax = Config.Bind("queue", "Max", 4, "Queue depth. When full the OLDEST waiting item is dropped (stale lines are the ones worth losing).");
            QueueTtlMs = Config.Bind("queue", "TtlMs", 20000, "Drop a waiting item once it is older than this. Keeps a long yield from replaying lines from ten minutes ago.");
            QueueGapMs = Config.Bind("queue", "GapMs", 250, "Silence between two queued lines, in milliseconds.");
            VerboseCues = Config.Bind("debug", "VerboseCues", false, "Log every performance cue.");
            PullEnabled = Config.Bind("console", "PullEnabled", true, "Poll chill-brain for cues pushed from the DSH console.");
            PullInterval = Config.Bind("console", "PullInterval", 0.6f, "Seconds between console pull requests.");
            AudioDir = Config.Bind("audio", "Dir", "", "Optional: absolute path to chill-brain's data/audio. Empty = stream over HTTP via /chill/v1/audio; a disk path skips that route and is more robust.");
            LipsyncEnabled = Config.Bind("lipsync", "Enabled", true, "Drive Face blendshapes while the voice plays.");
            LipsyncGain = Config.Bind("lipsync", "Gain", 1f, "Mouth weight multiplier (0.5-1.5).");
            AutoShots = Config.Bind("lipsync", "AutoShots", true, "Save shot-mouth-a/b.png at each line for visual checks.");
            TestSweep = Config.Bind("lipsync", "TestSweep", false, "Play a synthetic vowel sweep once after startup (verification only).");
            MotionSpeed = Config.Bind("motion", "Speed", 0.62f, "Playback speed of pushed cues (game idle motion is slower than clip fps; 0.6-0.9 looks natural).");
            MotionWeight = Config.Bind("motion", "Weight", 0.72f, "Max blend weight of a cue pose (0.6-1.0). Lower = subtler, closer to the game's own acting.");
            MotionEnabled = Config.Bind("motion", "Enabled", true, "False = never touch the skeleton, let the game act on its own.");
            NativeSubtitle = Config.Bind("subtitle", "Native", true, "Draw subtitles with the game's own TMPro font asset on a private canvas (fallback: built-in overlay bar).");
            Probes = Config.Bind("debug", "Probes", false, "Dump clips/skin/face/ui probes to BepInEx at startup (diagnostics only).");
            RespectGame = Config.Bind("interop", "RespectGame", true, "Hand the stage back while the game plays its own story or dialogue.");
            ForceBusy = Config.Bind("interop", "ForceBusy", false, "Test switch: pretend the game is on stage, so pushes are held.");
            Heartbeat = Config.Bind("interop", "Heartbeat", true, "POST live game state to /chill/v1/game so the console status tab is truthful.");
            HeartbeatMs = Config.Bind("interop", "HeartbeatMs", 2000, "Heartbeat interval in milliseconds.");
            MotionMaxDegPerSec = Config.Bind("motion", "MaxDegPerSec", 300f, "Cap on how fast a bone may rotate while blending in/out (deg per second).");

            var host = new GameObject("chill-performer");
            DontDestroyOnLoad(host);
            host.hideFlags = HideFlags.HideAndDontSave;
            host.AddComponent<PerformerUI>();

            Log.LogInfo("ChillPerformer awake. brain=" + BrainBaseUrl.Value);
            Uri parsedBase;
            bool baseOk = Uri.TryCreate(BrainBaseUrl.Value, UriKind.Absolute, out parsedBase);
            if (!baseOk || (parsedBase.Scheme != "http" && parsedBase.Scheme != "https"))
                Log.LogError("BaseUrl 不可用（必须是 http(s)://host:port/chill/v1）：" + BrainBaseUrl.Value);
        }
    }

    // ---------- DTO：与 chill-brain buildAct 的输出字段一一对应 ----------

    [Serializable]
    public class CueDto
    {
        public string slot;
        public string id;
        public int at;
        public int durationMs;
        public string text;
    }

    [Serializable]
    public class VoiceDto
    {
        public string text;
        public string lang;
        public bool skipTts;
        public string audioUrl;
    }

    [Serializable]
    public class SubtitleDto
    {
        public string text;
        public int maxChars;
    }

    [Serializable]
    public class StateDto
    {
        public string phase;
        public int energy;
        public int focusMinutes;
        public int turnCount;
    }

    [Serializable]
    public class MetaDto
    {
        public string model;
        public string mode;
        public int droppedCues;
        public int latencyMs;
    }

    [Serializable]
    public class ActDto
    {
        public string turnId;
        public string emotion;
        public VoiceDto voice;
        public SubtitleDto subtitle;
        public CueDto[] performance;
        public StateDto state;
        public MetaDto meta;
        public int mouthFps;
        public int mouthFrames;
        public List<double> mouthFlat;
        public string motionScope = "full";
        // 这一句的语音时长（毫秒）。<=0 表示没拿到，回退到按字数估。
        public double durationMs;
    }

    // 控制台推送（chill-brain GET /pull 的返回）
    [Serializable]
    public class FeedItemDto
    {
        public int seq;
        public string subtitle;
        public CueDto[] performance;
        public VoiceDto voice;
        public string source;
    }

    [Serializable]
    public class FeedDto
    {
        public bool ok;
        public int seq;
        public FeedItemDto[] items;
    }
    [Serializable]
    public class HealthDto
    {
        public bool ok;
        public string model;
        public bool hasApiKey;
        public int memoryTurns;
    }

    internal class PerformerUI : MonoBehaviour
    {
        private string lastError = "";
        private string subtitle = "";
        private float subtitleUntil;
        private Animator heroine;
        private readonly HashSet<string> clipNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, Animator> clipOwners = new Dictionary<string, Animator>(StringComparer.OrdinalIgnoreCase);
        private AudioSource audioSource;
        // 混音器路由：合成语音挂到游戏自己那一路混音器组上，游戏里的音量滑块与静音才管得住她。
        // 只读公开字段 AudioSource.outputAudioMixerGroup，不反射游戏内部类型、不打补丁。
        private AudioMixerGroup voiceGroup;
        private string voiceGroupLabel = "off";
        private float nextGroupTry;
        // 表演队列：大脑端有自己的队列，这里再排一次——两边独立、不同步，
        // 大脑只说"这一条演什么"，什么时候演由游戏端自己按先来先演决定。
        private struct PendingAct
        {
            public ActDto dto;
            public int seq;
            public float at;      // 入队时刻（unscaled）
            public string src;
        }
        private readonly List<PendingAct> pending = new List<PendingAct>();
        private bool performing;
        private int qDropped;
        private int qExpired;
        private int qMaxDepth;
        private int qPlayed;
        private GUIStyle subtitleStyle;
        // 口型：Face 的 SkinnedMeshRenderer + 六个母音 blendshape 下标
        private SkinnedMeshRenderer faceSmr;
        private readonly int[] mouthIdx = new int[] { -1, -1, -1, -1, -1, -1 };
        private float[] mouthW = new float[0];
        private int mouthCount;
        private int mouthFps = 30;
        private float mouthT0 = -1f;
        private float mouthDur;
        private bool mouthActive;
        // 采样播放器：游戏自己的动画状态机每帧会覆盖 CrossFade，
        // 所以改在 LateUpdate 里用 AnimationClip.SampleAnimation 直接写骨骼。
        private AnimationClip activeClip;
        private GameObject clipTarget;
        private float clipT0;
        private float clipLen;
        private bool clipLoop;
        private float clipSpeed = 0.62f;
        private bool clipActive;
        private readonly Dictionary<string, AnimationClip> clipAssets = new Dictionary<string, AnimationClip>(StringComparer.OrdinalIgnoreCase);
        // 采样只改旋转、锁死位置：位置一律用游戏自己这一帧解算出来的值，杜绝瞬移
        private Transform[] bones;
        private bool upperOnly;
        private bool[] upperAllowed;
        private Quaternion[] gameRot;
        private Vector3[] gamePos;
        private float clipFadeIn = 0.45f;
        private Quaternion[] lastRot;
        private float dbgMaxDeg;
        private int dbgFrames;
        private float clipFadeOut = 0.40f;
        private static readonly string[] MOUTH_KEYS = new string[] { "mouth_a", "mouth_i", "mouth_u", "mouth_e", "mouth_o", "mouth_n" };

        private string BaseUrl { get { return Plugin.BrainBaseUrl.Value.TrimEnd('/'); } }

        private void Start()
        {
            StartCoroutine(Bootstrap());
        }

        private IEnumerator Bootstrap()
        {
            yield return new WaitForSeconds(2.5f);
            yield return StartCoroutine(ProbeHealth());
            // 加载界面也有 Animator（7 个 UI clip），不能用「找到就算成功」的判据。
            // 真正的角色控制器 clip 数量远大于 50，等到映射够了再开始拉取。
            int tries = 0;
            while (clipNames.Count < 50 && tries < 600)
            {
                yield return StartCoroutine(DiscoverHeroine());
                tries++;
                if (clipNames.Count < 50) yield return new WaitForSecondsRealtime(3f);
            }
            var head = new System.Text.StringBuilder();
            int shown = 0;
            foreach (var k in clipNames) { head.Append(k).Append('|'); if (++shown >= 10) break; }
            Plugin.Log.LogInfo("heroine ready: scans=" + tries + " mapped=" + clipNames.Count + " sample=" + head);
            SceneProbe.DumpClips(Plugin.Log, System.IO.Path.Combine(BepInEx.Paths.BepInExRootPath, "chill-clips.txt"));
            SceneProbe.DumpSkin(Plugin.Log, System.IO.Path.Combine(BepInEx.Paths.BepInExRootPath, "chill-skin.txt"));
            SceneProbe.DumpFace(Plugin.Log, System.IO.Path.Combine(BepInEx.Paths.BepInExRootPath, "chill-face.txt"));

            SceneProbe.DumpDynamicRenderer(Plugin.Log);
            SceneProbe.DumpTimeOfDay(Plugin.Log, System.IO.Path.Combine(BepInEx.Paths.BepInExRootPath, "chill-timeofday.txt"));
            probed = true;
            FindFace();
            NativeSubtitle.Init(Plugin.Log);
            GameBusy.Init(Plugin.Log, audioSource);
            StartCoroutine(Forever(HeartbeatLoop, "Heartbeat"));
            if (Plugin.Probes != null && Plugin.Probes.Value) SceneProbe.DumpUIText(Plugin.Log);
            IndexClipAssets();
            if (Plugin.TestSweep != null && Plugin.TestSweep.Value) StartCoroutine(TestSweep());
            Plugin.Log.LogInfo("status: " + (heroine == null
                ? "brain ok, heroine animator NOT found"
                : "ready (" + clipNames.Count + " clips)"));
            StartCoroutine(Forever(PullLoop, "PullLoop"));
            StartCoroutine(Forever(PerformLoop, "PerformLoop"));
        }



        private float cycleTriggerCheckAt;


        private int feedSeq;
        private bool bootSynced;
        private int pullPolls;
        private int heartbeatFails;
        private bool heartbeatOk = true;
        private bool probed;

        // 控制台推来的 cue：每 PullInterval 秒问一次 /pull?since=N
        private const string Version = "0.10.1";

        private static string Js(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            var sb = new System.Text.StringBuilder(s.Length + 8);
            foreach (var ch in s)
            {
                switch (ch)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (ch < 0x20) sb.Append(' ');
                        else sb.Append(ch);
                        break;
                }
            }
            return sb.ToString();
        }

        private string BuildStateJson()
        {
            int fps = Time.smoothDeltaTime > 0.0001f ? Mathf.RoundToInt(1f / Time.smoothDeltaTime) : 0;
            string clipName = (clipActive && activeClip != null) ? activeClip.name : "";
            var sb = new System.Text.StringBuilder(256);
            sb.Append('{');
            sb.Append("\"ok\":").Append(heartbeatOk ? "true" : "false");
            sb.Append(",\"version\":\"").Append(Version).Append('"');
            sb.Append(",\"scene\":\"").Append(Js(GameBusy.SceneName)).Append('"');
            // The visible window view is what the player actually sees outside; the
            // brain uses it so her lines about the sky match the picture.
            sb.Append(",\"windowView\":\"").Append(Js(SceneProbe.CurrentWindowView())).Append('"');
            sb.Append(",\"busy\":").Append(GameBusy.IsBusy ? "true" : "false");
            sb.Append(",\"busyReason\":\"").Append(Js(GameBusy.Reason)).Append('"');
            sb.Append(",\"heroineReady\":").Append(heroine != null ? "true" : "false");
            sb.Append(",\"clips\":").Append(clipAssets.Count);
            sb.Append(",\"clip\":\"").Append(Js(clipName)).Append('"');
            sb.Append(",\"subtitle\":\"").Append(Js(subtitle)).Append('"');
            sb.Append(",\"mouth\":").Append(mouthActive ? "true" : "false");
            sb.Append(",\"audio\":").Append(audioSource != null && audioSource.isPlaying ? "true" : "false");
            sb.Append(",\"mixer\":\"").Append(Js(voiceGroupLabel)).Append('"');
            // 队列现场：depth=在等的条数，played/dropped/expired 是三条出口的计数
            sb.Append(",\"queue\":{\"depth\":").Append(pending.Count)
              .Append(",\"performing\":").Append(performing ? "true" : "false")
              .Append(",\"played\":").Append(qPlayed)
              .Append(",\"dropped\":").Append(qDropped)
              .Append(",\"expired\":").Append(qExpired)
              .Append(",\"maxDepth\":").Append(qMaxDepth)
              .Append(",\"enabled\":").Append((Plugin.QueueEnabled != null && Plugin.QueueEnabled.Value) ? "true" : "false")
              .Append('}');
            sb.Append(",\"fps\":").Append(fps);
            sb.Append(",\"focus\":").Append(GameBusy.FocusMode ? "true" : "false");
            sb.Append(",\"pomTexts\":").Append(GameBusy.PomodoroCandidates);
            sb.Append(",\"timer\":\"").Append(Js(GameBusy.TimerText)).Append('"');
            sb.Append(",\"tmp\":").Append(GameBusy.TmpCount);
            var pv = GameBusy.PomodoroVisibleTexts;
            sb.Append(",\"pomUi\":[");
            for (int i = 0; i < pv.Length; i++) { if (i > 0) sb.Append(","); sb.Append("\"").Append(Js(pv[i])).Append("\""); }
            sb.Append("]");
            var ats = GameBusy.ActiveTexts;
            sb.Append(",\"activeTexts\":[");
            for (int i = 0; i < ats.Length; i++) { if (i > 0) sb.Append(","); sb.Append("\"").Append(Js(ats[i])).Append("\""); }
            sb.Append("]");
            sb.Append(",\"pullSeq\":").Append(feedSeq);
            sb.Append(",\"lastError\":\"").Append(Js(lastError)).Append('"');
            sb.Append(",\"evidence\":[");
            var evs = GameBusy.Evidence;
            for (int i = 0; i < evs.Length; i++)
            {
                if (i > 0) sb.Append(",");
                sb.Append("\"").Append(Js(evs[i])).Append("\"");
            }
            sb.Append("]");
            sb.Append('}');
            return sb.ToString();
        }

        // 协程里抛异常会终止整条嵌套栈，而且没有任何"重启"入口：
        // 表现就是面板全绿、心跳还在报在线，游戏里却一动不动。
        // 这个包装器把异常变成一条错误日志，2 秒后重建整条循环。
        private IEnumerator Forever(System.Func<IEnumerator> factory, string tag)
        {
            while (true)
            {
                IEnumerator body = null;
                try { body = factory(); }
                catch (Exception e) { Plugin.Log.LogError(tag + " create failed: " + e.Message); }
                bool crashed = false;
                if (body != null)
                {
                    while (true)
                    {
                        bool moved;
                        try { moved = body.MoveNext(); }
                        catch (Exception e)
                        {
                            Plugin.Log.LogError(tag + " crashed: " + e.Message + "\n" + e.StackTrace);
                            crashed = true;
                            break;
                        }
                        if (!moved) break;
                        yield return body.Current;
                    }
                }
                if (body != null && !crashed) yield break;
                yield return new WaitForSecondsRealtime(2f);
            }
        }

        private IEnumerator HeartbeatLoop()
        {
            while (true)
            {
                int wait = Plugin.HeartbeatMs == null ? 2000 : Mathf.Clamp(Plugin.HeartbeatMs.Value, 500, 30000);
                yield return new WaitForSecondsRealtime(wait / 1000f);
                if (Plugin.Heartbeat != null && !Plugin.Heartbeat.Value) continue;
                string url = BaseUrl + "/game";
                string body = BuildStateJson();
                var req = new UnityWebRequest(url, "POST");
                req.uploadHandler = new UploadHandlerRaw(System.Text.Encoding.UTF8.GetBytes(body));
                req.downloadHandler = new DownloadHandlerBuffer();
                req.SetRequestHeader("Content-Type", "application/json");
                if (!string.IsNullOrEmpty(Plugin.ApiToken.Value))
                    req.SetRequestHeader("Authorization", "Bearer " + Plugin.ApiToken.Value);
                req.timeout = 6;
                yield return req.SendWebRequest();
                if (req.isNetworkError || req.isHttpError)
                {
                    heartbeatOk = false;
                    if (heartbeatFails++ % 15 == 0) Plugin.Log.LogWarning("heartbeat: " + req.error);
                }
                else { heartbeatFails = 0; heartbeatOk = true; }
                // 先取错误再 Dispose：Dispose 之后 req.error 读不稳
                string hbError = (req.isNetworkError || req.isHttpError) ? req.error : "";
                req.Dispose();
                if (!heartbeatOk) lastError = "heartbeat: " + (string.IsNullOrEmpty(hbError) ? "failed" : hbError);
            }
        }

        private IEnumerator PullLoop()
        {
            while (true)
            {
                float wait = Plugin.PullInterval == null ? 0.6f : Mathf.Max(0.2f, Plugin.PullInterval.Value);
                // 用真实时间：菜单/加载界面 Time.timeScale 可能为 0，WaitForSeconds 会永远不返回
                yield return new WaitForSecondsRealtime(wait);
                if (Plugin.PullEnabled == null || !Plugin.PullEnabled.Value) continue;
                if ((Plugin.RespectGame == null || Plugin.RespectGame.Value) && GameBusy.IsHard)
                {
                    // 游戏自己在演剧情/说话：让位，条目先留在大脑的 feed 里
                    if (pullPolls % 40 == 0) Plugin.Log.LogInfo("stage yielded to game (" + GameBusy.Reason + ")");
                    continue;
                }
                string url = BaseUrl + "/pull?since=" + feedSeq;
                Dictionary<string, object> root = null;
                // BaseUrl 畸形（缺 http://、带空格）时 UnityWebRequest.Get 直接抛 ArgumentException。
                // 抛在协程里 = 整条 PullLoop 永久死亡，而心跳还在报在线。
                UnityWebRequest req = null;
                try { req = UnityWebRequest.Get(url); }
                catch (Exception e)
                {
                    lastError = "pull url: " + e.Message;
                    Plugin.Log.LogError(lastError);
                }
                if (req == null)
                {
                    yield return new WaitForSecondsRealtime(2f);
                    continue;
                }
                using (req)
                {
                    req.timeout = 10;
                    if (!string.IsNullOrEmpty(Plugin.ApiToken.Value))
                        req.SetRequestHeader("Authorization", "Bearer " + Plugin.ApiToken.Value);
                    yield return req.SendWebRequest();
                    pullPolls++;
                    if (req.isNetworkError || req.isHttpError)
                    {
                        if (pullPolls % 100 == 1) Plugin.Log.LogWarning("pull net: " + req.error);
                        continue;
                    }
                    try { root = JsonLite.AsDict(JsonLite.Parse(req.downloadHandler.text)); }
                    catch (Exception e)
                    {
                        lastError = "pull parse: " + e.Message;
                        if (pullPolls % 20 == 1) Plugin.Log.LogWarning(lastError);
                        continue;
                    }
                }
                if (root == null) continue;
                int newestSeq = feedSeq;
                try
                {
                    if (!probed) { probed = true; SceneProbe.Dump(Plugin.Log, false); }
                    int headSeq = JsonLite.Int(JsonLite.Get(root, "seq"));
                    // 开机自检：大脑里可能还留着上次会话的条目，这里只对齐游标，不重播
                    if (!bootSynced)
                    {
                        bootSynced = true;
                        if (headSeq > 0)
                        {
                            Plugin.Log.LogInfo("pull: startup sync, skip backlog up to seq=" + headSeq);
                            feedSeq = headSeq;
                            continue;
                        }
                    }
                    // 大脑重启后 seq 从 1 重新计数，本地游标比它大就会永久空转，这里自动复位
                    if (headSeq > 0 && headSeq < feedSeq)
                    {
                        Plugin.Log.LogInfo("pull: brain seq reset (" + feedSeq + " -> " + headSeq + "), cursor rewound");
                        feedSeq = 0;
                    }
                    var items = JsonLite.AsList(JsonLite.Get(root, "items"));
                    if (items == null || items.Count == 0)
                    {
                        if (headSeq > feedSeq) feedSeq = headSeq;
                        continue;
                    }
                    // 大脑端排它自己的队，这里排这里的队，两边不同步：
                    // 指令到了就按 seq 顺序排进本地队列，由 PerformLoop 一条一条演。
                    // 会丢的只有两种——超过 TTL 的旧话、队列满了时最旧的那条。
                    int added = 0;
                    for (int i = 0; i < items.Count; i++)
                    {
                        var d = JsonLite.AsDict(items[i]);
                        if (d == null) continue;
                        int s = JsonLite.Int(JsonLite.Get(d, "seq"));
                        if (s != 0 && s <= feedSeq) continue; // 已经排过或演过
                        ActDto parsed = null;
                        try { parsed = ParseActDict(d); }
                        catch (Exception e) { Plugin.Log.LogWarning("pull parse item " + s + ": " + e.Message); }
                        if (parsed == null) continue;
                        string src = JsonLite.Str(JsonLite.Get(d, "source"));
                        parsed.emotion = string.IsNullOrEmpty(src) ? "console" : src;
                        Enqueue(parsed, s, src);
                        if (s > newestSeq) newestSeq = s;
                        added++;
                    }
                    if (added > 0) Plugin.Log.LogInfo("pull: queued " + added + " item(s) seq<=" + newestSeq + " depth=" + pending.Count);
                    if (newestSeq > feedSeq) feedSeq = newestSeq;
                }
                catch (Exception e)
                {
                    // 关键：解析/表演出任何异常都不能让循环死掉，否则整个插件永久静默
                    lastError = "pull loop: " + e.Message;
                    Plugin.Log.LogError(lastError);
                }
                // 这里不再自己演出：只负责把指令排进队列，演由 PerformLoop 一条一条来
                yield return null;
            }
        }
        private ActDto ParseActDict(Dictionary<string, object> root)
        {
            if (root == null) return null;
            var dto = new ActDto();
            dto.emotion = JsonLite.Str(JsonLite.Get(root, "emotion"));

            object subRaw = JsonLite.Get(root, "subtitle");
            var sub = JsonLite.AsDict(subRaw);
            string subText = sub != null
                ? JsonLite.Str(JsonLite.Get(sub, "text"))
                : (subRaw is string ? (string)subRaw : JsonLite.Str(JsonLite.Get(root, "subtitleText")));
            dto.subtitle = new SubtitleDto();
            dto.subtitle.text = subText;
            dto.subtitle.maxChars = 60;

            var voice = JsonLite.AsDict(JsonLite.Get(root, "voice"));
            string audio = voice != null ? JsonLite.Str(JsonLite.Get(voice, "audioUrl")) : "";
            if (string.IsNullOrEmpty(audio)) audio = JsonLite.Str(JsonLite.Get(root, "audioUrl"));
            dto.voice = new VoiceDto();
            dto.voice.audioUrl = audio;
            dto.voice.lang = "ja";

            // 口型：扁平数组 [a,i,u,e,o,n] × N 帧
            var flat = JsonLite.AsList(JsonLite.Get(root, "mouthFlat"));
            dto.mouthFlat = new List<double>();
            if (flat != null)
                for (int i = 0; i < flat.Count; i++) dto.mouthFlat.Add(JsonLite.Num(flat[i]));
            dto.mouthFps = JsonLite.Int(JsonLite.Get(root, "mouthFps"));
            dto.mouthFrames = dto.mouthFlat.Count / 6;
            var scopeRaw = JsonLite.Get(root, "motionScope");
            dto.motionScope = scopeRaw == null ? "full" : JsonLite.Str(scopeRaw);
            var durRaw = JsonLite.Get(root, "durationMs");
            dto.durationMs = durRaw == null ? 0.0 : JsonLite.Num(durRaw);

            var cues = new List<CueDto>();
            var perf = JsonLite.AsList(JsonLite.Get(root, "performance"));
            if (perf != null)
            {
                foreach (var o in perf)
                {
                    var d = JsonLite.AsDict(o);
                    if (d == null) continue;
                    var cue = new CueDto();
                    cue.slot = JsonLite.Str(JsonLite.Get(d, "slot"));
                    cue.id = JsonLite.Str(JsonLite.Get(d, "id"));
                    cue.at = JsonLite.Int(JsonLite.Get(d, "at"));
                    // brain 的时间线以 d 为准：这是这一段该占多少毫秒。
                    // 从前只读 at，DLL 自己按 segTotal / MotionSpeed 另算一套，
                    // 两套差着 1.6 倍，每条多段 cue 都在播到六成时被下一条打断（2026-11-14 修）。
                    // 线上字段名是 durationMs（cue.log 里缩写成 d 只是日志格式）
                    cue.durationMs = JsonLite.Int(JsonLite.Get(d, "durationMs"));
                    cues.Add(cue);
                }
            }
            if (cues.Count == 0)
            {
                var ids = JsonLite.AsList(JsonLite.Get(root, "ids"));
                var slots = JsonLite.AsList(JsonLite.Get(root, "slots"));
                var ats = JsonLite.AsList(JsonLite.Get(root, "ats"));
                if (ids != null)
                {
                    for (int k = 0; k < ids.Count; k++)
                    {
                        var cue = new CueDto();
                        cue.id = JsonLite.Str(ids[k]);
                        cue.slot = (slots != null && k < slots.Count) ? JsonLite.Str(slots[k]) : "animations";
                        cue.at = (ats != null && k < ats.Count) ? JsonLite.Int(ats[k]) : 0;
                        var durs = JsonLite.AsList(JsonLite.Get(root, "durations"));
                        cue.durationMs = (durs != null && k < durs.Count) ? JsonLite.Int(durs[k]) : 0;
                        cues.Add(cue);
                    }
                }
            }
            dto.performance = cues.ToArray();
            return dto;
        }
        private IEnumerator ProbeHealth()
        {
            string url = BaseUrl + "/health";
            using (var req = UnityWebRequest.Get(url))
            {
                req.timeout = 10;
                yield return req.SendWebRequest();
                if (req.isNetworkError || req.isHttpError)
                {
                    Plugin.Log.LogWarning("status: brain unreachable");
                    lastError = "health: " + req.error;
                    Plugin.Log.LogWarning(lastError);
                }
                else
                {
                    try
                    {
                        var h = JsonUtility.FromJson<HealthDto>(req.downloadHandler.text);
                        Plugin.Log.LogInfo("status: " + (h != null && h.ok ? "brain ok / " + h.model : "brain odd"));
                        Plugin.Log.LogInfo("health: " + req.downloadHandler.text);
                    }
                    catch (Exception e)
                    {
                        lastError = "health parse: " + e.Message;
                    }
                }
            }
        }

        private IEnumerator DiscoverHeroine()
        {
            Animator best = null;
            int bestCount = -1;
            clipOwners.Clear();
            clipNames.Clear();
            var all = Resources.FindObjectsOfTypeAll<Animator>();
            int scanned = 0;
            foreach (var a in all)
            {
                if (a == null || a.runtimeAnimatorController == null) continue;
                if (!a.gameObject.scene.IsValid()) continue;
                var clips = a.runtimeAnimatorController.animationClips;
                if (clips == null || clips.Length == 0) continue;
                scanned++;
                if (scanned <= 12) Plugin.Log.LogInfo("animator candidate: " + a.gameObject.name + " active=" + a.gameObject.activeInHierarchy + " clips=" + clips.Length);
                bool usable = a.gameObject.activeInHierarchy;
                foreach (var c in clips)
                {
                    if (c == null || string.IsNullOrEmpty(c.name)) continue;
                    Animator owner;
                    if (clipOwners.TryGetValue(c.name, out owner))
                    {
                        if (owner != null && !owner.gameObject.activeInHierarchy && usable) clipOwners[c.name] = a;
                        continue;
                    }
                    clipOwners[c.name] = a;
                    clipNames.Add(c.name);
                }
                if (usable && clips.Length > bestCount) { best = a; bestCount = clips.Length; }
            }
            if (best != null)
            {
                heroine = best;
                Plugin.Log.LogInfo("heroine animator: " + best.gameObject.name + " clips=" + bestCount + " mapped=" + clipNames.Count + " scanned=" + scanned);
                if (audioSource == null)
                {
                    audioSource = best.gameObject.AddComponent<AudioSource>();
                    audioSource.playOnAwake = false;
                    audioSource.spatialBlend = 0f;
                    ResolveVoiceGroup(); // 第一次尝试接入游戏的混音器组
                }
            }
            else
            {
                Plugin.Log.LogInfo("heroine animator: none active (mapped=" + clipNames.Count + ")");
            }
            yield return null;
        }
        // 口型驱动：每帧按音频播放时间在扁平帧上插值，写回六个母音 blendshape
        private void LateUpdate()
        {
            if (clipActive && activeClip != null && clipTarget != null)
            {
                float ct = Time.time - clipT0;
                if (ct > clipLen)
                {
                    if (clipLoop) ct = clipLen > 0.01f ? ct % clipLen : 0f;
                    else { clipActive = false; Plugin.Log.LogInfo("clip done: " + activeClip.name + " frames=" + dbgFrames + " maxDeg/frame=" + dbgMaxDeg.ToString("F2") + " (cap " + ((Plugin.MotionMaxDegPerSec == null ? 300f : Plugin.MotionMaxDegPerSec.Value) * Time.deltaTime).ToString("F2") + ")"); }
                }
                if (clipActive)
                {
                    try { StepClip(ct); }
                    catch (Exception e) { clipActive = false; Plugin.Log.LogWarning("sample failed: " + e.Message); }
                }
            }
            if (faceSmr == null || mouthIdx[0] < 0) return;
            if (Plugin.LipsyncEnabled != null && !Plugin.LipsyncEnabled.Value) { if (mouthActive) ClearMouth(); return; }
            if (!mouthActive) return;
            float t = Time.time - mouthT0;
            if (mouthCount < 2 || t < 0f || t > mouthDur + 0.08f) { ClearMouth(); mouthActive = false; return; }
            float fps = mouthFps > 0 ? mouthFps : 30f;
            float pos = t * fps;
            int i0 = Mathf.Clamp((int)pos, 0, mouthCount - 1);
            int i1 = Mathf.Min(i0 + 1, mouthCount - 1);
            float k = Mathf.Clamp01(pos - i0);
            float fadeIn = Mathf.Clamp01(t / 0.05f);
            float fadeOut = Mathf.Clamp01((mouthDur + 0.08f - t) / 0.1f);
            float gain = Plugin.LipsyncGain == null ? 1f : Plugin.LipsyncGain.Value;
            float env = Mathf.Min(fadeIn, fadeOut) * gain;
            for (int c = 0; c < 6; c++)
            {
                if (mouthIdx[c] < 0) continue;
                float v = Mathf.Lerp(mouthW[i0 * 6 + c], mouthW[i1 * 6 + c], k) * env;
                faceSmr.SetBlendShapeWeight(mouthIdx[c], Mathf.Clamp01(v) * 100f);
            }
        }

        private void ClearMouth()
        {
            if (faceSmr == null) return;
            for (int c = 0; c < 6; c++)
                if (mouthIdx[c] >= 0) faceSmr.SetBlendShapeWeight(mouthIdx[c], 0f);
        }

        private void BindMouth(ActDto dto)
        {
            mouthActive = false;
            mouthT0 = -1f;
            if (dto == null || dto.mouthFlat == null || dto.mouthFlat.Count < 12) { mouthW = new float[0]; mouthCount = 0; return; }
            mouthW = new float[dto.mouthFlat.Count];
            for (int i = 0; i < mouthW.Length; i++) mouthW[i] = (float)dto.mouthFlat[i];
            mouthCount = dto.mouthFlat.Count / 6;
            mouthFps = dto.mouthFps > 0 ? dto.mouthFps : 30;
        }

        // 找到脸：Face 网格上有 Mouth_a/i/u/e/o/n 六个 blendshape
        private void FindFace()
        {
            var smrs = Resources.FindObjectsOfTypeAll<SkinnedMeshRenderer>();
            foreach (var smr in smrs)
            {
                if (smr == null || smr.sharedMesh == null) continue;
                if (smr.sharedMesh.name != "Face" && smr.name != "Face") continue;
                int n = smr.sharedMesh.blendShapeCount;
                if (n < 6) continue;
                faceSmr = smr;
                var found = new StringBuilder();
                for (int i = 0; i < n; i++)
                {
                    string nm = smr.sharedMesh.GetBlendShapeName(i);
                    string low = nm.ToLowerInvariant();
                    for (int c = 0; c < 6; c++)
                    {
                        if (mouthIdx[c] >= 0) continue;
                        if (low.EndsWith(MOUTH_KEYS[c])) { mouthIdx[c] = i; found.Append(MOUTH_KEYS[c]).Append('=').Append(i).Append(' '); }
                    }
                }
                Plugin.Log.LogInfo("face bound: " + smr.transform.parent.name + "/" + smr.name + " shapes=" + n + " mouth[" + found + "]");
                return;
            }
            Plugin.Log.LogWarning("face not found (no Face skinned mesh)");
        }

        // 自检：合成五个母音轮流张一下嘴，配合 AutoShoot 截图确认 blendshape 真的在动
        private IEnumerator TestSweep()
        {
            yield return new WaitForSecondsRealtime(2.5f);
            int n = 90;
            mouthCount = n;
            mouthFps = 30;
            mouthW = new float[n * 6];
            for (int i = 0; i < n; i++)
            {
                int c = (i / 12) % 5;
                mouthW[i * 6 + c] = 1f;
            }
            mouthDur = n / 30f;
            mouthT0 = Time.time;
            mouthActive = mouthIdx[0] >= 0;
            Plugin.Log.LogInfo("test sweep: frames=" + mouthCount + " dur=" + mouthDur.ToString("F2") + " active=" + mouthActive);
            if (mouthActive) StartCoroutine(AutoShoot(mouthDur));
        }

        // 口型验证用：说话开头/中段各截一张，肉眼比对嘴型
        private IEnumerator AutoShoot(float dur)
        {
            yield return new WaitForSecondsRealtime(0.2f);
            TakeShot("shot-mouth-a.png");
            yield return new WaitForSecondsRealtime(Mathf.Clamp(dur * 0.45f, 0.25f, 1.2f));
            TakeShot("shot-mouth-b.png");
        }

        private string lastSceneBound = "";

        private void Update()
        {
            GameBusy.Tick();
            // 换场景后旧的 heroine / Animator / SkinnedMesh 全部失效，不重建就会永久静默
            string sc = GameBusy.SceneName;
            if (!string.IsNullOrEmpty(sc) && sc != lastSceneBound)
            {
                bool first = lastSceneBound.Length == 0;
                lastSceneBound = sc;
                if (!first)
                {
                    Plugin.Log.LogInfo("scene changed -> " + sc + ", rebinding performer");
                    heroine = null;
                    clipOwners.Clear();
                    clipNames.Clear();
                    clipAssets.Clear();
                    bones = null;
                    faceSmr = null;
                    clipActive = false;
                    mouthActive = false;
                    mouthW = new float[0];
                    StartCoroutine(RebindAll());
                }
            }
            if (clipActive && (Plugin.RespectGame == null || Plugin.RespectGame.Value) && GameBusy.IsHard)
            {
                clipActive = false;
                mouthActive = false;
                ClearMouth();
                if (audioSource != null && audioSource.isPlaying) audioSource.Stop();
                if (NativeSubtitle.Ready) NativeSubtitle.Hide();
                subtitle = ""; subtitleUntil = 0f;
                Plugin.Log.LogInfo("performance cut: hard busy (" + GameBusy.Reason + ")");
            }
            // 诊断触发器：投放 trigger-autotime.txt 就重新核查官方自动切换的接线。
            if (Time.unscaledTime - cycleTriggerCheckAt > 1f)
            {
                cycleTriggerCheckAt = Time.unscaledTime;
                var af = System.IO.Path.Combine(BepInEx.Paths.BepInExRootPath, "trigger-autotime.txt");
                if (System.IO.File.Exists(af))
                {
                    try { System.IO.File.Delete(af); } catch { }
                    SceneProbe.ProbeAutoTime(Plugin.Log, System.IO.Path.Combine(BepInEx.Paths.BepInExRootPath, "chill-autotime.txt"));
                }
            }
            // F8 re-runs the environment probe on demand. The boot-time run happens
            // ~36s in, before the facility panel exists, so instances are missing there.
            if (Input.GetKeyDown(KeyCode.F8))
            {
                SceneProbe.DumpTimeOfDay(Plugin.Log, System.IO.Path.Combine(BepInEx.Paths.BepInExRootPath, "chill-timeofday.txt"));
            }
            if (Input.GetKeyDown(KeyCode.F9)) { SceneProbe.Dump(Plugin.Log, true); Plugin.Log.LogInfo("visible: " + SceneProbe.VisibleSet(60)); }
            if (Input.GetKeyDown(KeyCode.F10)) TakeShot("shot.png");
            if (subtitleUntil > 0f && Time.time > subtitleUntil)
            {
                subtitleUntil = 0f;
                subtitle = "";
                if (NativeSubtitle.Ready) NativeSubtitle.Hide();
            }
        }

        private IEnumerator RebindAll()
        {
            yield return null;
            // 迭代器里不能把 yield 放进带 catch 的 try，所以分两步：先跑协程，异常在外部兜
            IEnumerator probe = null;
            try { probe = DiscoverHeroine(); }
            catch (Exception e) { Plugin.Log.LogWarning("rebind heroine: " + e.Message); }
            if (probe != null) yield return StartCoroutine(probe);
            try { IndexClipAssets(); }
            catch (Exception e) { Plugin.Log.LogWarning("rebind clips: " + e.Message); }
            try { FindFace(); }
            catch (Exception e) { Plugin.Log.LogWarning("rebind face: " + e.Message); }
            Plugin.Log.LogInfo("rebind done: heroine=" + (heroine == null ? "-" : heroine.gameObject.name) + " clips=" + clipAssets.Count);
        }

        private IEnumerator Perform(ActDto dto)
        {
            if (dto.subtitle != null && !string.IsNullOrEmpty(dto.subtitle.text))
            {
                subtitle = dto.subtitle.text;
                int len = subtitle.Length;
                // 字幕停留按实测语音时长算。原来只按字数估（len * 0.18，最少 4 秒），
                // 日语念一句 20 来个字常要六七秒，字幕会先没、话还在响。
                // 拿到 durationMs 就按它 + 1.2 秒收尾；拿不到才回退旧估法。
                float hold;
                if (dto.durationMs > 200.0)
                {
                    hold = (float)(dto.durationMs / 1000.0) + 1.2f;
                }
                else
                {
                    hold = Mathf.Max(4f, len * 0.18f);
                }
                subtitleUntil = Time.time + hold;
                bool native = NativeSubtitle.Ready && (Plugin.NativeSubtitle == null || Plugin.NativeSubtitle.Value);
                if (native) NativeSubtitle.Show(subtitle);
                if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("subtitle via " + (native ? "native TMP" : "overlay") + ": " + subtitle);
            }
            upperOnly = string.Equals(dto.motionScope, "upper", StringComparison.OrdinalIgnoreCase) || GameBusy.FocusMode;
            Plugin.Log.LogInfo("motion scope: " + (upperOnly ? "upper (head/neck only)" : "full") + " dto=" + dto.motionScope + " focus=" + GameBusy.FocusMode);
            BindMouth(dto);
            var cues = dto.performance ?? new CueDto[0];
            Array.Sort(cues, delegate (CueDto a, CueDto b) { return a.at.CompareTo(b.at); });
            float t0 = Time.unscaledTime;
            int lastAt = -10000;
            // 语音立刻起播：原来放在所有 cue 之后，带 at=3000 的动作时台词会比字幕晚 3 秒
            if (dto.voice != null && !string.IsNullOrEmpty(dto.voice.audioUrl))
                StartCoroutine(PlayAudio(dto.voice.audioUrl));
            foreach (var cue in cues)
            {
                // 排布：同一时刻（或间隔过近）的动作强制错开，别在同一帧互相覆盖
                if (cue.at - lastAt < 400) cue.at = lastAt + 400;
                lastAt = cue.at;
                // 必须用真实时间：timeScale=0（暂停/菜单）时 WaitForSeconds 永不返回，整条 pull 链会永久卡死
                float wait = cue.at / 1000f - (Time.unscaledTime - t0);
                if (wait > 0f) yield return new WaitForSecondsRealtime(wait);
                if (cue.slot == "animations") PlayAnim(cue.id, cue.durationMs);
                else if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("cue skipped: " + cue.slot + ":" + cue.id);
            }
            // 语音已在开头起播，这里不再重复
        }

        // 把所有控制器里的 clip 收进一张表，采样播放要用 clip 本身
        private void IndexClipAssets()
        {
            clipAssets.Clear();
            var animators = Resources.FindObjectsOfTypeAll<Animator>();
            foreach (var a in animators)
            {
                if (a == null || a.runtimeAnimatorController == null) continue;
                foreach (var c in a.runtimeAnimatorController.animationClips)
                {
                    if (c == null || string.IsNullOrEmpty(c.name)) continue;
                    if (!clipAssets.ContainsKey(c.name)) clipAssets[c.name] = c;
                }
            }
            Plugin.Log.LogInfo("clip assets indexed: " + clipAssets.Count);
        }

        // 序列播放：把 start → loop×k → end 串成一条时间线（这就是游戏自己播故事动作的结构）
        private AnimationClip[] segClips;
        private float[] segStarts;
        private float segTotal;

        private static string StripSuffix(string name)
        {
            if (name.EndsWith("_loop2", StringComparison.OrdinalIgnoreCase)) return name.Substring(0, name.Length - 6);
            if (name.EndsWith("_start", StringComparison.OrdinalIgnoreCase)) return name.Substring(0, name.Length - 6);
            if (name.EndsWith("_loop", StringComparison.OrdinalIgnoreCase)) return name.Substring(0, name.Length - 5);
            if (name.EndsWith("_end", StringComparison.OrdinalIgnoreCase)) return name.Substring(0, name.Length - 4);
            return name;
        }

        private AnimationClip Lookup(string name)
        {
            AnimationClip c;
            return clipAssets.TryGetValue(name, out c) ? c : null;
        }

        private void BuildSequence(string clipName)
        {
            var names = new List<string>();
            var clips = new List<AnimationClip>();
            string baseName = StripSuffix(clipName);
            AnimationClip self = Lookup(clipName);
            // 大脑已经把一组动作拆成 start / loop / end 三条独立 cue 分别下发，
            // 这里只能播它点名的那一段。从前无论传哪一段都会拼成完整组，
            // 于是每条 cue 都从头演一遍 start > loop > end，三条 cue 就叠成三次，
            // 观感是头部反复抽动（2026-11-14 修）。
            bool isSegment = clipName.EndsWith("_start", StringComparison.OrdinalIgnoreCase)
                || clipName.EndsWith("_loop", StringComparison.OrdinalIgnoreCase)
                || clipName.EndsWith("_end", StringComparison.OrdinalIgnoreCase);
            if (isSegment && self != null)
            {
                names.Add(clipName);
                clips.Add(self);
            }
            else if (self == null)
            {
                // 只给了基名：拼成完整组，让一段动画自带进出过渡
                AnimationClip start = Lookup(baseName + "_start");
                AnimationClip loop = Lookup(baseName + "_loop");
                AnimationClip end = Lookup(baseName + "_end");
                if (start != null) { names.Add(baseName + "_start"); clips.Add(start); }
                if (loop != null)
                {
                    int reps = Mathf.Clamp(Mathf.RoundToInt(1.4f / Mathf.Max(0.2f, loop.length)), 1, 5);
                    for (int i = 0; i < reps; i++) { names.Add(baseName + "_loop"); clips.Add(loop); }
                }
                if (end != null) { names.Add(baseName + "_end"); clips.Add(end); }
            }
            else
            {
                names.Add(clipName);
                clips.Add(self);
            }
            if (clips.Count == 0) { segClips = new AnimationClip[0]; segStarts = new float[1]; segTotal = 0f; return; }
            segClips = clips.ToArray();
            segStarts = new float[segClips.Length + 1];
            segTotal = 0f;
            for (int i = 0; i < segClips.Length; i++)
            {
                segStarts[i] = segTotal;
                segTotal += Mathf.Max(0.05f, segClips[i].length);
            }
            segStarts[segClips.Length] = segTotal;
            if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("sequence: " + string.Join(" > ", names.ToArray()) + " total=" + segTotal.ToString("F2"));
        }

        private static void SampleChainClip(AnimationClip c, GameObject target, float t, int resample)
        {
            c.SampleAnimation(target, Mathf.Clamp(t, 0f, Mathf.Max(0f, c.length - 0.001f)));
        }

        // 每帧：先记下游戏这一帧的姿势 → 沿时间线采样 → 旋转按包络混回去，位置保持游戏值
        private void StepClip(float ct)
        {
            if (segClips == null || segClips.Length == 0) { clipActive = false; return; }
            int n = bones.Length;
            for (int i = 0; i < n; i++)
            {
                var tr = bones[i];
                gamePos[i] = tr.localPosition;
                gameRot[i] = tr.localRotation;
            }
            float speed = clipSpeed > 0.01f ? clipSpeed : 0.62f;
            float wMax = Plugin.MotionWeight == null ? 0.72f : Mathf.Clamp01(Plugin.MotionWeight.Value);
            string firstName = segClips[0].name;
            if (firstName.StartsWith("anim_wild_", StringComparison.OrdinalIgnoreCase)) wMax *= 0.55f;
            float ts = Mathf.Clamp(ct * speed, 0f, Mathf.Max(0f, segTotal - 0.001f));
            int idx = 0;
            while (idx < segClips.Length - 1 && ts >= segStarts[idx + 1]) idx++;
            float local = ts - segStarts[idx];
            SampleChainClip(segClips[idx], clipTarget, local, 0);
            float w = wMax;
            if (ct < clipFadeIn) w = Mathf.Min(w, wMax * Mathf.SmoothStep(0f, 1f, ct / Mathf.Max(0.01f, clipFadeIn)));
            float left = clipLen - ct;
            if (left < clipFadeOut) w = Mathf.Min(w, wMax * Mathf.SmoothStep(0f, 1f, Mathf.Max(0f, left) / Mathf.Max(0.01f, clipFadeOut)));
            // 衔接：每个骨骼的旋转变化量设上限，避免切入/退出时肢体「啪」地甩过去
            float dt = Mathf.Max(0.0001f, Time.deltaTime);
            float maxDeg = (Plugin.MotionMaxDegPerSec == null ? 300f : Mathf.Max(30f, Plugin.MotionMaxDegPerSec.Value)) * dt;
            float worst = 0f;
            for (int i = 0; i < n; i++)
            {
                var tr = bones[i];
                // 专注/番茄钟：只让头和颈动，身体保持游戏自己的姿态
                if (upperOnly && (upperAllowed == null || !upperAllowed[i]))
                {
                    tr.localRotation = gameRot[i];
                    tr.localPosition = gamePos[i];
                    continue;
                }
                Quaternion want = Quaternion.Slerp(gameRot[i], tr.localRotation, w);
                Quaternion q = Quaternion.RotateTowards(lastRot[i], want, maxDeg);
                float d = Quaternion.Angle(lastRot[i], q);
                if (d > worst) worst = d;
                lastRot[i] = q;
                tr.localRotation = q;
                tr.localPosition = gamePos[i];
            }
            if (worst > dbgMaxDeg) dbgMaxDeg = worst;
            dbgFrames++;
        }

        private void EnsureBones()
        {
            if (bones != null && bones.Length > 0) return;
            var root = clipTarget != null ? clipTarget.transform : (heroine != null ? heroine.transform : null);
            if (root == null) { bones = new Transform[0]; gameRot = new Quaternion[0]; gamePos = new Vector3[0]; return; }
            var list = root.GetComponentsInChildren<Transform>(true);
            bones = list;
            gameRot = new Quaternion[list.Length];
            gamePos = new Vector3[list.Length];
            lastRot = new Quaternion[list.Length];
            for (int i = 0; i < list.Length; i++) lastRot[i] = list[i].localRotation;
            upperAllowed = new bool[list.Length];
            for (int i = 0; i < list.Length; i++)
            {
                string nm = list[i].name ?? "";
                upperAllowed[i] = nm.IndexOf("Head", StringComparison.OrdinalIgnoreCase) >= 0
                    || nm.IndexOf("Neck", StringComparison.OrdinalIgnoreCase) >= 0;
            }
            Plugin.Log.LogInfo("bones cached: " + list.Length + " under " + root.name);
        }

        private void StartClip(string clipName, bool loop, int durationMs)
        {
            EnsureBones();
            if (clipAssets.Count == 0) return;
            bool known = clipAssets.ContainsKey(clipName) || Lookup(StripSuffix(clipName) + "_loop") != null || Lookup(StripSuffix(clipName) + "_start") != null;
            if (!known) { Plugin.Log.LogWarning("clip missing: " + clipName); return; }
            Animator owner = null;
            if (!clipOwners.TryGetValue(clipName, out owner) || owner == null) owner = heroine;
            if (owner == null) return;
            clipTarget = owner.gameObject;
            if (Plugin.MotionEnabled != null && !Plugin.MotionEnabled.Value) { Plugin.Log.LogInfo("motion disabled, cue ignored: " + clipName); return; }
            if (bones != null) for (int i = 0; i < bones.Length; i++) lastRot[i] = bones[i].localRotation;
            dbgMaxDeg = 0f; dbgFrames = 0;
            BuildSequence(clipName);
            if (segClips.Length == 0) return;
            activeClip = segClips[0];
            float spd = Plugin.MotionSpeed == null ? 0.62f : Mathf.Clamp(Plugin.MotionSpeed.Value, 0.2f, 2f);
            // 时间线归 brain：cue 的 d 是这一段该占多久。放慢只在不影响播完时才生效，
            // 否则按 d 加速，保证这一段在下一条 cue 到来前演完，不会半途被切断。
            float want = durationMs > 0 ? durationMs / 1000f : 0f;
            if (want > 0.05f)
            {
                float need = segTotal / want;
                if (need > spd) spd = Mathf.Clamp(need, 0.2f, 6f);
                clipLen = want;
            }
            else
            {
                clipLen = Mathf.Clamp(segTotal / spd, 0.2f, 30f);
            }
            clipSpeed = spd;
            clipT0 = Time.time;
            clipLoop = loop;
            clipActive = true;
            if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("sample play " + clipName + " segs=" + segClips.Length + " total=" + segTotal.ToString("F2") + " wall=" + clipLen.ToString("F2") + " on " + clipTarget.name);
        }

        private void PlayAnim(string idOrName, int durationMs)
        {
            if (clipOwners.Count == 0) return;
            string name = AnimIdMap.Resolve(idOrName);
            if (string.IsNullOrEmpty(name))
            {
                Plugin.Log.LogWarning("anim id unknown: " + idOrName);
                return;
            }
            Animator target = null;
            string playName = name;
            if (!clipOwners.TryGetValue(name, out target) || target == null)
            {
                target = null;
                foreach (var kv in clipOwners)
                {
                    if (kv.Key.EndsWith(name, StringComparison.OrdinalIgnoreCase) && kv.Value != null)
                    {
                        target = kv.Value;
                        playName = kv.Key;
                        break;
                    }
                }
            }
            if (target == null)
            {
                string token = name.LastIndexOf('_') >= 0 ? name.Substring(name.LastIndexOf('_') + 1) : name;
                var sample = new System.Text.StringBuilder();
                int hits = 0;
                foreach (var k in clipNames)
                {
                    if (k.IndexOf(token, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    sample.Append(k).Append(',');
                    if (++hits >= 8) break;
                }
                Plugin.Log.LogWarning("anim not in any controller: " + idOrName + " (" + name + ") like[" + token + "]=" + sample);
                return;
            }
            // 不调 CrossFade：那会跟游戏自己的状态机抢，且它要 state 名不是 clip 名，
            // 大多数情况静默无效，还会让 SampleAnimation 的双驱动产生抖动
            StartClip(playName, false, durationMs);
            if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("play " + playName + " (" + idOrName + ") d=" + durationMs + " on " + target.gameObject.name);
        }
        // 大脑给的是 /chill/v1/audio/xxx.wav（相对站点根），BaseUrl 已经带 /chill/v1，
        // 直接拼接会变成 /chill/v1/chill/v1/... 404，所以这里按前缀归一化。
        private string ResolveAudioUrl(string p)
        {
            if (string.IsNullOrEmpty(p)) return "";
            if (p.StartsWith("http")) return p;
            string origin = BaseUrl;
            int cut = origin.IndexOf("/chill/", StringComparison.Ordinal);
            if (cut > 0) origin = origin.Substring(0, cut);
            if (p.StartsWith("/chill/")) return origin + p;
            if (p.StartsWith("/")) return BaseUrl + p;
            return BaseUrl + "/" + p;
        }
        // —— 混音器路由 —————————————————————————————————————————————
        // 目标：她的语音和游戏里那一路共用混音器组，玩家拉低或静音那一路，她一起静。
        // 只用公开 API：读场里现成 AudioSource 的 outputAudioMixerGroup。
        private static string GroupLabel(AudioMixerGroup g)
        {
            if (g == null) return "";
            string mixer = (g.audioMixer != null) ? g.audioMixer.name : "?";
            return mixer + "/" + g.name;
        }

        private static AudioMixerGroup PickGroup(string patterns, List<AudioMixerGroup> cands)
        {
            if (string.IsNullOrEmpty(patterns) || cands == null) return null;
            string[] ks = patterns.Split(',');
            for (int k = 0; k < ks.Length; k++)
            {
                string key = ks[k].Trim().ToLowerInvariant();
                if (key.Length == 0) continue;
                for (int i = 0; i < cands.Count; i++)
                {
                    var g = cands[i];
                    if (g == null) continue;
                    string hay = (g.name + " " + ((g.audioMixer != null) ? g.audioMixer.name : "")).ToLowerInvariant();
                    if (hay.Contains(key)) return g;
                }
            }
            return null;
        }

        private void ResolveVoiceGroup()
        {
            nextGroupTry = Time.time + 30f; // 场景里还没有带组的源时，30 秒后再看一次
            if (Plugin.FollowGameMixer == null || !Plugin.FollowGameMixer.Value)
            {
                voiceGroupLabel = "off";
                return;
            }
            var cands = GameBusy.MixerGroups();
            if (cands.Count == 0)
            {
                voiceGroupLabel = "none";
                Plugin.Log.LogInfo("mixer: no audio source carries a mixer group yet");
                return;
            }
            var names = new List<string>();
            for (int i = 0; i < cands.Count; i++) names.Add(GroupLabel(cands[i]));
            Plugin.Log.LogInfo("mixer candidates: " + string.Join(", ", names.ToArray()));
            var pick = PickGroup(Plugin.MixerGroupMatch.Value, cands);
            if (pick == null) pick = PickGroup(Plugin.MixerGroupFallback.Value, cands);
            if (pick == null)
            {
                voiceGroup = null;
                voiceGroupLabel = "none";
                Plugin.Log.LogInfo("mixer: nothing matched (match=" + Plugin.MixerGroupMatch.Value + " fallback=" + Plugin.MixerGroupFallback.Value + "), keeping own output");
                return;
            }
            voiceGroup = pick;
            voiceGroupLabel = GroupLabel(pick);
            // 顺手把这一路当前的音量读数记下来：玩家拉低或静音时，这个数字会变，
            // 用它就能自证"她确实挂在游戏那一路电平上"，不用靠耳朵。
            try
            {
                float db;
                string pname = pick.name + "Volume";
                if (pick.audioMixer != null && pick.audioMixer.GetFloat(pname, out db))
                    Plugin.Log.LogInfo("mixer level: " + pname + "=" + db.ToString("F1") + " dB");
                else if (pick.audioMixer != null && pick.audioMixer.GetFloat("MasterVolume", out db))
                    Plugin.Log.LogInfo("mixer level: MasterVolume=" + db.ToString("F1") + " dB");
            }
            catch (Exception e) { Plugin.Log.LogInfo("mixer level: unavailable (" + e.Message + ")"); }
            if (audioSource != null) audioSource.outputAudioMixerGroup = pick;
            Plugin.Log.LogInfo("mixer: voice -> " + voiceGroupLabel);
        }

        private void ApplyVoiceGroup()
        {
            if (audioSource == null) return;
            if (Plugin.FollowGameMixer == null || !Plugin.FollowGameMixer.Value)
            {
                audioSource.outputAudioMixerGroup = null;
                voiceGroupLabel = "off";
                return;
            }
            if (voiceGroup == null && Time.time >= nextGroupTry) ResolveVoiceGroup();
            if (voiceGroup != null && audioSource.outputAudioMixerGroup != voiceGroup) audioSource.outputAudioMixerGroup = voiceGroup;
        }

        // —— 表演队列 ——————————————————————————————————————————————
        // 严格先来先演、不打断：正在说的那句一定说完，队里按 seq 顺序接着来。
        // 大脑端与这里各排各的队，互不同步；两边唯一的共同约定是 seq 与 TTL。
        private void Enqueue(ActDto dto, int seq, string src)
        {
            if (dto == null) return;
            if (Plugin.QueueEnabled == null || !Plugin.QueueEnabled.Value)
            {
                // 回滚路径：只留最新一条（0.10.1 及以前的行为）
                pending.Clear();
                pending.Add(new PendingAct { dto = dto, seq = seq, at = Time.unscaledTime, src = src });
                return;
            }
            for (int i = 0; i < pending.Count; i++) if (pending[i].seq == seq) return;
            int max = Plugin.QueueMax == null ? 4 : Mathf.Max(1, Plugin.QueueMax.Value);
            while (pending.Count >= max)
            {
                int oldest = pending[0].seq;
                pending.RemoveAt(0);
                qDropped++;
                Plugin.Log.LogInfo("queue: dropped oldest seq=" + oldest + " (full)");
            }
            pending.Add(new PendingAct { dto = dto, seq = seq, at = Time.unscaledTime, src = src });
            if (pending.Count > qMaxDepth) qMaxDepth = pending.Count;
        }

        private void PruneExpired()
        {
            int ttl = Plugin.QueueTtlMs == null ? 20000 : Mathf.Max(0, Plugin.QueueTtlMs.Value);
            if (ttl <= 0) return;
            float now = Time.unscaledTime;
            for (int i = pending.Count - 1; i >= 0; i--)
            {
                float age = now - pending[i].at;
                if (age > ttl / 1000f)
                {
                    Plugin.Log.LogInfo("queue: expired seq=" + pending[i].seq + " age=" + age.ToString("F1") + "s");
                    pending.RemoveAt(i);
                    qExpired++;
                }
            }
        }

        private IEnumerator PerformLoop()
        {
            while (true)
            {
                if (pending.Count == 0) { yield return new WaitForSecondsRealtime(0.2f); continue; }
                PruneExpired();
                if (performing) { yield return new WaitForSecondsRealtime(0.1f); continue; }
                // 上一句还在响或动作还没收尾：等它，绝不打断
                if (audioSource != null && audioSource.isPlaying) { yield return new WaitForSecondsRealtime(0.1f); continue; }
                if (clipActive) { yield return new WaitForSecondsRealtime(0.1f); continue; }
                // 游戏在演它自己的剧情/台词：让台，不插嘴；队里的按 TTL 自然过期
                if (GameBusy.IsHard)
                {
                    if (Plugin.VerboseCues != null && Plugin.VerboseCues.Value)
                        Plugin.Log.LogInfo("queue: yielding to game (" + GameBusy.Reason + ") depth=" + pending.Count);
                    yield return new WaitForSecondsRealtime(0.5f);
                    continue;
                }
                var item = pending[0];
                pending.RemoveAt(0);
                performing = true;
                qPlayed++;
                string subText = (item.dto.subtitle == null || string.IsNullOrEmpty(item.dto.subtitle.text)) ? "-" : item.dto.subtitle.text;
                Plugin.Log.LogInfo("queue: play seq=" + item.seq + " depth=" + pending.Count + " waited=" + (Time.unscaledTime - item.at).ToString("F1") + "s cues=" + (item.dto.performance == null ? 0 : item.dto.performance.Length) + " sub=" + subText);
                yield return StartCoroutine(Perform(item.dto));
                // 等这一条真的演完（语音播完 + 动作收尾），30 秒兜底防卡死
                float until = Time.unscaledTime + 30f;
                while (Time.unscaledTime < until && ((audioSource != null && audioSource.isPlaying) || clipActive))
                    yield return null;
                int gap = Plugin.QueueGapMs == null ? 250 : Mathf.Max(0, Plugin.QueueGapMs.Value);
                if (gap > 0) yield return new WaitForSecondsRealtime(gap / 1000f);
                performing = false;
            }
        }

        private IEnumerator PlayAudio(string urlOrPath)
        {
            if (audioSource == null) yield break;
            // HTTP 路由（/chill/v1/audio/*）在部分版本里匹配不到，磁盘直读更稳：
            // 大脑已经把 wav 落在 audio 目录，用 file:// URI 交给 UnityWebRequest。
            string url = "";
            try
            {
                string dir = Plugin.AudioDir == null ? "" : Plugin.AudioDir.Value;
                string name = System.IO.Path.GetFileName(urlOrPath == null ? "" : urlOrPath.Split('?')[0]);
                if (!string.IsNullOrEmpty(dir) && !string.IsNullOrEmpty(name))
                {
                    string file = System.IO.Path.Combine(dir, name);
                    if (System.IO.File.Exists(file)) url = new Uri(file).AbsoluteUri;
                }
            }
            catch (Exception e) { Plugin.Log.LogWarning("audio path: " + e.Message); }
            if (string.IsNullOrEmpty(url)) url = ResolveAudioUrl(urlOrPath);
            if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("audio url: " + url);
            // 不能用 using：DownloadHandlerAudioClip 把音频数据挂在请求上，
            // 请求一 Dispose，clip 当场失效 —— 语音只响一帧或者干脆没声。
            // 改成请求和 clip 都保活到播完再释放。
            var req = UnityWebRequestMultimedia.GetAudioClip(url, AudioType.WAV);
            if (req == null)
            {
                lastError = "audio: request create failed";
                Plugin.Log.LogWarning(lastError);
                yield break;
            }
            req.timeout = 30;
            yield return req.SendWebRequest();
            if (req.isNetworkError || req.isHttpError)
            {
                lastError = "audio: " + req.error;
                Plugin.Log.LogWarning(lastError);
                req.Dispose();
                yield break;
            }
            var clip = DownloadHandlerAudioClip.GetContent(req);
            if (clip == null)
            {
                req.Dispose();
                yield break;
            }
            if (audioSource.isPlaying) audioSource.Stop(); // 上一句没播完就叠音
            ApplyVoiceGroup(); // 挂上游戏混音器组；音量从此是"在游戏电平之上再乘"
            audioSource.PlayOneShot(clip, Plugin.VoiceVolume.Value);
            mouthDur = clip.length;
            mouthT0 = Time.time;
            mouthActive = mouthCount >= 2 && mouthIdx[0] >= 0;
            if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("mouth: frames=" + mouthCount + " fps=" + mouthFps + " audioLen=" + clip.length.ToString("F2") + " active=" + mouthActive);
            if (mouthActive && Plugin.AutoShots != null && Plugin.AutoShots.Value) StartCoroutine(AutoShoot(mouthDur));
            StartCoroutine(ReleaseAudioLater(req, clip));
        }

        // 播完再放：clip 的所有权在请求上，提前 Dispose 就是静音
        private IEnumerator ReleaseAudioLater(UnityWebRequest req, AudioClip clip)
        {
            yield return new WaitForSecondsRealtime(clip != null ? clip.length + 0.5f : 1f);
            if (clip != null) UnityEngine.Object.Destroy(clip);
            if (req != null) req.Dispose();
        }

        // 构建引用里没有 ScreenCapture，走反射调用；截图用于肉眼核对表演效果
        internal static void TakeShot(string fileName)
        {
            try
            {
                string path = System.IO.Path.Combine(BepInEx.Paths.BepInExRootPath, fileName);
                var t = Type.GetType("UnityEngine.ScreenCapture, UnityEngine");
                if (t == null) t = Type.GetType("UnityEngine.ScreenCapture, UnityEngine.CoreModule");
                if (t == null) { Plugin.Log.LogWarning("shot: ScreenCapture type missing"); return; }
                var m = t.GetMethod("CaptureScreenshot", new Type[] { typeof(string) });
                if (m == null) { Plugin.Log.LogWarning("shot: method missing"); return; }
                m.Invoke(null, new object[] { path });
                Plugin.Log.LogInfo("shot -> " + path);
            }
            catch (Exception e) { Plugin.Log.LogWarning("shot failed: " + e.Message); }
        }
        private void EnsureStyles()
        {
            if (subtitleStyle != null) return;
            subtitleStyle = new GUIStyle(GUI.skin.label);
            subtitleStyle.fontSize = 22;
            subtitleStyle.alignment = TextAnchor.MiddleCenter;
            subtitleStyle.wordWrap = true;
            subtitleStyle.normal.textColor = Color.white;
        }

        // 游戏内只剩字幕层：对话、动作、语音全部由 DSH 控制台驱动，不再有 F8 面板。
        private void OnGUI()
        {
            if (NativeSubtitle.Ready && (Plugin.NativeSubtitle == null || Plugin.NativeSubtitle.Value)) return;
            EnsureStyles();
            if (Plugin.ShowSubtitle == null || !Plugin.ShowSubtitle.Value) return;
            if (string.IsNullOrEmpty(subtitle) || Time.time >= subtitleUntil) return;
            float w = Mathf.Min(Screen.width * 0.72f, 900f);
            var rect = new Rect((Screen.width - w) / 2f, Screen.height - 150f, w, 90f);
            var old = GUI.color;
            GUI.color = new Color(0f, 0f, 0f, 0.55f);
            GUI.DrawTexture(rect, Texture2D.whiteTexture);
            GUI.color = old;
            GUI.Label(new Rect(rect.x + 12f, rect.y + 8f, rect.width - 24f, rect.height - 16f), subtitle, subtitleStyle);
        }
    }
    internal static class Json
    {
        internal static string Quote(string s)
        {
            if (s == null) return "null";
            var sb = new StringBuilder(s.Length + 8);
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }
    }
}
