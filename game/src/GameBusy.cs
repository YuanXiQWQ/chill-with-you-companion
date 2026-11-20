using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Audio;
using UnityEngine.SceneManagement;
using BepInEx.Logging;

namespace ChillPerformer
{
    /// <summary>
    /// 判断"游戏此刻是不是在演它自己的剧情/说话"。
    ///
    /// 分两档，因为实测房间场景里游戏几乎一直在出声：
    ///   hard  —— 剧情/对话：剧情场景、剧情文本、或剧情语音（Story/Scenario/Episode/Novel）。
    ///             命中就把正在播的表演一起收掉，把台让干净。
    ///   soft  —— 她自言自语或做动作（Voice_SelfTalk_* / Voice_Motion_*）：
    ///             不新开表演，但已经开始的那一句让它演完，不硬切。
    ///   忽略  —— 音效/翻页/BGM（名字带 Sound / PageFlip / Bgm / Ambient / SE / Click）：
    ///             这类天天在响，当成"忙"就等于永远不演。
    /// 另加去抖：忙要连拍确认，闲要连续 1 秒才解除，避免状态抖动把表演反复打断。
    /// </summary>
    internal static class GameBusy
    {
        private const float ScanInterval = 0.5f;
        private const int BusyDebounce = 2;
        private const int IdleDebounce = 2;
        // 连续这么多次"只是软忙"就把 hard 降下来，否则一次剧情之后会永久让台
        private const int HardDowngrade = 4;

        private static float nextScan;
        private static bool busy;
        private static bool hard;
        private static string reason = "";
        private static int busyStreak;
        private static int idleStreak;
        private static int softStreak;
        private static List<Component> textComps = new List<Component>();
        private static List<AudioSource> audioComps = new List<AudioSource>();
        private static string lastScene = "";
        private static ManualLogSource log;
        private static AudioSource ownSource;
        private static List<string> evidence = new List<string>();

        public static bool IsBusy { get { return busy; } }
        public static bool IsHard { get { return hard; } }
        public static string Reason { get { return reason; } }
        public static string[] Evidence { get { return evidence.ToArray(); } }
        private static string[] activeTexts = new string[0];
        private static string[] pomodoroVisibleTexts = new string[0];
        public static string[] PomodoroVisibleTexts { get { return pomodoroVisibleTexts; } }
        public static int TmpCount { get { return textComps.Count; } }
        private static bool focusMode;
        private static float lastFocusSeen;
        public static bool FocusMode { get { return focusMode; } }
        public static string[] ActiveTexts { get { return activeTexts; } }
        public static string SceneName { get { try { return SceneManager.GetActiveScene().name ?? ""; } catch { return ""; } } }

        private static readonly string[] StorySceneTokens = new string[] { "story", "novel", "scenario", "episode", "chapter", "cutscene" };
        private static readonly string[] StoryUiTokens = new string[] { "story", "dialog", "message", "scenario", "novel", "subtitle", "serif", "talk" };
        private static readonly string[] SfxTokens = new string[] { "sound", "sfx", "se_", "_se", "bgm", "ambient", "pageflip", "click", "ui_", "noise" };
        // 番茄钟/计时/日程这类界面文本不算剧情
        private static readonly string[] IgnoreTextTokens = new string[] { "pomodoro", "timer", "countdown", "focus", "break", "clock", "schedule", "todo" };
        private static readonly string[] StoryVoiceTokens = new string[] { "story", "scenario", "episode", "chapter", "novel", "choice", "gamestart" };

        public static void Init(ManualLogSource logger, AudioSource mine)
        {
            log = logger;
            ownSource = mine;
            lastScene = SafeSceneName();
            lastFocusSeen = -9999f;
            pomodoroScanned = false;
            if (log != null) log.LogInfo("game watch: scene=" + lastScene + " (hard=story, soft=self-talk, ignore=sfx)");
        }

        private static string SafeSceneName()
        {
            try { return SceneManager.GetActiveScene().name ?? ""; }
            catch { return ""; }
        }

        // 混音器路由：把场里各 AudioSource 已挂着的混音器组交出去（去重），
        // 让合成语音能"和游戏同组"，从而跟随游戏自己的那一路音量与静音。
        // 只读公开字段 outputAudioMixerGroup，不反射游戏内部类型。
        public static List<AudioMixerGroup> MixerGroups()
        {
            var list = new List<AudioMixerGroup>();
            if (audioComps.Count == 0)
            {
                try
                {
                    var all = UnityEngine.Object.FindObjectsOfType<AudioSource>();
                    for (int i = 0; i < all.Length; i++) if (all[i] != null) audioComps.Add(all[i]);
                    if (log != null) log.LogInfo("mixer: scanned audio sources=" + all.Length);
                }
                catch (Exception e) { if (log != null) log.LogWarning("mixer: scan failed " + e.Message); }
            }
            for (int i = 0; i < audioComps.Count; i++)
            {
                var a = audioComps[i];
                if (a == null) continue;
                var g = a.outputAudioMixerGroup;
                if (g == null) continue;
                if (!list.Contains(g)) list.Add(g);
            }
            return list;
        }

        private static bool HasAny(string hay, string[] tokens)
        {
            if (string.IsNullOrEmpty(hay)) return false;
            string l = hay.ToLowerInvariant();
            for (int i = 0; i < tokens.Length; i++) if (l.Contains(tokens[i])) return true;
            return false;
        }

        private static string PathOf(Transform t)
        {
            if (t == null) return "";
            var sb = new System.Text.StringBuilder(t.name);
            var p = t.parent;
            int guard = 0;
            while (p != null && guard++ < 40) { sb.Insert(0, p.name + "/"); p = p.parent; }
            return sb.ToString();
        }

        private static void RefreshCaches()
        {
            textComps.Clear();
            audioComps.Clear();
            var comps = Resources.FindObjectsOfTypeAll<Component>();
            foreach (var c in comps)
            {
                if (c == null) continue;
                string tn = c.GetType().FullName;
                if (tn == null) continue;
                if (tn.IndexOf("TextMeshPro", StringComparison.Ordinal) >= 0) textComps.Add(c);
                else if (c is AudioSource) audioComps.Add((AudioSource)c);
            }
        }

        private static bool TryReadText(Component c, out string text)
        {
            text = "";
            try
            {
                var p = c.GetType().GetProperty("text");
                if (p == null) return false;
                text = Convert.ToString(p.GetValue(c, null)) ?? "";
                return true;
            }
            catch { return false; }
        }

        public static void Tick()
        {
            if (Time.unscaledTime < nextScan) return;
            nextScan = Time.unscaledTime + ScanInterval;

            string scene = SafeSceneName();
            if (scene != lastScene)
            {
                if (log != null) log.LogInfo("game watch: scene changed " + lastScene + " -> " + scene);
                lastScene = scene;
            }

            var ev = new List<string>();
            ev.Add("scene:" + scene);

            if (Plugin.ForceBusy != null && Plugin.ForceBusy.Value)
            {
                ev.Add("forced");
                Apply(true, true, "forced", ev);
                return;
            }

            bool hitHard = false;
            bool hitSoft = false;
            string why = "";

            if (HasAny(scene, StorySceneTokens)) { hitHard = true; why = "scene:" + scene; ev.Add("scene-match"); }

            if (!hitHard)
            {
                if (textComps.Count == 0 || audioComps.Count == 0) RefreshCaches();
                for (int i = 0; i < textComps.Count; i++)
                {
                    var c = textComps[i];
                    if (c == null) continue;
                    var beh = c as Behaviour;
                    if (beh != null && !beh.enabled) continue;
                    if (!c.gameObject.activeInHierarchy) continue;
                    string text;
                    if (!TryReadText(c, out text)) continue;
                    if (string.IsNullOrEmpty(text) || text.Trim().Length < 2) continue;
                    string path = PathOf(c.transform);
                    if (!HasAny(path, StoryUiTokens)) continue;
                    if (HasAny(path, IgnoreTextTokens)) continue;
                    hitHard = true; why = "story-text:" + path; ev.Add("story-text:" + path);
                    break;
                }
            }

            if (!hitHard)
            {
                for (int i = 0; i < audioComps.Count; i++)
                {
                    var a = audioComps[i];
                    if (a == null || a == ownSource) continue;
                    if (!a.isPlaying || a.clip == null) continue;
                    string cn = a.clip.name ?? "";
                    if (cn.Length == 0) continue;
                    if (cn.ToLowerInvariant().Contains("pomodoro")) lastFocusSeen = Time.unscaledTime;
                    if (HasAny(cn, SfxTokens)) continue;
                    if (HasAny(cn, StoryVoiceTokens)) { hitHard = true; why = "story-voice:" + cn; ev.Add("story-voice:" + cn); break; }
                    if (cn.StartsWith("Voice", StringComparison.OrdinalIgnoreCase)) { hitSoft = true; if (why.Length == 0) why = "self-talk:" + cn; ev.Add("self-talk:" + cn); }
                }
            }

            CollectTexts();
            bool wasFocus = focusMode;
            bool timerRun = PomodoroRunning();
            bool grace = (Time.unscaledTime - lastFocusSeen) < 30f;
            bool inUse = PomodoroInUse();
            focusMode = timerRun || inUse;
            if (focusMode != wasFocus) Plugin.Log.LogInfo("focus mode " + (focusMode ? "on (upper-body only)" : "off") + " timerRun=" + timerRun + " inUse=" + inUse + " grace=" + grace + " timer='" + TimerText + "' t=" + Time.unscaledTime.ToString("F1"));
            Apply(hitHard || hitSoft, hitHard, why, ev);
        }

        private static bool LooksLikeTimer(string s)
        {
            if (string.IsNullOrEmpty(s)) return false;
            string l = s.ToLowerInvariant();
            return l.Contains("pomodoro") || l.Contains("focus") || s.Contains("专注") || s.Contains("集中") || s.Contains("計時") || s.Contains("番茄");
        }

        private static List<Component> pomodoroTexts = new List<Component>();
        private static bool pomodoroScanned;
        private static int pomodoroCandidates;
        private static float nextPomodoroScan;

        public static int PomodoroCandidates { get { return pomodoroCandidates; } }

        private static Transform[] usingMarks;
        private static bool usingScanned;
        private static float nextUsingScan;
        private static int usingActive;

        private static void RefreshUsingMarks()
        {
            var found = new List<Transform>();
            var all = Resources.FindObjectsOfTypeAll<Transform>();
            for (int i = 0; i < all.Length; i++)
            {
                var tr = all[i];
                if (tr == null) continue;
                string nm = tr.name ?? "";
                if (nm.Equals("PomodoroUsing", StringComparison.OrdinalIgnoreCase) || nm.Equals("CountupUsing", StringComparison.OrdinalIgnoreCase))
                    found.Add(tr);
            }
            usingMarks = found.ToArray();
            usingScanned = true;
            Plugin.Log.LogInfo("pomodoro using marks: " + usingMarks.Length);
        }

        // 番茄钟/正计时正在使用 = 游戏自己的 UI 状态对象被激活
        private static bool PomodoroInUse()
        {
            if (!usingScanned || (usingMarks != null && usingMarks.Length == 0 && Time.unscaledTime > nextUsingScan))
            {
                nextUsingScan = Time.unscaledTime + 15f;
                RefreshUsingMarks();
            }
            int active = 0;
            if (usingMarks != null)
            {
                for (int i = 0; i < usingMarks.Length; i++)
                {
                    var tr = usingMarks[i];
                    if (tr == null) continue;
                    if (tr.gameObject.activeInHierarchy) active++;
                }
            }
            usingActive = active;
            return active > 0;
        }

        public static bool PomodoroInUsePublic { get { return PomodoroInUse(); } }

        private static void RefreshPomodoroTexts()
        {
            pomodoroTexts.Clear();
            pomodoroCandidates = 0;
            var comps = Resources.FindObjectsOfTypeAll<Component>();
            foreach (var c in comps)
            {
                if (c == null) continue;
                string tn = c.GetType().FullName;
                if (tn == null || tn.IndexOf("TextMeshPro", StringComparison.Ordinal) < 0) continue;
                string path = PathOf(c.transform);
                if (path.IndexOf("Pomodoro", StringComparison.OrdinalIgnoreCase) < 0) continue;
                pomodoroCandidates++;
                pomodoroTexts.Add(c);
            }
            pomodoroScanned = true;
            Plugin.Log.LogInfo("pomodoro texts found: " + pomodoroCandidates);
        }

        private static string lastTimerText = "";
        private static float lastTimerChange = -9999f;
        private static string currentTimerText = "";

        // 真在专注：番茄钟面板里的倒计时文本**正在变化**（静态的 25:00 只是设定值）
        private static bool PomodoroRunning()
        {
            if (!pomodoroScanned || (pomodoroTexts.Count == 0 && Time.unscaledTime > nextPomodoroScan))
            {
                nextPomodoroScan = Time.unscaledTime + 10f;
                RefreshPomodoroTexts();
            }
            string found = "";
            for (int i = 0; i < pomodoroTexts.Count; i++)
            {
                var c = pomodoroTexts[i];
                if (c == null) continue;
                if (!c.gameObject.activeInHierarchy) continue;
                string text;
                if (!TryReadText(c, out text)) continue;
                string t = (text ?? "").Trim();
                if (t.Length == 0) continue;
                // 三段都要：游戏面板显示的是 HH:MM:SS。只取前两段会把 27 分 23 秒截成
                // "00:27"，侧车 parseClock 读成 27 秒 —— 专注中途就判定"跑完了"，把人踢进休息。
                // 这里只多抓一段，判"在不在变"的逻辑不变。
                var mm = System.Text.RegularExpressions.Regex.Match(t, @"([0-9]{1,3})\s*[:：]\s*([0-9]{2})(?:\s*[:：]\s*([0-9]{2}))?");
                if (!mm.Success) continue;
                t = mm.Groups[3].Success
                    ? mm.Groups[1].Value + ":" + mm.Groups[2].Value + ":" + mm.Groups[3].Value
                    : mm.Groups[1].Value + ":" + mm.Groups[2].Value;
                found = t;
                break;
            }
            currentTimerText = found;
            if (found.Length > 0 && lastTimerText.Length > 0 && found != lastTimerText)
                lastTimerChange = Time.unscaledTime;
            lastTimerText = found;
            return lastTimerChange > 0f && (Time.unscaledTime - lastTimerChange) < 3f;
        }

        public static string TimerText { get { return currentTimerText; } }

        private static void CollectTexts()
        {
            var list = new List<string>(8);
            for (int i = 0; i < textComps.Count && list.Count < 4; i++)
            {
                var c = textComps[i];
                if (c == null || !c.gameObject.activeInHierarchy) continue;
                string text;
                if (!TryReadText(c, out text)) continue;
                if (string.IsNullOrEmpty(text) || text.Trim().Length == 0) continue;
                string t = text.Trim();
                if (t.Length > 24) t = t.Substring(0, 24);
                list.Add(t + " @ " + c.transform.name);
            }
            activeTexts = list.ToArray();
            var pl = new List<string>(4);
            for (int i = 0; i < pomodoroTexts.Count && pl.Count < 4; i++)
            {
                var c = pomodoroTexts[i];
                if (c == null || !c.gameObject.activeInHierarchy) continue;
                string text;
                if (!TryReadText(c, out text)) continue;
                if (string.IsNullOrEmpty(text) || text.Trim().Length == 0) continue;
                pl.Add(c.transform.name + "=" + text.Trim());
            }
            pomodoroVisibleTexts = pl.ToArray();
        }

        private static void Apply(bool wantBusy, bool wantHard, string why, List<string> ev)
        {
            if (ev.Count > 6) ev.RemoveRange(6, ev.Count - 6);
            evidence = ev;

            if (wantBusy)
            {
                busyStreak++;
                idleStreak = 0;
                if (!wantHard) softStreak++; else softStreak = 0;
                if (!busy && busyStreak >= BusyDebounce)
                {
                    busy = true; hard = wantHard; reason = why;
                    if (log != null) log.LogInfo("game busy=true (" + (wantHard ? "hard" : "soft") + " " + why + ")");
                }
                else if (busy && wantHard && !hard)
                {
                    hard = true; reason = why; softStreak = 0;
                    if (log != null) log.LogInfo("game busy hard upgrade (" + why + ")");
                }
                else if (busy && hard && !wantHard && softStreak >= HardDowngrade)
                {
                    // 剧情/语音已经结束，只剩房间里的软声：让出台子，不然她会一直不说话
                    hard = false; reason = why;
                    if (log != null) log.LogInfo("game busy hard downgrade (" + why + ")");
                }
            }
            else
            {
                idleStreak++;
                busyStreak = 0;
                softStreak = 0;
                if (busy && idleStreak >= IdleDebounce)
                {
                    busy = false; hard = false; reason = "";
                    if (log != null) log.LogInfo("game busy=false");
                }
            }
        }
    }
}
