using System;
using System.Collections.Generic;
using System.Reflection;
using UnityEngine;
using BepInEx.Logging;

namespace ChillPerformer
{
    /// <summary>
    /// 用游戏自己的字体资源（TMPro_FontAsset）在独立 Canvas 上画字幕，
    /// 视觉与游戏原生字幕一致；不依赖游戏内任何对话组件，因此不会被剧情逻辑覆盖，
    /// 也不会因为游戏更新而失效（只依赖 TMPro 这个公共库）。
    /// </summary>
    internal static class NativeSubtitle
    {
        private static bool tried;
        private static bool ready;
        private static Component text;
        private static GameObject root;
        private static string fallbackReason = "";
        private static Type tmpType;
        private static ManualLogSource log;

        public static bool Ready { get { return ready; } }
        public static string Reason { get { return fallbackReason; } }

        private static Type FindType(string fullName)
        {
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                Type t = null;
                try { t = asm.GetType(fullName, false); } catch { }
                if (t != null) return t;
            }
            return null;
        }

        private static void Set(object obj, string member, object value)
        {
            if (obj == null) return;
            try
            {
                var ty = obj.GetType();
                var p = ty.GetProperty(member, BindingFlags.Public | BindingFlags.Instance);
                if (p != null && p.CanWrite) { p.SetValue(obj, value, null); return; }
                var fi = ty.GetField(member, BindingFlags.Public | BindingFlags.Instance);
                if (fi != null) fi.SetValue(obj, value);
            }
            catch { }
        }

        private static object Get(object obj, string member)
        {
            if (obj == null) return null;
            try
            {
                var ty = obj.GetType();
                var p = ty.GetProperty(member, BindingFlags.Public | BindingFlags.Instance);
                if (p != null) return p.GetValue(obj, null);
                var fi = ty.GetField(member, BindingFlags.Public | BindingFlags.Instance);
                if (fi != null) return fi.GetValue(obj);
            }
            catch { }
            return null;
        }

        /// <summary>找一个游戏现成的 TMP 文本当样式模板（剧情字幕优先）。</summary>
        private static Component FindTemplate()
        {
            Component best = null;
            int bestScore = -1;
            var all = Resources.FindObjectsOfTypeAll<Component>();
            foreach (var c in all)
            {
                if (c == null) continue;
                var ty = c.GetType();
                if (ty.FullName == null || ty.FullName.IndexOf("TextMeshPro", StringComparison.Ordinal) < 0) continue;
                string path = PathOf(c.transform);
                int score = 0;
                if (path.IndexOf("SubTitleText", StringComparison.OrdinalIgnoreCase) >= 0) score += 60;
                if (path.IndexOf("Story", StringComparison.OrdinalIgnoreCase) >= 0) score += 30;
                if (path.IndexOf("BodText", StringComparison.OrdinalIgnoreCase) >= 0) score += 20;
                if (path.IndexOf("Dialog", StringComparison.OrdinalIgnoreCase) >= 0) score += 10;
                object font = Get(c, "font");
                if (font == null) continue;
                if (score > bestScore) { bestScore = score; best = c; }
            }
            return best;
        }

        internal static string PathOf(Transform t)
        {
            if (t == null) return "";
            var sb = new System.Text.StringBuilder(t.name);
            var p = t.parent;
            int guard = 0;
            while (p != null && guard++ < 64) { sb.Insert(0, p.name + "/"); p = p.parent; }
            return sb.ToString();
        }

        public static void Init(ManualLogSource logger)
        {
            log = logger;
            if (tried) return;
            tried = true;
            try
            {
                tmpType = FindType("TMPro.TextMeshProUGUI");
                if (tmpType == null) { fallbackReason = "TMPro.TextMeshProUGUI not found"; return; }
                Component tpl = FindTemplate();
                if (tpl == null) { fallbackReason = "no TMP template in scene"; return; }

                // 独立画布：不影响游戏 UI，也不会被游戏 UI 逻辑开关
                root = new GameObject("ChillSubtitleCanvas");
                UnityEngine.Object.DontDestroyOnLoad(root);
                var canvas = root.AddComponent<Canvas>();
                canvas.renderMode = RenderMode.ScreenSpaceOverlay;
                canvas.sortingOrder = 30000;
                var scaler = root.AddComponent<UnityEngine.UI.CanvasScaler>();
                scaler.uiScaleMode = UnityEngine.UI.CanvasScaler.ScaleMode.ScaleWithScreenSize;
                scaler.referenceResolution = new Vector2(1920f, 1080f);
                scaler.matchWidthOrHeight = 0.5f;

                var holder = new GameObject("ChillSubtitle");
                holder.transform.SetParent(root.transform, false);
                text = holder.AddComponent(tmpType) as Component;
                if (text == null) { fallbackReason = "AddComponent TextMeshProUGUI failed"; return; }

                // 样式全部继承游戏自己的模板
                object font = Get(tpl, "font");
                Set(text, "font", font);
                Set(text, "fontSize", 40f);
                Set(text, "enableWordWrapping", true);
                Set(text, "richText", true);
                Set(text, "raycastTarget", false);
                Set(text, "alignment", EnumValue("TMPro.TextAlignmentOptions", "Center"));
                Set(text, "color", new Color(1f, 1f, 1f, 0.96f));
                Set(text, "text", "");

                object mat = Get(tpl, "fontSharedMaterial");
                if (mat != null) Set(text, "fontSharedMaterial", mat);

                var rt = holder.GetComponent<RectTransform>();
                if (rt != null)
                {
                    rt.anchorMin = new Vector2(0.5f, 0f);
                    rt.anchorMax = new Vector2(0.5f, 0f);
                    rt.pivot = new Vector2(0.5f, 0f);
                    rt.anchoredPosition = new Vector2(0f, 118f);
                    rt.sizeDelta = new Vector2(1180f, 160f);
                }
                holder.SetActive(false);
                ready = true;
                log.LogInfo("native subtitle ready, template=" + PathOf(tpl.transform) + " font=" + Convert.ToString(Get(tpl, "font")));
            }
            catch (Exception e)
            {
                fallbackReason = "init: " + e.Message;
                ready = false;
                log.LogWarning("native subtitle init failed: " + e.Message);
            }
        }

        private static object EnumValue(string typeName, string name)
        {
            var t = FindType(typeName);
            if (t == null) return null;
            try { return Enum.Parse(t, name); } catch { return null; }
        }

        public static void Show(string s)
        {
            if (!ready || text == null) return;
            try
            {
                Set(text, "text", s == null ? "" : s);
                if (root != null) root.SetActive(true);
                var beh = text as Behaviour;
                if (beh != null) beh.enabled = true;
                if (text.gameObject != null) text.gameObject.SetActive(true);
                // 字号按长度自适应，长句不溢出
                float fs = 40f;
                int len = s == null ? 0 : s.Length;
                if (len > 26) fs = 34f;
                if (len > 40) fs = 30f;
                Set(text, "fontSize", fs);
            }
            catch (Exception e) { log.LogWarning("native subtitle show: " + e.Message); }
        }

        public static void Hide()
        {
            if (!ready) return;
            try
            {
                Set(text, "text", "");
                if (text.gameObject != null) text.gameObject.SetActive(false);
            }
            catch { }
        }
    }
}
