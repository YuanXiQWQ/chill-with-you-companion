// chill-brain 的表演端（DSH 插件的消费者）。只用游戏自带资源：
//  - 动作：Animator.CrossFadeInFixedTime(state/clip 名)，id 由 AnimIdMap 还原（从游戏枚举生成）
//  - 字幕：自己画的 IMGUI 覆盖层，不碰游戏 UI
//  - 语音：播放大脑合成的 wav（音色取自游戏语音包）
// 不打任何 Harmony 补丁 → 游戏更新不失效。

using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
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

    private static WatchRecorder watcher;

    internal static Animator FindHeroineForWatch()
    {
        try
        {
            foreach (var an in Resources.FindObjectsOfTypeAll<Animator>())
            {
                if (an == null || an.runtimeAnimatorController == null) continue;
                if (!an.gameObject.scene.IsValid() || !an.gameObject.activeInHierarchy) continue;
                if (an.runtimeAnimatorController.name.IndexOf("Character", StringComparison.OrdinalIgnoreCase) < 0) continue;
                return an;
            }
        }
        catch { }
        return null;
    }

    private static float watchNextAt;
    private static string watchLast = "";

    // 旁观记录：游戏自己演的时候，人往哪走、哪台相机在拍
    public static void WatchTick()
    {
        if (Time.unscaledTime < watchNextAt) return;
        watchNextAt = Time.unscaledTime + 0.4f;
        try
        {
            string live = "?";
            Vector3 rootPos = Vector3.zero;
            string camName = "-";
            var heroine = FindHeroineForWatch();
            if (heroine != null)
            {
                rootPos = heroine.transform.position;
                var infos = heroine.GetCurrentAnimatorClipInfo(0);
                if (infos != null && infos.Length > 0 && infos[0].clip != null) live = infos[0].clip.name;
            }
            var cam = Camera.main;
            if (cam != null) camName = cam.gameObject.name;
            string sig = live + "|" + camName + "|" + rootPos.ToString("F2");
            if (sig == watchLast) return;
            watchLast = sig;
            Log.LogInfo("watch: clip=" + live + " cam=" + camName + " root=" + rootPos.ToString("F2"));
        }
        catch (Exception ex) { Log.LogError("watch failed: " + ex); }
    }

    // 离座在途保护：不连点。判据是"当下这一帧在不在 leavechair 动画里"，
    // 不靠历史标志——历史标志被误判过一次（明明在看书，却报还在离座）。
    internal static class TripGuard
    {
        // 返回 true = 可以触发
        public static bool TryBegin(string planName)
        {
            var h = FindHeroineForWatch();
            if (h != null)
            {
                var infos = h.GetCurrentAnimatorClipInfo(0);
                if (infos != null && infos.Length > 0 && infos[0].clip != null)
                {
                    string live = infos[0].clip.name;
                    if (live.IndexOf("leavechair", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        Log.LogInfo("trip: 忽略 " + planName + " —— 她正在离座（" + live + "）");
                        return false;
                    }
                }
            }
            return true;
        }
    }

    public static void EnsureWatcher()
    {
        if (watcher != null) return;
        var go = new GameObject("ChillPerformerWatch");
        DontDestroyOnLoad(go);
        watcher = go.AddComponent<WatchRecorder>();
    Log.LogInfo("watcher up");
    }
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
        public static ConfigEntry<bool> Props;
        internal static ConfigEntry<string> MixerGroupMatch;
        internal static ConfigEntry<string> MixerGroupFallback;
        internal static ConfigEntry<bool> QueueEnabled;
        internal static ConfigEntry<int> QueueMax;
        internal static ConfigEntry<int> QueueTtlMs;
        internal static ConfigEntry<int> QueueGapMs;
        internal static ConfigEntry<bool> VerboseCues;
        // 专注（只叠不搬）时，动作一律不走：游戏自己的表演模型是单槽的状态机，
        // 任何"动作"都要切 ActionState，会把手上的事顶掉（实测原生 ClickHeroine 也会）。
        // 原生不打断的通道只有两条：表情层 L2 与嘴形/语音层 L3。所以就只走这两条。
        internal static ConfigEntry<bool> FocusNativeOnly;
        internal static ConfigEntry<int> CameraDefaultSeat;
        // 跨族原生动作：放宽时照播（会把她从当前姿势族里拽出来两秒），默认关。
        internal static ConfigEntry<bool> CrossFamilyNative;
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
            // 让椅子、窗户这些道具跟着同名 clip 一起动。默认关：
            // 那套动画是按别的场景锚点摆的，套过来会把物体甩到位（实测：椅子糊住整个镜头）。
            Props = Config.Bind("acting", "Props", false, "Let props (chair, window…) play their same-named clip. Off by default.");
            FocusNativeOnly = Config.Bind("acting", "FocusNativeOnly", true,
                "During focus (upper-body only) skip body animation entirely and let the game keep its own state." +
                " Only the native facial and mouth layers react. False = sample head clips over the live pose.");
            // 默认机位：进场后把镜头定到书桌（游戏自己的 Camera_Desk），一次，之后不再抢。
            // 0 = 书桌 / 1 = 沙发 / 2 = 床 / -1 = 不动（完全交给游戏）。
            // 只做一次的原因：这是"开场站在哪"的偏好，不是持续接管；游戏自己后面切走就该让它切。
            CameraDefaultSeat = Config.Bind("acting", "CameraDefaultSeat", 0,
                "Seat camera to set once after load. 0=desk (game default), 1=sofa, 2=bed, -1=leave it alone.");
            // 跨族原生动作：游戏那 180 条动作按姿势族命名，跨族播会把她从当前姿势里搬走两秒。
            // 默认关——只在当前族里找等价动作，找不到就只做表情和嘴形。
            CrossFamilyNative = Config.Bind("acting", "CrossFamilyNative", false,
                "Allow native actions from another pose family (pops her out of the current pose for ~2s). Off = same family only.");            // 手动走位：离座时把角色根送到沙发/床边。默认关——
            // 这些 clip 是原地动画（rootΔ=0），游戏是在别处摆好位置再播的，硬塞位移会把人放到镜头外。
            // 离座时切房间相机（Camera_Sofa / Camera_Bed）。默认关：游戏的视野本来不变，
            // 人是自己走到沙发坐下的。
            MixerGroupMatch = Config.Bind("audio", "MixerGroupMatch", "voice", "Keyword(s) that pick the mixer group, comma separated, case-insensitive. First match wins.");
            MixerGroupFallback = Config.Bind("audio", "MixerGroupFallback", "master", "Fallback keyword(s) when nothing matches MixerGroupMatch. Empty = leave the source unmixed (old behaviour).");
            QueueEnabled = Config.Bind("queue", "Enabled", true, "Queue incoming cues locally and play them one after another. False = old behaviour, only the newest item is performed.");
            QueueMax = Config.Bind("queue", "Max", 8, "Queue depth. When full the OLDEST waiting item is dropped (stale lines are the ones worth losing). 8 = 连发五六句也不会把前面那句挤掉（实测 4 深度时 dropped 一路涨）。");
            QueueTtlMs = Config.Bind("queue", "TtlMs", 45000, "Drop a waiting item once it is older than this. Keeps a long yield from replaying lines from ten minutes ago.");
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
    EnsureWatcher();

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
        // holdMs：把这一族的循环段按住这么久（毫秒）。0 = 按自然长度演完。
        // 离座长途用它把"在沙发上待着"变成长时间接管的一个 cue，而不是几分钟的重复 cue。
        public int holdMs;
        public string text;
        // 原生路径：非空时不走采样，改成调游戏自己的
        // HeroineService.ChangeAnimation(AnimationType)，由 Unity 的状态机转载、混合、收尾。
        // 实测："ForInteger" 只对 Wild001 有效，"ChangeAnimation(枚举)" 两者都行。
        public string nativeName;
        public int nativeId;
        // nativeSub 只是后缀（"DrinkTea"）。游戏在每个基底下都实现了一遍同名子动作：
        //   BreakBase004_DrinkTea / WorkBase001_DrinkTea / WorkBase002_DrinkTea / WorkBase003_DrinkTea
        // 同一个"喝口茶"，坐着休息和在工位时身体姿势完全不同，写死任何一条都是错的。
        // 所以由我们按她此刻的基底拼全名，拼不出来才退回 nativeName。
        public string nativeSub;
        // 子动作的同义写法（逗号分隔），语义链的第二层候选。
        // 游戏把 DrinkTea 改名成 DrinkTeaCup 时，这里补一句就能救回来，不用重新编译客户端。
        public string nativeAlso;
        // 持续状态：写代码 / 看书 / 看电影 / 听歌 / 睡，对应 HeroineAI.ActionStateType。
        // 有它就不走采样——直接告诉游戏的状态机"她该去干什么"，
        // base_start -> base_loop -> base_end 全程它自己管。
        public string stateName;
        // 表情，对应 FacialType（Shy_Fun / Shy_Joy / Shy_Sad …）。
        // 走 ChangeHeroineFacialAnimation，落在 L2 层，跟身体动作互不干扰。
        public string facial;
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
        // 每帧那几个数的排列顺序，由服务端给。空 = 用服务端默认（a,i,u,e,o,n）。
        public List<string> mouthChannels;
        public string motionScope = "full";
        // 这一句的语音时长（毫秒）。<=0 表示没拿到，回退到按字数估。
        public double durationMs;
        // 这一条在队列里最多能等多久（毫秒）。0 = 用全局 queue.TtlMs。
        // 离座长途要预排"回来"那一条，它得在沙发上等三五分钟，全局 45s 会把它当过期丢掉。
        public int ttlMs;
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

    // 纯旁观：游戏自己演的时候，人往哪走、哪台相机在拍。
    internal class WatchRecorder : MonoBehaviour
    {
        private float nextAt;
        private string last = "";
        private void Update()
        {
if (Time.unscaledTime < nextAt) return;
            nextAt = Time.unscaledTime + 0.4f;
            try
            {
                string live = "?";
                Vector3 rootPos = Vector3.zero;
                string camName = "-";
                Animator heroine = null;
                var chGo = GameObject.Find("Character");
                if (chGo != null) heroine = chGo.GetComponent<Animator>();
                if (heroine != null)
                {
                    rootPos = heroine.transform.position;
                    var infos = heroine.GetCurrentAnimatorClipInfo(0);
                    if (infos != null && infos.Length > 0 && infos[0].clip != null) live = infos[0].clip.name;
                }
                var cam = Camera.main;
                if (cam != null) camName = cam.gameObject.name;
                string sig = live + "|" + camName + "|" + rootPos.ToString("F2");
                if (sig == last) return;
                last = sig;
                Plugin.Log.LogInfo("watch: clip=" + live + " cam=" + camName + " root=" + rootPos.ToString("F2"));
            }
            catch { }
        }
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
            public int ttlMs;     // 0 = 用全局 queue.TtlMs
        }
        private readonly List<PendingAct> pending = new List<PendingAct>();
        private bool performing;
        // 记一下从什么时候开始 performing：Perform 抛异常时它不会再被复位，
        // 队列就永久卡在 "if (performing) continue"。
        private float performingSince;
        private static string pendingPlan;
        private static int pendingHoldMs;
        private static float pendingUntil;
        private int qDropped;
        private int qExpired;
        private int qMaxDepth;
        private int qPlayed;
        private GUIStyle subtitleStyle;
        // 口型：Face 的 SkinnedMeshRenderer + 母音 blendshape 下标。
        // 通道的顺序与数量都由服务端随数据下发（mouthChannels），游戏端不再保自己的副本：
        // lib/lipsync.mjs 的 CHANNELS 是唯一定义源，游戏更新换命名、加通道、减通道都跟着它走。
        private SkinnedMeshRenderer faceSmr;
        private string[] mouthChannels = new string[0];
        private int[] mouthIdx = new int[0];
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
        // 姿势追踪（诊断"归位抽动"）：每 TRACE_DT 秒记一行角度，到时写成 tsv。
        // 外部命令通道是文件轮询，2 Hz 上下，抓不到 0.2 秒的回弹；只能在里面记。
        private float traceUntil = 0f;
        private float traceNextAt = 0f;
        private Transform[] traceBones;
        private System.Text.StringBuilder traceBuf;
        private const float TraceDt = 0.05f;
        // 原生放手的软着陆：把游戏那一两帧的归位 CrossFade 摊到 NativeExitBlend 秒。
        private Quaternion[] nativeExitRot;
        private float nativeExitUntil = 0f;
        private const float NativeExitBlend = 0.35f;
        // 当前基底没有某个子动作时的备选基底，按"最接近日常待人"排。
        private static readonly string[] SubFallbackBases = {
            "BreakBase004", "WorkBase002", "WorkBase001", "WorkBase003",
            "BreakBase001", "BreakBase002", "BreakBase003", "BreakBase006",
        };
        private static readonly string[] TraceWanted = new string[] { "Hips", "Head", "LeftForeArm", "RightForeArm", "LeftUpLeg" };
        private Quaternion[] gameRot;
        private Vector3[] gamePos;
        private float clipFadeIn = 0.45f;
        private Quaternion[] lastRot;
        private float dbgMaxDeg;
        private int dbgClamped;
        private float dbgClampFirst = -1f;
        private float dbgClampAt = -1f;
        private string dbgClampBone = "";
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
        // 段边界交叉用的临时姿势（X_start 末帧 / X_end 首帧不同 → 硬切会跳）
        private Quaternion[] blendTmp;
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
        private Quaternion[] exitFrom;
        private Quaternion[] exitSmooth;    // 放手前我们的输出，用来量离待机还有多远
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
        // 这段 clip 每根骨头的峰值偏移（度）与"到底要不要写"的掩码。
        // 用途只有一个：叠加式演出里，clip 没动的骨头一律不写 —— 让游戏自己的状态机
        // 继续驱动它们。她在专注时敲键盘，手臂就属于这一类。
        private float[] bonePeak;
        private bool[] boneDrive;
        private int boneDriveCount;
        private const float BoneDriveMinDeg = 1.5f;
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
            // 场景切换是真正的事件（Unity 自己会通知），当场上报一次，不靠轮询。
            UnityEngine.SceneManagement.SceneManager.sceneLoaded += OnSceneLoadedForMonitor;
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
        // 状态监测：每 200ms 算一次快照签名，变了立刻上报；没变就只按 HeartbeatMs
        // 发一次存活性心跳。原来是固定 2 秒一轮，她睡着/切状态最坏要 2 秒侧车才知道，
        // 这期间还在往她身上推动作。
        private int monitorSeq;
        private string monitorSig = "";
        private string monitorLabel = "";
        private volatile bool monitorDirty;
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
            // hard = 游戏自己在演剧情/说话（story 场景 / 剧情文本 / 剧情语音）。
            // 那时 DLL 连 pull 都不做，侧车要是还照常排戏，只会排进 feed 里过期。
            sb.Append(",\"hard\":").Append(GameBusy.IsHard ? "true" : "false");
            sb.Append(",\"busyReason\":\"").Append(Js(GameBusy.Reason)).Append('"');
            sb.Append(",\"heroineReady\":").Append(heroine != null ? "true" : "false");
            sb.Append(",\"clips\":").Append(clipAssets.Count);
            sb.Append(",\"clip\":\"").Append(Js(clipName)).Append('"');
            // 她在游戏里的真实状态与姿势族。侧车拿这两条挑"这一族里真有的动作"——
            // 不带上，侧车只能事后丢掉跨族动作，等于她只剩表情。
            string nativeAnim = CurrentNativeName();
            sb.Append(",\"state\":\"").Append(Js(AiStateName())).Append('"');
            sb.Append(",\"nativeAnim\":\"").Append(Js(nativeAnim)).Append('"');
            sb.Append(",\"family\":\"").Append(Js(NativeBasePrefix(nativeAnim))).Append('"');
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
              .Append(",\"maxDepth\":").Append(qMaxDepth).Append(",\"maxQueue\":").Append(Plugin.QueueMax == null ? 0 : Plugin.QueueMax.Value).Append(",\"ttlMs\":").Append(Plugin.QueueTtlMs == null ? 0 : Plugin.QueueTtlMs.Value)
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
              .Append("\",\"base\":\"").Append(Js(activeBase)).Append("\",\"live\":\"").Append(Js(LiveClipName())).Append("\"}");
            sb.Append(",\"fps\":").Append(fps);
            sb.Append(",\"focus\":").Append(GameBusy.FocusMode ? "true" : "false");
            // 她当前在演什么（HeroineAI.ActionStateType 的名字）。
            // 侧车靠它判断"她已经睡了"——那是游戏按连续专注时长自己进入的，
            // 那时候我们一拍都不能排，否则等于隔几秒把她从梦里拽出来。
            sb.Append(",\"heroState\":\"").Append(Js(AiStateName())).Append('"');
            sb.Append(",\"cam\":\"").Append(Js(camMode)).Append('"');
            sb.Append(",\"camStory\":").Append(camStory ? "true" : "false");
            sb.Append(",\"monitorSeq\":").Append(monitorSeq);
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
        /// <summary>场景切换是真正的事件，Unity 自己会回调。挂事件而不是挂补丁：
        /// 全插件不打任何 Harmony 补丁，游戏更新才不会失效。</summary>
        private void OnSceneLoadedForMonitor(UnityEngine.SceneManagement.Scene scene, UnityEngine.SceneManagement.LoadSceneMode mode)
        {
            monitorDirty = true;
            Plugin.Log.LogInfo("monitor: 场景切换 → " + (scene.name == null ? "?" : scene.name));
        }


        /// <summary>会改变编排口径的字段拼成签名。fps / 队列深度不算，
        /// 否则每一拍都变了，等于没做差分。</summary>
        private string MonitorSignature()
        {
            // 这里必须覆盖 game-monitor.js 的 FIELDS 全集，否则"字段变了但签名没变"＝事件丢失。
            // 反过来也别多放：倒计时（TimerText）每秒都变，放进来就是每秒一次上报。
            RefreshCamera();
            string hs = AiStateName();
            return (hs == null ? "" : hs) + "|" + (GameBusy.FocusMode ? "1" : "0") + "|" +
                   (GameBusy.IsBusy ? "1" : "0") + "|" + (GameBusy.IsHard ? "1" : "0") + "|" +
                   (GameBusy.Reason == null ? "" : GameBusy.Reason) + "|" +
                   (GameBusy.SceneName == null ? "" : GameBusy.SceneName) + "|" +
                   (heroine != null ? "1" : "0") + "|" +
                   camMode + "|" + (camStory ? "1" : "0");
        }

        // —— 机位 ——
        // 游戏自己有一套 Cinemachine 机位（15 台 vcam：Initial/Base/Chair/Desk/CoffeeMaker/
        // Window/StoryChairFaceToFace/StoryIntroduceBook/Sofa/DecorationEdit*/WallPaperLandscape/
        // StoryLandscape/MobileInitial），另有五台单独开关的隐藏摄像机（装饰、壁纸布景、剧情布景）。
        // 它同时回答两个我们以前只能猜的问题：
        //   1. 玩家此刻看的是哪个构图 —— 决定一个全身动作是否在镜头里；
        //   2. isPlayingStory —— 游戏自己说的"正在演剧情"，比我们从文本/语音 token 猜的 Reason 权威。
        private static Type camMgrType;
        private static System.Reflection.FieldInfo camTypeField;
        private static System.Reflection.FieldInfo camStoryField;
        private static object camMgr;
        private static float nextCamFind;
        private static string camMode = "";
        private static bool camStory;

        // 游戏自己的"无活动 vcam"状态下主相机的姿势。
        // 关键：Cinemachine 在没有活动 vcam 时**不会把相机放回去**——它停在最后一次混合到的位置。
        // 所以我们强制切过机位再全关，画面就卡在那台机位上看墙/看房间外，玩家看见的是"啥也没有"。
        // 记住原姿势，退出强制机位时一并还原。
        private static bool camHomeValid;
        private static Vector3 camHomePos;
        private static Quaternion camHomeRot;
        private static bool camManual;
        private static bool camDefaultApplied;
        private static bool camSeatWarned;
        private static int camDefaultFails;

        private static bool ResolveCamera()
        {
            if (camTypeField != null && camStoryField != null) return true;
            if (camMgrType == null)
            {
                foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
                {
                    camMgrType = asm.GetType("Bulbul.RoomCameraManager", false);
                    if (camMgrType != null) break;
                }
                if (camMgrType == null) return false;
            }
            camTypeField = camMgrType.GetField("currentVirtualCameraType", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
            camStoryField = camMgrType.GetField("isPlayingStory", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
            return camTypeField != null && camStoryField != null;
        }

        private void RefreshCamera()
        {
            float now = Time.unscaledTime;
            if (now < nextCamFind) return;
            nextCamFind = now + 0.5f;
            if (!ResolveCamera()) return;
            try
            {
                if (camMgr == null) camMgr = UnityEngine.Object.FindObjectOfType(camMgrType);
                if (camMgr == null) { camMode = ""; camStory = false; return; }
                object v = camTypeField.GetValue(camMgr);
                camMode = v == null ? "" : Convert.ToString(v);
                object s = camStoryField.GetValue(camMgr);
                camStory = (s is bool) && (bool)s;

                // 默认机位：进场后定一次，之后不再管。
                // 为什么是"一次"：这是开场视角的偏好。持续接管会和游戏自己的走动/剧情切镜打架，
                // 而玩家手动点了别的机位也该算数——所以只在第一次解析到 manager 时做。
                if (!camDefaultApplied)
                {
                    // 以前 camDefaultApplied 在 ChangeCameraTransform 之前置位，整块又被外层
                    // catch { camMode=""; camStory=false; } 吞掉：反射失败一次就是"默认机位静默不生效、
                    // 永不重试"，假值还进了心跳。现在只有真的切成功才置位。
                    int seat = Plugin.CameraDefaultSeat == null ? 0 : Plugin.CameraDefaultSeat.Value;
                    if (seat < 0) camDefaultApplied = true;
                    else if (seat > 2)
                    {
                        if (!camSeatWarned) { camSeatWarned = true; Plugin.Log.LogWarning("camera: CameraDefaultSeat=" + seat + " 超出 0..2，忽略"); }
                        camDefaultApplied = true;
                    }
                    else
                    {
                        var m0 = camMgrType.GetMethod("ChangeCameraTransform", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                        if (m0 != null)
                        {
                            try
                            {
                                m0.Invoke(camMgr, new object[] { seat });
                                camDefaultApplied = true;
                                Plugin.Log.LogInfo("camera: 默认机位 seat=" + seat + " | " + MainCamPos());
                            }
                            catch (Exception e0)
                            {
                                if (camDefaultFails++ % 5 == 0) Plugin.Log.LogWarning("camera: 默认机位失败（会重试） " + e0.Message);
                            }
                        }
                    }
                }

                // 没人强制机位、且 Cinemachine 手上没有活动 vcam —— 这就是游戏自己的静止姿势，记下来。
                if (!camManual)
                {
                    var main = Camera.main;
                    if (main != null)
                    {
                        string act = ActiveVcamName();
                        if (act.IndexOf("无活动 vcam", StringComparison.Ordinal) >= 0)
                        {
                            camHomePos = main.transform.position;
                            camHomeRot = main.transform.rotation;
                            camHomeValid = true;
                        }
                    }
                }
            }
            catch { camMode = ""; camStory = false; }
        }

        // —— 机位：给控制台点着看 ——
        // 名字有两种，都认：
        //   ① 15 台 vcam 的 VirtualCameraType 枚举名（Base / Desk / Window / StoryLandscape …）
        //      交给游戏的 VirtualCameraSwitch，过渡由它的 Cinemachine 负责，比我们动 transform 好。
        //   ② 五台隐藏摄像机的**字段名**（decorationCam / wallPaperLandscapeCam / storyLandscapeCam …）
        //      它们不在 vcam 混合里，只靠 SetActive 开关，所以单独走 GameObject.SetActive。
        //      注意真实字段名是 `_decorationCam` 这种短名，不是 _decorationCamera——实测找不到。
        private static readonly string[] HiddenCams = {
            "decorationCam", "decorationChairCam", "decorationDeskCam",
            "wallPaperLandscapeCam", "storyLandscapeCam",
        };

        private void SwitchCamera(string want, bool on)
        {
            if (string.IsNullOrEmpty(want)) return;
            if (!ResolveCamera()) { Plugin.Log.LogWarning("camera: 没找到 RoomCameraManager"); return; }
            try
            {
                if (camMgr == null) camMgr = UnityEngine.Object.FindObjectOfType(camMgrType);
                if (camMgr == null) { Plugin.Log.LogWarning("camera: manager 实例为空"); return; }
                if (want == "?") { LogCameras(); return; }

                // 游戏自己的三台固定机位：_camTransform[0..2]（椅 / 桌 / 沙发那一类）。
                // 这才是日常切视角的正路——它由 RoomCameraManager 自己的 Animator 驱动，
                // 不会像强开 vcam 那样把画面丢到空处。
                if (want.StartsWith("seat:", StringComparison.OrdinalIgnoreCase))
                {
                    int idx;
                    if (!int.TryParse(want.Substring(5), out idx)) { Plugin.Log.LogWarning("camera: seat 参数不对 " + want); return; }
                    var m = camMgrType.GetMethod("ChangeCameraTransform", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                    if (m == null) { Plugin.Log.LogWarning("camera: 没有 ChangeCameraTransform"); return; }
                    string before = MainCamPos();
                    m.Invoke(camMgr, new object[] { idx });
                    camManual = true;
                    // 记住这一帧的位姿，之后每帧续上（游戏下一帧就会把它拉回默认视角）。
                    var seats = camMgrType.GetField("_camTransform", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                    var seatArr = seats == null ? null : seats.GetValue(camMgr) as Array;
                    if (seatArr != null && idx >= 0 && idx < seatArr.Length && seatArr.GetValue(idx) is Transform)
                    {
                        camSeatTr = (Transform)seatArr.GetValue(idx);
                        camSeatPos = camSeatTr.position;
                        camSeatRot = camSeatTr.rotation;
                    }
                    else
                    {
                        // 拿不到机位 Transform 就退一步：把刚才摆上去的位姿钉住。
                        var main0 = Camera.main;
                        if (main0 != null) { camSeatTr = main0.transform; camSeatPos = main0.transform.position; camSeatRot = main0.transform.rotation; }
                    }
                    Plugin.Log.LogInfo("camera: ChangeCameraTransform(" + idx + ") " + before + " -> " + MainCamPos() + "（已锁定）");
                    return;
                }

                // "home"：不动 vcam，只把主相机摆回游戏自己的静止姿势。
                if (string.Equals(want, "home", StringComparison.OrdinalIgnoreCase))
                {
                    if (!camHomeValid) { Plugin.Log.LogWarning("camera: 还没记下静止姿势"); return; }
                    var main = Camera.main;
                    if (main != null)
                    {
                        main.transform.position = camHomePos;
                        main.transform.rotation = camHomeRot;
                        Plugin.Log.LogInfo("camera: 回到静止姿势 " + MainCamPos());
                    }
                    camManual = false;
                    camSeatTr = null;   // 解除每帧续位，把镜头还给游戏
                    return;
                }

                // "all" / "off:all"：全部关掉，把机位还给游戏自己的逻辑。
                // 面板上的「自动」走这条——这是从任何强制机位退出来的唯一保证。
                if (string.Equals(want, "all", StringComparison.OrdinalIgnoreCase))
                {
                    var me = camMgr as Component;
                    var rt = me == null ? null : me.transform.Find("Cameras/VirtualCameras");
                    int n = 0;
                    if (rt != null)
                        for (int i = 0; i < rt.childCount; i++)
                        {
                            if (!rt.GetChild(i).gameObject.activeSelf && !on) continue;
                            rt.GetChild(i).gameObject.SetActive(on);
                            n++;
                        }
                    camManual = false;
                    camSeatTr = null;   // 解除每帧续位，把镜头还给游戏
                    // 关掉之后必须把主相机拎回去。
                    // Cinemachine 在没有活动 vcam 时把相机停在最后一次混合到的位置——只关 vcam 不还原姿势，
                    // 画面就永远卡在那台机位上看墙。玩家看到的就是"啥也看不到"。
                    if (!on && camHomeValid)
                    {
                        var main = Camera.main;
                        if (main != null)
                        {
                            main.transform.position = camHomePos;
                            main.transform.rotation = camHomeRot;
                            Plugin.Log.LogInfo("camera: 主相机归位 pos=" + camHomePos.ToString("F2"));
                        }
                    }
                    Plugin.Log.LogInfo("camera: 全部 vcam " + (on ? "打开" : "关闭") + " (" + n + " 台) | " + ActiveVcamName());
                    return;
                }

                string hit = null;
                for (int i = 0; i < HiddenCams.Length; i++)
                    if (string.Equals(HiddenCams[i], want, StringComparison.OrdinalIgnoreCase)) { hit = HiddenCams[i]; break; }

                if (hit != null)
                {
                    string field = "_" + hit;
                    var f = camMgrType.GetField(field, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                    var go = f == null ? null : f.GetValue(camMgr) as GameObject;
                    if (go == null) { Plugin.Log.LogWarning("camera: 找不到 " + field); return; }
                    go.SetActive(on);
                    Plugin.Log.LogInfo("camera: " + hit + (on ? " 开" : " 关") + " -> active=" + go.activeSelf);
                    return;
                }

                var sw = camMgrType.GetMethod("VirtualCameraSwitch", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                if (sw == null) { Plugin.Log.LogWarning("camera: 没有 VirtualCameraSwitch"); return; }
                object val;
                try { val = Enum.Parse(sw.GetParameters()[0].ParameterType, want, true); }
                catch { Plugin.Log.LogWarning("camera: 不是机位名 " + want); return; }

                // 先叫游戏切（它自己知道该混多久、该不该写 currentVirtualCameraType）
                try { sw.Invoke(camMgr, new object[] { val }); }
                catch (Exception e) { Plugin.Log.LogWarning("camera: VirtualCameraSwitch 抛错 " + e.Message); }

                // 再兜一手：实测 15 台 vcam 平时全是 off、currentCam 为空，此时 VirtualCameraSwitch
                // 什么都不做（没有活动 vcam 可混）。直接把目标那台打开，Cinemachine 会自己接上。
                var self = camMgr as Component;
                var root = self == null ? null : self.transform.Find("Cameras/VirtualCameras");
                if (root != null)
                {
                    Transform target = null;
                    string want2 = want + "Camera";
                    for (int i = 0; i < root.childCount; i++)
                    {
                        var c = root.GetChild(i);
                        if (string.Equals(c.name, want2, StringComparison.OrdinalIgnoreCase) ||
                            string.Equals(c.name, want, StringComparison.OrdinalIgnoreCase)) { target = c; break; }
                    }
                    if (target == null) Plugin.Log.LogWarning("camera: 没有名为 " + want2 + " 的 vcam");
                    else
                    {
                        // 独占：先关掉其它所有 vcam 再开这台。
                        // 不这么做的话，游戏自己切活动时会把它的目标也打开，两台同时 active，
                        // Cinemachine 按优先级挑一台——你看的是哪台就变成了运气。
                        for (int i = 0; i < root.childCount; i++)
                        {
                            var c = root.GetChild(i);
                            if (c != target && c.gameObject.activeSelf) c.gameObject.SetActive(false);
                        }
                        target.gameObject.SetActive(on);
                        camManual = on;
                        Plugin.Log.LogInfo("camera: vcam " + target.name + (on ? " 开（独占）" : " 关") +
                            " -> active=" + target.gameObject.activeSelf + " | " + ActiveVcamName() +
                            " pos=" + (Camera.main != null ? Camera.main.transform.position.ToString("F2") : "?"));
                    }
                }
                else Plugin.Log.LogWarning("camera: 找不到 Cameras/VirtualCameras");

                Plugin.Log.LogInfo("camera: 切到 " + want);
            }
            catch (Exception e) { Plugin.Log.LogWarning("camera: " + e.Message); }
        }

        /// <summary>Cinemachine 此刻真正在用的那台虚拟相机。这是"视角到底有没有换"的唯一硬证据。</summary>
        private static string ActiveVcamName()
        {
            try
            {
                var main = Camera.main;
                if (main == null) return "brain=(无 MainCamera)";
                var comps = main.GetComponents<Component>();
                for (int i = 0; i < comps.Length; i++)
                {
                    var c = comps[i];
                    if (c == null || c.GetType().Name != "CinemachineBrain") continue;
                    var p = c.GetType().GetProperty("ActiveVirtualCamera");
                    var v = p == null ? null : p.GetValue(c, null);
                    if (v == null) return "brain=(无活动 vcam)";
                    var nf = v.GetType().GetProperty("Name");
                    return "brain=" + (nf == null ? v.GetType().Name : Convert.ToString(nf.GetValue(v, null)));
                }
                return "brain=(MainCamera 上没有 CinemachineBrain)";
            }
            catch (Exception e) { return "brain=(" + e.Message + ")"; }
        }

        /// <summary>主相机此刻的位姿，一行字。排查"切了没变/画面空"全靠它。</summary>
        private static string MainCamPos()
        {
            var c = Camera.main;
            if (c == null) return "cam=(无)";
            var p = c.transform.position;
            var f = c.transform.forward;
            return "cam=(" + p.x.ToString("F2") + "," + p.y.ToString("F2") + "," + p.z.ToString("F2") + ") 朝向=(" +
                   f.x.ToString("F2") + "," + f.y.ToString("F2") + "," + f.z.ToString("F2") + ")";
        }

        /// <summary>把机位现场摊开打日志：当前是哪台、15 台 vcam 的开关、5 台隐藏相机的 active/enabled/depth。</summary>
        private void LogCameras()
        {
            try
            {
                var curF = camMgrType.GetField("currentCam", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                var prvF = camMgrType.GetField("prevCam", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                var cur = curF == null ? null : curF.GetValue(camMgr) as Component;
                var prv = prvF == null ? null : prvF.GetValue(camMgr) as Component;
                Plugin.Log.LogInfo("camera 一览: current=" + camMode + " story=" + camStory +
                    " currentCam=" + (cur == null ? "(空)" : cur.name) +
                    " prevCam=" + (prv == null ? "(空)" : prv.name) + " | " + ActiveVcamName() + " | " + MainCamPos());

                // 三台固定机位：位姿 + 跟前 6 米有没有东西。画面空不空看这个就知道。
                var tf = camMgrType.GetField("_camTransform", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                var arr = tf == null ? null : tf.GetValue(camMgr) as Array;
                if (arr != null)
                {
                    for (int i = 0; i < arr.Length; i++)
                    {
                        var tr = arr.GetValue(i) as Transform;
                        if (tr == null) { Plugin.Log.LogInfo("camera seat[" + i + "] = (空)"); continue; }
                        var fw = tr.forward;
                        Plugin.Log.LogInfo("camera seat[" + i + "] " + tr.name + " pos=(" +
                            tr.position.x.ToString("F2") + "," + tr.position.y.ToString("F2") + "," + tr.position.z.ToString("F2") +
                            ") 朝向=(" + fw.x.ToString("F2") + "," + fw.y.ToString("F2") + "," + fw.z.ToString("F2") + ")");
                    }
                }

                var self = camMgr as Component;
                var root = self == null ? null : self.transform.Find("Cameras/VirtualCameras");
                if (root != null)
                {
                    var sb = new System.Text.StringBuilder("camera vcams:");
                    for (int i = 0; i < root.childCount; i++)
                        sb.Append(' ').Append(root.GetChild(i).name)
                          .Append(root.GetChild(i).gameObject.activeSelf ? "=on" : "=off");
                    Plugin.Log.LogInfo(sb.ToString());
                }

                for (int i = 0; i < HiddenCams.Length; i++)
                {
                    var f = camMgrType.GetField("_" + HiddenCams[i], BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                    var go = f == null ? null : f.GetValue(camMgr) as GameObject;
                    if (go == null) { Plugin.Log.LogInfo("camera 隐藏: " + HiddenCams[i] + " = (无此字段)"); continue; }
                    var cam = go.GetComponent<Camera>();
                    Plugin.Log.LogInfo("camera 隐藏: " + HiddenCams[i] + " active=" + go.activeSelf +
                        " cam=" + (cam == null ? "(无 Camera 组件)" : ("enabled=" + cam.enabled + " depth=" + cam.depth)));
                }
            }
            catch (Exception e) { Plugin.Log.LogWarning("camera: " + e.Message); }
        }
        private string MonitorLabel()
        {
            string hs = AiStateName();
            return (hs == null ? "" : hs) + " focus=" + (GameBusy.FocusMode ? "1" : "0") +
                   (GameBusy.IsHard ? " 剧情中" : "") + " @" + (GameBusy.SceneName == null ? "" : GameBusy.SceneName);
        }

        /// <summary>低频监测 + 切换即报。
        /// 每秒只做一次字段比对（纯本地读，不发请求）；只有**变了**那一刻才 POST，
        /// 或者到了 HeartbeatMs 该发一次存活性心跳。玩家的切换（开始专注 / 她切状态 /
        /// 场景加载）都落在"变了"这一支上，所以是切换驱动，不是轮询上报。</summary>
        private IEnumerator HeartbeatLoop()
        {
            float lastPush = 0f;
            while (true)
            {
                yield return new WaitForSecondsRealtime(1.0f);
                if (Plugin.Heartbeat != null && !Plugin.Heartbeat.Value) continue;
                int every = Plugin.HeartbeatMs == null ? 2000 : Mathf.Clamp(Plugin.HeartbeatMs.Value, 500, 30000);
                float nowSec = Time.realtimeSinceStartup;
                string label = MonitorLabel();
                string sig = MonitorSignature();
                bool changed = sig != monitorSig || monitorDirty;
                bool due = (nowSec - lastPush) * 1000f >= every;
                if (!changed && !due) continue;
                // 同一个切换可能连着触发两次（场景 + 状态），250ms 内合并成一次。
                if (changed && (nowSec - lastPush) * 1000f < 250f) continue;
                monitorDirty = false;
                if (changed && monitorSig.Length > 0)
                    Plugin.Log.LogInfo("monitor: " + monitorLabel + " -> " + label);
                monitorSig = sig;
                monitorLabel = label;
                if (changed) monitorSeq++;
                lastPush = nowSec;
                string url = BaseUrl + "/game";
                string body = BuildStateJson();
                // using：SendWebRequest 抛异常时（换场景销毁连接、域名解析失败）以前 req 连同
                // 两个 handler 与 native 句柄一起漏，每 2 秒一个。
                string hbError = "";
                bool hbOk = false;
                using (var req = new UnityWebRequest(url, "POST"))
                {
                    req.uploadHandler = new UploadHandlerRaw(System.Text.Encoding.UTF8.GetBytes(body));
                    req.downloadHandler = new DownloadHandlerBuffer();
                    req.SetRequestHeader("Content-Type", "application/json");
                    if (!string.IsNullOrEmpty(Plugin.ApiToken.Value))
                        req.SetRequestHeader("Authorization", "Bearer " + Plugin.ApiToken.Value);
                    req.timeout = 6;
                    yield return req.SendWebRequest();
                    if (req.isNetworkError || req.isHttpError)
                    {
                        hbOk = false;
                        if (heartbeatFails++ % 15 == 0) Plugin.Log.LogWarning("heartbeat: " + req.error);
                    }
                    else { heartbeatFails = 0; hbOk = true; }
                    // 先取错误再 Dispose：Dispose 之后 req.error 读不稳
                    if (req.isNetworkError || req.isHttpError) hbError = req.error;
                }
                heartbeatOk = hbOk;
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

            // 口型：扁平数组，每帧 mouthChannels.Length 个数
            var flat = JsonLite.AsList(JsonLite.Get(root, "mouthFlat"));
            dto.mouthFlat = new List<double>();
            if (flat != null)
                for (int i = 0; i < flat.Count; i++) dto.mouthFlat.Add(JsonLite.Num(flat[i]));
            dto.mouthChannels = new List<string>();
            var chans = JsonLite.AsList(JsonLite.Get(root, "mouthChannels"));
            if (chans != null)
                for (int i = 0; i < chans.Count; i++)
                {
                    string c = JsonLite.Str(chans[i]);
                    if (!string.IsNullOrEmpty(c)) dto.mouthChannels.Add(c);
                }
            dto.mouthFps = JsonLite.Int(JsonLite.Get(root, "mouthFps"));
            dto.mouthFrames = dto.mouthChannels.Count > 0
                ? dto.mouthFlat.Count / dto.mouthChannels.Count
                : dto.mouthFlat.Count / 6;
            var scopeRaw = JsonLite.Get(root, "motionScope");
            dto.motionScope = scopeRaw == null ? "full" : JsonLite.Str(scopeRaw);
            var durRaw = JsonLite.Get(root, "durationMs");
            dto.durationMs = durRaw == null ? 0.0 : JsonLite.Num(durRaw);

            var cues = new List<CueDto>();
            // 首选通道：cuesJson —— 一条字符串数组，每项是 cue 的 JSON 文本。
            //
            // 为什么是字符串而不是对象数组：JsonUtility 对「对象数组」解析不可靠，
            // 但对 string[] 没问题。而 cue 一多，平行数组就要维护 N 条
            // （slots/ids/ats/durations/holds/nativeNames/nativeSubs/nativeAlsos/
            //   stateNames/facials），加一个字段要同步五处，漏一处就是静默失效。
            // 走这里之后：加字段 = CueDto 加一行 + 下面加一行读取，两处。
            //
            // 老的平行数组保留在下面做兜底，老版本 DLL 不受影响。
            var packed = JsonLite.AsList(JsonLite.Get(root, "cuesJson"));
            if (packed != null && packed.Count > 0)
            {
                for (int k = 0; k < packed.Count; k++)
                {
                    var cue = new CueDto();
                    string one = JsonLite.Str(packed[k]);
                    if (!string.IsNullOrEmpty(one))
                    {
                        var cd = JsonLite.AsDict(JsonLite.Parse(one));
                        if (cd != null)
                        {
                            cue.slot = JsonLite.Str(JsonLite.Get(cd, "slot"));
                            cue.id = JsonLite.Str(JsonLite.Get(cd, "id"));
                            cue.at = JsonLite.Int(JsonLite.Get(cd, "at"));
                            cue.durationMs = JsonLite.Int(JsonLite.Get(cd, "durationMs"));
                            cue.holdMs = JsonLite.Int(JsonLite.Get(cd, "holdMs"));
                            cue.nativeName = JsonLite.Str(JsonLite.Get(cd, "nativeName"));
                            cue.nativeId = JsonLite.Int(JsonLite.Get(cd, "nativeId"));
                            cue.nativeSub = JsonLite.Str(JsonLite.Get(cd, "nativeSub"));
                            cue.nativeAlso = JsonLite.Str(JsonLite.Get(cd, "nativeAlso"));
                            cue.stateName = JsonLite.Str(JsonLite.Get(cd, "stateName"));
                            cue.facial = JsonLite.Str(JsonLite.Get(cd, "facial"));
                        }
                    }
                    cues.Add(cue);
                }
                if (Plugin.VerboseCues.Value && cues.Count > 0)
                    Plugin.Log.LogInfo("cues: 走 cuesJson，共 " + cues.Count + " 条");
            }
            var perf = JsonLite.AsList(JsonLite.Get(root, "performance"));
            // cuesJson 已经解析出东西就**不要再解析 performance**：那两个是同一批 cue 的两种形态。
            // 以前两段都跑，等于每句话的每个动作演两遍（日志里 `cues=2` 而 slots 只有 1，
            // 同一条 cue 的 `cue in` 打两次就是这么来的）。
            if (perf != null && cues.Count == 0)
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
                    cue.holdMs = JsonLite.Int(JsonLite.Get(d, "holdMs"));
                    // 原生路径标记。这里要是漏了，brain 那边写了也白写——
                    // 手写解析器不会自己认识新字段，表现就是"改了半天没反应"。
                    cue.nativeName = JsonLite.Str(JsonLite.Get(d, "nativeName"));
                    cue.nativeId = JsonLite.Int(JsonLite.Get(d, "nativeId"));
                    cue.nativeSub = JsonLite.Str(JsonLite.Get(d, "nativeSub"));
                    cue.nativeAlso = JsonLite.Str(JsonLite.Get(d, "nativeAlso"));
                    cue.stateName = JsonLite.Str(JsonLite.Get(d, "stateName"));
                    cue.facial = JsonLite.Str(JsonLite.Get(d, "facial"));
                    cues.Add(cue);
                }
            }
            if (cues.Count == 0 && Plugin.VerboseCues.Value)
                Plugin.Log.LogInfo("cues: 这一条既没有 cuesJson 也没有 performance，按空处理");
            dto.performance = cues.ToArray();
            // 条目级 TTL：离座长途预排的「回来」那一条要在队里等几分钟，
            // 全局 queue.TtlMs（45s）会把它当过期丢掉。
            dto.ttlMs = JsonLite.Int(JsonLite.Get(root, "ttlMs"));
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
            // 这里以前只清 clipOwners/clipNames，clipExtraOwners 一轮轮攒下去：
            // 每次重新发现（换场景、重进剧情）都会把同一个 Animator 重新记一遍，
            // 而它按 clip 名索引，clip 名上百个——字典里留着已经销毁的旧 Animator。
            clipExtraOwners.Clear();
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
                    List<Animator> holders;
                    if (clipExtraOwners.TryGetValue(c.name, out holders)) { if (!holders.Contains(a) && usable) holders.Add(a); }
                    else clipExtraOwners[c.name] = new List<Animator> { a };
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
        // 手动机位要每帧续上。
        //
        // ChangeCameraTransform 只摆一下——游戏自己的相机逻辑（Animator / 活动切换）下一帧
        // 就把主相机拉回去，实测 <1 秒复位成书桌。所以手动锁定期间每帧覆盖一次位姿，
        // 放在 LateUpdate 里最后一个动作的位置，赢了这一帧就算数。
        private static Transform camSeatTr;
        private static Vector3 camSeatPos;
        private static Quaternion camSeatRot;

        private void ApplyCameraOverride()
        {
            if (!camManual || camSeatTr == null) return;
            if (camStory) return;                       // 剧情里让位给游戏自己的镜头
            var main = Camera.main;
            if (main == null) return;
            var t = main.transform;
            if (t.position != camSeatPos) t.position = camSeatPos;
            if (t.rotation != camSeatRot) t.rotation = camSeatRot;
            if (!camLockLogged) { camLockLogged = true; Plugin.Log.LogInfo("camera: 锁定生效 " + MainCamPos()); }
        }

        // LateUpdate 的先后顺序不由我们定：游戏自己的相机逻辑很可能排在我们后面，
        // 每帧把我们写的位姿又覆盖掉（实测切完一秒内就复位）。onPreCull 在所有
        // LateUpdate 之后、渲染之前回调，这里写的位置才是这一帧真正用到的位置。
        private void CameraPreCull(Camera c)
        {
            if (c == null) return;
            if (camManual && camSeatTr != null && c == Camera.main) ApplyCameraOverride();
        }

        private static bool camLockLogged;

        private void OnEnable()
        {
            // 手动机位：渲染前最后一次写入机会（见 CameraPreCull 的说明）。
            Camera.onPreCull += CameraPreCull;
        }

        private void OnDisable()
        {
            Camera.onPreCull -= CameraPreCull;
        }

        private void LateUpdate()
        {
            // 口型先走：原生路径接管的是 L0 骨骼，脸不在它的管辖范围内。
            // 她说着话同时打哈欠的时候，嘴必须还在动。
            UpdateMouth();
            // 手动机位：每帧续一次，并放在最前面（后面有几条早退路径，
            // 放末尾会被 return 跳过，机位就又会被游戏拉回去）。
            ApplyCameraOverride();
            // 姿势追踪必须放在 nativeBusy 之前：要抓的"归位抽动"正好发生在
            // nativeBusy 从 true 翻回 false 的那几帧里，放后面就正好看不见。
            TraceTick();
            // 原生路径接管期间，采样层完全不碰骨骼：两条路同时写同一个 Layer 会打架
            // （实测骨骼由我们 LateUpdate 覆盖，而游戏状态机以为自己在演别的动作）。
            if (nativeBusy) { ApplyCameraOverride(); return; }
            // 软着陆：游戏刚把动作交回来时会用一两帧 CrossFade 回待机，那一下是"啪"。
            // 这里把上一帧的姿势和游戏这一帧写的值再做一次 Slerp，等于把整个过程摊到 200ms。
            // 只接管移动量、不改终值：k 到 1 时就是游戏自己的姿势，之后彻底撒手。
            if (nativeExitUntil > 0f)
            {
                if (Time.unscaledTime >= nativeExitUntil) nativeExitUntil = 0f;
                else if (bones != null && nativeExitRot != null && !clipActive)
                {
                    float k = Mathf.Clamp01(1f - (nativeExitUntil - Time.unscaledTime) / NativeExitBlend);
                    for (int i = 0; i < bones.Length && i < nativeExitRot.Length; i++)
                    {
                        if (bones[i] == null) continue;
                        bones[i].localRotation = Quaternion.Slerp(nativeExitRot[i], bones[i].localRotation, k);
                    }
                }
            }
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
                        exitSmooth = null;
                        lastFamilyEnd = Time.time;
                        Plugin.Log.LogInfo("hipsΔ=" + (hipsIdx >= 0 && bones != null && hipsIdx < bones.Length ? (bones[hipsIdx].localPosition - hipsAtStart).magnitude.ToString("F2") : "-") + "m " + "rootΔ=" + (rootStartValid && bones != null && bones.Length > 0 ? (bones[0].localPosition - rootAtClipStart).magnitude.ToString("F2") : "-") + "m " + "clip done: " + activeClip.name + " frames=" + dbgFrames
                            + " peakHead=" + headSpeedMax.ToString("F0") + "dps@t" + dbgPeakAt.ToString("F2") + "s/dt" + (dbgPeakDt * 1000f).ToString("F1") + "ms dev=" + headDevDeg.ToString("F1") + "deg"
                + " amp=head" + dbgAmpHead.ToString("F1") + "/body" + dbgAmpBody.ToString("F1") + "deg"
                + " clamp=" + dbgClamped + "\u00b0t" + dbgClampFirst.ToString("F2") + "/" + dbgClampAt.ToString("F2") + "s/" + dbgClampBone + "\u00b0" + dbgClampMax.ToString("F0") + "d"
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
        }

        // 口型：每帧按音频播放时间在扁平帧上插值，写回六个母音 blendshape。
        //
        // 这一块必须跑在 nativeBusy 之前。她说话的时候经常同时在做一个原生动作
        // （打哈欠、点头、伸懒腰），那时候 L0 骨骼归游戏状态机管，但脸不归它管——
        // 嘴该照动。原来它排在 LateUpdate 最后，被 `if (nativeBusy) return` 一刀切掉，
        // 表现就是"原生动作一播，嘴就不动了"。
        private void UpdateMouth()
        {
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
            int chN = mouthChannels.Length;
            for (int c = 0; c < chN; c++)
            {
                if (mouthIdx[c] < 0) continue;
                float v = Mathf.Lerp(mouthW[i0 * chN + c], mouthW[i1 * chN + c], k) * env;
                faceSmr.SetBlendShapeWeight(mouthIdx[c], Mathf.Clamp01(v) * 100f);
            }
        }

        private void ClearMouth()
        {
            if (faceSmr == null) return;
            for (int c = 0; c < mouthIdx.Length; c++)
                if (mouthIdx[c] >= 0) faceSmr.SetBlendShapeWeight(mouthIdx[c], 0f);
        }

        private void BindMouth(ActDto dto)
        {
            mouthActive = false;
            mouthT0 = -1f;
            mouthChannels = dto != null && dto.mouthChannels != null && dto.mouthChannels.Count > 0
                ? dto.mouthChannels.ToArray()
                : DefaultMouthChannels;
            mouthIdx = new int[mouthChannels.Length];
            for (int c = 0; c < mouthIdx.Length; c++) mouthIdx[c] = -1;
            // 先绑脸再判数据：口型数据有没有（TTS 挂掉时没有）和"脸的 blendshape 好不好绑"
            // 是两件事，混在一起会让绑定的失败也被一并藏起来。
            if (faceSmr == null || mouthIdx.Length == 0 || mouthIdx[0] < 0) FindFace();
            if (dto == null || dto.mouthFlat == null || dto.mouthFlat.Count < mouthChannels.Length * 2) { mouthW = new float[0]; mouthCount = 0; return; }
            mouthW = new float[dto.mouthFlat.Count];
            for (int i = 0; i < mouthW.Length; i++) mouthW[i] = (float)dto.mouthFlat[i];
            mouthCount = dto.mouthFlat.Count / mouthChannels.Length;
            mouthFps = dto.mouthFps > 0 ? dto.mouthFps : 30;
        }

        private static readonly string[] DefaultMouthChannels = new string[] { "a", "i", "u", "e", "o", "n" };

        // 判断某个 blendshape 名是不是"母音 ch"，不写死整串名字。
        //
        // 只认结尾：字母本身，且前一个字符是分隔符。这样
        //   mouth_a / Mouth_A / vowel_a / v.a / A            → 命中
        //   Mouth_narrow / Mouth_wide / Mouth_smile          → 不命中
        // 最后一条很关键：Mouth_wide 以 'e' 结尾，天真的"以字母结尾"会把 e 认错。
        private static bool IsChannelShape(string lowName, string ch)
        {
            if (string.IsNullOrEmpty(lowName) || string.IsNullOrEmpty(ch)) return false;
            if (ch.Length != 1) return lowName.EndsWith(ch, StringComparison.Ordinal);
            if (lowName[lowName.Length - 1] != ch[0]) return false;
            if (lowName.Length == 1) return true;
            char prev = lowName[lowName.Length - 2];
            return prev == '_' || prev == '.' || prev == '-' || prev == ' ';
        }

        private static bool NameLooksLikeFace(SkinnedMeshRenderer s)
        {
            string n = (s.name ?? "").ToLowerInvariant();
            string m = s.sharedMesh != null ? (s.sharedMesh.name ?? "").ToLowerInvariant() : "";
            return n.IndexOf("face") >= 0 || m.IndexOf("face") >= 0;
        }

        // 找脸：判据是"这个网格上能对上几个母音通道"，不是"它叫不叫 Face"。
        // 名字只用来在匹配数相同时排序，这样网格改名不会让口型直接失效。
        private void FindFace()
        {
            var smrs = Resources.FindObjectsOfTypeAll<SkinnedMeshRenderer>();
            SkinnedMeshRenderer best = null;
            int bestHit = 0;
            bool bestNamed = false;
            foreach (var smr in smrs)
            {
                if (smr == null || smr.sharedMesh == null) continue;
                int n = smr.sharedMesh.blendShapeCount;
                if (n < mouthChannels.Length) continue;
                int hit = 0;
                for (int c = 0; c < mouthChannels.Length; c++)
                {
                    for (int i = 0; i < n; i++)
                    {
                        if (IsChannelShape(smr.sharedMesh.GetBlendShapeName(i).ToLowerInvariant(), mouthChannels[c])) { hit++; break; }
                    }
                }
                bool named = NameLooksLikeFace(smr);
                // 命中数优先；并列时"名字像脸"的优先；再并列就保持先找到的
                if (hit > bestHit || (hit == bestHit && hit > 0 && named && !bestNamed))
                {
                    best = smr; bestHit = hit; bestNamed = named;
                }
            }
            if (best == null)
            {
                faceSmr = null;
                Plugin.Log.LogWarning("face not found (no skinned mesh with mouth blendshapes for channels " + string.Join(",", mouthChannels) + ")");
                return;
            }
            faceSmr = best;
            var mesh = best.sharedMesh;
            int total = mesh.blendShapeCount;
            var found = new StringBuilder();
            for (int c = 0; c < mouthChannels.Length; c++)
            {
                mouthIdx[c] = -1;
                for (int i = 0; i < total; i++)
                {
                    if (IsChannelShape(mesh.GetBlendShapeName(i).ToLowerInvariant(), mouthChannels[c])) { mouthIdx[c] = i; break; }
                }
                found.Append(mouthChannels[c]).Append('=').Append(mouthIdx[c]).Append(' ');
            }
            Plugin.Log.LogInfo("face bound: " + best.transform.parent.name + "/" + best.name + " shapes=" + total
                + " hit=" + bestHit + "/" + mouthChannels.Length + " mouth[" + found + "]");
            // 绑不全要喊出来。以前这里只打 Info，嘴不动也不报错，
            // 和"语音引擎没装自动降级"长得一样，很难查。
            if (bestHit < mouthChannels.Length)
            {
                var names = new StringBuilder();
                int show = Mathf.Min(total, 24);
                for (int i = 0; i < show; i++) names.Append(mesh.GetBlendShapeName(i)).Append(i == show - 1 ? "" : " | ");
                Plugin.Log.LogWarning("mouth bind incomplete " + bestHit + "/" + mouthChannels.Length
                    + " on " + best.name + "; shapes=" + total + " [" + names + "]");
            }
        }

        // 自检：合成五个母音轮流张一下嘴，配合 AutoShot 截图确认 blendshape 真的在动
        private IEnumerator TestSweep()
        {
            yield return new WaitForSecondsRealtime(2.5f);
            int n = 90;
            int chN = mouthChannels.Length > 0 ? mouthChannels.Length : DefaultMouthChannels.Length;
            if (mouthChannels.Length == 0) mouthChannels = DefaultMouthChannels;
            if (mouthIdx.Length != chN) { mouthIdx = new int[chN]; for (int c = 0; c < chN; c++) mouthIdx[c] = -1; FindFace(); }
            mouthCount = n;
            mouthFps = 30;
            mouthW = new float[n * chN];
            for (int i = 0; i < n; i++)
            {
                int c = (i / 12) % chN;
                mouthW[i * chN + c] = 1f;
            }
            mouthDur = n / 30f;
            mouthT0 = Time.time;
            mouthActive = mouthIdx.Length > 0 && mouthIdx[0] >= 0;
            Plugin.Log.LogInfo("test sweep: frames=" + mouthCount + " ch=" + chN + " dur=" + mouthDur.ToString("F2") + " active=" + mouthActive);
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
            Plugin.WatchTick();
            GameBusy.Tick();
            ReflectConsole.Host = this;
            ReflectConsole.Tick(Plugin.Log);
                GameVoiceGate.Tick();
                TryFlushTrip();
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
            if (Plugin.VerboseCues.Value) foreach (var cc in cues) Plugin.Log.LogInfo("cue in: slot=" + cc.slot + " id=" + cc.id + " sub=[" + cc.nativeSub + "] name=[" + cc.nativeName + "]");
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

                // 表情独立于动作：它落在 L2（Facial），身体动作在 L0（Base），是两层。
                // 所以「只换脸、不改姿势」是合法的——说完一句话表情变了，身体还端着原来的样子。
                // 放在状态机分支之外，一次性动作（点头、打哈欠）也才能带表情。
                if (!string.IsNullOrEmpty(cue.facial))
                {
                    object fsvc = NativeService();
                    if (fsvc != null) ChangeFacial(cue.facial, fsvc);
                    else Plugin.Log.LogWarning("facial: 没有 HeroineService，跳过 " + cue.facial);
                }

                // 持续状态优先：这是最贴合官方路径的一条——不写骨骼，只切状态。
                if (!string.IsNullOrEmpty(cue.stateName))
                {
                    yield return SwitchState(cue.stateName);
                    // 表情在上面已经统一换过一遍（挪到了 focus 判断之前），这里不再重复调：
                    // 同一张脸被同一个 id 连设两次，日志会出两条 facial ->，也不好排查。
                    continue;
                }
                if (cue.slot == "animations")
                {
                    // 专注时她在敲键盘/写字/看报告：那是游戏的 ActionState。
                    // 我们的"动作"要么切状态（打断手上的事），要么写骨骼（把她冻住）。
                    // 游戏原生没有"边干活边点头"这种东西，所以这里不造：
                    // 只让表情层和嘴形层回应，身体一直是游戏自己的。
                    if (GameBusy.FocusMode && (Plugin.FocusNativeOnly == null || Plugin.FocusNativeOnly.Value))
                    {
                        Plugin.Log.LogInfo("focus: 跳过动作 " + cue.id + "，只走原生表情/嘴形");
                        continue;
                    }
                    // 原生优先：游戏自己有动作就用它，过渡质量交给 Unity。
                    // 但采样还在演的时候不能直接调：ChangeAnimation 会把游戏状态机整个切走，
                    // 而我们这边 clipActive 还是 true，等于把一个正在演的动作从中间切断。
                    // 实测 trace 里能看到 nb=1 和 clip=1 同时为真的帧，那就是"被打断插入"。
                    if (!string.IsNullOrEmpty(cue.nativeSub) || !string.IsNullOrEmpty(cue.nativeName))
                    {
                        // 子动作按她此刻的基底拼：BreakBase004_DrinkTea / WorkBase002_DrinkTea …
                        // 游戏在每个基底下各实现了一遍同名子动作，姿势基准不同。
                        // 少了这个上下文，手臂会落到错的位置——实测两只手摆成交叉。
                        string nativeWant = cue.nativeName;
                        if (!string.IsNullOrEmpty(cue.nativeSub))
                        {
                            string sub = ResolveNativeSub(cue.nativeSub, cue.nativeAlso, NativeService());
                            if (!string.IsNullOrEmpty(sub))
                            {
                                nativeWant = sub;
                                Plugin.Log.LogInfo("native sub " + cue.nativeSub + " -> " + sub);
                            }
                            else
                            {
                                // 她此刻的基底里没有这个子动作 —— **不做**，而不是换一个基底去做。
                                //
                                // 以前这里会跨基底找（她在 BreakBase001 看电影，找不到 DrinkTea 就用
                                // BreakBase004_DrinkTea），结果是她从看电影被整个搬到喝茶的姿势族里，
                                // 再回电影——一次明显的"打断"。游戏每个基底下各实现一遍同名子动作，
                                // 正是因为这个：换基底不是换个动作，是换一套姿势基准。
                                //
                                // 跨基底采样同样不行：把别族的 clip 采样到当前姿势上，实测两只手摆成交叉。
                                // 所以这里直接跳过这一条，让下一个 cue 过来。
                                Plugin.Log.LogInfo("native sub " + cue.nativeSub +
                                    " 不在当前基底（" + CurrentNativeName() + "），跳过这一条动作");
                                continue;
                            }
                        }
                        if (!string.IsNullOrEmpty(nativeWant))
                        {
                            // nativeName 是具体枚举名，同样可能跨族（Base001_Motion5_Shy 播在 BreakBase003 上）。
                            // 换算到她此刻的族里；换算不出来就只留表情和嘴形——和子动作那条一个道理。
                            string curBase2 = NativeBasePrefix(CurrentNativeName());
                            string mapped = SameFamilyNative(nativeWant, curBase2);
                            Plugin.Log.LogInfo("native name " + nativeWant + " 族=" + (curBase2.Length == 0 ? "(未知)" : curBase2) +
                                " -> " + (mapped ?? "(无同族等价)"));
                            if (!string.IsNullOrEmpty(mapped))
                            {
                                nativeWant = mapped;
                            }
                            else if (Plugin.CrossFamilyNative != null && Plugin.CrossFamilyNative.Value)
                            {
                                Plugin.Log.LogInfo("native name " + nativeWant + " 族不匹配（" + curBase2 + "），按宽松模式照播");
                            }
                            else
                            {
                                Plugin.Log.LogInfo("native name " + nativeWant + " 在自己这一族（" + curBase2 +
                                    "）里没有对应动作，只留表情和嘴形");
                                continue;
                            }
                            float waitClipBy = Time.unscaledTime + 3f;
                            while (clipActive && Time.unscaledTime < waitClipBy)
                                yield return null;
                            yield return PlayNative(nativeWant, cue.durationMs);
                            if (nativeLastStarted)
                            {
                                // 原生演完了，但游戏可能还在收尾。等它落地再让下一条 cue 起手，
                                // 否则采样层会插进收尾过渡里，看起来像原生动作被人切走。
                                yield return WaitNativeSettled(0.25f);
                                continue;
                            }
                            // 原生没接上（枚举名变了 / 状态机拒收）：回落到采样，
                            // 这一次至少还有动作，而不是什么都不演。
                            Plugin.Log.LogWarning("native fallback to clip: " + cue.id);
                        }
                    }
                    // 上一条动作还没演完就插新的，等于从中间切断：身体要走一次
                    // "归还姿势 → 重新淡入"，观感就是抽一下。这里等它落地再起手。
                    // 兜底 3 秒：万一 clipActive 因为别的原因没清，不能把整条链卡死。
                    float idleBy = Time.unscaledTime + 3f;
                    while (clipActive && Time.unscaledTime < idleBy)
                        yield return null;
                    // 采样也不能跨族：clip 是按某族的姿势基准做的，套到别的族上手臂会错位。
                    string clipFam = ClipFamily(cue.id);
                    string hereFam = NativeBasePrefix(CurrentNativeName());
                    if (clipFam.Length > 0 && hereFam.Length > 0 && !string.Equals(clipFam, hereFam, StringComparison.OrdinalIgnoreCase)
                        && (Plugin.CrossFamilyNative == null || !Plugin.CrossFamilyNative.Value))
                    {
                        Plugin.Log.LogInfo("采样 " + cue.id + " 属于 " + clipFam + "，她此刻在 " + hereFam + "，跳过这一条动作");
                        continue;
                    }
                    PlayAnim(cue.id, cue.durationMs, cue.holdMs);
                }
                else if (cue.slot == "trip") TriggerLeaveChair(cue.id, cue.durationMs);
                // 控制台点机位：id 是机位名，"off:" 前缀表示关掉那台隐藏相机
                else if (cue.slot == "dump" && string.Equals(cue.id, "anims", StringComparison.OrdinalIgnoreCase))
                {
                    // 把 180 条原生动作名一次吐到日志里，供离线分组（native-gestures.json）。
                    // 走 cue 通道而不是新开控制台动词：这条路已经通了，不用再加一层协议。
                    var all = EnumNames();
                    Plugin.Log.LogInfo("anims n=" + all.Length + " :: " + string.Join(",", all));
                }
                else if (cue.slot == "camera")
                {
                    string want = cue.id ?? "";
                    bool on = true;
                    if (want.StartsWith("off:", StringComparison.OrdinalIgnoreCase)) { on = false; want = want.Substring(4); }
                    SwitchCamera(want, on);
                }
                else if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("cue skipped: " + cue.slot + ":" + cue.id);
            }
            // 语音已在开头起播，这里不再重复
        }

        // ── 原生路径 ───────────────────────────────────────────────────
        // 游戏自己有完整的动画状态机（Character_Animator_ForScript，5 层：
        // 身体 / 视线 / 表情 / 说话 / 抖动）。直接调 ChangeAnimation 让 Unity 去转载、
        // 混合、演完收尾、回落待机——这三件事我们手搓了一整晚也没搓平。
        private bool nativeBusy;
        // 最近一次原生播放有没有真的开始。没起来就不能当成演完了——
        // 静默丢掉一个动作比演得难看更难查。
        private bool nativeLastStarted;
        private static Type nativeEnumType;
        private static System.Reflection.FieldInfo nativeCurrentField;
        private static System.Reflection.MethodInfo nativeChangeMethod;

        private static bool ResolveNative()
        {
            if (nativeChangeMethod != null) return true;
            Type hsType = null;
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                hsType = asm.GetType("Bulbul.HeroineService", false);
                if (hsType != null) break;
            }
            if (hsType == null) return false;
            nativeCurrentField = hsType.GetField("_currentAnimationType",
                System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            Type[] nest = hsType.GetNestedTypes(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic);
            for (int i = 0; i < nest.Length; i++)
                if (nest[i].Name == "AnimationType") nativeEnumType = nest[i];
            if (nativeEnumType == null) return false;
            nativeChangeMethod = hsType.GetMethod("ChangeAnimation", new Type[] { nativeEnumType });
            return nativeChangeMethod != null;
        }

        private static object NativeService()
        {
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                Type t = asm.GetType("Bulbul.HeroineService", false);
                if (t == null) continue;
                UnityEngine.Object o = UnityEngine.Object.FindObjectOfType(t);
                if (o != null) return o;
            }
            return null;
        }

        private static string NativeCurrentName(object svc)
        {
            if (svc == null || nativeCurrentField == null) return "";
            try { return Convert.ToString(nativeCurrentField.GetValue(svc)); } catch { return ""; }
        }

        /// <summary>
        /// 她此刻的动作名，带兜底。
        ///
        /// `NativeService()` 是按类名找的（Bulbul.HeroineService），类名一改就返回 null，
        /// 于是"她此刻在哪一族"变成未知——跨族判定就会悄悄失效（实测：日志里 `族=(未知)`
        /// 而动作照样跨族播出去了）。
        ///
        /// 兜底是全场景扫一遍：谁的类里有 `_currentAnimationType` 就是谁，不依赖任何类名字符串。
        /// 扫到就缓存下来，之后每帧只做一次字段读取。
        /// </summary>
        private static string CurrentNativeName()
        {
            // 先把这个枚举和字段解析出来。少了这一句，nativeEnumType 还是 null，
            // 下面"只认字段类型相符的对象"这道过滤会失效，于是抓到 DeskObject 那个同名字段。
            ResolveNative();
            string n = NativeCurrentName(NativeService());
            if (!string.IsNullOrEmpty(n)) return n;
            try
            {
                if (nativeSvcCache == null)
                {
                    // 整场景扫一遍 MonoBehaviour 不便宜，而"她此刻在哪一族"每帧都问。
                    // 扫不到时以前是每帧都重扫（几十上百个对象的 GetType + GetField 反射）；
                    // 现在 5 秒扫一次，扫到就永久缓存（换场景时缓存对象会变成 null，走 else 分支重扫）。
                    if (Time.unscaledTime < nativeScanAt) return "";
                    nativeScanAt = Time.unscaledTime + 5f;
                    var all = UnityEngine.Object.FindObjectsOfType<MonoBehaviour>();
                    for (int i = 0; i < all.Length; i++)
                    {
                        var mb = all[i];
                        if (mb == null) continue;
                        var f = mb.GetType().GetField("_currentAnimationType",
                            BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                        if (f == null) continue;
                        // 只认字段类型正好是那个枚举的对象。场景里还有别的类也叫 _currentAnimationType
                        // （HeroineUseObjectController 的 DeskObjectAnimationType，值是 FromBookToPc 之类），
                        // 不校验类型就会抓到它，于是"她此刻在哪一族"读成 FromBookToPc。
                        if (nativeEnumType != null && f.FieldType != nativeEnumType) continue;
                        string s = Convert.ToString(f.GetValue(mb));
                        if (string.IsNullOrEmpty(s) || s == "None") continue;
                        nativeSvcCache = mb;
                        n = s;
                        break;
                    }
                    if (nativeSvcCache == null) return "";
                }
                // 缓存的对象被销毁（换场景 / 重开一局）时引用会变成 null：以前这里直接
                // 往 NativeCurrentName(null) 里传，然后一直返回空（"族未知"）直到重启游戏。
                var cachedMb = nativeSvcCache as UnityEngine.Object;
                if (cachedMb == null || !cachedMb) { nativeSvcCache = null; nativeScanAt = 0f; return ""; }
                if (n.Length == 0) n = NativeCurrentName(nativeSvcCache);
            }
            catch (Exception eCn)
            {
                // 以前是裸 catch {}：返回空串，下游当成"族未知"就直接放行跨族
                // （SameFamilyNative / ResolveNativeSub），正好是注释里记过的"族=(未知) 却照样跨族播"。
                if (nativeNameFails++ % 20 == 0)
                    Plugin.Log.LogWarning("native: 读不到当前族名（第 " + nativeNameFails + " 次） " + eCn.GetType().Name + ": " + eCn.Message);
            }
            return n;
        }

        // 她此刻站在哪套动作里 —— 取 _currentAnimationType 的下划线前缀。
        //   BreakBase004_DrinkTea -> "BreakBase004"
        //   WorkBase002           -> "WorkBase002"
        // 拼子动作全靠这个：游戏在每个基底下各实现了一遍 DrinkTea / Thinking 之类，
        // 少了基底上下文，姿势基准就不对（实测会把手摆成交叉）。
        private static string NativeBasePrefix(string name)
        {
            if (string.IsNullOrEmpty(name)) return "";
            int i = name.IndexOf('_');
            return i > 0 ? name.Substring(0, i) : name;
        }

        // 按当前基底拼子动作名。拼不出来返回 null，让调用方退回 nativeName。
        // 只认枚举里真有的名字：游戏加了新基底就自动能用，删了也不会炸。
        // 枚举全表只取一次。游戏更新后名字变了，靠这份缓存对比出来。
        private static string[] enumNamesCache;
        private static float enumRetryAt;
        private static float nativeScanAt;
        private static bool enumWarned;
        private static int nativeNameFails;
        private static object nativeSvcCache;
        private static bool enumDiffed;

        private static string[] EnumNames()
        {
            if (enumNamesCache != null && enumNamesCache.Length > 0) return enumNamesCache;
            // 空表不当有效缓存：以前一次失败（场景还没加载完 / 原生类型还没解析到）
            // 就把 new string[0] 永久写进缓存，之后所有原生动作静默降级，只有最早一条 warn。
            if (enumNamesCache != null && Time.unscaledTime < enumRetryAt) return enumNamesCache;
            if (!ResolveNative())
            {
                enumRetryAt = Time.unscaledTime + 60f;
                enumNamesCache = new string[0];
                return enumNamesCache;
            }
            try
            {
                var names = Enum.GetNames(nativeEnumType);
                if (names != null && names.Length > 0)
                {
                    enumNamesCache = names;
                    return enumNamesCache;
                }
                if (!enumWarned) { enumWarned = true; Plugin.Log.LogError("enum names: 拿到空表，60 秒后重试"); }
            }
            catch (Exception e)
            {
                if (!enumWarned) { enumWarned = true; Plugin.Log.LogError("enum names: " + e.Message + "，60 秒后重试"); }
            }
            enumRetryAt = Time.unscaledTime + 60f;
            if (enumNamesCache == null) enumNamesCache = new string[0];
            return enumNamesCache;
        }

        private static int EnumIndexOf(string name)
        {
            var names = EnumNames();
            for (int i = 0; i < names.Length; i++)
                if (string.Equals(names[i], name, StringComparison.OrdinalIgnoreCase)) return i;
            return -1;
        }

        /// <summary>
        /// 采样 clip 属于哪一族。没有原生名的 cue 走采样，采样同样跨不得族
        /// （实测：work_pc 的 thinking clip 采到休息姿势上，两只手摆成交叉）。
        /// 名字规律从 assets.seed.json / 实际日志里来的，纯字符串判断，缺一条不影响别条。
        /// </summary>
        private static string ClipFamily(string clipId)
        {
            if (string.IsNullOrEmpty(clipId)) return "";
            string s = clipId.ToLowerInvariant();
            if (s.Contains("work_pc")) return "WorkBase002";
            if (s.Contains("work_book")) return "WorkBase002";
            if (s.Contains("work_report")) return "WorkBase003";
            if (s.Contains("break_movie")) return "BreakBase001";
            if (s.Contains("break_novel")) return "BreakBase002";
            if (s.Contains("break_music")) return "BreakBase003";
            if (s.Contains("break_tea")) return "BreakBase004";
            if (s.Contains("break_sleep")) return "BreakBase005";
            if (s.Contains("break_forward")) return "BreakBase006";
            if (s.Contains("story") || s.Contains("base001")) return "Base001";
            if (s.Contains("wild")) return "Wild";
            return "";
        }

        /// <summary>
        /// 把动作名换算到她**此刻的姿势族**里。
        ///
        /// 游戏那 180 条原生动作按族命名：Base001_… / BreakBase001_… / WorkBase001_… 等。
        /// 族的差别不是前缀好看，是**姿势基准不同**（坐着/靠着/拿着东西），
        /// 跨族播等于把她从当前姿势里搬走，再回来就是一次可见的打断。
        ///
        /// 所以：同族直接用；跨族就在当前族里找同名后缀；都没有就返回 null，让调用方只留表情和嘴形。
        /// </summary>
        private static string SameFamilyNative(string want, string curBase)
        {
            if (string.IsNullOrEmpty(want)) return null;
            if (string.IsNullOrEmpty(curBase)) return want;
            string wBase = NativeBasePrefix(want);
            if (!string.IsNullOrEmpty(wBase) && string.Equals(wBase, curBase, StringComparison.OrdinalIgnoreCase))
                return want;

            int cut = want.IndexOf('_');
            string suffix = cut >= 0 ? want.Substring(cut + 1) : want;      // Motion5_Shy
            var names = EnumNames();

            // ① 同后缀，换族
            string exact = curBase + "_" + suffix;
            if (EnumIndexOf(exact) >= 0) return exact;

            // ② 同族里带同一个尾关键词：Shy / Drink / Stretch …
            string key = suffix;
            int lastCut = suffix.LastIndexOf('_');
            if (lastCut >= 0 && lastCut < suffix.Length - 1) key = suffix.Substring(lastCut + 1);
            if (key.Length >= 3)
            {
                string hit = FindInFamily(names, curBase, key);
                if (hit != null) return hit;
            }

            // ③ 近义：族里没有"Shy"，但有"Laugh"/"Interest"——她此刻在看的电影里就这么几个动作。
            // 这一层是查表，不是猜：候选词全部来自 native-gestures.json 里各族的实际动作名。
            string[] alt = SynonymsFor(key);
            for (int k = 0; k < alt.Length; k++)
            {
                string hit = FindInFamily(names, curBase, alt[k]);
                if (hit != null) return hit;
            }
            return null;
        }

        private static string FindInFamily(string[] names, string curBase, string key)
        {
            if (string.IsNullOrEmpty(key)) return null;
            for (int i = 0; i < names.Length; i++)
            {
                if (!names[i].StartsWith(curBase + "_", StringComparison.OrdinalIgnoreCase)) continue;
                if (names[i].IndexOf(key, StringComparison.OrdinalIgnoreCase) >= 0) return names[i];
            }
            return null;
        }

        /// <summary>近义动作词。游戏各族的动作表很小（休息族 2~6 条），所以要按它真有的词去找。</summary>
        private static string[] SynonymsFor(string key)
        {
            if (string.IsNullOrEmpty(key)) return new string[0];
            switch (key.ToLowerInvariant())
            {
                case "shy": case "smile": case "happy": case "fun": case "laugh": case "cheer":
                    return new[] { "Laugh", "Interest", "Smile" };
                case "think": case "thinking": case "curious": case "wonder":
                    return new[] { "Interest", "Suspenseful" };
                case "surprise": case "fear": case "worry": case "nervous":
                    return new[] { "Suspenseful", "Interest" };
                case "drink": case "tea": case "sip":
                    return new[] { "DrinkTea", "DrinkHot", "CoolingDrinkTea" };
                case "stretch": case "relax":
                    return new[] { "Stretch", "Laugh" };
                case "read": case "page":
                    return new[] { "NextPage", "Interest" };
                default:
                    return new string[0];
            }
        }

        private static bool EnumExists(string name)
        {
            if (string.IsNullOrEmpty(name)) return false;
            return EnumIndexOf(name) >= 0;
        }

        // 游戏更新会改动作名。这里留一份上次的快照，第一次拿到枚举时对比，
        // 只用日志报差异——不改行为，因为我们本来就不会因为找不到名字而崩。
        // 但"静默退化"最难查（动作还在演，只是退回了采样），所以变化必须留痕。
        private static void DiffEnumSnapshot()
        {
            if (enumDiffed) return;
            enumDiffed = true;
            var names = EnumNames();
            if (names.Length == 0) return;
            string path = System.IO.Path.Combine(BepInEx.Paths.BepInExRootPath, "chill-enum.txt");
            try
            {
                string[] prev = System.IO.File.Exists(path) ? System.IO.File.ReadAllLines(path) : new string[0];
                var prevSet = new HashSet<string>(prev);
                var nowSet = new HashSet<string>(names);
                int added = 0, gone = 0;
                var addList = new List<string>();
                var goneList = new List<string>();
                for (int i = 0; i < names.Length; i++)
                    if (!prevSet.Contains(names[i])) { added++; if (addList.Count < 20) addList.Add(names[i]); }
                for (int i = 0; i < prev.Length; i++)
                    if (prev[i].Length > 0 && !nowSet.Contains(prev[i])) { gone++; if (goneList.Count < 20) goneList.Add(prev[i]); }
                if (prev.Length == 0) Plugin.Log.LogInfo("enum: 首次记录 " + names.Length + " 个动作名");
                else if (added == 0 && gone == 0) Plugin.Log.LogInfo("enum: " + names.Length + " 个动作名，与上次一致");
                else
                {
                    Plugin.Log.LogWarning("enum: 动作表变了 共" + names.Length + " 新增" + added + " 消失" + gone);
                    for (int i = 0; i < addList.Count; i++) Plugin.Log.LogWarning("  + " + addList[i]);
                    for (int i = 0; i < goneList.Count; i++) Plugin.Log.LogWarning("  - " + goneList[i]);
                }
                System.IO.File.WriteAllLines(path, names);
            }
            catch (Exception e) { Plugin.Log.LogWarning("enum snapshot: " + e.Message); }
        }

        // 子动作解析：绝不写死全名。
        //
        // 游戏更新最可能动两处：基底名、子动作名。所以按"语义链"找，四层逐级放宽：
        //   ① <基底>_<子动作>      精确
        //   ② <基底>_<备选>        精确（服务端可以给一串同义写法）
        //   ③ <基底>_<子动作>      前缀（DrinkTea 改成 DrinkTeaCup 也能命中）
        //   ④ <基底>_*<子动作>*    包含（DrinkTea 被挪到 DrinkTea_Slow 也能命中）
        // 每层都先在"她此刻的基底"里找，再依次试备选基底。
        // 全落空才返回 null，让调用方回落采样——降级而不是报错。
        private string ResolveNativeSub(string sub, string also, object svc)
        {
            if (string.IsNullOrEmpty(sub) && string.IsNullOrEmpty(also)) return null;
            if (!ResolveNative()) return null;
            var names = EnumNames();
            if (names.Length == 0) return null;
            DiffEnumSnapshot();

            string cur = NativeCurrentName(svc);
            string baseName = NativeBasePrefix(cur);

            var subs = new List<string>();
            if (!string.IsNullOrEmpty(sub)) subs.Add(sub);
            if (!string.IsNullOrEmpty(also))
                foreach (var raw in also.Split(','))
                {
                    string t = raw.Trim();
                    if (t.Length > 0 && !subs.Contains(t)) subs.Add(t);
                }

            var bases = new List<string>();
            // 只用她此刻的基底。跨基底"找一个能演的"等于换姿势族——见调用处的说明。
            // 只有在拿不到当前基底（还没进任何动作）时才退回默认几族。
            if (!string.IsNullOrEmpty(baseName)) bases.Add(baseName);
            else
                for (int i = 0; i < SubFallbackBases.Length; i++)
                    if (!bases.Contains(SubFallbackBases[i])) bases.Add(SubFallbackBases[i]);

            // ① 精确
            for (int bi = 0; bi < bases.Count; bi++)
                for (int si = 0; si < subs.Count; si++)
                {
                    string cand = bases[bi] + "_" + subs[si];
                    if (EnumIndexOf(cand) >= 0) return LandSub(cur, baseName, cand);
                }
            // ② 前缀
            for (int bi = 0; bi < bases.Count; bi++)
                for (int si = 0; si < subs.Count; si++)
                {
                    string pfx = bases[bi] + "_" + subs[si];
                    for (int n = 0; n < names.Length; n++)
                        if (names[n].StartsWith(pfx, StringComparison.OrdinalIgnoreCase))
                            return LandSub(cur, baseName, names[n]);
                }
            // ③ 包含
            for (int bi = 0; bi < bases.Count; bi++)
                for (int si = 0; si < subs.Count; si++)
                {
                    string pfx = bases[bi] + "_";
                    for (int n = 0; n < names.Length; n++)
                        if (names[n].StartsWith(pfx, StringComparison.OrdinalIgnoreCase)
                            && names[n].IndexOf(subs[si], StringComparison.OrdinalIgnoreCase) >= 0)
                            return LandSub(cur, baseName, names[n]);
                }

            Plugin.Log.LogInfo("native sub: 当前基底（" + (string.IsNullOrEmpty(baseName) ? "未知" : baseName) +
                "）里找不到 " + sub + "（枚举 " + names.Length + " 条，跨族不算）");
            return null;
        }

        private static string LandSub(string cur, string curBase, string hit)
        {
            int us = hit.IndexOf('_');
            string hitBase = us > 0 ? hit.Substring(0, us) : hit;
            if (!string.IsNullOrEmpty(curBase) && !string.Equals(hitBase, curBase, StringComparison.OrdinalIgnoreCase))
                Plugin.Log.LogInfo("native sub: 她在 " + cur + "，改用 " + hit);
            else
                Plugin.Log.LogInfo("native sub -> " + hit);
            return hit;
        }

        // ── 官方状态机 ─────────────────────────────────────────────
        // 她的"正在做什么"是 HeroineAI.ActionStateType 的一个显式值，不是我们从骨骼反推的。
        // 持续状态（写代码 / 看书 / 看电影 / 听歌 / 睡）直接切过去，
        // 游戏的 base_start -> base_loop -> base_end 全程它自己管：
        // 循环点、归还姿势、跟别的层抢骨骼，一件都不用我们操心。
        //
        // 这是"贴合官方路径"的核心：不写骨骼，只告诉状态机"她该去干什么"。
        private static Type aiType;
        private static MethodInfo aiChangeState;
        private static MethodInfo aiGetState;
        private static MethodInfo aiIsPossible;

        private static bool ResolveAi()
        {
            if (aiChangeState != null) return true;
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                Type t = null;
                try { t = asm.GetType("Bulbul.HeroineAI", false); } catch { }
                if (t == null)
                {
                    // 全名不一定是 Bulbul.HeroineAI —— dump 是按 Type.Name 匹配的，
                    // 看着像全名其实不是。所以按 Name 再找一遍。
                    try
                    {
                        Type[] all = null;
                        try { all = asm.GetTypes(); }
                        catch (ReflectionTypeLoadException rtle) { all = rtle.Types; }
                        catch { all = null; }
                        if (all != null)
                            for (int i = 0; i < all.Length; i++)
                                if (all[i] != null && all[i].Name == "HeroineAI") { t = all[i]; break; }
                    }
                    catch { }
                }
                if (t == null) continue;
                aiType = t;
                aiChangeState = t.GetMethod("DebugChangeState", BindingFlags.Public | BindingFlags.Instance);
                aiGetState = t.GetMethod("GetCurrentState", BindingFlags.Public | BindingFlags.Instance);
                aiIsPossible = t.GetMethod("IsPossibleChangeAction", BindingFlags.Public | BindingFlags.Instance);
                if (aiChangeState != null) return true;
            }
            return false;
        }

        private static object AiInstance()
        {
            if (!ResolveAi()) return null;
            try
            {
                var all = UnityEngine.Object.FindObjectsOfType(aiType);
                for (int i = 0; i < all.Length; i++)
                {
                    var c = all[i] as Component;
                    if (c != null && c.gameObject.activeInHierarchy) return c;
                }
                return all.Length > 0 ? all[0] : null;
            }
            catch { return null; }
        }

        private string AiStateName()
        {
            object ai = AiInstance();
            if (ai == null || aiGetState == null) return "";
            try { return Convert.ToString(aiGetState.Invoke(ai, null)); } catch { return ""; }
        }

        // 表情：L2 层，跟身体动作互不干扰。
        // ChangeHeroineFacialAnimation 的参数是 Int32 而不是枚举，得自己按 FacialType 换。
        // 表是实测出来的（enum FacialType），游戏加新表情就退化成"查不到就跳过"。
        private static readonly Dictionary<string, int> FacialIds = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
        {
            { "None", 0 }, { "Shy_Rest", 1 }, { "Shy_Fun", 2 }, { "Shy_Anger", 3 },
            { "Shy_Sad", 4 }, { "Shy_Joy", 5 }, { "Shy_Surprise", 6 }, { "Open_Eye", 18 },
        };
        private static MethodInfo facialChange;

        private static void ChangeFacial(string name, object svc)
        {
            if (svc == null || string.IsNullOrEmpty(name)) return;
            if (facialChange == null)
                facialChange = svc.GetType().GetMethod("ChangeHeroineFacialAnimation", BindingFlags.Public | BindingFlags.Instance);
            if (facialChange == null) { Plugin.Log.LogWarning("facial: 没有 ChangeHeroineFacialAnimation"); return; }
            int id;
            if (!FacialIds.TryGetValue(name, out id))
            {
                if (!int.TryParse(name, NumberStyles.Integer, CultureInfo.InvariantCulture, out id))
                {
                    Plugin.Log.LogWarning("facial: 不认识 " + name);
                    return;
                }
            }
            try
            {
                facialChange.Invoke(svc, new object[] { id });
                Plugin.Log.LogInfo("facial -> " + name + "(" + id + ")");
            }
            catch (Exception e)
            {
                Plugin.Log.LogWarning("facial: " + (e.InnerException != null ? e.InnerException.Message : e.Message));
            }
        }
        // 切状态。这是整个"原生表演"里最有性价比的一条：
        // 一条 DebugChangeState 换掉整段逐帧采样。
        private static bool IsWorkState(string name)
        {
            if (string.IsNullOrEmpty(name)) return false;
            return name.Equals("WorkPC", StringComparison.OrdinalIgnoreCase)
                || name.Equals("WorkBook", StringComparison.OrdinalIgnoreCase)
                || name.Equals("WorkReport", StringComparison.OrdinalIgnoreCase);
        }

        private IEnumerator SwitchState(string stateName)
        {
            object ai = AiInstance();
            if (ai == null) { Plugin.Log.LogWarning("state: 没有 HeroineAI 实例"); yield break; }
            string before = AiStateName();
            // 不替游戏决定她累不累：BreakSleep 由游戏按连续专注时长自己进入。
            // 曾经这里强行置 ActivateSleepFlg 再 DebugChangeState(BreakSleep)，
            // 那是改游戏自己的状态位，已移除（2026-11-19）。
            //
            // 同理，她已经睡着了就不要再用指令吵醒她。游戏送她进 BreakSleep 是长时间
            // 专注的结果，属于游戏自己的节奏；我们每来一句话就切一次状态，
            // 等于每隔几秒把她从睡梦里拽出来——比不演还糟。
            if (string.Equals(before, "BreakSleep", StringComparison.OrdinalIgnoreCase))
            {
                if (Plugin.VerboseCues != null && Plugin.VerboseCues.Value)
                    Plugin.Log.LogInfo("state: 她在睡（游戏按专注时长送的），本轮不切 " + stateName);
                yield break;
            }
            // 工作态（WorkPC / WorkBook / WorkReport）只能专注时切。
            //
            // 这一条是硬规矩，理由不在我们这边：**"她在敲键盘"本身就是游戏的番茄钟语义**。
            // 非专注时把她按进工作态，她就对着键盘敲，可现实里没有会话在跑——玩家看到的是
            // "我没开始专注，她自己在打字"，而且之后再开番茄钟她也只是从已经敲着的状态继续，
            // 等于把"开始专注"这个动作的效果提前偷走了。
            // 所以：非专注时她的身体状态归游戏，我们只做表情、嘴形和手边的小动作。
            if (!GameBusy.FocusMode && IsWorkState(stateName))
            {
                Plugin.Log.LogInfo("state: 非专注，不切工作态 " + stateName + "（她此刻是 " + before + "）");
                yield break;
            }
            if (string.Equals(before, stateName, StringComparison.OrdinalIgnoreCase))
            {
                Plugin.Log.LogInfo("state: 已经在 " + stateName);
                yield break;
            }
            // 她能接受指令才发，否则等一会儿。等不到也照发——被拒总比不动强。
            float waitBy = Time.unscaledTime + 3f;
            if (aiIsPossible != null)
                while (Time.unscaledTime < waitBy)
                {
                    bool ok = true;
                    try { ok = (bool)aiIsPossible.Invoke(ai, null); } catch { ok = true; }
                    if (ok) break;
                    yield return null;
                }
            object val;
            try { val = Enum.Parse(aiChangeState.GetParameters()[0].ParameterType, stateName, true); }
            catch { Plugin.Log.LogWarning("state: 动作表里没有 " + stateName); yield break; }
            try { aiChangeState.Invoke(ai, new object[] { val }); }
            catch (Exception e)
            {
                Plugin.Log.LogWarning("state: " + stateName + " 调用失败 " + (e.InnerException != null ? e.InnerException.Message : e.Message));
                yield break;
            }
            // 等它真的切过去。切不过去就如实记下来，别假装成功。
            float deadline = Time.unscaledTime + 4f;
            while (Time.unscaledTime < deadline)
            {
                yield return null;
                if (string.Equals(AiStateName(), stateName, StringComparison.OrdinalIgnoreCase)) break;
            }
            string after = AiStateName();
            if (string.Equals(after, stateName, StringComparison.OrdinalIgnoreCase))
                Plugin.Log.LogInfo("state: " + before + " -> " + after);
            else
                Plugin.Log.LogWarning("state: 想切 " + stateName + " 但现在是 " + after + "（被状态机拒了）");
        }

        // 发一条 ChangeAnimation，然后等它自己演完。
        // 结束判据 = _currentAnimationType 不再是这个动作（游戏演完会回落 Base001 / BreakBase*）。
        // startBy 兜一周：游戏先播当前动作的 _end，再起新的，中间有一两秒。
        private IEnumerator PlayNative(string typeName, int durationMs)
        {
            if (!ResolveNative())
            {
                Plugin.Log.LogWarning("native unavailable: " + typeName);
                yield break;
            }
            object svc = NativeService();
            if (svc == null) { Plugin.Log.LogWarning("native: no HeroineService"); yield break; }
            object val;
            try { val = Enum.Parse(nativeEnumType, typeName, true); }
            catch { Plugin.Log.LogWarning("native: bad enum " + typeName); yield break; }

            nativeBusy = true;
            try
            {
                nativeChangeMethod.Invoke(svc, new object[] { val });
                Plugin.Log.LogInfo("native play " + typeName);
                // 起手窗口：游戏开新动作前会先把当前动作的 _end 播完。
                // 实测"看电影"收尾 1.00s、"看小说"收尾 3.19s——2 秒会把后者判成没接上，
                // 然后回落采样，和还在跑的状态机抢骨骼。4.5 秒覆盖最长的收尾。
                float startBy = Time.unscaledTime + 4.5f;
                // 总时长按这条 cue 自己的长度算，别用固定值：
                // 哈欠 5.33s + 收尾就要 7 秒以上，9 秒的硬顶对长动作不够。
                float dsec = Mathf.Clamp(durationMs / 1000f, 1f, 20f);
                float deadline = Time.unscaledTime + dsec + 6f;
                bool started = false;
                while (Time.unscaledTime < deadline)
                {
                    string now = NativeCurrentName(svc);
                    if (!started)
                    {
                        if (now == typeName) started = true;
                        else if (Time.unscaledTime > startBy) break;
                    }
                    else if (now != typeName) break;
                    yield return null;
                }
                nativeLastStarted = started;
                Plugin.Log.LogInfo("native done " + typeName + " started=" + started);
                // 放手前先把姿势拍下来。原生动作演完时游戏会自己 CrossFade 回待机，
                // 那个过渡只有一两帧：实测右前臂 105.6° / 67ms ≈ 1576°/s，眼睛看到的就是"啪"一下归位。
                // 这不是我们写出来的（那一刻 native=0 且 clip=0），但可以把它拖慢。
                EnsureBones();
                if (bones != null && bones.Length > 0)
                {
                    if (nativeExitRot == null || nativeExitRot.Length != bones.Length) nativeExitRot = new Quaternion[bones.Length];
                    for (int i = 0; i < bones.Length; i++)
                        nativeExitRot[i] = bones[i] != null ? bones[i].localRotation : Quaternion.identity;
                    nativeExitUntil = Time.unscaledTime + NativeExitBlend;
                }
            }
            finally { nativeBusy = false; }
        }

        // 等游戏把收尾过渡走完。
        //
        // PlayNative 一看到动作名变了就返回，但"名字变了"只是收尾的开始：
        // 游戏还要用一两帧 CrossFade 回到待机。这时候如果下一条 cue 立刻 PlayAnim，
        // 采样层就开始写骨骼，正好插在收尾中间——观感是原生动作被切开、换了个动作。
        // 判据用"动作名连续 stableSec 秒不再变"，不是等固定时长：
        // 短动作收尾快，长动作收尾慢，固定值两头都不对。
        private IEnumerator WaitNativeSettled(float stableSec)
        {
            object svc = NativeService();
            if (svc == null) yield break;
            string last = NativeCurrentName(svc);
            float stableAt = Time.unscaledTime;
            float hardStop = Time.unscaledTime + 2.5f;
            while (Time.unscaledTime < hardStop)
            {
                yield return null;
                string now = NativeCurrentName(svc);
                if (now != last) { last = now; stableAt = Time.unscaledTime; }
                else if (Time.unscaledTime - stableAt >= stableSec) yield break;
            }
            Plugin.Log.LogInfo("native settle timeout, last=" + last);
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
        // 同一 clip 名可能同时存在于角色和道具（m_Chair_mobile 的 ChairAnimationCtr 就有 136 条同名），
        // 只演角色 = 人走了椅子不动。这里记下所有 owner，演出时按同一进度逐个采样。
        private readonly Dictionary<string, List<Animator>> clipExtraOwners = new Dictionary<string, List<Animator>>();
        private readonly List<GameObject> propTargets = new List<GameObject>();
        private readonly List<AnimationClip> propClips = new List<AnimationClip>();
        // 道具没有"身体预算"那套，进度按归一化走：角色走到几成，道具也走到几成。
        private float propProgress;
        // 根位移：离座/行走类 clip 必须放行，否则"走到沙发"这件事被写回逻辑抹掉，
        // 人只在画面里原地做动作。按住段则把根冻在走到的位置。
        private bool posFree;
        // 诊断：髋骨位移有多大（她到底有没有走开）
        private int hipsIdx = -1;
        private Vector3 hipsAtStart;
        // 沙发锚点：按名字现找（离座动画是原地动画，位移得我们自己给）
        // 房间相机：游戏靠切换它们换视角（Camera_Desk / Camera_Sofa / Camera_Bed）
        private bool roomCamCached;
        private Vector3 chairHomeWorld;
        private bool chairHomeValid;
        private bool heldPosValid;
        private Vector3 heldPos;
        private Vector3 rootAtClipStart;
        private bool rootStartValid;
        // 这一条没有同名道具 clip 时沿用上一条的最后姿势（否则椅子会弹回原位）
        private readonly List<GameObject> lastPropTargets = new List<GameObject>();
        private readonly List<AnimationClip> lastPropClips = new List<AnimationClip>();

        private AnimationClip[] segClips;
        private float[] segStarts;
        private float segTotal;
        // segHold[i] > 0 表示这一段被按住这么久（秒），采样时对它取模 → 原地循环。
        // 只有 holdMs 的 cue 才会出现，普通 cue 全是 0，行为不变。
        private float[] segHold;
        private float segHoldTotal;

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

        private void BuildSequence(string clipName, int holdMs = 0)
        {
            var names = new List<string>();
            var clips = new List<AnimationClip>();
            int holdClipIndex = -1;
            float holdSpanSec = 0f;
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
                // 分段形式（X_loop）被按住：这一段就是它自己，循环 holdMs
                if (holdMs > 0 && clipName.EndsWith("_loop", StringComparison.OrdinalIgnoreCase))
                {
                    holdClipIndex = clips.Count - 1;
                    holdSpanSec = Mathf.Max(0.5f, holdMs / 1000f);
                }
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
                    if (holdMs > 0)
                    {
                        // 按住：循环段只放一条，时长由 segHold 撑开（采样时取模）
                        names.Add(baseName + "_loop");
                        clips.Add(loop);
                        holdClipIndex = clips.Count - 1;
                        holdSpanSec = Mathf.Max(0.5f, holdMs / 1000f);
                    }
                    else
                    {
                        int reps = Mathf.Clamp(Mathf.RoundToInt(1.4f / Mathf.Max(0.2f, loop.length)), 1, 5);
                        for (int i = 0; i < reps; i++) { names.Add(baseName + "_loop"); clips.Add(loop); }
                    }
                }
                // _end 必须播：没有 loop 的族里，_start 末帧是动作最高点（哈欠=手举在嘴边），
                // 只播 _start 会停在那帧上不动，画面上就是"手臂一直举着"——比交界跳一帧糟得多。
                // 交界那一帧的跳变交给限速器摊平（实测 12° 分两帧走完）。
                if (end != null) { names.Add(baseName + "_end"); clips.Add(end); }
            }
            else
            {
                names.Add(clipName);
                clips.Add(self);
            }
            if (clips.Count == 0) { segClips = new AnimationClip[0]; segStarts = new float[1]; segHold = new float[0]; segTotal = 0f; segHoldTotal = 0f; return; }
            segClips = clips.ToArray();
            segStarts = new float[segClips.Length + 1];
            segHold = new float[segClips.Length];
            segTotal = 0f;
            segHoldTotal = 0f;
            for (int i = 0; i < segClips.Length; i++)
            {
                float natural = Mathf.Max(0.05f, segClips[i].length);
                float span = natural;
                if (holdClipIndex == i && holdSpanSec > 0f)
                {
                    segHold[i] = holdSpanSec;
                    segHoldTotal = holdSpanSec;
                    span = holdSpanSec;
                }
                segStarts[i] = segTotal;
                segTotal += span;
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
            if (bonePeak == null || bonePeak.Length != n) bonePeak = new float[n];
            for (int bi = 0; bi < n; bi++) bonePeak[bi] = 0f;
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
                float lt = tt - segStarts[idx];
                if (segHold != null && idx < segHold.Length && segHold[idx] > 0f) lt = Mathf.Repeat(lt, Mathf.Max(0.05f, segClips[idx].length));
                SampleChainClip(segClips[idx], clipTarget, lt, 0);
                for (int i = 0; i < n; i++)
                {
                    Quaternion q = bones[i].localRotation;
                    if (k == 0) { baseRot[i] = q; prevRot[i] = q; continue; }
                    float dev = Quaternion.Angle(baseRot[i], q);
                    float sp = step > 0.0001f ? Quaternion.Angle(prevRot[i], q) / step : 0f;
                    bool isHead = upperAllowed != null && i < upperAllowed.Length && upperAllowed[i];
                    if (dev > bonePeak[i]) bonePeak[i] = dev;
                    if (isHead) { if (dev > headDeg) headDeg = dev; if (sp > headSpd) headSpd = sp; }
                    else { if (dev > bodyDeg) bodyDeg = dev; if (sp > bodySpd) bodySpd = sp; }
                    prevRot[i] = q;
                }
            }
            for (int i = 0; i < n; i++) bones[i].localRotation = snap[i];
            // 哪几根骨头真的会动：低于阈值的整段都不写，交还给游戏。
            if (boneDrive == null || boneDrive.Length != n) boneDrive = new bool[n];
            boneDriveCount = 0;
            for (int bi = 0; bi < n; bi++)
            {
                boneDrive[bi] = bonePeak[bi] >= BoneDriveMinDeg;
                if (boneDrive[bi]) boneDriveCount++;
            }
            if (Plugin.VerboseCues != null && Plugin.VerboseCues.Value)
            {
                int armDriven = 0;
                for (int bi = 0; bi < n; bi++)
                {
                    if (!boneDrive[bi]) continue;
                    string nm = bones[bi] == null ? "" : (bones[bi].name ?? "");
                    if (nm.IndexOf("Arm", StringComparison.OrdinalIgnoreCase) >= 0
                        || nm.IndexOf("Hand", StringComparison.OrdinalIgnoreCase) >= 0
                        || nm.IndexOf("Finger", StringComparison.OrdinalIgnoreCase) >= 0) armDriven++;
                }
                Plugin.Log.LogInfo("drive: " + boneDriveCount + "/" + n + " bones, 手臂类 " + armDriven + " 根");
            }
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
            // 增益必须每帧重算，不能"第一次算完就缓存"：
            // 第一次演某族时 peakBodyFam 只量到开场那几帧（实测 0.2°），算出的 gain 是 1.0，
            // 缓存之后永远压不下来——149° 的哈欠被当成合理幅度全量播放，画面上就是手臂举过头顶。
            // peakBodyFam 只增不减，重算的结果单调收敛，不会来回抖。
            float gainBody = peakBodyFam > 0.05f
                ? Mathf.Clamp(limitBody / peakBodyFam, 0f, gainBodyCap)
                : gainBodyCap;
            familyGainBody[planFamily] = gainBody;
            float gainHead = peakHeadFam > 0.05f
                ? Mathf.Clamp(limitHead / peakHeadFam, 0f, gainHeadCap)
                : gainHeadCap;
            familyGainHead[planFamily] = gainHead;
            planWBody = gainBody;
            planWHead = gainHead;
            // 硬上限兜底：不管增益链路怎么算，身体都不允许按 149° 演。
            // BodyDegBudget(26) × BodyBurstScale(3) = 78° 是"大动作能到的最大幅度"，
            // 149° 在画面上就是把手举过头顶，不是打哈欠。
            {
                float bodyCeil = profile.BodyDeg * Mathf.Max(1f, profile.BodyBurst);
                if (bodyCeil > 1f && planBodyPeakDeg > bodyCeil)
                    planWBody = Mathf.Min(planWBody, bodyCeil / planBodyPeakDeg);
                float headCeil = profile.HeadDeg * Mathf.Max(1f, profile.HeadBurst);
                if (headCeil > 1f && planHeadPeakDeg > headCeil)
                    planWHead = Mathf.Min(planWHead, headCeil / planHeadPeakDeg);
            }
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

        // 游戏 Animator 当前播放的 clip（权重最大的那条）。读不到就返回空串，
        // 上层拿到空串一律按"不知道"处理，不做拦截。
        private string LiveClipName()
        {
            try
            {
                if (heroine == null || !heroine.isActiveAndEnabled) return "";
                var infos = heroine.GetCurrentAnimatorClipInfo(0);
                string best = "";
                float bestW = -1f;
                for (int i = 0; i < infos.Length; i++)
                {
                    var c = infos[i].clip;
                    if (c == null) continue;
                    float w = infos[i].weight;
                    if (w > bestW) { bestW = w; best = c.name; }
                }
                return best ?? "";
            }
            catch { return ""; }
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
            if (!chairHomeValid && bones != null && bones.Length > 0)
            {
                chairHomeWorld = bones[0].position;
                chairHomeValid = true;
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
            // 归还期间不再重采样：cts 越过 clipLen 后，循环类片段会取到回卷/收尾帧，
            // 姿势在那一帧跳一下（实测颈部 24°），随后全交给限速器去抹。
            // 归还的本质是"停止表演、把身体还回去"，姿势就停在最后一帧。
            bool exiting0 = !clipLoop && ct > clipLen;
            if (!exiting0) SampleChainClip(segClips[idx], clipTarget, ts - segStarts[idx], 0);
            if (!exiting0 && (propClips.Count > 0 || lastPropClips.Count > 0))
            {
                if (propClips.Count > 0)
                {
                    propProgress = segTotal > 0.01f ? Mathf.Clamp01(ts / segTotal) : 0f;
                    lastPropTargets.Clear(); lastPropClips.Clear();
                    lastPropTargets.AddRange(propTargets); lastPropClips.AddRange(propClips);
                    for (int pi = 0; pi < propClips.Count; pi++)
                    {
                        var pc = propClips[pi];
                        if (pc == null) continue;
                        float pl = Mathf.Repeat(propProgress * pc.length, Mathf.Max(0.05f, pc.length - 0.001f));
                        pc.SampleAnimation(propTargets[pi], pl);
                    }
                }
                else
                {
                    // 这一条没有道具版本（沙发上"待着"）：冻在上一条的最后一帧，别让椅子自己弹回去
                    for (int pi = 0; pi < lastPropClips.Count; pi++)
                    {
                        var pc = lastPropClips[pi];
                        if (pc == null) continue;
                        pc.SampleAnimation(lastPropTargets[pi], Mathf.Max(0f, pc.length - 0.001f));
                    }
                }
            }
            // 归还阶段：我们是插入，演完必须把身体还回去。
            // 目标要现场问游戏"你现在会把她摆成什么样"；用开演前的旧姿势 = 交回去一个过期姿势。
            float relMs = Plugin.ReleaseMs == null ? 300f : Mathf.Max(30f, Plugin.ReleaseMs.Value);
            float relSec = relMs / 1000f;
            bool exiting = exiting0;
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
// 起点必须是"我们上一帧真正写下去的值"。bones 此刻已被游戏重新求值，
                        // 拿它当起点等于拿游戏姿势当地基，斜坡一开始就错位。
                        exitFrom[bb] = (lastRot != null && bb < lastRot.Length) ? lastRot[bb]
                            : (bones[bb] == null ? Quaternion.identity : bones[bb].localRotation);
                }
                // 每帧重取归还目标：交回"正在跑的那段待机"，而不是开演前的静止快照。
                exitValid = CaptureGamePose(exitRot);
            // 游戏侧也会自己切待机：单帧取到的目标可能正处在它的过渡里。
            // 用 2 帧平滑（0.5 权重）压掉那一下，交接差从 8° 降到 1° 量级。
            if (exitValid)
            {
                if (exitSmooth == null || exitSmooth.Length != n)
                {
                    exitSmooth = new Quaternion[n];
                    for (int bb = 0; bb < n; bb++) exitSmooth[bb] = exitRot[bb];
                }
                else
                {
                    for (int bb = 0; bb < n; bb++) exitRot[bb] = Quaternion.Slerp(exitSmooth[bb], exitRot[bb], 0.5f);
                    for (int bb = 0; bb < n; bb++) exitSmooth[bb] = exitRot[bb];
                }
            }
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
            // 上限放到 1.6s：幅度大的动作（哈欠整族身体峰值 94°）在 900ms 内起来，
            // 看起来就是"猛一下"。淡入时长由动作自己多大决定，见 StartClip 里的按幅度补偿。
            float switchMs = Mathf.Clamp(switchMsFromClass, 80f, 1600f);
            float kSwitch = switchMs <= 1f ? 1f : Mathf.SmoothStep(0f, 1f, Mathf.Clamp01((Time.time - switchT0) / (switchMs / 1000f)));
            float dt = Mathf.Max(0.0001f, Time.deltaTime);
            for (int i = 0; i < n; i++)
            {
                var tr = bones[i];
                // 叠加式（专注/只叠不搬）演出里，这段 clip 没动的骨头一根都不写。
                // 她在敲键盘时，手臂属于这一类：交回游戏的状态机，敲击就不会停。
                // 以前所有骨头都写，基底又是"开演那一刻冻结的游戏姿势"，
                // 于是手臂被冻在起手那一帧 —— 这就是"一说话敲字就断"的来源。
                if ((profile.Additive || upperOnly) && boneDrive != null && i < boneDrive.Length && !boneDrive[i])
                {
                    lastRot[i] = tr.localRotation;
                    continue;
                }
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
                    // 归还期间 baseNow 必须继续用"开演时冻结的游戏基准"，不能切成此刻的活姿势：
// kOut 起点是 1（= 完全用我们的输出），这时候换基底等于在这一帧直接跳过去。
// 实测右前臂一帧跳 77°，全靠限速器才没看出来。交给归还斜坡去做，它本来就是干这个的。
                    Quaternion baseNow = gameRot[i];
                    q = baseNow * ScaleDelta(delta, isHead ? wHead : wBody);
                }
                else
                {
                    // 道具/姿态/位移类：必须真的到她该去的位置，所以向绝对姿势过渡，
                    // 过渡时长由分类决定（600~900ms），不是瞬间覆盖。
                    // 绝对姿势斜坡才是实际生效的那个淡入（abs=True 时不走 kSwitch）。
                    // 只改 switchMsFromClass 会出现日志写 1500ms、实际还是 profile 里的 900ms。
                    float rampMsEff = Mathf.Max(profile.RampMs, switchMsFromClass);
                    float rampW = rampMsEff <= 1f ? 1f : Mathf.SmoothStep(0f, 1f, Mathf.Clamp01((Time.time - absRampT0) / (rampMsEff / 1000f)));
                    // 归还期间 baseNow 必须继续用"开演时冻结的游戏基准"，不能切成此刻的活姿势：
// kOut 起点是 1（= 完全用我们的输出），这时候换基底等于在这一帧直接跳过去。
// 实测右前臂一帧跳 77°，全靠限速器才没看出来。交给归还斜坡去做，它本来就是干这个的。
                    Quaternion baseNow = gameRot[i];
                    q = Quaternion.Slerp(baseNow, tr.localRotation, Mathf.Clamp01((isHead ? wHead : wBody) * rampW));
                }
                // 起手：从"插入那一刻的姿势"过渡进来
                if (kSwitch < 1f && prevPoseValid && prevPose != null && i < prevPose.Length)
                    q = Quaternion.Slerp(prevPose[i], q, kSwitch);
                // 幅度天花板：任何一根骨头相对"游戏此刻姿势"的偏移都不许超过上限。
                // 增益链路（planWBody）在某些族上会算成 1.0，149° 的哈欠就被全量演出来——
                // 画面上是把手举过头顶。这里是写入端最后一道闸，只看几何，不看权重。
                // 身体 78°（26×3）、头颈 22.5°（15×1.5），按骨骼链归属分别收口。
                if (baseGameRot != null && i < baseGameRot.Length)
                {
                    float ceilDeg = isHead ? 22.5f : 78f;
                    float off = Quaternion.Angle(baseGameRot[i], q);
                    if (off > ceilDeg)
                    {
                        q = Quaternion.Slerp(baseGameRot[i], q, ceilDeg / off);
                        dbgClamped++;
                        if (dbgClamped == 1) { dbgClampFirst = ct; dbgClampBone = tr.name ?? ""; }
                        dbgClampAt = ct;
                        if (off > dbgClampMax) dbgClampMax = off;
                    }
                }
                // 归还：交回游戏此刻的姿势，而不是硬切
                // 归还：只做一件事 —— 从"她最后被写下去的那个姿势"交回"游戏此刻的姿势"。
                // 期间不再叠加采样、包络、增益：段尾这几样都会抖（实测颈部单帧 39°），
                // 混进来就只能在写入端靠限速器抹，看起来就是"慢半拍"。
                if (exiting && exitValid && exitFrom != null && i < exitFrom.Length && i < exitRot.Length)
                    q = Quaternion.Slerp(exitRot[i], exitFrom[i], kOut);
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
                        if (dbgClamped <= 3 && Plugin.VerboseCues != null && Plugin.VerboseCues.Value)
                            Plugin.Log.LogInfo("jump: ct=" + ct.ToString("F3") + " " + (tr.name ?? "") + " " + jumpDeg.ToString("F1") + "deg w=" + (isHead ? wHead : wBody).ToString("F2")
                                + " kOut=" + kOut.ToString("F2") + " exit=" + (exiting ? 1 : 0) + " env=" + EnvelopeAt(ct, isHead).ToString("F2")
                                + " clipLen:" + clipLen.ToString("F2"));
                        if (dbgClampFirst < 0f) dbgClampFirst = ct;
                        if (jumpDeg > dbgClampMax) { dbgClampMax = jumpDeg; dbgClampAt = ct; dbgClampBone = tr.name ?? ""; }
                    }
                }
                float d = Quaternion.Angle(lastRot[i], q);
                lastRot[i] = q;
                tr.localRotation = q;
                // 位置不再写回：采样给的绝对值就是答案。写回会把髋骨/根的位移整条抹掉。
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

        // ── 离座：按游戏自己的开关，不再自己排演出 ───────────────────
        // 2026-11-15 实测（WatchTick + 反射通道）：
        //   Character 根全程 (2.74, 0.00, 1.70) 不动；
        //   HeroineService._currentPlace 全程 Desk（她正在播沙发动画时也是 Desk）；
        //   _heroineTransform 是空表 —— 游戏里没有可切换的摆位点；
        //   变的只有 AnimationType，由 HeroineStateLeaveChairGoSofa 的权重 + 秒表
        //   在 thinking(40~70s) / lookOutside(40~70s) / headphone(15~20s) 之间轮转，
        //   最后自己播 comeback。
        // 所以位移、镜头、时长从来不是我们的活：这里只按下开始。
        // 请求入口：游戏可能在泡茶/翻书，这时候调会被吞掉，所以先挂起等它闲下来。
        internal static void TriggerLeaveChair(string planName, int holdMs)
        {
            if (!Plugin.TripGuard.TryBegin(planName)) return;
            pendingPlan = planName;
            pendingHoldMs = holdMs;
            pendingUntil = Time.unscaledTime + 30f;
            if (!TryFlushTrip())
                Plugin.Log.LogInfo("trip: " + planName + " 已挂起，等她回到待机再走（最多等 30s）");
        }
        
        // 每帧试一次：空闲就点火
        internal static bool TryFlushTrip()
        {
            if (pendingPlan == null) return true;
            if (Time.unscaledTime > pendingUntil)
            {
                Plugin.Log.LogWarning("trip: " + pendingPlan + " 等空闲超时，丢掉这次请求");
                pendingPlan = null;
                return true;
            }
            if (!IsGameIdle()) return false;
            string plan = pendingPlan;
            pendingPlan = null;
            FireLeaveChair(plan, pendingHoldMs);
            return true;
        }
        
        // 只看动画名：base/idle 结尾才算闲，_sub_ 这类子动作（泡茶、翻页、喝东西）算忙
        private static bool IsGameIdle()
        {
            var h = Plugin.FindHeroineForWatch();
            if (h == null) return true;
            var infos = h.GetCurrentAnimatorClipInfo(0);
            if (infos == null || infos.Length == 0 || infos[0].clip == null) return true;
            string n = infos[0].clip.name;
            if (n.IndexOf("leavechair", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            if (n.IndexOf("_sub_", StringComparison.OrdinalIgnoreCase) >= 0
                && n.IndexOf("_end", StringComparison.OrdinalIgnoreCase) < 0) return false;
            return n.EndsWith("_base_loop", StringComparison.OrdinalIgnoreCase)
                || n.EndsWith("_base", StringComparison.OrdinalIgnoreCase)
                || n.EndsWith("_base_end", StringComparison.OrdinalIgnoreCase)
                || n.EndsWith("_idle", StringComparison.OrdinalIgnoreCase)
                || n.StartsWith("anim_story_base", StringComparison.OrdinalIgnoreCase);
        }
        
        private static void FireLeaveChair(string planName, int holdMs)
        {
            try
            {
                Type aiType = null;
                foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
                {
                    var t = asm.GetType("HeroineAI", false);
                    if (t != null) { aiType = t; break; }
                }
                if (aiType == null) { Plugin.Log.LogWarning("trip: 找不到 HeroineAI，游戏版本可能变了"); return; }

                UnityEngine.Object ai = null;
                var found = Resources.FindObjectsOfTypeAll(aiType);
                if (found != null && found.Length > 0) ai = found[0];
                if (ai == null) { Plugin.Log.LogWarning("trip: HeroineAI 实例不存在"); return; }

                var mi = aiType.GetMethod("DebugForceLeaveChair",
                    BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                if (mi == null) { Plugin.Log.LogWarning("trip: HeroineAI.DebugForceLeaveChair 不存在"); return; }
                var ps = mi.GetParameters();
                if (ps.Length != 1 || !ps[0].ParameterType.IsEnum)
                {
                    Plugin.Log.LogWarning("trip: DebugForceLeaveChair 签名变了: " + (ps.Length > 0 ? ps[0].ParameterType.Name : "无参"));
                    return;
                }
                Type planType = ps[0].ParameterType;
                object plan = null;
                foreach (var n in Enum.GetNames(planType))
                {
                    if (string.Equals(n, planName, StringComparison.OrdinalIgnoreCase)) { plan = Enum.Parse(planType, n); break; }
                }
                if (plan == null)
                {
                    plan = Enum.GetValues(planType).GetValue(0);
                    Plugin.Log.LogWarning("trip: plan '" + planName + "' 不在游戏枚举里（"
                        + string.Join(",", Enum.GetNames(planType)) + "），回退到 " + plan);
                }
                // 先把闸门关上再让它动：游戏是"先播离座语音再走"，晚了就抢不过它。
                float holdSec = holdMs > 0 ? Mathf.Clamp(holdMs / 1000f, 5f, 60f) : 30f;
                GameVoiceGate.Enter("trip " + planName, holdSec);
                mi.Invoke(ai, new object[] { plan });
                Plugin.Log.LogInfo("trip: 已交给游戏自己的状态机 DebugForceLeaveChair(" + plan + ")");
            }
            catch (Exception ex)
            {
                Plugin.Log.LogWarning("trip: 调用失败 " + ex.GetType().Name + ": " + ex.Message);
            }
        }

        // ── 演出期间让游戏闭嘴 ──────────────────────────────────────
        // 我们的字幕和语音在播的时候，游戏自己的"自言自语"（弹幕）和她自己的语音
        // 会一起出来，两套台词打架。这两个开关实测都能在运行时改：
        //   HeroineSelfTalkController._selfTalkProbability  int，默认 75
        //   HeroineAI._heroineVoiceController.CancelVoice() / ChangeEnableHeroineTalkAnimation(bool)
        // 演出开始关掉，结束恢复；depth 计数 + 超时兜底，免得协程被中断后一直关着。
        internal static class GameVoiceGate
        {
            private static int depth;
            private static float expireAt;
            private static float nextCancelAt;
            private static bool active;
            private static int savedProbability = -1;
            private static object selfTalk;
            private static object voice;

            public static void Enter(string why, float holdSeconds)
            {
                depth++;
                expireAt = Time.unscaledTime + Mathf.Max(5f, holdSeconds);
                if (active) return;
                if (!Resolve()) return;
                try
                {
                    var pf = Field(selfTalk, "_selfTalkProbability");
                    if (pf != null)
                    {
                        savedProbability = (int)pf.GetValue(selfTalk);
                        pf.SetValue(selfTalk, 0);
                    }
                    Invoke0(voice, "CancelVoice", null);
                    active = true;
                    Plugin.Log.LogInfo("voice gate: 演出开始，游戏自言自语/语音已关（" + why + "）");
                }
                catch (Exception ex) { Plugin.Log.LogWarning("voice gate enter: " + ex.Message); }
            }

            public static void Exit()
            {
                depth--;
                if (depth > 0) return;
                depth = 0;
                expireAt = 0f;
                Restore("演出结束");
            }

            // 每帧兜底：协程被停掉时没人调 Exit，靠这里恢复
            public static void Tick()
            {
                if (!active) return;
                // 游戏可能在我们关闸之后才起播（离座语音就是这样），所以压住期间持续打断。
                if (Time.unscaledTime >= nextCancelAt)
                {
                    nextCancelAt = Time.unscaledTime + 0.5f;
                }
                if (Time.unscaledTime < expireAt) return;
                depth = 0;
                Restore("到点恢复");
            }

            private static void Restore(string why)
            {
                if (!active) return;
                try
                {
                    if (selfTalk != null && savedProbability >= 0)
                    {
                        var pf = Field(selfTalk, "_selfTalkProbability");
                        if (pf != null) pf.SetValue(selfTalk, savedProbability);
                    }
                    Plugin.Log.LogInfo("voice gate: 恢复游戏语音（" + why + "）");
                }
                catch (Exception ex) { Plugin.Log.LogWarning("voice gate restore: " + ex.Message); }
                finally { active = false; savedProbability = -1; }
            }

            private static FieldInfo Field(object target, string name)
            {
                if (target == null) return null;
                return target.GetType().GetField(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            }

            
            private static void Invoke0(object target, string name, object arg)
            {
                if (target == null) return;
                var mi = target.GetType().GetMethod(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                if (mi != null && mi.GetParameters().Length == 0) mi.Invoke(target, null);
            }

            private static void Invoke1(object target, string name, bool arg)
            {
                if (target == null) return;
                var mi = target.GetType().GetMethod(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                if (mi == null) return;
                var ps = mi.GetParameters();
                if (ps.Length == 1 && ps[0].ParameterType == typeof(bool)) mi.Invoke(target, new object[] { arg });
            }

            private static bool Resolve()
            {
                if (selfTalk != null) return true;
                try
                {
                    Type aiType = null;
                    foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
                    {
                        var t = asm.GetType("HeroineAI", false);
                        if (t != null) { aiType = t; break; }
                    }
                    if (aiType == null) return false;
                    var found = Resources.FindObjectsOfTypeAll(aiType);
                    if (found == null || found.Length == 0) return false;
                    object ai = found[0];
                    var f1 = aiType.GetField("_selfTalkController", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                    var f2 = aiType.GetField("_heroineVoiceController", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                    if (f1 != null) selfTalk = f1.GetValue(ai);
                    if (f2 != null) voice = f2.GetValue(ai);
                    if (selfTalk == null) Plugin.Log.LogWarning("voice gate: 拿不到 HeroineSelfTalkController");
                    return selfTalk != null;
                }
                catch (Exception ex) { Plugin.Log.LogWarning("voice gate resolve: " + ex.Message); return false; }
            }
        }

        public static string TracePath { get { return System.IO.Path.Combine(BepInEx.Paths.BepInExRootPath, "chill-trace.txt"); } }

        // 开始记录姿势。外部按 50ms 一行读，用来找"归位抽动"发生在哪一帧、多少度。
        public void StartTrace(float sec)
        {
            traceBones = null;
            traceBuf = new System.Text.StringBuilder();
            traceUntil = Time.unscaledTime + Mathf.Clamp(sec, 1f, 60f);
            traceNextAt = 0f;
            Plugin.Log.LogInfo("trace start " + traceUntil.ToString("F2") + " -> " + TracePath);
        }

        private void TraceTick()
        {
            if (traceUntil <= 0f || traceBuf == null) return;
            float now = Time.unscaledTime;
            if (now > traceUntil)
            {
                try { System.IO.File.WriteAllText(TracePath, traceBuf.ToString(), new System.Text.UTF8Encoding(false)); }
                catch (Exception e) { Plugin.Log.LogWarning("trace write: " + e.Message); }
                Plugin.Log.LogInfo("trace done lines=" + (traceBuf.ToString().Split('\n').Length - 1));
                traceUntil = 0f;
                return;
            }
            if (now < traceNextAt) return;
            traceNextAt = now + TraceDt;
            var root = clipTarget != null ? clipTarget.transform : (heroine != null ? heroine.transform : null);
            if (root == null) return;
            if (traceBones == null)
            {
                var all = root.GetComponentsInChildren<Transform>(true);
                traceBones = new Transform[TraceWanted.Length];
                for (int w = 0; w < TraceWanted.Length; w++)
                {
                    for (int i = 0; i < all.Length; i++)
                    {
                        if (all[i] == null) continue;
                        if (all[i].name.IndexOf(TraceWanted[w], StringComparison.OrdinalIgnoreCase) >= 0) { traceBones[w] = all[i]; break; }
                    }
                }
                traceBuf.Append("t|anim|native|clip|");
                for (int w = 0; w < TraceWanted.Length; w++)
                    traceBuf.Append(traceBones[w] == null ? TraceWanted[w] : traceBones[w].name).Append(w == TraceWanted.Length - 1 ? "" : "|");
                traceBuf.Append('\n');
            }
            traceBuf.Append(now.ToString("F3")).Append('|')
                .Append(NativeCurrentNameSafe()).Append('|')
                .Append(nativeBusy ? '1' : '0').Append('|')
                .Append(clipActive ? '1' : '0').Append('|');
            for (int w = 0; w < traceBones.Length; w++)
            {
                if (traceBones[w] == null) { traceBuf.Append('-'); }
                else
                {
                    // 记四元数不记欧拉角：欧拉角在 x 接近 ±90° 时会 gimbal 耦合，
                    // 同一个微小旋转能算出 120° 的"跳变"，追这种假尖峰纯属浪费。
                    // 角速度用 2*acos(|dot(q1,q2)|) 算，没有环绕和耦合问题。
                    Quaternion q = traceBones[w].localRotation;
                    traceBuf.Append(q.w.ToString("F4")).Append(',').Append(q.x.ToString("F4"))
                        .Append(',').Append(q.y.ToString("F4")).Append(',').Append(q.z.ToString("F4"));
                }
                if (w != traceBones.Length - 1) traceBuf.Append('|');
            }
            traceBuf.Append('\n');
        }

        private string NativeCurrentNameSafe()
        {
            try
            {
                object svc = NativeService();
                return svc == null ? "-" : (NativeCurrentName(svc) ?? "-");
            }
            catch { return "-"; }
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
            int namedUpper = 0;
            for (int i = 0; i < list.Length; i++)
            {
                string nm = list[i].name ?? "";
                // 这个池子的语义是「头颈」，不是「上半身」——它决定 headDeg/headSpd 这半边账，
                // 另一半是 bodyDeg/bodySpd。往里加手臂手指会把肢体的幅度算进头部预算，
                // 实测会让 clamp 从 1° 涨到 1673°，动作被削得面目全非。别加宽。
                bool named = nm.IndexOf("Head", StringComparison.OrdinalIgnoreCase) >= 0
                    || nm.IndexOf("Neck", StringComparison.OrdinalIgnoreCase) >= 0;
                upperAllowed[i] = named;
                if (named) namedUpper++;
                if (nm.IndexOf("Head", StringComparison.OrdinalIgnoreCase) >= 0
                    && (headIdx < 0 || nm.Length < (list[headIdx].name ?? "").Length)) headIdx = i;
            }
            // 名字一个都没命中 = 游戏换了命名风格或换了骨架。退到"世界高度高于躯干中线"：
            // 粗，但至少能把头和身体分开，限幅账不至于全记在身体上。
            // 只在名字全军覆没时才启用——正常情况名字比高度准得多（躺下时头会低于骨盆）。
            string upperHow = "name";
            if (namedUpper == 0 && list.Length > 0)
            {
                float lo = float.MaxValue, hi = float.MinValue;
                for (int i = 0; i < list.Length; i++)
                {
                    float y = list[i].position.y;
                    if (y < lo) lo = y;
                    if (y > hi) hi = y;
                }
                float cut = lo + (hi - lo) * 0.55f;
                int byHeight = 0;
                for (int i = 0; i < list.Length; i++)
                {
                    if (list[i].position.y > cut) { upperAllowed[i] = true; byHeight++; }
                }
                upperHow = "height>" + cut.ToString("F2") + "(" + byHeight + ")";
                for (int i = 0; i < list.Length; i++)
                {
                    if (list[i].name != null && list[i].name.IndexOf("Head", StringComparison.OrdinalIgnoreCase) >= 0)
                    { headIdx = i; break; }
                }
            }
            if (headIdx < 0) for (int i = 0; i < list.Length; i++) if (upperAllowed[i]) { headIdx = i; break; }
            Plugin.Log.LogInfo("head bone: idx=" + headIdx + " name=" + (headIdx >= 0 ? list[headIdx].name : "(none)")
                + " upper=" + System.Array.FindAll(upperAllowed, b => b).Length + "/" + list.Length + " via=" + upperHow);

            // cam scan：房间里有几台相机、谁管切换
            try
            {
                foreach (var cam in Resources.FindObjectsOfTypeAll<Camera>())
                {
                    if (cam == null || !cam.gameObject.scene.IsValid()) continue;
                    Plugin.Log.LogInfo("cam scan: " + cam.gameObject.name + " enabled=" + cam.enabled
                        + " goActive=" + cam.gameObject.activeInHierarchy + " depth=" + cam.depth.ToString("F1")
                        + " pos=" + cam.transform.position.ToString("F2") + " parent=" + (cam.transform.parent == null ? "-" : cam.transform.parent.name));
                }
                foreach (var mb in Resources.FindObjectsOfTypeAll<MonoBehaviour>())
                {
                    if (mb == null || !mb.gameObject.scene.IsValid()) continue;
                    if (mb.GetType().Name.IndexOf("Camera", StringComparison.OrdinalIgnoreCase) < 0) continue;
                    var t = mb.GetType();
                    var fields = t.GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                    int shown = 0;
                    foreach (var f in fields)
                    {
                        if (f.FieldType != typeof(string) && f.FieldType != typeof(int) && f.FieldType != typeof(bool)) continue;
                        object v = null;
                        try { v = f.GetValue(mb); } catch { continue; }
                        Plugin.Log.LogInfo("cam field: " + t.Name + "." + f.Name + " = " + v);
                        if (++shown >= 12) break;
                    }
                    if (mb.transform.childCount > 0)
                    {
                        for (int ci = 0; ci < mb.transform.childCount && ci < 12; ci++)
                        {
                            var ch = mb.transform.GetChild(ci);
                            Plugin.Log.LogInfo("cam child: " + t.Name + "/" + ch.name + " active=" + ch.gameObject.activeSelf
                                + " pos=" + ch.position.ToString("F2"));
                        }
                    }
                }
            }
            catch (Exception ex) { Plugin.Log.LogInfo("cam scan failed: " + ex.Message); }
            for (int hi = 0; hi < list.Length; hi++)
            {
                var hn = list[hi].name ?? "";
                if (hn.IndexOf("hips", StringComparison.OrdinalIgnoreCase) >= 0) { hipsIdx = hi; break; }
            }
            Plugin.Log.LogInfo("hips idx=" + hipsIdx);
            Plugin.Log.LogInfo("bones cached: " + list.Length + " under " + root.name);
            // 离座动画是原地动画（根位移 0）：想真到沙发上去，得先知道沙发在哪。
            try
            {
                int found = 0;
                foreach (var tr in Resources.FindObjectsOfTypeAll<Transform>())
                {
                    if (tr == null || !tr.gameObject.scene.IsValid()) continue;
                    string nm = tr.name ?? "";
                    if (nm.IndexOf("sofa", StringComparison.OrdinalIgnoreCase) < 0
                        && nm.IndexOf("couch", StringComparison.OrdinalIgnoreCase) < 0
                        && nm.IndexOf("bed", StringComparison.OrdinalIgnoreCase) < 0) continue;
                    Plugin.Log.LogInfo("seat candidate: " + nm + " world=" + tr.position.ToString("F2")
                        + " active=" + tr.gameObject.activeInHierarchy + " parent=" + (tr.parent == null ? "-" : tr.parent.name));
                    if (++found >= 10) break;
                }
                Plugin.Log.LogInfo("seat candidates=" + found + " charRoot=" + root.name + " world=" + root.position.ToString("F2")
                    + " local=" + root.localPosition.ToString("F2") + " parent=" + (root.parent == null ? "-" : root.parent.name));
            }
            catch (Exception ex) { Plugin.Log.LogInfo("seat scan failed: " + ex.Message); }
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

        private void StartClip(string clipName, bool loop, int durationMs, int holdMs = 0)
        {
            EnsureBones();
            if (clipAssets.Count == 0) return;
            // 名字归一：大脑点名 `X_loop`，资产里可能是 `anim_X_loop` 或大小写不同
            // 基名（一族，如 anim_break_yawn_1）**不能**归一：宽松匹配会把它接到 _end 上，
            // 于是"整族"变成"只播收尾那一段"——哈欠只演闭嘴，观感就是抖一下。
            // 基名要原样交给 BuildSequence 去拼 start→loop→end。
            string normName = clipName;
            bool looksBase = !clipName.EndsWith("_start", StringComparison.OrdinalIgnoreCase)
                && !clipName.EndsWith("_loop", StringComparison.OrdinalIgnoreCase)
                && !clipName.EndsWith("_end", StringComparison.OrdinalIgnoreCase)
                && !clipName.EndsWith("_single", StringComparison.OrdinalIgnoreCase);
            AnimationClip normClip = looksBase ? null : LookupLoose(clipName, out normName);
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
            // 同族还没演完：接着演，别重新起手。
            // 以前只比 clipName == activeClip.name，可上游下发的是**基名**（一族一条），
            // 段名 _start/_loop/_end 永远对不上这个比较——闸门形同虚设，
            // 于是每条新 cue 都从 _start 第 0 帧重新淡入：动作演到一半被拽回起点再重来，
            // 观感就是"抽一下"。这里按族名比，第一次就拦住。
            string fam = StripSuffix(clipName);
            bool sameFamily = clipActive && string.Equals(fam, activeBase, StringComparison.OrdinalIgnoreCase);
            if (stillPlaying && sameFamily)
            {
                skippedRepeat++;
                // 新 cue 只是要求演更久时，把总时长往后推；进度一秒不动。
                float wantLonger = durationMs > 0 ? durationMs / 1000f : 0f;
                if (wantLonger > clipLen) clipLen = wantLonger;
                if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("anim skip: 同族续演 " + fam
                    + " 已演 " + Mathf.RoundToInt((nowWall - clipStartWall) * 1000f) + "ms / " + Mathf.RoundToInt(clipLen * 1000f) + "ms");
                return;
            }
            // 同族续演：X_start -> X_loop -> X_end 是同一条动作，不该每段都重新淡入
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
            dbgClampFirst = -1f; dbgClampAt = -1f; dbgClampBone = "";
            // 这一条有哪些道具要一起动
            propTargets.Clear();
            propClips.Clear();
            {
                // 离座/回来这两族的椅子动画是按另一套锚点摆的，套过来会把椅子甩到镜头前
                bool skipPropForTrip = Plugin.Props == null || !Plugin.Props.Value
                || clipName.IndexOf("leavechair", StringComparison.OrdinalIgnoreCase) >= 0;
                List<Animator> holders;
                if (!skipPropForTrip && clipExtraOwners.TryGetValue(clipName, out holders))
                {
                    for (int hi = 0; hi < holders.Count; hi++)
                    {
                        var an = holders[hi];
                        if (an == null || an.gameObject == owner.gameObject) continue;
                        if (!an.gameObject.activeInHierarchy) continue;
                        var ctrl = an.runtimeAnimatorController;
                        if (ctrl == null) continue;
                        var cl = ctrl.animationClips;
                        if (cl == null) continue;
                        for (int ci = 0; ci < cl.Length; ci++)
                        {
                            if (cl[ci] != null && string.Equals(cl[ci].name, clipName, StringComparison.Ordinal))
                            {
                                propTargets.Add(an.gameObject);
                                propClips.Add(cl[ci]);
                                break;
                            }
                        }
                    }
                }
                if (propTargets.Count > 0 && Plugin.VerboseCues.Value)
                    Plugin.Log.LogInfo("props follow: " + clipName + " → " + propTargets.Count + " 个道具");
            }
            BuildSequence(clipName, holdMs);
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
            // 需要走位的那几族：离座、行走。它们不改写根位移就没有意义。
            if (hipsIdx >= 0 && bones != null && hipsIdx < bones.Length) hipsAtStart = bones[hipsIdx].localPosition;
            posFree = clipName.IndexOf("leavechair", StringComparison.OrdinalIgnoreCase) >= 0
                || clipName.IndexOf("_walk", StringComparison.OrdinalIgnoreCase) >= 0
                || clipName.IndexOf("_run", StringComparison.OrdinalIgnoreCase) >= 0;
            if (posFree && bones != null && bones.Length > 0)
            {
                rootAtClipStart = bones[0].localPosition;
                rootStartValid = true;
            }
            // 普通坐姿动作开始时清掉"她走开了"的记忆，免得一直冻在沙发
            if (!posFree && holdMs <= 0) heldPosValid = false;
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
            // 起手时长按"这一类动作有多大"给，不按测量值：测量值在第一次演某族时是 0，
            // 而第一次恰恰最抽。身体大动作（哈欠整族实测 107°）900ms 起来 = 一秒转一百度，
            // 观感就是"抽一下再正常"；小动作（点头 520ms）不受影响。
            {
                string clsLabel = MotionRules.Label(cls);
                if (clsLabel == "posture") switchMsFromClass = Mathf.Max(switchMsFromClass, 1500f);
                else if (clsLabel == "prop") switchMsFromClass = Mathf.Max(switchMsFromClass, 1200f);
                if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("fade in " + switchMsFromClass.ToString("F0") + "ms (" + clsLabel + "): " + clipName);
            }
            spd *= planSpeed;
            clipSpeed = Mathf.Max(0.05f, spd);
            // 按住段按真实时长待着：速度缩放只该作用于"演"，不该作用于"等"
            float natural = segHoldTotal > 0f ? segTotal : segTotal / clipSpeed;
            // 表演和语音解绑：一段动作就按它自己的自然时长演完。
            // 以前允许指令里的 durationMs 把它撑到 1.35 倍——那是让身体去填语音的空白。
            // 口型不在这里，走 mouthFlat/音频时间轴。
            clipLen = natural;
            float maxClipSec = Mathf.Clamp(profile.MaxSec > 0f ? profile.MaxSec : 8f, 0.5f, 40f);
            inAbsolute = !profile.Additive;
            absRampT0 = Time.time;
            // 按住段例外：它天生就比 MaxClipSec 长，按秒截断会让"沙发上待着"变成 8 秒
            clipLen = segHoldTotal > 0f ? Mathf.Clamp(Mathf.Min(clipLen, segTotal), 0.2f, 900f) : Mathf.Clamp(Mathf.Min(clipLen, maxClipSec), 0.2f, 30f);
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

        private void PlayAnim(string idOrName, int durationMs, int holdMs = 0)
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
                // 基名（一整族，如 anim_break_yawn_1）不会出现在任何 controller 里：
                // 它只是 _start/_loop/_end 的统称。上游把整族当一条下发时，
                // 就拿 _start 段找 owner——段由 BuildSequence 自己拼成一条时间线。
                // 这样整族一次起手、段间不归还姿势，演出开头才不会抽一下。
                string probe = name + "_start";
                if (clipOwners.TryGetValue(probe, out target) && target != null)
                {
                    playName = name;
                }
                else
                {
                    target = null;
                    foreach (var kv in clipOwners)
                    {
                        if (kv.Key.EndsWith(probe, StringComparison.OrdinalIgnoreCase) && kv.Value != null)
                        {
                            target = kv.Value;
                            playName = name;
                            break;
                        }
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
            StartClip(playName, false, durationMs, holdMs);
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
                pending.Add(new PendingAct { dto = dto, seq = seq, at = Time.unscaledTime, src = src, ttlMs = dto == null ? 0 : dto.ttlMs });
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
            pending.Add(new PendingAct { dto = dto, seq = seq, at = Time.unscaledTime, src = src, ttlMs = dto == null ? 0 : dto.ttlMs });
            if (pending.Count > qMaxDepth) qMaxDepth = pending.Count;
        }

        private void PruneExpired()
        {
            // 条目级 TTL：离座长途预排的"回来"那一条要在队里等三五分钟，
            // 全局 45s 会把正常的等待当成过期。0 仍走全局。
            int globalTtl = Plugin.QueueTtlMs == null ? 20000 : Mathf.Max(0, Plugin.QueueTtlMs.Value);
            float now = Time.unscaledTime;
            for (int i = pending.Count - 1; i >= 0; i--)
            {
                int ttl = pending[i].ttlMs > 0 ? pending[i].ttlMs : globalTtl;
                if (ttl <= 0) continue;
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
                // performing 卡死兜底：Perform 里任何一次异常都会让这个标志留在 true，
                // 以前就是队列永久不演、心跳还报在线。90 秒没复位就当它已经挂了。
                if (performing && Time.unscaledTime - performingSince > 90f)
                {
                    Plugin.Log.LogError("queue: performing 卡了 " + (Time.unscaledTime - performingSince).ToString("F0") + "s，强制复位");
                    performing = false;
                    GameVoiceGate.Exit();
                }
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
                performingSince = Time.unscaledTime;
                qPlayed++;
                string subText = (item.dto.subtitle == null || string.IsNullOrEmpty(item.dto.subtitle.text)) ? "-" : item.dto.subtitle.text;
                GameVoiceGate.Enter("queue seq=" + item.seq, 30f);
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
                GameVoiceGate.Exit();
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