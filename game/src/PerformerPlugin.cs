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
        internal static ConfigEntry<float> BodyBurstScale;
        internal static ConfigEntry<float> HeadBurstScale;
        internal static ConfigEntry<float> SwitchBlendMs;
        internal static ConfigEntry<int> BacklogTtlMs;
        internal static ConfigEntry<float> SpeedCap;
        internal static ConfigEntry<float> BodyDegBudget;
        internal static ConfigEntry<float> HeadDegBudget;
        internal static ConfigEntry<float> BodySpeedBudget;
        internal static ConfigEntry<float> HeadSpeedBudget;
        internal static ConfigEntry<float> MaxSlowdown;
        internal static ConfigEntry<float> HeadWeight;
        internal static ConfigEntry<int> HeadFadeMs;
        internal static ConfigEntry<int> ReleaseMs;
        internal static ConfigEntry<bool> IdleSwap;
        internal static ConfigEntry<string> IdleSwapClip;
        internal static ConfigEntry<int> IdleSwapFadeMs;
        internal static ConfigEntry<string> IdleSwapStory;
        internal static ConfigEntry<string> IdleSwapBreak;
        internal static ConfigEntry<string> IdleSwapWild;
        internal static ConfigEntry<float> MaxClipSec;
        internal static ConfigEntry<int> RepeatWindowMs;
        internal static ConfigEntry<int> FamilyGraceMs;
        internal static ConfigEntry<float> MotionWeightCeil;
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
            MotionMaxDegPerSec = Config.Bind("motion", "MaxDegPerSec", 300f, "Deprecated and unused since 0.10.1: bones are no longer rate-limited. Kept only so old cfg files still load.");
            BodyBurstScale = Config.Bind("motion", "BodyBurstScale", 3f, "Big gestures (yawn, stretch, standing up) may reach this many times the body budget before being scaled down. Without it a 150-degree stretch is squashed to 17 percent and stops reading as a stretch.");
            HeadBurstScale = Config.Bind("motion", "HeadBurstScale", 1.5f, "Same as BodyBurstScale for the head.");
            SwitchBlendMs = Config.Bind("motion", "SwitchBlendMs", 200f, "Cross-fade length when a new cue starts, measured from the pose actually on screen. Without it the previous cue's pose vanishes in a single frame (measured 186 deg/s head spike).");
            BacklogTtlMs = Config.Bind("interop", "BacklogTtlMs", 20000, "On the first pull after startup, cues older than this many ms are last session leftovers and get dropped; newer ones still play, so a push made just before startup is not swallowed.");
            SpeedCap = Config.Bind("motion", "SpeedCap", 1.25f, "Upper bound on speeding a clip up to fit a cue's d. Slowing down is handled by the speed budget.");
            // —— 演出预算（0.10.1 重构的核心）——
            // 旧做法：先按 clip 演，再用限速/限幅/低通把"过头"的部分砍掉。砍掉的是曲线形状，
            // 被削平的峰会在频域里长出谐波，肉眼看到的就是"点一下变成连点好几下"。
            // 新做法：播之前量出这段 clip 的峰值幅度与峰值角速度，再乘一个系数把整体缩进预算。
            // 乘法只改大小不改形状 —— 既不会抽，也不会凭空多出动作。
            BodyDegBudget = Config.Bind("motion", "BodyDegBudget", 26f, "Peak deviation budget (deg) for the body. Clip poses beyond it are scaled down via blend weight.");
            HeadDegBudget = Config.Bind("motion", "HeadDegBudget", 15f, "Peak deviation budget (deg) for Head/Neck. Smaller than the body because the head is what reads as twitchy.");
            BodySpeedBudget = Config.Bind("motion", "BodySpeedBudget", 320f, "Peak angular speed budget (deg/s) for the body. Excess is removed by slowing the clip, never by clipping bones.");
            HeadSpeedBudget = Config.Bind("motion", "HeadSpeedBudget", 160f, "Peak angular speed budget (deg/s) for Head/Neck.");
            MaxSlowdown = Config.Bind("motion", "MaxSlowdown", 1.6f, "How far a clip may be slowed to respect the speed budget (1.6 = at most 1/1.6 of its own pace).");
            HeadWeight = Config.Bind("motion", "HeadWeight", 1f, "Extra multiplier on the head's budget weight.");
            HeadFadeMs = Config.Bind("motion", "HeadFadeMs", 320, "Head/Neck fade length in ms; longer than the body so a nod eases in instead of jerking.");
            ReleaseMs = Config.Bind("motion", "ReleaseMs", 300, "Blend back to the game pose over this many ms after the clip ends.");
            IdleSwap = Config.Bind("motion", "IdleSwap", false, "On clip end, cross-fade the game animator to IdleSwapClip instead of blending back to a stale pose: the game keeps owning the skeleton, we just stop writing.");
            IdleSwapClip = Config.Bind("motion", "IdleSwapClip", "anim_story_subbase_002_base_loop", "Clip/state the game animator is cross-faded to when a performance ends.");
            IdleSwapFadeMs = Config.Bind("motion", "IdleSwapFadeMs", 300, "Cross-fade length for the idle swap, in ms.");
            // 收尾待机按层选：演完让游戏切回她"这一层本来就该有的待机"，只是换成与结束姿势最接近的那一个。
            // 实测游戏自己的待机状态机会一直往下切（tea_sub_unique001_* → tea_base_loop），
            // 所以持久接管 idle 不成立；能做的只是把收尾那一次切换指到更合适的待机。
            IdleSwapStory = Config.Bind("motion", "IdleSwapStory", "anim_story_subbase_002_base_loop", "Closing idle for story-layer performances.");
            IdleSwapBreak = Config.Bind("motion", "IdleSwapBreak", "anim_break_tea_base_loop", "Closing idle for break-layer performances.");
            IdleSwapWild = Config.Bind("motion", "IdleSwapWild", "anim_wild_tired2_loop", "Closing idle for wild-layer performances.");
            MaxClipSec = Config.Bind("motion", "MaxClipSec", 8f, "Hard ceiling on how long one cue may own the skeleton.");
            RepeatWindowMs = Config.Bind("motion", "RepeatWindowMs", 1500, "Asking for the same clip again inside this window keeps the running performance instead of restarting it.");
            FamilyGraceMs = Config.Bind("motion", "FamilyGraceMs", 1500, "A follow-up cue of the SAME family (X_start -> X_loop -> X_end) inside this window continues the timeline.");
            MotionWeightCeil = MotionWeight;

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
        private int dbgClamped;
        private float dbgClampMax;
        private float dbgEntryDeg;
        // —— 演出计划（播之前量出来，播的时候只做乘法）——
        private float planWBody = 1f;
        private float planWHead = 1f;
        private float planSpeed = 1f;
        // clip 第一帧的姿势：把"姿势偏移"与"动作摆动"分开处理要用到
        private Quaternion[] clipBaseRot;
        private bool keepClipBase;
        // 族级增益：一条动作常被拆成 _start / _loop / _end 三段分别下发。
        // 若每段各按自己的峰值算增益，loop 段（几乎不动）会算出 1.0，而 start 段被压到 0.33，
        // 于是循环点上身体突然放大三倍。整族必须用同一个增益，段与段之间才不会跳。
        private readonly Dictionary<string, float> familyGainBody = new Dictionary<string, float>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, float> familyGainHead = new Dictionary<string, float>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, float> familyPeakBody = new Dictionary<string, float>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, float> familyPeakHead = new Dictionary<string, float>(StringComparer.OrdinalIgnoreCase);
        private string planFamily = "";
        // 当前 clip 的分类策略：决定叠加式还是绝对过渡、预算多少、能否变速
        private MotionProfile profile = MotionProfile.For(ClipClass.Unknown);
        private ClipClass currentClass = ClipClass.Idle;
        private float switchMsFromClass = 260f;
        private bool inAbsolute;
        private float absRampT0 = -999f;
        // 换段/换族时的交叉淡化起点：新动作从"当前可见姿势"混过去，
        // 而不是从游戏姿势重新起算——否则上一段的偏移会在一帧内消失（实测 186°/s 尖峰）。
        // 游戏自身待机姿势的缓存：演出期间不许重抓，否则会把我们自己的输出当基底
        private Quaternion[] baseGameRot;
        private Vector3[] baseGamePos;
        private bool baseGameValid;
        // 演出期间相对"游戏待机姿势"的最大推离角度：验收用这个，不用 dps
        private float dbgPushHead;
        private float dbgPushBody;
        private string dbgPushName = "";
        private string dbgPushHeadName = "";
        private float dbgPushW;
        // 段内幅度：相对本段第一帧采样的角差。与 plan（段内峰值）同量纲，才能比较。
        // 旧的 push 量的是离待机多远，跟 plan 不是一个东西，放在一起比只会误导。
        private Quaternion[] ampStart;
        private bool ampStartValid;
        private float dbgAmpHead;
        private float dbgAmpBody;
        private string dbgAmpHeadName = "";
        private string dbgAmpName = "";
        private float dbgAmpW;
        // 归还过渡的目标：演完时"游戏此刻会把她摆成什么样"，现场求值后读出
        private Quaternion[] exitRot;
        private Quaternion[] exitFrom;    // 放手前我们的输出，用来量离待机还有多远
        private float exitRelSec = 0.30f;   // 归还时长：按离游戏姿势的距离算，不是固定 300ms
        private float exitEndT;             // clipLen + exitRelSec
        private bool exitValid;
        // 排队衔接：上一套演完时后面还有动作，就用她的最后姿势当下一套的起点，
        // 省掉「归还待机 → 再起手」这一整段。
        private bool chainEntry;
        private Quaternion[] prevPose;
        // prevPose 是否真的装着"上一次可见姿势"；没装着就不许淡化
        private bool prevPoseValid;
        private float switchT0 = -999f;
        private float planBodyPeakDeg;
        private float planHeadPeakDeg;
        private float planBodyPeakSpd;
        private float planHeadPeakSpd;
        private int planSamples;
        // —— 实时遥测（只观察，不参与运算）——
        private float headDevDeg;
        private float headSpeedMax;
        // 尖峰定位：峰值角速度发生在第几秒、那一帧 dt 多少（判断是真空跳还是 dt 量化）
        private float dbgPeakAt;
        private float dbgPeakDt;
        private string dbgPeakBone = "";
        private float dbgExitDeg;
        private float dbgExitSec;
        private int headIdx = -1;
        // —— 同族续演 / 重复跳过 ——
        private string activeBase = "";
        private float lastFamilyEnd = -999f;
        private float clipStartWall;
        private int skippedRepeat;
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
        // 首次拉取的年龄门槛：比它旧的条目算上次会话旧账，不重播；新的照演
        private long bootSkipAtMs;
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
            sb.Append(",\"motion\":{\"class\":\"").Append(MotionRules.Label(profile.Class))
              .Append("\",\"mode\":\"").Append(profile.Additive ? "additive" : "absolute")
              .Append("\",\"wBody\":").Append(planWBody.ToString("F2"))
              .Append(",\"wHead\":").Append(planWHead.ToString("F2"))
              .Append(",\"speedFactor\":").Append(planSpeed.ToString("F2"))
              .Append(",\"bodyPeakDeg\":").Append(planBodyPeakDeg.ToString("F1"))
              .Append(",\"headPeakDeg\":").Append(planHeadPeakDeg.ToString("F1"))
              .Append(",\"bodyPeakSpd\":").Append(planBodyPeakSpd.ToString("F0"))
              .Append(",\"headPeakSpd\":").Append(planHeadPeakSpd.ToString("F0"))
              .Append(",\"headDevDeg\":").Append(headDevDeg.ToString("F1"))
              .Append(",\"headSpeed\":").Append(headSpeedMax.ToString("F0"))
              .Append(",\"remainingMs\":").Append(clipActive ? Mathf.Max(0f, (clipLen + (Plugin.ReleaseMs == null ? 300f : Plugin.ReleaseMs.Value) / 1000f - (Time.time - clipT0)) * 1000f) : 0f)
                .Append(",\"skippedRepeat\":").Append(skippedRepeat)
              .Append(",\"active\":\"").Append(Js(clipActive && activeClip != null ? activeClip.name : ""))
              .Append("\",\"base\":\"").Append(Js(activeBase)).Append("\"}");
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
                    // 开机自检：大脑里可能留着上次会话的旧条目，也可能有刚推来的指令。
                    // 一律丢弃会把"刚推的那条"一起吞掉（测试时要重推两三次就是这么来的），
                    // 所以只按年龄丢：超过 BacklogTtlMs 的算旧账，新的照演。
                    if (!bootSynced)
                    {
                        bootSynced = true;
                        int ttlMs = Plugin.BacklogTtlMs == null ? 20000 : Mathf.Clamp(Plugin.BacklogTtlMs.Value, 0, 600000);
                        bootSkipAtMs = NowUnixMs() - ttlMs;
                        if (headSeq > 0) Plugin.Log.LogInfo("pull: startup sync, drop backlog older than " + ttlMs + "ms (seq=" + headSeq + ", local=" + feedSeq + ")");
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
                        if (bootSkipAtMs > 0)
                        {
                            long atMs = JsonLite.Int(JsonLite.Get(d, "at"));
                            if (atMs > 0 && atMs < bootSkipAtMs)
                            {
                                if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("pull: drop stale cue at=" + atMs);
                                continue;
                            }
                        }
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
                float relForEnd = (Plugin.ReleaseMs == null ? 300f : Mathf.Max(30f, Plugin.ReleaseMs.Value)) / 1000f;
                // 多留一个归还窗口：这段时间里 StepClip 把姿势淡回游戏状态，之后才真正放手
                float endAt = exitValid ? exitEndT : clipLen + relForEnd;
                if (ct > (clipLoop ? clipLen : endAt))
                {
                    if (clipLoop) ct = clipLen > 0.01f ? ct % clipLen : 0f;
                    else
                    {
                        // 交接差 = 放手瞬间我们的输出与游戏姿势的最大角差。
                        // 这是回归过渡有没有做好的硬指标：接近 0 就是无缝交回。
                        float handoff = -1f;
                        if (exitValid && exitRot != null && bones != null)
                        {
                            handoff = 0f;
                            for (int b = 0; b < bones.Length && b < exitRot.Length; b++)
                            {
                                if (bones[b] == null) continue;
                                float d = Quaternion.Angle(bones[b].localRotation, exitRot[b]);
                                if (d > handoff) handoff = d;
                            }
                        }
                        // 回归：直接改她正在跑的待机，然后放手。不回写姿势 —— 那会踩掉游戏自己的淡入。
                        if (Plugin.IdleSwap.Value && activeClip != null)
                        {
                            string closeIdle = PickClosingIdle(activeClip.name);
                            if (!string.IsNullOrEmpty(closeIdle)) ProbeIdleSwap(closeIdle);
                        }
                        if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("handoff dev=" + handoff.ToString("F2") + "deg rel=" + (exitRelSec * 1000f).ToString("F0") + "ms pending=" + pending.Count);
                        // 衔接：下一套从她"此刻的姿势"起步，而不是从待机重新起手
                        if (HasAnimPending())
                        {
                            if (prevPose != null && bones != null)
                                for (int b = 0; b < bones.Length && b < prevPose.Length; b++)
                                    if (bones[b] != null) prevPose[b] = bones[b].localRotation;
                            prevPoseValid = true;
                            chainEntry = true;
                            if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("chain: 下一套接上（起点=当前姿势）");
                        }
                        clipActive = false; ReleaseBaseGameCache(); exitValid = false;
                        lastFamilyEnd = Time.time;
                        Plugin.Log.LogInfo("clip done: " + activeClip.name + " frames=" + dbgFrames
                            + " peakHead=" + headSpeedMax.ToString("F0") + "dps@t" + dbgPeakAt.ToString("F2") + "s/dt" + (dbgPeakDt * 1000f).ToString("F1") + "ms dev=" + headDevDeg.ToString("F1") + "deg"
                + " amp=head" + dbgAmpHead.ToString("F1") + "/body" + dbgAmpBody.ToString("F1") + "deg"
                + " clamp=" + dbgClamped + "\u00b0" + dbgClampMax.ToString("F0") + "d"
                + " moved=head:" + ((dbgAmpHead >= Mathf.Max(1f, planHeadPeakDeg * 0.32f)) ? 1 : 0)
                + "/body:" + ((dbgAmpBody >= Mathf.Max(1f, planBodyPeakDeg * 0.32f)) ? 1 : 0)
                + ((planHeadPeakDeg > 2f && dbgAmpHead < 1f) || (planBodyPeakDeg > 2f && dbgAmpBody < 1f) ? " MISS" : "")
                + " plan=head" + planHeadPeakDeg.ToString("F1") + "/body" + planBodyPeakDeg.ToString("F1") + "deg"
                + " bones[" + dbgAmpHeadName + "@w" + dbgAmpW.ToString("F2") + " | " + dbgAmpName + "] max=" + dbgAmpW.ToString("F2")
                + " ramp=" + (profile.RampMs).ToString("F0") + "ms abs=" + inAbsolute + " upperOnly=" + upperOnly
                            + " plan(wBody=" + planWBody.ToString("F2") + " wHead=" + planWHead.ToString("F2") + " x" + planSpeed.ToString("F2") + ")");
                    }
                }
                if (clipActive)
                {
                    try { StepClip(ct); }
                    catch (Exception e) { clipActive = false; ReleaseBaseGameCache(); Plugin.Log.LogWarning("sample failed: " + e.Message); }
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
                    clipActive = false; ReleaseBaseGameCache();
                    mouthActive = false;
                    mouthW = new float[0];
                    StartCoroutine(RebindAll());
                }
            }
            if (clipActive && (Plugin.RespectGame == null || Plugin.RespectGame.Value) && GameBusy.IsHard)
            {
                clipActive = false; ReleaseBaseGameCache();
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
            // clipdump：把完整动作集打到日志（含所属控制器与时长），供离线生成动作全表。
            // 纯输出，不碰任何游戏资源。
            if (Plugin.VerboseCues != null && Plugin.VerboseCues.Value)
            {
                var seenDump = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
                var animators2 = Resources.FindObjectsOfTypeAll<Animator>();
                foreach (var a2 in animators2)
                {
                    if (a2 == null || a2.runtimeAnimatorController == null) continue;
                    string owner = a2.gameObject != null ? a2.gameObject.name : "-";
                    string ctrl = a2.runtimeAnimatorController.name ?? "-";
                    foreach (var c2 in a2.runtimeAnimatorController.animationClips)
                    {
                        if (c2 == null || string.IsNullOrEmpty(c2.name)) continue;
                        if (!seenDump.Add(owner + "/" + c2.name)) continue;
                        Plugin.Log.LogInfo("clipdump " + owner + " " + ctrl + " " + c2.name + " " + c2.length.ToString("F3"));
                    }
                }
            }
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

        // 宽松查找：精确 → 忽略大小写 → 最短后缀命中 → 最短前缀命中。
        // 大脑点名的可能是 `X_loop` 这种分段，而资产里的名字可能带前缀或大小写差异；
        // 查不到就会退化成"拼整组"，一条 cue 演成整段，是以前动作反复的主因。
        private AnimationClip LookupLoose(string name, out string found)
        {
            found = null;
            if (string.IsNullOrEmpty(name)) return null;
            AnimationClip c = Lookup(name);
            if (c != null) { found = name; return c; }
            string best = null;
            foreach (var kv in clipAssets)
            {
                if (kv.Value == null) continue;
                if (string.Equals(kv.Key, name, StringComparison.OrdinalIgnoreCase)) { found = kv.Key; return kv.Value; }
            }
            foreach (var kv in clipAssets)
            {
                if (kv.Value == null) continue;
                if (kv.Key.EndsWith(name, StringComparison.OrdinalIgnoreCase) && (best == null || kv.Key.Length < best.Length)) { best = kv.Key; c = kv.Value; }
            }
            if (c != null) { found = best; return c; }
            foreach (var kv in clipAssets)
            {
                if (kv.Value == null) continue;
                if (kv.Key.StartsWith(name, StringComparison.OrdinalIgnoreCase) && (best == null || kv.Key.Length < best.Length)) { best = kv.Key; c = kv.Value; }
            }
            if (c != null) { found = best; return c; }
            return null;
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

        // 播之前把这段 clip 走一遍，量出"峰值幅度"和"峰值角速度"。
        // 之后所有"别太猛"的需求都用**乘法**满足：幅度超预算就降权重，速度超预算就放慢时间轴。
        // 乘法保形，截断（限速/限幅/低通）不保形——不保形就会在削平处生出额外折返，
        // 那正是"点一下看起来像连点好几下"的根源。
        private static bool clipSpeedAllowed(MotionProfile p)
        {
            // 位移类动作不许变速：走路的步频一改就滑步
            return p.SpeedWarp;
        }

        private void MeasureAndPlan(float baseSpeed)
        {
            int n = bones.Length;
            planSamples = 0;
            planWBody = 1f; planWHead = 1f; planSpeed = 1f;
            planBodyPeakDeg = 0f; planHeadPeakDeg = 0f; planBodyPeakSpd = 0f; planHeadPeakSpd = 0f;
            if (n == 0 || segClips == null || segClips.Length == 0 || segTotal < 0.05f) return;
            int samples = Mathf.Clamp(Mathf.CeilToInt(segTotal / 0.033f), 6, 90);
            float step = segTotal / Mathf.Max(1, samples - 1);
            var snap = new Quaternion[n];
            var baseRot = new Quaternion[n];
            var prevRot = new Quaternion[n];
            for (int i = 0; i < n; i++) snap[i] = bones[i].localRotation;
            float bodyDeg = 0f, headDeg = 0f, bodySpd = 0f, headSpd = 0f;
            for (int k = 0; k < samples; k++)
            {
                float tt = Mathf.Min(segTotal - 0.001f, k * step);
                int idx = 0;
                while (idx < segClips.Length - 1 && tt >= segStarts[idx + 1]) idx++;
                SampleChainClip(segClips[idx], clipTarget, tt - segStarts[idx], 0);
                for (int i = 0; i < n; i++)
                {
                    Quaternion q = bones[i].localRotation;
                    if (k == 0) { baseRot[i] = q; prevRot[i] = q; continue; }
                    float dev = Quaternion.Angle(baseRot[i], q);
                    float sp = step > 0.0001f ? Quaternion.Angle(prevRot[i], q) / step : 0f;
                    bool isHead = upperAllowed != null && i < upperAllowed.Length && upperAllowed[i];
                    if (isHead) { if (dev > headDeg) headDeg = dev; if (sp > headSpd) headSpd = sp; }
                    else { if (dev > bodyDeg) bodyDeg = dev; if (sp > bodySpd) bodySpd = sp; }
                    prevRot[i] = q;
                }
            }
            for (int i = 0; i < n; i++) bones[i].localRotation = snap[i];
            if (clipBaseRot == null || clipBaseRot.Length != n) clipBaseRot = new Quaternion[n];
            // 同族续演（X_start > X_loop > X_end）时必须沿用上一条的起始姿势：
            // 每段都拿自己的首帧当基准，offset 目标会在段边界跳一次，
            // 那一下就是实测到的 635°/s 单帧尖峰（头会"弹"一下）。
            if (!keepClipBase || clipBaseRot == null || clipBaseRot.Length != n) System.Array.Copy(baseRot, clipBaseRot, n);
            // 头骨不能靠名字挑（Character 下同时存在一根静态的 "Head" 和真正被驱动的 "Character_Head"）。
            // 直接用刚刚量到的峰值：名字带 Head 且真的在动的骨里取最大者，否则退到 upper 里最大者。
            int pickHead = -1; float pickHeadDev = 0f;
            int pickAny = -1; float pickAnyDev = 0f;
            for (int i = 0; i < n; i++)
            {
                if (upperAllowed == null || i >= upperAllowed.Length || !upperAllowed[i]) continue;
                float d = Quaternion.Angle(baseRot[i], bones[i].localRotation);
                string nm = bones[i].name ?? "";
                bool namedHead = nm.IndexOf("Head", StringComparison.OrdinalIgnoreCase) >= 0;
                if (namedHead && d > pickHeadDev) { pickHeadDev = d; pickHead = i; }
                if (d > pickAnyDev) { pickAnyDev = d; pickAny = i; }
            }
            if (pickHead >= 0 && pickHeadDev >= 1f) headIdx = pickHead;
            else if (pickAny >= 0) headIdx = pickAny;
            planSamples = samples;
            planBodyPeakDeg = bodyDeg; planHeadPeakDeg = headDeg;
            planBodyPeakSpd = bodySpd; planHeadPeakSpd = headSpd;
            float degBudgetBody = profile.BodyDeg;
            float degBudgetHead = profile.HeadDeg;
            float spdBudgetBody = Plugin.BodySpeedBudget == null ? 320f : Mathf.Max(30f, Plugin.BodySpeedBudget.Value);
            float spdBudgetHead = Plugin.HeadSpeedBudget == null ? 160f : Mathf.Max(20f, Plugin.HeadSpeedBudget.Value);
            if (!profile.Additive)
            {
                // 绝对过渡本身就慢（ramp 600~900ms），速度账已经记在过渡上，不再另设上限
                spdBudgetBody = Mathf.Max(spdBudgetBody, 900f);
                spdBudgetHead = Mathf.Max(spdBudgetHead, 420f);
            }
            float slowMax = Plugin.MaxSlowdown == null ? 1.6f : Mathf.Clamp(Plugin.MaxSlowdown.Value, 1f, 6f);
            float gainBodyCap = Plugin.MotionWeight == null ? 1f : Mathf.Clamp(Plugin.MotionWeight.Value, 0.1f, 3f);
            float gainHeadCap = Plugin.HeadWeight == null ? 2.2f : Mathf.Clamp(Plugin.HeadWeight.Value, 0.1f, 4f);
            if (segClips[0] != null && segClips[0].name.StartsWith("anim_wild_", StringComparison.OrdinalIgnoreCase))
            {
                gainBodyCap *= 0.7f;
                gainHeadCap *= 0.7f;
            }
            // 大动作（哈欠、伸懒腰、起身）不该被当成"过头"压掉，burst 给它们更高的预算线
            float burstBody = Mathf.Max(1f, profile.BodyBurst);
            float burstHead = Mathf.Max(1f, profile.HeadBurst);
            // 增益按族定：同一条动作的 _start/_loop/_end 必须共用一个数，否则循环点会突然放大
            float peakBodyFam;
            float peakHeadFam;
            if (!familyPeakBody.TryGetValue(planFamily, out peakBodyFam)) peakBodyFam = bodyDeg;
            if (!familyPeakHead.TryGetValue(planFamily, out peakHeadFam)) peakHeadFam = headDeg;
            peakBodyFam = Mathf.Max(peakBodyFam, bodyDeg);
            peakHeadFam = Mathf.Max(peakHeadFam, headDeg);
            familyPeakBody[planFamily] = peakBodyFam;
            familyPeakHead[planFamily] = peakHeadFam;
            float limitBody = Mathf.Min(peakBodyFam, degBudgetBody * burstBody);
            float limitHead = Mathf.Min(peakHeadFam, degBudgetHead * burstHead);
            float gainBody;
            if (!familyGainBody.TryGetValue(planFamily, out gainBody))
            {
                gainBody = peakBodyFam > 0.05f ? Mathf.Clamp(limitBody / peakBodyFam, 0f, gainBodyCap) : gainBodyCap;
                familyGainBody[planFamily] = gainBody;
            }
            float gainHead;
            if (!familyGainHead.TryGetValue(planFamily, out gainHead))
            {
                gainHead = peakHeadFam > 0.05f ? Mathf.Clamp(limitHead / peakHeadFam, 0f, gainHeadCap) : gainHeadCap;
                familyGainHead[planFamily] = gainHead;
            }
            planWBody = gainBody;
            planWHead = gainHead;
            float factor = 1f;
            if (clipSpeedAllowed(profile) && bodySpd > spdBudgetBody) factor = Mathf.Min(factor, spdBudgetBody / bodySpd);
            if (clipSpeedAllowed(profile) && headSpd > spdBudgetHead) factor = Mathf.Min(factor, spdBudgetHead / headSpd);
            if (factor < 1f) factor = Mathf.Max(factor, 1f / slowMax);
            planSpeed = Mathf.Clamp(factor, 0.2f, 1f);
        }
        // 每帧：记下游戏此刻的姿势 → 采样 clip → 只取 clip 相对自己首帧的"运动增量"，
        // 按权重叠在游戏姿势上。位置一律用游戏值。
        private float EnvelopeAt(float ct, bool head)
        {
            float fade = head
                ? (Plugin.HeadFadeMs == null ? 0.32f : Mathf.Max(0.02f, Plugin.HeadFadeMs.Value / 1000f))
                : clipFadeIn;
            float rel = Plugin.ReleaseMs == null ? 0.3f : Mathf.Max(0.02f, Plugin.ReleaseMs.Value / 1000f);
            float e = 1f;
            if (ct < fade) e = Mathf.Min(e, Mathf.SmoothStep(0f, 1f, ct / fade));
            float tailFrom = clipLen + (head ? rel : 0f);
            float left = tailFrom - ct;
            if (left < fade) e = Mathf.Min(e, Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(Mathf.Max(0f, left) / fade)));
            if (ct > clipLen)
            {
                float k = Mathf.Clamp01(1f - (ct - clipLen) / rel);
                e = Mathf.Min(e, Mathf.SmoothStep(0f, 1f, k));
            }
            return Mathf.Clamp01(e);
        }

        private static long NowUnixMs()
        {
            return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        }

        private void ReleaseBaseGameCache()
        {
            baseGameValid = false;
        }

        /**
         * 读出"游戏自己此刻的姿势"。
         * 不能在 LateUpdate 里直接抓 bones.localRotation —— 那上面是我们上一帧写回去的值，
         * 叠加路径会因此每帧自乘（实测 dev=119°）。让 Animator 当场重算一帧再读。
         * 起手与归还都用它。
         */
        private bool CaptureGamePose(Quaternion[] dst)
        {
            if (heroine == null || bones == null || bones.Length == 0 || dst == null) return false;
            bool was = heroine.enabled;
            if (!was) heroine.enabled = true;
            try { heroine.Update(0f); } catch { }
            for (int i = 0; i < bones.Length && i < dst.Length; i++)
            {
                if (bones[i] != null) dst[i] = bones[i].localRotation;
            }
            if (!was) heroine.enabled = was;
            return true;
        }

        /**
         * 按动作所在的层挑"收尾待机"。层不是猜的：clip 名自带场景前缀（story_/break_/wild_），
         * 那正是游戏自己的分层。回到本层待机，才不会出现"坐着演完却切到站立待机"。
         */
        private string PickClosingIdle(string finished)
        {
            string n = finished == null ? "" : finished;
            if (n.StartsWith("anim_wild_", StringComparison.Ordinal)) return Plugin.IdleSwapWild.Value;
            if (n.StartsWith("anim_break_", StringComparison.Ordinal)) return Plugin.IdleSwapBreak.Value;
            if (n.StartsWith("anim_story_", StringComparison.Ordinal)) return Plugin.IdleSwapStory.Value;
            return Plugin.IdleSwapClip.Value;
        }

        private Coroutine swapProbe;
        /**
         * 回归的新做法：不去"校准"游戏此刻的姿势，而是直接把她正在跑的待机改成另一段 idle，
         * 然后彻底放手 —— 骨架归游戏，交接差按构造为 0。
         * 唯一要验的是：游戏的状态机不会下一帧就把待机切回去。这个探针就是读它。
         */
        private void ProbeIdleSwap(string wantOverride)
        {
            if (swapProbe != null) StopCoroutine(swapProbe);
            swapProbe = StartCoroutine(ProbeIdleSwapCo(wantOverride));
        }

        private System.Collections.IEnumerator ProbeIdleSwapCo(string wantOverride)
        {
            string want = wantOverride ?? Plugin.IdleSwapClip.Value;
            if (heroine == null || string.IsNullOrEmpty(want)) yield break;
            float fade = Mathf.Max(0f, Plugin.IdleSwapFadeMs.Value) / 1000f;
            bool before = heroine.enabled;
            if (!before) heroine.enabled = true;
            try { heroine.CrossFadeInFixedTime(want, fade); } catch (Exception e) { Plugin.Log.LogWarning("idle swap failed: " + e.Message); }
            Plugin.Log.LogInfo("idle swap: -> " + want + " fade=" + (fade * 1000f).ToString("F0") + "ms");
            float[] marks = new float[] { 0.05f, 0.15f, 0.3f, 0.6f, 1.0f, 2.5f, 5.0f };
            float waited = 0f;
            for (int i = 0; i < marks.Length; i++)
            {
                yield return new WaitForSecondsRealtime(marks[i] - waited);
                waited = marks[i];
                var st = heroine.GetCurrentAnimatorStateInfo(0);
                string playing = "?";
                var infos = heroine.GetCurrentAnimatorClipInfo(0);
                if (infos != null && infos.Length > 0 && infos[0].clip != null) playing = infos[0].clip.name;
                Plugin.Log.LogInfo("idle swap @" + ((i + 1) * 1.5f).ToString("F1") + "s: state=" + st.shortNameHash + " normalized=" + st.normalizedTime.ToString("F2") + " clip=" + playing + " want=" + want + " held=" + (playing == want));
            }
        }

        private void StepClip(float ct)
        {
            if (segClips == null || segClips.Length == 0) { clipActive = false; ReleaseBaseGameCache(); return; }
            int n = bones.Length;
            // 只有没在演的时候才认为 rig 上是"游戏自己的姿势"。
            // 演出期间 rig 上是我们的输出，拿它当基底会让 delta 自乘放大。
            if (!clipActive || !baseGameValid)
            {
                if (baseGameRot == null || baseGameRot.Length != n)
                {
                    baseGameRot = new Quaternion[n];
                    baseGamePos = new Vector3[n];
                }
                // 起手：让她此刻的样子成为插入的起点（现场求值），而不是我们缓存的旧样子
                if (!CaptureGamePose(baseGameRot))
                {
                    for (int i = 0; i < n; i++) baseGameRot[i] = bones[i].localRotation;
                }
                for (int i = 0; i < n; i++) baseGamePos[i] = bones[i].localPosition;
                baseGameValid = true;
            }
            if (baseGameRot != null && baseGameRot.Length == n)
            {
                for (int i = 0; i < n; i++)
                {
                    gameRot[i] = baseGameRot[i];
                    gamePos[i] = baseGamePos[i];
                }
            }
            float speed = clipSpeed > 0.01f ? clipSpeed : 0.62f;
            float ts = Mathf.Clamp(ct * speed, 0f, Mathf.Max(0f, segTotal - 0.001f));
            int idx = 0;
            while (idx < segClips.Length - 1 && ts >= segStarts[idx + 1]) idx++;
            SampleChainClip(segClips[idx], clipTarget, ts - segStarts[idx], 0);
            // 归还阶段：我们是插入，演完必须把身体还回去。
            // 目标要现场问游戏"你现在会把她摆成什么样"；用开演前的旧姿势 = 交回去一个过期姿势。
            float relMs = Plugin.ReleaseMs == null ? 300f : Mathf.Max(30f, Plugin.ReleaseMs.Value);
            float relSec = relMs / 1000f;
            bool exiting = !clipLoop && ct > clipLen;
            if (exiting)
            {
                bool firstExit = !exitValid;
                if (exitRot == null || exitRot.Length != n) exitRot = new Quaternion[n];
                if (exitFrom == null || exitFrom.Length != n) exitFrom = new Quaternion[n];
                if (firstExit)
                {
                    // 首帧先记下"我们的输出"，再让游戏求值；顺序反了就是拿游戏刚写下的值跟自己比，距离恒 0。
                    // 这段必须只在首帧跑：每帧都覆盖 exitFrom，斜坡就等于失效，最后一帧会硬跳回待机。
                    for (int bb = 0; bb < n; bb++)
                        exitFrom[bb] = bones[bb] == null ? Quaternion.identity : bones[bb].localRotation;
                }
                // 每帧重取归还目标：交回"正在跑的那段待机"，而不是开演前的静止快照。
                exitValid = CaptureGamePose(exitRot);
                if (firstExit)
                {
                    float maxDeg = 0f;
                    if (exitValid)
                    {
                        for (int bb = 0; bb < n; bb++)
                        {
                            if (bones[bb] == null) continue;
                            float dd = Quaternion.Angle(exitFrom[bb], exitRot[bb]);
                            if (dd > maxDeg) maxDeg = dd;
                        }
                    }
                    // 距离决定归还时长：坐着点头差 5°，0.3s 够；站起来差 100°，还用 0.3s 就是被扫回去。
                    exitRelSec = Mathf.Clamp(0.30f + maxDeg / 180f, 0.30f, 0.90f);
                    // 后面还排着动作：不用等满归还窗口，但也不许为了"快"切一刀 ——
                    // 上限 0.25s 是按"这段距离最多走 0.25s"算的，下一段自己的进入过渡会接着把它走完。
                    // 带队列时压缩归还，但压缩不能违背速度预算：165° 的位移压到 0.25s 就是 663dps。
                    // 取 min(按距离, max(0.18s, 距离/400dps))：近距离仍然很快，远距离停在 400dps 以内。
                    if (HasAnimPending())
                    {
                        float chained = Mathf.Max(0.18f, maxDeg / 400f);
                        if (exitRelSec > chained) exitRelSec = chained;
                    }
                    dbgExitDeg = maxDeg;
                    dbgExitSec = exitRelSec;
                    if (Plugin.VerboseCues != null && Plugin.VerboseCues.Value)
                        Plugin.Log.LogInfo("exit: deg=" + maxDeg.ToString("F1") + " over=" + (exitRelSec * 1000f).ToString("F0") + "ms => " + (maxDeg / Mathf.Max(0.01f, exitRelSec)).ToString("F0") + "dps" + (HasAnimPending() ? " chained" : ""));
                    exitEndT = clipLen + exitRelSec;
                    if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("return: " + (exitValid ? "live idle" : "fallback") + " dist=" + maxDeg.ToString("F1") + "deg rel=" + (exitRelSec * 1000f).ToString("F0") + "ms");
                }
            }
            float kOut = 1f;
            if (exiting)
            {
                float kk = exitRelSec <= 0.001f ? 1f : Mathf.Clamp01((ct - clipLen) / exitRelSec);
                kOut = Mathf.SmoothStep(0f, 1f, 1f - kk);
            }
            if (ampStart == null || ampStart.Length != n)
            {
                ampStart = new Quaternion[n];
                ampStartValid = false;
            }
            // 基线取第一帧。注意 amp 含"进入过渡"的混合量，plan 只量 clip 自身幅度：
            // 两者不同量纲 —— 校验以 plan 为准，amp 只用来看"这一下有没有真的动"（moved）。
            bool capAmp = !ampStartValid;
            if (capAmp) ampStartValid = true;
            headDevDeg = 0f;
            float wBody = planWBody * EnvelopeAt(ct, false);
            float wHead = planWHead * EnvelopeAt(ct, true);
            float switchMs = Mathf.Clamp(switchMsFromClass, 80f, 900f);
            float kSwitch = switchMs <= 1f ? 1f : Mathf.SmoothStep(0f, 1f, Mathf.Clamp01((Time.time - switchT0) / (switchMs / 1000f)));
            float dt = Mathf.Max(0.0001f, Time.deltaTime);
            for (int i = 0; i < n; i++)
            {
                var tr = bones[i];
                bool isHead = upperAllowed != null && i < upperAllowed.Length && upperAllowed[i];
                // 说明：这里不再"只放行头骨"。upper 的正确语义是"只叠加、不搬身体"，
                // 由下方 useAdditive 实现 —— 硬锁非头骨会把抬手/前倾这些手臂动作一起吞掉，
                // 喝水的动作就退化成"歪一下头"（实测只剩 3~10°）。
                // 叠加式：base 是 clip 自己的首帧，delta 是它自己的运动量。
                // 游戏待机姿势（gameRot）始终是基底，所以不会把她"搬"到别处 ——
                // 位移式点头的根因就是拿 clip 的绝对姿势去覆盖待机姿势。
                Quaternion baseQ = (clipBaseRot != null && i < clipBaseRot.Length) ? clipBaseRot[i] : Quaternion.identity;
                Quaternion delta = Quaternion.Inverse(baseQ) * tr.localRotation;
                Quaternion q;
                // 专注态只让头和颈动，身体被锁在游戏姿势 —— 这时追求"绝对姿势"是自欺：
                // 够不到目标，却把 clip 的绝对姿态套到头上（10.5° 的动作推成 20.2° 偏移）。
                bool useAdditive = profile.Additive || upperOnly;
                if (useAdditive)
                {
                    // 手势类：叠在游戏姿态上，她不会位移
                    Quaternion baseNow = (exiting && exitValid && i < exitRot.Length) ? exitRot[i] : gameRot[i];
                    q = baseNow * ScaleDelta(delta, isHead ? wHead : wBody);
                }
                else
                {
                    // 道具/姿态/位移类：必须真的到她该去的位置，所以向绝对姿势过渡，
                    // 过渡时长由分类决定（600~900ms），不是瞬间覆盖。
                    float rampW = profile.RampMs <= 1f ? 1f : Mathf.SmoothStep(0f, 1f, Mathf.Clamp01((Time.time - absRampT0) / (profile.RampMs / 1000f)));
                    Quaternion baseNow = (exiting && exitValid && i < exitRot.Length) ? exitRot[i] : gameRot[i];
                    q = Quaternion.Slerp(baseNow, tr.localRotation, Mathf.Clamp01((isHead ? wHead : wBody) * rampW));
                }
                // 起手：从"插入那一刻的姿势"过渡进来
                if (kSwitch < 1f && prevPoseValid && prevPose != null && i < prevPose.Length)
                    q = Quaternion.Slerp(prevPose[i], q, kSwitch);
                // 归还：交回游戏此刻的姿势，而不是硬切
                if (exiting && exitValid && i < exitRot.Length)
                    q = Quaternion.Slerp(exitRot[i], q, kOut);
                // 段内幅度：这一段里，当前采样离本段第一帧最远多少度 —— 与 plan 同量纲。
                if (ampStart != null && ampStart.Length == n)
                {
                    if (capAmp) ampStart[i] = tr.localRotation;
                    else
                    {
                        float amp = Quaternion.Angle(ampStart[i], tr.localRotation);
                        if (isHead) { if (amp > dbgAmpHead) { dbgAmpHead = amp; dbgAmpHeadName = tr.name ?? ""; dbgAmpW = wHead; } }
                        else if (amp > dbgAmpBody) { dbgAmpBody = amp; dbgAmpName = tr.name ?? ""; dbgAmpW = wBody; }
                    }
                }
                // 硬限速：段边界、envelope 尾巴、clip 自己的末帧，都会在某些帧造成单帧大跳。
                // 这里按预算收口（头 160dps / 身体 320dps），任何来源的跳变都变成 1~2 帧的快速过渡，
                // 而不是一帧切过去。1.15 留一点余量，免得正常快动作被压成慢动作。
                {
                    float limDt = Mathf.Max(0.0001f, Time.deltaTime);
                    float budget = isHead
                        ? (Plugin.HeadSpeedBudget == null ? 160f : Plugin.HeadSpeedBudget.Value)
                        : (Plugin.BodySpeedBudget == null ? 320f : Plugin.BodySpeedBudget.Value);
                    float allowDeg = Mathf.Max(0.6f, budget * limDt * 1.15f);
                    float jumpDeg = Quaternion.Angle(lastRot[i], q);
                    if (jumpDeg > allowDeg)
                    {
                        q = Quaternion.Slerp(lastRot[i], q, allowDeg / jumpDeg);
                        dbgClamped++;
                        if (jumpDeg > dbgClampMax) dbgClampMax = jumpDeg;
                    }
                }
                float d = Quaternion.Angle(lastRot[i], q);
                lastRot[i] = q;
                tr.localRotation = q;
                tr.localPosition = gamePos[i];
                dbgMaxDeg = Mathf.Max(dbgMaxDeg, d);
                if (isHead)
                {
                    headDevDeg = Mathf.Max(headDevDeg, Quaternion.Angle(gameRot[i], q));
                    float spd = d / dt;
                    if (spd > headSpeedMax) { headSpeedMax = spd; dbgPeakAt = ct; dbgPeakDt = dt; dbgPeakBone = tr.name ?? ""; }
                }
            }
            dbgFrames++;
        }

        // 增量按角度轴缩放：w>1 放大手势，w<1 收敛。Slerp 权重被夹在 0..1，
        // 想"点得明显"必须自己在轴上放大，否则只能靠搬姿势。
        private static Quaternion ScaleDelta(Quaternion delta, float w)
        {
            if (Mathf.Abs(w - 1f) < 0.001f) return delta;
            float ang; Vector3 axis;
            delta.ToAngleAxis(out ang, out axis);
            if (ang > 180f) ang -= 360f;
            if (float.IsNaN(axis.x) || (axis.x == 0f && axis.y == 0f && axis.z == 0f)) return Quaternion.identity;
            return Quaternion.AngleAxis(ang * w, axis);
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
            headIdx = -1;
            for (int i = 0; i < list.Length; i++)
            {
                string nm = list[i].name ?? "";
                upperAllowed[i] = nm.IndexOf("Head", StringComparison.OrdinalIgnoreCase) >= 0
                    || nm.IndexOf("Neck", StringComparison.OrdinalIgnoreCase) >= 0;
                if (nm.IndexOf("Head", StringComparison.OrdinalIgnoreCase) >= 0
                    && (headIdx < 0 || nm.Length < (list[headIdx].name ?? "").Length)) headIdx = i;
            }
            if (headIdx < 0) for (int i = 0; i < list.Length; i++) if (upperAllowed[i]) { headIdx = i; break; }
            Plugin.Log.LogInfo("head bone: idx=" + headIdx + " name=" + (headIdx >= 0 ? list[headIdx].name : "(none)") + " upper=" + System.Array.FindAll(upperAllowed, b => b).Length);
            Plugin.Log.LogInfo("bones cached: " + list.Length + " under " + root.name);
        }

        // 队里还排着动画吗？（只看槽位，不看时间：时间由排队消费端控制）
        private bool HasAnimPending()
        {
            for (int i = 0; i < pending.Count; i++)
            {
                var dto = pending[i].dto;
                if (dto == null || dto.performance == null) continue;
                for (int k = 0; k < dto.performance.Length; k++)
                {
                    var c = dto.performance[k];
                    if (c != null && string.Equals(c.slot, "animations", StringComparison.OrdinalIgnoreCase)) return true;
                }
            }
            return false;
        }

        private void StartClip(string clipName, bool loop, int durationMs)
        {
            EnsureBones();
            if (clipAssets.Count == 0) return;
            // 名字归一：大脑点名 `X_loop`，资产里可能是 `anim_X_loop` 或大小写不同
            string normName;
            AnimationClip normClip = LookupLoose(clipName, out normName);
            if (normClip != null && !string.Equals(normName, clipName, StringComparison.Ordinal))
            {
                if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("clip name normalized: " + clipName + " -> " + normName);
                clipName = normName;
            }
            bool known = normClip != null
                || LookupLoose(StripSuffix(clipName) + "_loop", out normName) != null
                || LookupLoose(StripSuffix(clipName) + "_start", out normName) != null
                || LookupLoose(StripSuffix(clipName) + "_end", out normName) != null;
            if (!known) { Plugin.Log.LogWarning("clip missing: " + clipName); return; }
            Animator owner = null;
            if (!clipOwners.TryGetValue(clipName, out owner) || owner == null) owner = heroine;
            if (owner == null) return;
            clipTarget = owner.gameObject;
            if (Plugin.MotionEnabled != null && !Plugin.MotionEnabled.Value) { Plugin.Log.LogInfo("motion disabled, cue ignored: " + clipName); return; }
            // 重复跳过：同一段还在演（或刚演完 1.5s 内）就不再从第 0 帧重来。
            // 一条 cue 被上游重复下发时，这里就是"点了好几下"的最后一处闸门。
            float nowWall = Time.time;
            float repWin = Plugin.RepeatWindowMs == null ? 1.5f : Mathf.Max(0f, Plugin.RepeatWindowMs.Value / 1000f);
            bool stillPlaying = clipActive && (nowWall - clipStartWall) < clipLen + (Plugin.ReleaseMs == null ? 0.3f : Plugin.ReleaseMs.Value / 1000f);
            if (stillPlaying && string.Equals(clipName, activeClip == null ? "" : activeClip.name, StringComparison.OrdinalIgnoreCase) && (nowWall - clipStartWall) < repWin)
            {
                skippedRepeat++;
                if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("anim skip: repeat " + clipName + " within " + Mathf.RoundToInt((nowWall - clipStartWall) * 1000f) + "ms");
                return;
            }
            // 同族续演：X_start -> X_loop -> X_end 是同一条动作，不该每段都重新淡入
            string fam = StripSuffix(clipName);
            bool inFamily = clipActive && string.Equals(activeBase, fam, StringComparison.OrdinalIgnoreCase)
                || (fam == activeBase && (nowWall - lastFamilyEnd) < (Plugin.FamilyGraceMs == null ? 1.5f : Plugin.FamilyGraceMs.Value / 1000f));
            // chainEntry 只作标记（日志用）：淡入时长交给下面的距离公式，
            // 否则"接队"就等于强制 120ms —— 换族时那一下就是硬切。
            bool continueFamily = clipActive && string.Equals(activeBase, fam, StringComparison.OrdinalIgnoreCase)
                || (!clipActive && string.Equals(activeBase, fam, StringComparison.OrdinalIgnoreCase) && (nowWall - lastFamilyEnd) < (Plugin.FamilyGraceMs == null ? 1.5f : Plugin.FamilyGraceMs.Value / 1000f));
            if (bones != null) for (int i = 0; i < bones.Length; i++) lastRot[i] = bones[i].localRotation;
            chainEntry = false;
            dbgMaxDeg = 0f; dbgFrames = 0;
            dbgClamped = 0; dbgClampMax = 0f;
            BuildSequence(clipName);
            if (segClips.Length == 0) return;
            activeClip = segClips[0];
            activeBase = fam;
            float spd = Plugin.MotionSpeed == null ? 0.62f : Mathf.Clamp(Plugin.MotionSpeed.Value, 0.2f, 2f);
            // cue 的 d 是建议时长：允许加速到 SpeedCap 去塞进 d，但不许为了塞而把动作压成鬼畜。
            float capSpeed = Plugin.SpeedCap == null ? 1.25f : Mathf.Clamp(Plugin.SpeedCap.Value, 0.5f, 6f);
            float want = durationMs > 0 ? durationMs / 1000f : 0f;
            if (want > 0.05f && clipSpeedAllowed(profile))
            {
                float need = segTotal / want;
                if (need > spd) spd = Mathf.Min(need, capSpeed);
            }
            // 量完才知道该多快、多重：这是唯一决定"动作多大、多快"的地方
            planFamily = StripSuffix(clipName);
            // 分类：决定这一段的合成方式（叠加 / 绝对过渡）、预算与是否独占
            ClipClass cls = MotionRules.Classify(clipName);
            float transMs = MotionRules.TransitionMs(currentClass, cls);
            profile = MotionProfile.For(cls);
            if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("class " + MotionRules.Label(currentClass) + " > " + MotionRules.Label(cls) + " trans=" + transMs.ToString("F0") + "ms");
            currentClass = cls;
            switchMsFromClass = transMs;
            if (profile.Exclusive && clipActive && !continueFamily)
            {
                skippedRepeat++;
                if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("anim deferred: " + MotionRules.Label(cls) + " is exclusive, still performing " + (activeClip != null ? activeClip.name : "?"));
                return;
            }
            keepClipBase = continueFamily;
            // 从 rig 上真实的当前姿势起步：这才是"以上一个动作为初始状态"。
            // 不能抄 lastRot —— 那是我们自己上次写进去的值，首次演出时它是恒等式，
            // 淡入就等于把整个骨架从 identity 拉到待机（实测 119° 跳变）。
            if (bones != null && bones.Length > 0)
            {
                if (prevPose == null || prevPose.Length != bones.Length) prevPose = new Quaternion[bones.Length];
                for (int b = 0; b < bones.Length; b++)
                {
                    if (bones[b] != null) prevPose[b] = bones[b].localRotation;
                }
                prevPoseValid = true;
            exitValid = false;
            dbgPushHead = 0f; dbgPushBody = 0f;
            dbgAmpHead = 0f; dbgAmpBody = 0f; dbgAmpHeadName = ""; dbgAmpName = ""; ampStartValid = false;
            // 新的一段：允许下一帧重新确认游戏待机姿势（场景/坐姿可能换了）
            baseGameValid = false;
            }
            else
            {
                prevPoseValid = false;
            }
            switchT0 = Time.time;
            MeasureAndPlan(spd);
            spd *= planSpeed;
            clipSpeed = Mathf.Max(0.05f, spd);
            float natural = segTotal / clipSpeed;
            // 表演和语音解绑：一段动作就按它自己的自然时长演完。
            // 以前允许指令里的 durationMs 把它撑到 1.35 倍——那是让身体去填语音的空白。
            // 口型不在这里，走 mouthFlat/音频时间轴。
            clipLen = natural;
            float maxClipSec = Mathf.Clamp(profile.MaxSec > 0f ? profile.MaxSec : 8f, 0.5f, 40f);
            inAbsolute = !profile.Additive;
            absRampT0 = Time.time;
            clipLen = Mathf.Clamp(Mathf.Min(clipLen, maxClipSec), 0.2f, 30f);
            // 进入过渡不能是固定值：她此刻在什么姿势、这条 clip 第一帧是什么姿势，
            // 差多少度就得给多久。固定 0.45s 对 10° 的点头够用，对 100° 的起身/离座就是硬切；
            // 衔接时用 0.12s 更是一定切。所以按角差算，同族且几乎没位移时才走利落档。
            // 进入过渡按「这段动作实际要移动多少度 × 视觉速度上限」算，而不是拍一个固定值。
            // 拿 clip 原始首帧姿势做差是错的量纲：手势 peakBody=0°，原始首帧却能差 107°。
            // 用类别 profile 的位移预算（BodyDeg）与 RampMs 作下界，再按 300°/s 收口。
            float clsDeg = Mathf.Min(planBodyPeakDeg > 0.5f ? planBodyPeakDeg : profile.BodyDeg, profile.BodyDeg);
            float bySpeed = clsDeg / 300f;
            clipFadeIn = Mathf.Clamp(Mathf.Max(profile.RampMs / 1000f, bySpeed), 0.16f, 0.95f);
            // 同族且这段几乎不动：保持利落（点头不该有半秒的起手）
            if (continueFamily && clsDeg < 8f) clipFadeIn = Mathf.Min(clipFadeIn, 0.18f);
            dbgEntryDeg = clsDeg;            headDevDeg = 0f; headSpeedMax = 0f;
            clipT0 = Time.time;
            clipStartWall = nowWall;
            clipLoop = loop;
            clipActive = true;
            if (inFamily) lastFamilyEnd = nowWall;
            if (Plugin.VerboseCues.Value)
                Plugin.Log.LogInfo("plan " + clipName + " speed=" + clipSpeed.ToString("F2") + " (x" + planSpeed.ToString("F2") + ")"
                    + " wBody=" + planWBody.ToString("F2") + " wHead=" + planWHead.ToString("F2")
                    + " peakBody=" + planBodyPeakDeg.ToString("F0") + "deg/" + planBodyPeakSpd.ToString("F0") + "dps"
                    + " peakHead=" + planHeadPeakDeg.ToString("F0") + "deg/" + planHeadPeakSpd.ToString("F0") + "dps"
                    + " fade=" + Mathf.RoundToInt(clipFadeIn * 1000f) + "ms/" + Mathf.RoundToInt(dbgEntryDeg) + "deg wall=" + clipLen.ToString("F2") + (continueFamily ? " (family)" : ""));
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
                // 队里还有动作就不插空档：上一套刚接完，下一套立刻起手
                int gap = pending.Count > 0 ? 0 : (Plugin.QueueGapMs == null ? 250 : Mathf.Max(0, Plugin.QueueGapMs.Value));
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
