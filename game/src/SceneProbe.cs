// Scene probe: dumps what actually drives the heroine in the live game.
// Triggered by F9. ASCII only.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using System.Text;
using UnityEngine;
using BepInEx.Logging;

public static class SceneProbe
{
    public static void Dump(ManualLogSource log, bool verboseMethods)
    {
        try
        {
            log.LogInfo("=== probe start ===");
            DumpAnimators(log);
            DumpAnimationComponents(log);
            DumpHeroineTree(log, verboseMethods);
            log.LogInfo("=== probe end ===");
        }
        catch (Exception e)
        {
            log.LogWarning("probe failed: " + e);
        }
    }

    // 面部部件调查：group9 底下 Mouth_a/Mouth_i/... 是贴片还是缩放开关
    public static void DumpFace(ManualLogSource log, string path)
    {
        var sb = new StringBuilder();
        Transform group = null;
        foreach (var tr in Resources.FindObjectsOfTypeAll<Transform>())
        {
            if (tr == null) continue;
            if (tr.name == "group9" && Path(tr).IndexOf("Character", StringComparison.Ordinal) >= 0) { group = tr; break; }
        }
        if (group == null) { sb.AppendLine("group9 NOT FOUND"); Write(path, sb, log); return; }
        sb.AppendLine("group9 path=" + Path(group) + " active=" + group.gameObject.activeSelf + " scale=" + group.localScale.ToString());
        sb.AppendLine("children=" + group.childCount);
        foreach (Transform c in group)
        {
            var mr = c.GetComponent<MeshRenderer>();
            var mf = c.GetComponent<MeshFilter>();
            var sr = c.GetComponent<SpriteRenderer>();
            string mat = mr != null && mr.sharedMaterial != null ? mr.sharedMaterial.name : "-";
            string mesh = mf != null && mf.sharedMesh != null ? mf.sharedMesh.name : "-";
            sb.AppendLine(string.Format("{0} | active={1} | scale={2} | mr={3}/{4} | sr={5} | mesh={6} | mat={7}",
                c.name, c.gameObject.activeSelf, c.localScale.ToString(),
                mr != null, mr != null && mr.enabled, sr != null, mesh, mat));
            var pos = c.localPosition;
            sb.AppendLine("      pos=" + pos.ToString() + " rot=" + c.localRotation.eulerAngles.ToString());
        }
        // 顺带看一遍角色根上有没有其它嘴型载体
        foreach (var tr in Resources.FindObjectsOfTypeAll<Transform>())
        {
            if (tr == null) continue;
            string n = tr.name;
            if (!n.StartsWith("Mouth", StringComparison.Ordinal)) continue;
            if (group != null && tr.parent == group) continue;
            sb.AppendLine("OTHER " + Path(tr) + " active=" + tr.gameObject.activeSelf + " scale=" + tr.localScale.ToString());
        }
        Write(path, sb, log);
    }

    // MLSDynamicRenderer 是脸部的真实驱动组件；先把它的成员摸清（字段/属性/方法）
    public static void DumpDynamicRenderer(ManualLogSource log)
    {
        Component target = null;
        foreach (var r in Resources.FindObjectsOfTypeAll<Renderer>())
        {
            if (r == null || r.name != "Face") continue;
            foreach (var c in r.GetComponents<Component>())
            {
                if (c != null && c.GetType().Name.IndexOf("Dynamic", StringComparison.Ordinal) >= 0) { target = c; break; }
            }
            if (target != null) break;
        }
        if (target == null) { log.LogWarning("dynamic renderer not found"); return; }
        var ty = target.GetType();
        log.LogInfo("dyn: type=" + ty.FullName + " asm=" + ty.Assembly.GetName().Name);

        var sb = new StringBuilder();
        foreach (var fld in ty.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance))
        {
            string v;
            try
            {
                object o = fld.GetValue(target);
                if (o == null) v = "null";
                else if (o is string) v = "\"" + o + "\"";
                else if (o is Array) v = "Array[" + ((Array)o).Length + "]";
                else if (o is System.Collections.ICollection) v = "Collection[" + ((System.Collections.ICollection)o).Count + "]";
                else if (o.GetType().IsPrimitive || o is string) v = o.ToString();
                else v = o.GetType().Name;
            }
            catch (Exception e) { v = "<" + e.GetType().Name + ">"; }
            sb.AppendLine("  F " + fld.FieldType.Name + " " + fld.Name + " = " + v);
        }
        foreach (var pr in ty.GetProperties(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance))
        {
            if (pr.GetIndexParameters().Length > 0) continue;
            string v;
            try { object o = pr.CanRead ? pr.GetValue(target, null) : null; v = o == null ? "null" : o.ToString(); }
            catch (Exception e) { v = "<" + e.GetType().Name + ">"; }
            sb.AppendLine("  P " + pr.PropertyType.Name + " " + pr.Name + " = " + v);
        }
        foreach (var m in ty.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.DeclaredOnly))
        {
            if (m.IsSpecialName) continue;
            var ps = m.GetParameters();
            var sig = new StringBuilder();
            foreach (var p in ps) sig.Append(p.ParameterType.Name).Append(' ').Append(p.Name).Append(',');
            sb.AppendLine("  M " + m.ReturnType.Name + " " + m.Name + "(" + sig.ToString().TrimEnd(',') + ")");
        }
        log.LogInfo("dyn members:\n" + sb.ToString());
    }
    // 关键：动画可能改的是 material 实例 / MaterialPropertyBlock，而不是 sharedMaterial
    public static IEnumerator ProbeFaceInstance(ManualLogSource log, Animator animator)
    {
        Renderer face = null;
        foreach (var r in Resources.FindObjectsOfTypeAll<Renderer>())
        {
            if (r != null && r.name == "Face" && Path(r.transform).IndexOf("Character", StringComparison.Ordinal) >= 0) { face = r; break; }
        }
        if (face == null) { log.LogWarning("face: not found"); yield break; }
        var comps = face.GetComponents<Component>();
        var cnames = new StringBuilder();
        foreach (var c in comps) cnames.Append(c.GetType().Name).Append(',');
        log.LogInfo("face comps: " + cnames);

        var mpb = new MaterialPropertyBlock();
        for (int round = 0; round < 3; round++)
        {
            string clip = round == 0 ? "anim_face_talk" : (round == 1 ? "anim_face_shy_joy" : "anim_face_shy_rest");
            if (animator != null) animator.CrossFadeInFixedTime(clip, 0.05f, 0);
            for (int i = 0; i < 8; i++)
            {
                yield return new WaitForSecondsRealtime(0.2f);
                var inst = face.material;
                face.GetPropertyBlock(mpb);
                string sharedTex = face.sharedMaterial != null && face.sharedMaterial.mainTexture != null ? face.sharedMaterial.mainTexture.name : "-";
                string instTex = inst != null && inst.mainTexture != null ? inst.mainTexture.name : "-";
                string mpbTex = mpb.GetTexture("_MainTex") != null ? mpb.GetTexture("_MainTex").name : "-";
                log.LogInfo("fx[" + clip + " " + i + "] shared=" + sharedTex + " inst=" + instTex + " mpb=" + mpbTex
                    + " instOff=" + (inst != null ? inst.mainTextureOffset.ToString() : "-")
                    + " matName=" + (inst != null ? inst.name : "-"));
            }
        }
    }
    // 脸部是一整块 Face 网格，嘴型几乎必然靠材质 UV 切换。这里读材质并观察 talk 片段的 UV 变化。
    public static IEnumerator ProbeFaceMaterial(ManualLogSource log, Animator animator)
    {
        Renderer face = null;
        foreach (var r in Resources.FindObjectsOfTypeAll<Renderer>())
        {
            if (r == null) continue;
            if (r.name == "Face" && Path(r.transform).IndexOf("Character", StringComparison.Ordinal) >= 0) { face = r; break; }
        }
        if (face == null) { log.LogWarning("face renderer not found"); yield break; }
        var mat = face.sharedMaterial != null ? face.sharedMaterial : face.material;
        log.LogInfo("face mat: obj=" + Path(face.transform) + " shader=" + (mat.shader != null ? mat.shader.name : "?") + " mat=" + mat.name);
        var tex = mat.mainTexture;
        log.LogInfo("face tex: " + (tex != null ? tex.name + " " + tex.width + "x" + tex.height : "null")
            + " scale=" + mat.mainTextureScale.ToString() + " offset=" + mat.mainTextureOffset.ToString());
        var names = mat.GetTexturePropertyNames();
        log.LogInfo("face tex props: " + string.Join(",", names));
        // 材质实例的其它常用 UV 参数
        foreach (var p in new string[] { "_MainTex_ST", "_BaseMap_ST", "_FaceTex_ST", "_UVSec_ST" })
        {
            if (mat.HasProperty(p)) log.LogInfo("face prop " + p + " = " + mat.GetVector(p).ToString());
        }

        string[] clips = { "anim_face_talk", "anim_face_shy_joy", "anim_face_shy_rest" };
        foreach (var cname in clips)
        {
            if (animator == null) break;
            animator.CrossFadeInFixedTime(cname, 0.05f, 0);
            for (int i = 0; i < 6; i++)
            {
                yield return new WaitForSecondsRealtime(0.25f);
                var m = face.sharedMaterial != null ? face.sharedMaterial : face.material;
                log.LogInfo("uv[" + cname + " " + i + "] offset=" + m.mainTextureOffset.ToString() + " scale=" + m.mainTextureScale.ToString());
            }
        }
        log.LogInfo("face probe done");
    }
    // 真正被绘制的部件清单：enabled 且 activeInHierarchy 的 Renderer
    public static string VisibleSet(int max)
    {
        var sb = new StringBuilder();
        int n = 0;
        foreach (var r in Resources.FindObjectsOfTypeAll<Renderer>())
        {
            if (r == null || !r.enabled || !r.gameObject.activeInHierarchy) continue;
            string p = Path(r.transform);
            if (p.IndexOf("Character", StringComparison.Ordinal) < 0) continue;
            sb.Append(p).Append(' ');
            if (++n >= max) break;
        }
        return n == 0 ? "(none)" : "n=" + n + " " + sb.ToString();
    }

    public static IEnumerator WatchFace(ManualLogSource log, int samples, float interval)
    {
        for (int i = 0; i < samples; i++)
        {
            log.LogInfo("face[" + i + "] " + VisibleSet(40));
            yield return new WaitForSecondsRealtime(interval);
        }
    }
    // 逐帧采样面部部件的启用/缩放状态，看清脸是用什么开关切的
    public static IEnumerator SampleFace(ManualLogSource log, string path, int samples, float interval)
    {
        var sb = new StringBuilder();
        for (int i = 0; i < samples; i++)
        {
            Transform group = FindGroup9();
            sb.AppendLine("=== sample " + i + " t=" + Time.time.ToString("F2") + " ===");
            if (group != null)
            {
                foreach (Transform c in group)
                {
                    var mr = c.GetComponent<MeshRenderer>();
                    bool on = mr != null && mr.enabled;
                    var s = c.localScale;
                    bool scaled = Mathf.Abs(s.x - 1f) > 0.01f || Mathf.Abs(s.y - 1f) > 0.01f;
                    bool act = c.gameObject.activeSelf;
                    if (!on && !scaled && act) continue;
                    sb.AppendLine(string.Format("  {0} enabled={1} active={2} scale=({3:F2},{4:F2})", c.name, on, act, s.x, s.y));
                }
            }
            var animators = Resources.FindObjectsOfTypeAll<Animator>();
            foreach (var a in animators)
            {
                if (a == null || !a.isActiveAndEnabled || a.runtimeAnimatorController == null) continue;
                if (a.runtimeAnimatorController.animationClips.Length < 50) continue;
                var st = a.GetCurrentAnimatorStateInfo(0);
                sb.AppendLine("  animator=" + a.name + " layer0 hash=" + st.fullPathHash + " norm=" + st.normalizedTime.ToString("F2") + " len=" + st.length.ToString("F2"));
                break;
            }
            yield return new WaitForSecondsRealtime(interval);
        }
        Write(path, sb, log);
    }

    static Transform FindGroup9()
    {
        foreach (var tr in Resources.FindObjectsOfTypeAll<Transform>())
        {
            if (tr != null && tr.name == "group9" && Path(tr).IndexOf("Character", StringComparison.Ordinal) >= 0) return tr;
        }
        return null;
    }
    static void Write(string path, StringBuilder sb, ManualLogSource log)
    {
        try
        {
            System.IO.File.WriteAllText(path, sb.ToString(), new UTF8Encoding(false));
            log.LogInfo("face dumped -> " + path + " bytes=" + sb.Length);
        }
        catch (Exception e) { log.LogWarning("face dump failed: " + e.Message); }
    }
    // 口型前置调查：角色有没有 blendshape / 张口骨骼。写到 chill-skin.txt
    public static void DumpSkin(ManualLogSource log, string path)
    {
        var sb = new StringBuilder();
        var smrs = Resources.FindObjectsOfTypeAll<SkinnedMeshRenderer>();
        sb.AppendLine("# skinned meshes: " + smrs.Length);
        int withShapes = 0;
        foreach (var smr in smrs)
        {
            if (smr == null || smr.sharedMesh == null) continue;
            int n = smr.sharedMesh.blendShapeCount;
            if (n > 0) withShapes++;
            sb.AppendLine("SMR " + Path(smr.transform) + " mesh=" + smr.sharedMesh.name + " shapes=" + n + " bones=" + (smr.bones == null ? 0 : smr.bones.Length));
            for (int i = 0; i < n && i < 80; i++)
                sb.AppendLine("   shape[" + i + "] " + smr.sharedMesh.GetBlendShapeName(i));
        }
        sb.AppendLine("# meshes with shapes: " + withShapes);

        var renderers = Resources.FindObjectsOfTypeAll<MeshRenderer>();
        sb.AppendLine("# plain mesh renderers: " + renderers.Length);

        string[] keys = { "jaw", "mouth", "chin", "lip", "tongue", "teeth", "face", "head", "eye", "brow" };
        var trs = Resources.FindObjectsOfTypeAll<Transform>();
        sb.AppendLine("# transforms matching mouth/jaw keys: ");
        int hits = 0;
        foreach (var tr in trs)
        {
            if (tr == null) continue;
            string nm = tr.name.ToLowerInvariant();
            foreach (var k in keys)
            {
                if (nm.IndexOf(k, StringComparison.Ordinal) >= 0)
                {
                    sb.AppendLine("   BONE " + Path(tr) + "  localRot=" + tr.localRotation.eulerAngles.ToString("F1"));
                    hits++;
                    break;
                }
            }
            if (hits > 120) break;
        }
        sb.AppendLine("# bone hits: " + hits);
        try
        {
            System.IO.File.WriteAllText(path, sb.ToString(), new UTF8Encoding(false));
            log.LogInfo("skin dumped: smrs=" + smrs.Length + " withShapes=" + withShapes + " boneHits=" + hits + " -> " + path);
        }
        catch (Exception e) { log.LogWarning("skin dump failed: " + e.Message); }
    }
    public static void DumpClips(ManualLogSource log, string path)
    {
        try
        {
            var sb = new System.Text.StringBuilder();
            int animators = 0;
            int clips = 0;
            foreach (var a in Resources.FindObjectsOfTypeAll<Animator>())
            {
                if (a == null || a.runtimeAnimatorController == null) continue;
                if (!a.gameObject.scene.IsValid()) continue;
                var list = a.runtimeAnimatorController.animationClips;
                if (list == null || list.Length == 0) continue;
                animators++;
                foreach (var c in list)
                {
                    if (c == null || string.IsNullOrEmpty(c.name)) continue;
                    clips++;
                    sb.Append(a.gameObject.name).Append('\t').Append(a.gameObject.activeInHierarchy ? "1" : "0")
                      .Append('\t').Append(c.name).Append('\t').Append(c.length.ToString("F3", System.Globalization.CultureInfo.InvariantCulture)).Append('\n');
                }
            }
            System.IO.File.WriteAllText(path, sb.ToString(), new System.Text.UTF8Encoding(false));
            log.LogInfo("clips dumped: animators=" + animators + " clips=" + clips + " -> " + path);
        }
        catch (Exception e)
        {
            log.LogWarning("clip dump failed: " + e.Message);
        }
    }
    static void DumpAnimators(ManualLogSource log)
    {
        var all = Resources.FindObjectsOfTypeAll<Animator>();
        int n = 0;
        foreach (var a in all)
        {
            if (a == null) continue;
            if (!a.gameObject.scene.IsValid()) continue;
            n++;
            if (n > 20) { log.LogInfo("animators: more than 20, truncated"); break; }
            string ctrl = "null";
            string ctrlType = "null";
            int clipCount = 0;
            if (a.runtimeAnimatorController != null)
            {
                ctrlType = a.runtimeAnimatorController.GetType().Name;
                ctrl = a.runtimeAnimatorController.name;
                var clips = a.runtimeAnimatorController.animationClips;
                clipCount = clips == null ? 0 : clips.Length;
            }
            log.LogInfo("animator[" + Path(a.transform) + "] ctrlType=" + ctrlType + " ctrl=" + ctrl +
                        " clips=" + clipCount + " avatar=" + (a.avatar != null && a.avatar.isValid) +
                        " active=" + a.gameObject.activeInHierarchy);
        }
        log.LogInfo("animators total(in scene)=" + n);
    }

    static void DumpAnimationComponents(ManualLogSource log)
    {
        var all = Resources.FindObjectsOfTypeAll<Animation>();
        int n = 0;
        foreach (var an in all)
        {
            if (an == null || !an.gameObject.scene.IsValid()) continue;
            n++;
            if (n > 20) break;
            int states = 0;
            var names = new StringBuilder();
            foreach (AnimationState st in an)
            {
                states++;
                if (states <= 8) names.Append(st.name).Append(',');
            }
            string cur = an.clip != null ? an.clip.name : "-";
            bool playing = an.isPlaying;
            log.LogInfo("animation[" + Path(an.transform) + "] states=" + states + " current=" + cur +
                        " playing=" + playing + " sample=" + names);
        }
        log.LogInfo("animation components total=" + n);
    }

    static void DumpHeroineTree(ManualLogSource log, bool verboseMethods)
    {
        Animator best = null;
        int bestCount = -1;
        foreach (var a in Resources.FindObjectsOfTypeAll<Animator>())
        {
            if (a == null || a.runtimeAnimatorController == null) continue;
            if (!a.gameObject.scene.IsValid()) continue;
            int c = a.runtimeAnimatorController.animationClips.Length;
            if (c > bestCount) { best = a; bestCount = c; }
        }
        if (best == null) { log.LogInfo("tree: no animator"); return; }
        Transform root = best.transform;
        for (int i = 0; i < 4 && root.parent != null; i++) root = root.parent;
        log.LogInfo("tree root: " + Path(root));
        Walk(log, root, 0, verboseMethods);
    }

    static void Walk(ManualLogSource log, Transform t, int depth, bool verboseMethods)
    {
        if (depth > 5 || t == null) return;
        var comps = t.GetComponents<Component>();
        var sb = new StringBuilder();
        foreach (var c in comps)
        {
            if (c == null) continue;
            sb.Append(c.GetType().Name).Append(' ');
        }
        log.LogInfo("tree " + new string(' ', depth * 2) + t.name + " :: " + sb);
        foreach (var c in comps)
        {
            if (c == null) continue;
            string tn = c.GetType().Name;
            if (tn.IndexOf("Character", StringComparison.OrdinalIgnoreCase) < 0 &&
                tn.IndexOf("Motion", StringComparison.OrdinalIgnoreCase) < 0 &&
                tn.IndexOf("Anim", StringComparison.OrdinalIgnoreCase) < 0 &&
                tn.IndexOf("Player", StringComparison.OrdinalIgnoreCase) < 0) continue;
            DumpMethods(log, c, verboseMethods);
        }
        for (int i = 0; i < t.childCount; i++) Walk(log, t.GetChild(i), depth + 1, verboseMethods);
    }

    static void DumpMethods(ManualLogSource log, Component c, bool verboseMethods)
    {
        var t = c.GetType();
        var sb = new StringBuilder();
        int count = 0;
        foreach (var m in t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
        {
            if (m.IsSpecialName) continue;
            count++;
            if (count > 40) break;
            sb.Append(m.Name).Append('(');
            var ps = m.GetParameters();
            for (int i = 0; i < ps.Length; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(ps[i].ParameterType.Name);
            }
            sb.Append(") ");
        }
        log.LogInfo("  methods " + t.Name + " (" + count + "): " + sb);
        if (!verboseMethods) return;
        int f = 0;
        var fsb = new StringBuilder();
        foreach (var fi in t.GetFields(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
        {
            f++;
            if (f > 40) break;
            fsb.Append(fi.Name).Append(' ');
        }
        log.LogInfo("  fields " + t.Name + " (" + f + "): " + fsb);
    }

    static string Path(Transform t)
    {
        var sb = new StringBuilder(t.name);
        var p = t.parent;
        int guard = 0;
        while (p != null && guard++ < 6)
        {
            sb.Insert(0, p.name + "/");
            p = p.parent;
        }
        return sb.ToString();
    }
    // 探测游戏原生 UI 文本：字幕/对话用的 Text / TextMeshProUGUI，以及带文本字段的脚本
    public static void DumpUIText(ManualLogSource log)
    {
        var sb = new System.Text.StringBuilder();
        sb.AppendLine("# native UI text probe");
        var all = Resources.FindObjectsOfTypeAll<Component>();
        int seen = 0;
        foreach (var c in all)
        {
            if (c == null) continue;
            string tn = c.GetType().FullName;
            bool isText = tn == "UnityEngine.UI.Text" || tn.EndsWith("TextMeshProUGUI") || tn.EndsWith("TMP_Text") || tn.EndsWith("TextMeshPro");
            if (!isText) continue;
            var go = c.gameObject;
            string text = "";
            try
            {
                var p = c.GetType().GetProperty("text");
                if (p != null) text = Convert.ToString(p.GetValue(c, null));
            }
            catch { }
            sb.AppendLine("TEXT path=" + Path(go.transform) + " type=" + tn
                + " active=" + go.activeInHierarchy + " enabled=" + ((c as Behaviour) != null ? ((Behaviour)c).enabled.ToString() : "?")
                + " len=" + (text == null ? 0 : text.Length)
                + " text=\"" + (text == null ? "" : text.Replace("\n", "\\n").Replace("\r", "")) + "\"");
            seen++;
            if (seen > 200) break;
        }
        // 找带字幕/对话语义字段或方法的脚本
        sb.AppendLine("# candidate scripts");
        int sc = 0;
        foreach (var c in all)
        {
            if (c == null) continue;
            var ty = c.GetType();
            if (ty.Namespace != null && ty.Namespace.StartsWith("UnityEngine")) continue;
            bool hit = false;
            var fields = ty.GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);
            var props = ty.GetProperties(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);
            var methods = ty.GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);
            string note = "";
            foreach (var fi in fields)
            {
                if (fi.FieldType == typeof(string) && LooksLikeText(fi.Name)) { note += "field:" + fi.Name + " "; hit = true; }
            }
            foreach (var pi in props)
            {
                if (pi.PropertyType == typeof(string) && LooksLikeText(pi.Name)) { note += "prop:" + pi.Name + " "; hit = true; }
            }
            foreach (var mi in methods)
            {
                if (mi.GetParameters().Length <= 1 && (mi.ReturnType == typeof(void)) && LooksLikeText(mi.Name) && (mi.Name.StartsWith("Set") || mi.Name.StartsWith("Show") || mi.Name.StartsWith("Play") || mi.Name.StartsWith("Draw")))
                { note += "method:" + mi.Name + " "; hit = true; }
            }
            if (!hit) continue;
            sb.AppendLine("SCRIPT " + Path(c.transform) + " type=" + ty.FullName + " active=" + c.gameObject.activeInHierarchy + " => " + note);
            if (++sc > 120) break;
        }
        Write("chill-ui.txt", sb, log);
    }

    private static bool LooksLikeText(string n)
    {
        if (string.IsNullOrEmpty(n)) return false;
        string l = n.ToLowerInvariant();
        return l.Contains("text") || l.Contains("message") || l.Contains("caption") || l.Contains("dialog") || l.Contains("subtitle") || l.Contains("serif") || l.Contains("word");
    }

    // ---- time of day / atmosphere probe (read only) ----
    // Walks every loaded assembly looking for types whose name mentions
    // TimeOfDay / Atmosphere, prints full member signatures for the ones we
    // care about, then dumps live values from any instance in the scene.
    // Touches nothing: no setters, no patches. Written for C# 5.
    public static void DumpTimeOfDay(ManualLogSource log, string path)
    {
        var sb = new StringBuilder();
        sb.AppendLine("== lightmap ==");
        try
        {
            sb.AppendLine("  LightmapSettings.lightmaps.Length = " + LightmapSettings.lightmaps.Length);
            sb.AppendLine("  lightmapsMode = " + LightmapSettings.lightmapsMode);
        }
        catch (Exception e) { sb.AppendLine("  err: " + e.Message); }
        try
        {
            sb.AppendLine("  RenderSettings.ambientMode = " + RenderSettings.ambientMode);
            sb.AppendLine("  RenderSettings.ambientIntensity = " + RenderSettings.ambientIntensity);
            sb.AppendLine("  RenderSettings.ambientLight = " + RenderSettings.ambientLight);
            sb.AppendLine("  RenderSettings.skybox = " + (RenderSettings.skybox == null ? "null" : RenderSettings.skybox.name));
        }
        catch (Exception e) { sb.AppendLine("  err: " + e.Message); }

        // The real switch entry is RuntimeAPI.SwitchLightmap; blending lives in
        // MagicLightmapSwitcher. Keep the higher level TimeOfDay types too, they tell
        // us how the game decides WHICH scenario, not HOW to apply it.
        var want = new string[] {
            "TimeOfDayProvider", "TimeOfDayParam", "AtmosphereProfile", "AtmospherePair",
            "CozyAtmosphereModule", "WindowTimeOfDayType",
            "RuntimeAPI", "StoredLightingScenario", "EnvironmentUI", "EnvironmentType",
            "WindowViewService", "WindowViewType", "CozyWeather", "TimeEnvironmentController"
        };
        var full = new List<Type>();
        var brief = new List<string>();

        foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
        {
            Type[] types;
            try { types = asm.GetTypes(); }
            catch (ReflectionTypeLoadException ex) { types = ex.Types; }
            catch { continue; }
            if (types == null) continue;
            for (int i = 0; i < types.Length; i++)
            {
                var t = types[i];
                if (t == null) continue;
                var n = t.Name;
                bool care = false;
                for (int k = 0; k < want.Length; k++) if (n == want[k]) care = true;
                if (care) { if (!full.Contains(t)) full.Add(t); continue; }
                // Magic Lightmap Switcher carries the actual blend API. Pull the whole
                // namespace so we can see every way it offers to cross-fade.
                if (!care && t.Namespace != null && t.Namespace.IndexOf("MagicLightmapSwitcher") >= 0) care = true;
                if (care) { if (!full.Contains(t)) full.Add(t); continue; }
                if (n.IndexOf("TimeOfDay") >= 0 || n.IndexOf("Atmosphere") >= 0 || n.IndexOf("Cozy") >= 0)
                {
                    var line = t.FullName + "  [" + asm.GetName().Name + "]";
                    if (!brief.Contains(line)) brief.Add(line);
                }
            }
        }

        sb.AppendLine("");
        sb.AppendLine("== other types mentioning TimeOfDay/Atmosphere/Cozy (" + brief.Count + ") ==");
        for (int i = 0; i < brief.Count; i++) sb.AppendLine("  " + brief[i]);

        const BindingFlags All = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;

        for (int ti = 0; ti < full.Count; ti++)
        {
            var t = full[ti];
            sb.AppendLine("");
            sb.AppendLine("### " + t.FullName + "   enum=" + t.IsEnum + "  abstract=" + t.IsAbstract);
            if (t.IsEnum)
            {
                try
                {
                    foreach (var v in Enum.GetValues(t))
                        sb.AppendLine("  enum " + v + " = " + Convert.ToInt64(v));
                }
                catch (Exception e) { sb.AppendLine("  enum err: " + e.Message); }
            }
            if (t.BaseType != null) sb.AppendLine("  base: " + t.BaseType.FullName);

            FieldInfo[] fs;
            try { fs = t.GetFields(All); } catch { fs = new FieldInfo[0]; }
            for (int i = 0; i < fs.Length; i++)
            {
                var f = fs[i];
                sb.AppendLine("  field " + (f.IsStatic ? "static " : "") + f.FieldType.Name + " " + f.Name);
            }

            PropertyInfo[] ps;
            try { ps = t.GetProperties(All); } catch { ps = new PropertyInfo[0]; }
            for (int i = 0; i < ps.Length; i++)
            {
                var p = ps[i];
                sb.AppendLine("  prop " + p.PropertyType.Name + " " + p.Name + (p.CanWrite ? " {get;set;}" : " {get;}"));
            }

            MethodInfo[] ms;
            try { ms = t.GetMethods(All); } catch { ms = new MethodInfo[0]; }
            for (int i = 0; i < ms.Length; i++)
            {
                var m = ms[i];
                if (m.IsSpecialName) continue;
                var parms = m.GetParameters();
                var sig = new StringBuilder();
                for (int k = 0; k < parms.Length; k++)
                {
                    if (k > 0) sig.Append(", ");
                    sig.Append(parms[k].ParameterType.Name).Append(' ').Append(parms[k].Name);
                }
                sb.AppendLine("  method " + (m.IsStatic ? "static " : "") + m.ReturnType.Name + " " + m.Name + "(" + sig + ")");
            }

            // live instance values
            if (t.IsEnum || t.IsAbstract) continue;
            // FindObjectOfType only sees active scene objects. The facility panel and its
            // controllers live in prefabs / inactive objects at boot, so walk everything
            // loaded and skip prefab assets by requiring a valid scene.
            UnityEngine.Object inst = null;
            int allCount = 0;
            try
            {
                if (typeof(UnityEngine.Object).IsAssignableFrom(t))
                {
                    var all = Resources.FindObjectsOfTypeAll(t);
                    allCount = all == null ? 0 : all.Length;
                    for (int ai = 0; ai < allCount; ai++)
                    {
                        var o = all[ai];
                        if (o == null) continue;
                        var comp = o as Component;
                        if (comp != null) { if (!comp.gameObject.scene.IsValid()) continue; }
                        else
                        {
                            var go = o as GameObject;
                            if (go != null && !go.scene.IsValid()) continue;
                        }
                        inst = o;
                        break;
                    }
                }
            }
            catch (Exception e) { sb.AppendLine("  find err: " + e.Message); }
            if (inst == null)
            {
                sb.AppendLine("  [no instance, " + allCount + " loaded incl inactive]");
                continue;
            }
            sb.AppendLine("  [instance " + inst.name + "]");
            for (int i = 0; i < fs.Length; i++)
            {
                var f = fs[i];
                if (f.IsStatic) continue;
                string val;
                try
                {
                    var o = f.GetValue(inst);
                    if (o == null) val = "null";
                    else if (o is string) val = "\"" + o + "\"";
                    else
                    {
                        var en = o as System.Collections.IEnumerable;
                        if (en != null && !(o is string))
                        {
                            int cnt = 0;
                            foreach (var _ in en) { cnt++; if (cnt > 64) break; }
                            val = "<" + o.GetType().Name + " count=" + cnt + ">";
                        }
                        else val = o.ToString();
                    }
                }
                catch (Exception e) { val = "err:" + e.Message; }
                sb.AppendLine("    " + f.Name + " = " + val);
            }
        }

        try
        {
            System.IO.File.WriteAllText(path, sb.ToString(), new UTF8Encoding(false));
            log.LogInfo("timeofday dumped -> " + path + " bytes=" + sb.Length);
        }
        catch (Exception e) { log.LogWarning("timeofday dump failed: " + e.Message); }
    }

    // ---- window time of day control (reflection, no patches) ----
    // The visible scene time is not a lightmap blend: WindowViewService keeps one
    // GameObject per window view (_day/_sunset/_night/...) and simply toggles them,
    // which is why the switch looks instant. Going through the game's own
    // ChangeWeatherAndTime keeps every other bookkeeping intact.
    static Type FindGameType(string fullName)
    {
        var asms = AppDomain.CurrentDomain.GetAssemblies();
        for (int i = 0; i < asms.Length; i++)
        {
            try
            {
                var t = asms[i].GetType(fullName, false);
                if (t != null) return t;
            }
            catch { }
        }
        return null;
    }

    static UnityEngine.Object FindLiveInstance(Type t)
    {
        if (t == null) return null;
        UnityEngine.Object[] all;
        try { all = Resources.FindObjectsOfTypeAll(t); }
        catch { return null; }
        if (all == null) return null;
        for (int i = 0; i < all.Length; i++)
        {
            var o = all[i];
            if (o == null) continue;
            var c = o as Component;
            if (c == null) return o;
            if (c.gameObject.scene.IsValid()) return o;
        }
        return null;
    }

    // 官方自带 AutoTimeWindowViewChanger.ApplyTimeOfDayFromCurrentTime()，自动切换
    // 由游戏负责，这里只负责把"窗外现在是什么"报给 chill-brain。
    // 优先读游戏自己维护的状态，读不到才退回按钟点猜一个。
    public static string CurrentWindowView()
    {
        try
        {
            var wvs = FindGameType("Bulbul.WindowViewService");
            if (wvs != null)
            {
                if (cachedWindowService == null) cachedWindowService = FindLiveInstance(wvs);
                if (cachedWindowService != null)
                {
                    var v = ReadCurrentView(wvs, cachedWindowService);
                    if (v != null && v.Length > 0) return v;
                }
            }
        }
        catch { }
        return "";
    }


    // Resources.FindObjectsOfTypeAll is a full object walk; doing it on every tick
    // would stutter. Cache the service and let Unity's overloaded == invalidate it
    // when the scene is torn down.
    static UnityEngine.Object cachedWindowService;

    static string ReadCurrentView(Type wvs, UnityEngine.Object inst)
    {
        try
        {
            var p = wvs.GetProperty("CurrentTimeOfDayType", BindingFlags.Public | BindingFlags.Instance);
            if (p == null) return null;
            var rp = p.GetValue(inst, null);
            if (rp == null) return null;
            var vp = rp.GetType().GetProperty("Value");
            if (vp == null) return null;
            var v = vp.GetValue(rp, null);
            return v == null ? null : v.ToString();
        }
        catch { return null; }
    }
    // ---- 官方自动切换功能核查 ----
    // EnvironmentUI 上有一个 IAutoTimeWindowViewChanger 字段。它非 null 就说明官方
    // 的自动切换已经接好了；null 就说明这项功能没有启用（或者被移除）。
    public static void ProbeAutoTime(ManualLogSource log, string path)
    {
        var sb = new System.Text.StringBuilder(2048);
        try
        {
            var ui = FindGameType("Bulbul.EnvironmentUI");
            sb.AppendLine("EnvironmentUI type : " + (ui == null ? "NOT FOUND" : ui.FullName));
            if (ui != null)
            {
                var inst = FindLiveInstance(ui);
                sb.AppendLine("instance           : " + (inst == null ? "none" : inst.name));
                if (inst != null)
                {
                    var ff = ui.GetField("_autoTimeWindowViewChanger", BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Instance);
                    sb.AppendLine("field found        : " + (ff != null));
                    if (ff != null)
                    {
                        var v = ff.GetValue(inst);
                        sb.AppendLine("field value        : " + (v == null ? "NULL" : v.GetType().FullName));
                        if (v != null)
                        {
                            var vt = v.GetType();
                            sb.AppendLine("impl base          : " + (vt.BaseType == null ? "?" : vt.BaseType.FullName));
                            sb.AppendLine("impl interfaces    : " + string.Join(", ", (string[])Array.ConvertAll(vt.GetInterfaces(), delegate(Type x) { return x.Name; })));
                            sb.AppendLine("-- methods --");
                            var ms = vt.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.DeclaredOnly);
                            for (int i = 0; i < ms.Length; i++) sb.AppendLine("  " + ms[i].Name);
                            sb.AppendLine("-- fields --");
                            var fs2 = vt.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.DeclaredOnly);
                            for (int i = 0; i < fs2.Length; i++)
                            {
                                string val;
                                try { var o = fs2[i].GetValue(v); val = o == null ? "null" : o.ToString(); }
                                catch { val = "<err>"; }
                                sb.AppendLine("  " + fs2[i].FieldType.Name + " " + fs2[i].Name + " = " + val);
                            }
                        }
                    }
                    // 存档里的自动切换数据
                    var pi = ui.GetProperty("AutoTimeWindowChangeData", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static);
                    sb.AppendLine("prop found         : " + (pi != null));
                    if (pi != null)
                    {
                        string pv;
                        try { var o = pi.GetValue(pi.GetGetMethod(true).IsStatic ? null : (object)inst, null); pv = o == null ? "null" : o.ToString(); }
                        catch (Exception e) { pv = "<err: " + e.Message + ">"; }
                        sb.AppendLine("prop value         : " + pv);
                    }
                    // ApplyWindowTime 是否存在
                    var m2 = ui.GetMethod("ApplyWindowTime", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                    sb.AppendLine("ApplyWindowTime    : " + (m2 == null ? "missing" : "present"));
                    var m3 = ui.GetMethod("ApplyWindowBySavedata", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                    sb.AppendLine("ApplyWindowBySave  : " + (m3 == null ? "missing" : "present"));
                }
            }
        }
        catch (Exception e) { sb.AppendLine("probe error: " + e.Message); }
        System.IO.File.WriteAllText(path, sb.ToString(), new UTF8Encoding(false));
        log.LogInfo("autotime probe -> " + path);
    }
}
