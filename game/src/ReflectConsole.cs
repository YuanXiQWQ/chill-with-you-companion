// Reflect console: a file-driven debug channel for looking at the game's own APIs at runtime.
//   write commands  -> <BepInEx>/chill-cmd.txt   (one command per line)
//   read answers    -> <BepInEx>/chill-cmd-out.txt (appended, UTF-8 no BOM)
// Read-only by default: "types"/"inst"/"dump"/"audio" only read metadata and live values.
// "call"/"set" run only when the operator writes the exact member name; every failure is
// caught and logged, never rethrown into the game loop.
//
// 用途：查"游戏自己怎么触发离座事件"这类问题（HANDOFF §9-P0）。游戏端 DLL 不能反编译，
// 但运行时能拿到类型/方法/字段与实例路径 —— 这条通道就是那只手。
//
// NOTE: keep this file ASCII-safe for csc; comments may be Chinese (file is UTF-8 with BOM).
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using UnityEngine;
using BepInEx.Logging;
using IOPath = System.IO.Path;

public static class ReflectConsole
{
    static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);

    // 命令行要能启动插件里的记录器，所以留一个指向插件实例的口子。
    internal static ChillPerformer.PerformerUI Host;
    static float nextTick;
    static string lastError;

    public static string CmdPath { get { return IOPath.Combine(BepInEx.Paths.BepInExRootPath, "chill-cmd.txt"); } }
    public static string OutPath { get { return IOPath.Combine(BepInEx.Paths.BepInExRootPath, "chill-cmd-out.txt"); } }

    public static void Tick(ManualLogSource log)
    {
        if (Time.unscaledTime < nextTick) return;
        nextTick = Time.unscaledTime + 0.5f;
        string text;
        try
        {
            if (!File.Exists(CmdPath)) return;
            text = File.ReadAllText(CmdPath, Utf8);
        }
        catch (Exception e) { Warn(log, "read cmd failed: " + e.Message); return; }
        if (text == null || text.Trim().Length == 0) return;
        try { File.WriteAllText(CmdPath, "", Utf8); } catch { }
        // 每条命令单独执行，一条炸了不影响下一条
        string[] lines = text.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
        for (int i = 0; i < lines.Length; i++)
        {
            string line = lines[i].Trim();
            if (line.Length == 0) continue;
            var sb = new StringBuilder();
            sb.Append("### ").Append(DateTime.Now.ToString("HH:mm:ss")).Append("  ").Append(line).Append('\n');
            try { Run(log, line, sb); }
            catch (Exception e) { sb.Append("ERROR ").Append(e.GetType().Name).Append(": ").Append(e.Message).Append('\n'); }
            sb.Append('\n');
            try { File.AppendAllText(OutPath, sb.ToString(), Utf8); } catch (Exception e) { Warn(log, "write out failed: " + e.Message); }
        }
    }

    static void Warn(ManualLogSource log, string s)
    {
        lastError = s;
        if (log != null) log.LogWarning("reflect: " + s);
    }

    static void Run(ManualLogSource log, string line, StringBuilder sb)
    {
        string[] parts = Tokenize(line);
        if (parts.Length == 0) return;
        string verb = parts[0].ToLowerInvariant();
        if (verb == "help") { sb.Append("types <re> | inst <re> | dump <re> | enum <re> | anim | play <int> | trig <Name> | ai <0|1> | hips | mouth | pose | trace <sec> | state [name] | call <re> <method> [args] | set <re> <member> <value> | audio | clear\n"); return; }
        if (verb == "clear") { try { File.WriteAllText(OutPath, "", Utf8); } catch { } sb.Append("ok\n"); return; }
        if (verb == "audio") { DumpAudio(sb); return; }
        // 无参 verb 要在"缺参数"检查之前分发
        if (verb == "anim") { DumpAnimator(sb); return; }
        if (verb == "hips") { DumpHips(sb); return; }
        if (verb == "mouth") { DumpMouth(sb); return; }
        if (verb == "pose") { DumpPose(sb); return; }
        // state           看她在哪一档（ActionStateType / UpdateStateType / 当前 AnimationType / L0 clip）
        // state <name|n>  切过去，走游戏自己的 DebugChangeState，不是我们写骨骼
        if (verb == "state") { DumpState(parts.Length > 1 ? parts[1] : "", sb); return; }
        if (verb == "trace")
        {
            float sec = 10f;
            if (parts.Length > 1) { float t; if (float.TryParse(parts[1], out t)) sec = t; }
            if (Host == null) { sb.Append("no host instance\n"); return; }
            Host.StartTrace(sec);
            sb.Append("trace ").Append(sec.ToString("F0")).Append("s -> ").Append(ChillPerformer.PerformerUI.TracePath).Append('\n');
            return;
        }
        if (parts.Length < 2) { sb.Append("ERROR need a type pattern\n"); return; }
        string pattern = parts[1];

        if (verb == "types") { DumpTypes(pattern, sb); return; }
        if (verb == "inst") { DumpInstances(pattern, sb); return; }
        if (verb == "dump") { DumpMembers(pattern, parts.Length > 2 ? parts[2] : "", sb); return; }
        if (verb == "enum") { DumpEnum(pattern, sb); return; }
        if (verb == "anim") { DumpAnimator(sb); return; }
        if (verb == "play") { DoPlay(int.Parse(pattern), sb); return; }
        if (verb == "trig") { DoTrig(pattern, sb); return; }
        if (verb == "ai") { DoAi(pattern != "0", sb); return; }
        if (verb == "hips") { DumpHips(sb); return; }
        if (verb == "call") { Call(pattern, parts, sb); return; }
        if (verb == "set") { SetValue(pattern, parts, sb); return; }
        sb.Append("ERROR unknown verb ").Append(verb).Append('\n');
    }

    // 支持用双引号包住带空格的参数
    static string[] Tokenize(string line)
    {
        var list = new List<string>();
        var cur = new StringBuilder();
        bool quote = false;
        for (int i = 0; i < line.Length; i++)
        {
            char c = line[i];
            if (c == '"') { quote = !quote; continue; }
            if (!quote && (c == ' ' || c == '\t')) { if (cur.Length > 0) { list.Add(cur.ToString()); cur.Length = 0; } continue; }
            cur.Append(c);
        }
        if (cur.Length > 0) list.Add(cur.ToString());
        return list.ToArray();
    }

    static List<Type> MatchTypes(string pattern)
    {
        var re = new Regex(pattern, RegexOptions.IgnoreCase);
        var list = new List<Type>();
        var seen = new HashSet<string>();
        Assembly[] asms = AppDomain.CurrentDomain.GetAssemblies();
        for (int a = 0; a < asms.Length; a++)
        {
            Assembly asm = asms[a];
            string an;
            try { an = asm.GetName().Name; } catch { continue; }
            if (an.StartsWith("System", StringComparison.OrdinalIgnoreCase) || an.StartsWith("mscorlib", StringComparison.OrdinalIgnoreCase)
                || an.StartsWith("UnityEngine", StringComparison.OrdinalIgnoreCase) || an.StartsWith("Unity.", StringComparison.OrdinalIgnoreCase))
                continue; // 只要游戏自己的程序集，别被 BCL/Unity 淹没
            Type[] ts;
            try { ts = asm.GetTypes(); }
            catch (ReflectionTypeLoadException e) { ts = e.Types; }
            catch { continue; }
            if (ts == null) continue;
            for (int i = 0; i < ts.Length; i++)
            {
                Type t = ts[i];
                if (t == null) continue;
                string fn = t.FullName ?? t.Name;
                if (!re.IsMatch(fn)) continue;
                if (seen.Contains(fn)) continue;
                seen.Add(fn);
                list.Add(t);
                if (list.Count >= 40) return list;
            }
        }
        return list;
    }

    static string Sig(MethodInfo m)
    {
        var sb = new StringBuilder();
        sb.Append(m.Name).Append('(');
        ParameterInfo[] ps = m.GetParameters();
        for (int i = 0; i < ps.Length; i++)
        {
            if (i > 0) sb.Append(',');
            sb.Append(ps[i].ParameterType.Name);
            if (ps[i].IsOptional) sb.Append("=?");
        }
        sb.Append(')');
        return sb.ToString();
    }

    static int InstanceCount(Type t)
    {
        int n = 0;
        try
        {
            UnityEngine.Object[] all = Resources.FindObjectsOfTypeAll(t);
            for (int i = 0; i < all.Length; i++) if (all[i] != null) n++;
        }
        catch { }
        return n;
    }

    static void DumpTypes(string pattern, StringBuilder sb)
    {
        List<Type> types = MatchTypes(pattern);
        sb.Append("types matched=").Append(types.Count).Append('\n');
        for (int i = 0; i < types.Count; i++)
        {
            Type t = types[i];
            sb.Append("T ").Append(t.FullName).Append("  asm=").Append(t.Assembly.GetName().Name).Append("  inst=").Append(InstanceCount(t)).Append('\n');
            MethodInfo[] ms = t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly);
            int shown = 0;
            sb.Append("   M:");
            for (int j = 0; j < ms.Length && shown < 30; j++)
            {
                if (ms[j].IsSpecialName) continue;
                sb.Append(' ').Append(Sig(ms[j]));
                shown++;
            }
            sb.Append('\n');
            FieldInfo[] fs = t.GetFields(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly);
            if (fs.Length > 0)
            {
                sb.Append("   F:");
                for (int j = 0; j < fs.Length && j < 20; j++) sb.Append(' ').Append(fs[j].FieldType.Name).Append(' ').Append(fs[j].Name);
                sb.Append('\n');
            }
        }
    }

    static string PathOf(Transform t)
    {
        if (t == null) return "";
        var sb = new StringBuilder(t.name);
        Transform p = t.parent;
        int guard = 0;
        while (p != null && guard++ < 40) { sb.Insert(0, p.name + "/"); p = p.parent; }
        return sb.ToString();
    }

    static List<UnityEngine.Object> Instances(Type t)
    {
        var list = new List<UnityEngine.Object>();
        try
        {
            UnityEngine.Object[] all = Resources.FindObjectsOfTypeAll(t);
            for (int i = 0; i < all.Length; i++) if (all[i] != null) list.Add(all[i]);
        }
        catch { }
        return list;
    }

    static void DumpInstances(string pattern, StringBuilder sb)
    {
        List<Type> types = MatchTypes(pattern);
        sb.Append("inst types=").Append(types.Count).Append('\n');
        for (int i = 0; i < types.Count; i++)
        {
            Type t = types[i];
            List<UnityEngine.Object> all = Instances(t);
            sb.Append("I ").Append(t.Name).Append(" instances=").Append(all.Count).Append('\n');
            for (int j = 0; j < all.Count && j < 8; j++)
            {
                var c = all[j] as Component;
                var go = all[j] as GameObject;
                string path = c != null ? PathOf(c.transform) : (go != null ? PathOf(go.transform) : all[j].name);
                bool active = c != null ? c.gameObject.activeInHierarchy : (go != null && go.activeInHierarchy);
                sb.Append("   ").Append(path).Append(" active=").Append(active).Append('\n');
            }
        }
    }

    static string ValueOf(object o)
    {
        if (o == null) return "null";
        var s = o as string;
        if (s != null) return "\"" + s + "\"";
        var arr = o as Array;
        if (arr != null) return "Array[" + arr.Length + "]";
        var col = o as System.Collections.ICollection;
        if (col != null) return "Collection[" + col.Count + "]";
        Type t = o.GetType();
        if (t.IsPrimitive || o is decimal) return Convert.ToString(o, CultureInfo.InvariantCulture);
        return o.ToString();
    }

    static void DumpMembers(string pattern, string memberFilter, StringBuilder sb)
    {
        List<Type> types = MatchTypes(pattern);
        var re = memberFilter.Length > 0 ? new Regex(memberFilter, RegexOptions.IgnoreCase) : null;
        for (int i = 0; i < types.Count; i++)
        {
            Type t = types[i];
            List<UnityEngine.Object> all = Instances(t);
            sb.Append("D ").Append(t.FullName).Append(" instances=").Append(all.Count).Append('\n');
            sb.Append("  methods:");
            MethodInfo[] ms = t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly);
            int mcount = 0;
            for (int j = 0; j < ms.Length && mcount < 40; j++) { if (ms[j].IsSpecialName) continue; sb.Append(' ').Append(Sig(ms[j])); mcount++; }
            sb.Append('\n');
            if (all.Count == 0) continue;
            object inst = all[0];
            FieldInfo[] fs = t.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
            for (int j = 0; j < fs.Length && j < 60; j++)
            {
                FieldInfo f = fs[j];
                if (re != null && !re.IsMatch(f.Name)) continue;
                string v;
                try { v = ValueOf(f.GetValue(inst)); } catch (Exception e) { v = "<" + e.GetType().Name + ">"; }
                sb.Append("  F ").Append(f.FieldType.Name).Append(' ').Append(f.Name).Append(" = ").Append(v).Append('\n');
            }
            PropertyInfo[] ps = t.GetProperties(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
            for (int j = 0; j < ps.Length && j < 40; j++)
            {
                PropertyInfo p = ps[j];
                if (p.GetIndexParameters().Length > 0) continue;
                if (re != null && !re.IsMatch(p.Name)) continue;
                string v;
                try { v = p.CanRead ? ValueOf(p.GetValue(inst, null)) : "<write-only>"; } catch (Exception e) { v = "<" + e.GetType().Name + ">"; }
                sb.Append("  P ").Append(p.PropertyType.Name).Append(' ').Append(p.Name).Append(" = ").Append(v).Append('\n');
            }
        }
    }

    // 枚举值全表：AnimationType 这类上百个动作的枚举，dump 只给当前值，
    // 要的是"游戏一共会哪些动作"，所以单独一个 verb。
    static void DumpEnum(string pattern, StringBuilder sb)
    {
        List<Type> types = MatchTypes(pattern);
        for (int i = 0; i < types.Count; i++)
        {
            Type t = types[i];
            if (t == null) continue;
            if (t.IsEnum) { AppendEnum(t, sb); continue; }
            Type[] nest = t.GetNestedTypes(BindingFlags.Public | BindingFlags.NonPublic);
            for (int j = 0; j < nest.Length; j++)
                if (nest[j] != null && nest[j].IsEnum) AppendEnum(nest[j], sb);
        }
    }

    static void AppendEnum(Type t, StringBuilder sb)
    {
        sb.Append("E ").Append(t.FullName).Append('\n');
        Array vals = Enum.GetValues(t);
        for (int i = 0; i < vals.Length; i++)
        {
            string name = vals.GetValue(i).ToString();
            long n = 0;
            try { n = Convert.ToInt64(vals.GetValue(i)); } catch { }
            sb.Append("  ").Append(name).Append('=').Append(n).Append('\n');
        }
    }
    // ── 原生演出验证：anim / play / trig / ai ────────────────────────
    static Type ByName(string name)
    {
        List<Type> ts = MatchTypes(name);
        for (int i = 0; i < ts.Count; i++) if (ts[i] != null && ts[i].Name == name) return ts[i];
        return ts.Count > 0 ? ts[0] : null;
    }

    static object FirstInst(Type t)
    {
        if (t == null) return null;
        List<UnityEngine.Object> all = Instances(t);
        return all.Count > 0 ? all[0] : null;
    }

    static object FieldOf(object o, string name)
    {
        if (o == null) return null;
        Type t = o.GetType();
        while (t != null)
        {
            FieldInfo f = t.GetField(name, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
            if (f != null) return f.GetValue(o);
            t = t.BaseType;
        }
        return null;
    }

    // 她到底有没有站起来。判据只能是骨骼位置：
    // ChangeAnimation 返回成功、_currentAnimationType 变了，都只证明"状态机接受了这个枚举"，
    // 不证明动作适合她当前坐着的姿势。Wild001 全族的语义标注都是「站立动作」，
    // 播上去要是 Hips 的世界高度明显升高，就说明人离座了，这条映射不能用在座位上。
    // 读脸上六个母音 blendshape 的当前权重。
    // 口型不走 L3 Talk 层（那层一直 _None），是插件直接写 blendshape——
    // 所以判断"嘴到底动没动"只能看这里的数值。
    static void DumpMouth(StringBuilder sb)
    {
        SkinnedMeshRenderer target = null;
        foreach (SkinnedMeshRenderer s in UnityEngine.Object.FindObjectsOfType<SkinnedMeshRenderer>())
        {
            if (s.sharedMesh == null) continue;
            if (s.sharedMesh.blendShapeCount < 6) continue;
            if (s.name.IndexOf("Face", System.StringComparison.OrdinalIgnoreCase) >= 0) { target = s; break; }
        }
        if (target == null) { sb.Append("no face renderer\n"); return; }
        sb.Append("face=").Append(target.name).Append(" shapes=").Append(target.sharedMesh.blendShapeCount).Append('\n');
        for (int i = 0; i < target.sharedMesh.blendShapeCount; i++)
        {
            string nm = target.sharedMesh.GetBlendShapeName(i);
            string low = nm.ToLowerInvariant();
            if (low.IndexOf("mouth") < 0 && low.IndexOf("lip") < 0) continue;
            sb.Append("  ").Append(nm).Append(" = ").Append(target.GetBlendShapeWeight(i).ToString("F2")).Append('\n');
        }
    }

    static void DumpHips(StringBuilder sb)
    {
        Transform hit = null;
        foreach (Transform t in UnityEngine.Object.FindObjectsOfType<Transform>())
        {
            if (t.name == "Character_Hips") { hit = t; break; }
        }
        if (hit == null)
        {
            foreach (Transform t in UnityEngine.Object.FindObjectsOfType<Transform>())
            {
                if (t.name.IndexOf("Hips", System.StringComparison.OrdinalIgnoreCase) >= 0) { hit = t; break; }
            }
        }
        if (hit == null) { sb.Append("no hips found\n"); return; }
        object hs = FirstInst(ByName("HeroineService"));
        sb.Append("name=").Append(hit.name)
          .Append(" worldY=").Append(hit.position.y.ToString("F3"))
          .Append(" localY=").Append(hit.localPosition.y.ToString("F3"))
          .Append(" anim=").Append(hs == null ? "-" : System.Convert.ToString(FieldOf(hs, "_currentAnimationType")))
          .Append('\n');
    }

    // 姿势探针：把几根关键骨的 localEulerAngles 打出来，配合轮询量化"归位抽动"。
    // 只报角度不报四元数——人要读的是"动了多少度"。
    static void DumpPose(StringBuilder sb)
    {
        string[] want = new string[] { "Hips", "Spine", "Head", "LeftForeArm", "RightForeArm", "LeftUpLeg" };
        var all = UnityEngine.Object.FindObjectsOfType<Transform>();
        object hs = FirstInst(ByName("HeroineService"));
        sb.Append("anim=").Append(hs == null ? "-" : System.Convert.ToString(FieldOf(hs, "_currentAnimationType")))
          .Append(" t=").Append(Time.unscaledTime.ToString("F2")).Append('\n');
        for (int w = 0; w < want.Length; w++)
        {
            Transform hit = null;
            for (int i = 0; i < all.Length; i++)
            {
                if (all[i] == null) continue;
                if (all[i].name.IndexOf(want[w], System.StringComparison.OrdinalIgnoreCase) >= 0) { hit = all[i]; break; }
            }
            if (hit == null) { sb.Append("  ").Append(want[w]).Append(" = -\n"); continue; }
            Vector3 e = hit.localEulerAngles;
            sb.Append("  ").Append(hit.name).Append(" = ")
              .Append(e.x.ToString("F1")).Append(' ').Append(e.y.ToString("F1")).Append(' ').Append(e.z.ToString("F1"))
              .Append('\n');
        }
    }

    static void DumpAnimator(StringBuilder sb)
    {
        object hs = FirstInst(ByName("HeroineService"));
        if (hs == null) { sb.Append("no HeroineService\n"); return; }
        sb.Append("currentAnimationType = ").Append(FieldOf(hs, "_currentAnimationType")).Append('\n');
        Animator an = FieldOf(hs, "_animator") as Animator;
        if (an == null) { sb.Append("no animator\n"); return; }
        RuntimeAnimatorController rac = an.runtimeAnimatorController;
        sb.Append("controller = ").Append(rac == null ? "-" : rac.name)
          .Append(" layers = ").Append(an.layerCount)
          .Append(" speed = ").Append(an.speed.ToString("F2")).Append('\n');
        for (int i = 0; i < an.layerCount; i++)
        {
            AnimatorStateInfo si = an.GetCurrentAnimatorStateInfo(i);
            AnimatorClipInfo[] ci = an.GetCurrentAnimatorClipInfo(i);
            string clip = ci != null && ci.Length > 0 && ci[0].clip != null ? ci[0].clip.name : "-";
            sb.Append("  L").Append(i).Append(' ').Append(an.GetLayerName(i))
              .Append(" w=").Append(an.GetLayerWeight(i).ToString("F2"))
              .Append(" clip=").Append(clip)
              .Append(" t=").Append(si.normalizedTime.ToString("F2"))
              .Append(" len=").Append(si.length.ToString("F2"))
              .Append(" trans=").Append(an.IsInTransition(i) ? "1" : "0")
              .Append(" blends=").Append(ci == null ? 0 : ci.Length)
              .Append('\n');
            if (ci != null && ci.Length > 1)
                for (int k = 0; k < ci.Length; k++)
                    sb.Append("     blend[").Append(k).Append("] ").Append(ci[k].clip == null ? "-" : ci[k].clip.name)
                      .Append(" w=").Append(ci[k].weight.ToString("F2")).Append('\n');
        }
    }

    static void DoPlay(int id, StringBuilder sb)
    {
        object hs = FirstInst(ByName("HeroineService"));
        if (hs == null) { sb.Append("no HeroineService\n"); return; }
        MethodInfo m = hs.GetType().GetMethod("ChangeHeroineAnimationForInteger");
        if (m == null) { sb.Append("no method\n"); return; }
        m.Invoke(hs, new object[] { id });
        sb.Append("play(").Append(id).Append(") invoked\n");
    }

    static void DoTrig(string name, StringBuilder sb)
    {
        object hs = FirstInst(ByName("HeroineService"));
        if (hs == null) { sb.Append("no HeroineService\n"); return; }
        Type et = null;
        Type[] nest = hs.GetType().GetNestedTypes(BindingFlags.Public | BindingFlags.NonPublic);
        for (int i = 0; i < nest.Length; i++) if (nest[i].Name == "AnimationType") et = nest[i];
        if (et == null) { sb.Append("no AnimationType enum\n"); return; }
        object val;
        try { val = Enum.Parse(et, name, true); }
        catch { sb.Append("bad enum name: ").Append(name).Append('\n'); return; }
        MethodInfo m = hs.GetType().GetMethod("ChangeHeroineAnimationForTrigger");
        if (m == null) { sb.Append("no method\n"); return; }
        m.Invoke(hs, new object[] { val });
        sb.Append("trig(").Append(name).Append(") invoked\n");
    }

    static void DoAi(bool on, StringBuilder sb)
    {
        object ai = FirstInst(ByName("HeroineAI"));
        if (ai == null) { sb.Append("no HeroineAI\n"); return; }
        FieldInfo f = ai.GetType().GetField("_isUse", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
        if (f == null) { sb.Append("no _isUse\n"); return; }
        f.SetValue(ai, on);
        sb.Append("_isUse = ").Append(on).Append('\n');
    }
    static object ConvertArg(string raw, Type want)
    {
        if (want == typeof(string)) return raw;
        if (want == typeof(int)) return int.Parse(raw, CultureInfo.InvariantCulture);
        if (want == typeof(long)) return long.Parse(raw, CultureInfo.InvariantCulture);
        if (want == typeof(float)) return float.Parse(raw, CultureInfo.InvariantCulture);
        if (want == typeof(double)) return double.Parse(raw, CultureInfo.InvariantCulture);
        if (want == typeof(bool)) return raw == "1" || raw.Equals("true", StringComparison.OrdinalIgnoreCase);
        if (want.IsEnum)
        {
            // 数字或名字都收
            int n;
            if (int.TryParse(raw, out n)) return Enum.ToObject(want, n);
            return Enum.Parse(want, raw, true);
        }
        throw new InvalidOperationException("cannot convert '" + raw + "' to " + want.Name);
    }

    // 她在哪一档：这是游戏自己的状态机，不是我们的推断。
    // ActionStateType 里 WorkPC/WorkBook/WorkReport/BreakMovie/BreakReadBook/
    // BreakListenMusic/BreakTeaTime/BreakSleep 这些是"持续状态"——
    // 切过去之后 L0 会自己播 base_start -> base_loop，我们什么都不用写。
    // 这比逐帧采样强得多：不用管循环点、不用管归还姿势。
    static void DumpState(string arg, StringBuilder sb)
    {
        // 不能写死全名：HeroineAI 不在 Bulbul 命名空间下（dump 是按 Type.Name 匹配的，
        // 所以看着像全名）。这里同样按 Name 精确定位，顺带排除 HeroineAIMaster。
        Type aiType = null;
        List<Type> aiCands = MatchTypes("HeroineAI");
        for (int i = 0; i < aiCands.Count; i++)
            if (aiCands[i].Name == "HeroineAI") { aiType = aiCands[i]; break; }
        if (aiType == null) { sb.Append("ERROR no HeroineAI type\n"); return; }
        List<UnityEngine.Object> all = Instances(aiType);
        if (all.Count == 0) { sb.Append("ERROR no HeroineAI instance\n"); return; }
        object ai = all[0];

        MethodInfo getState = aiType.GetMethod("GetCurrentState", BindingFlags.Public | BindingFlags.Instance);
        MethodInfo change = aiType.GetMethod("DebugChangeState", BindingFlags.Public | BindingFlags.Instance);

        if (!string.IsNullOrEmpty(arg))
        {
            if (change == null) { sb.Append("ERROR no DebugChangeState\n"); return; }
            ParameterInfo[] ps = change.GetParameters();
            object val;
            try { val = Enum.Parse(ps[0].ParameterType, arg, true); }
            catch { sb.Append("ERROR bad state ").Append(arg).Append('\n'); return; }
            // 睡觉要先置 flag，否则 DebugChangeState(BreakSleep) 会被静默吞掉
            // （实测：切了没反应，GetCurrentState 还是上一个）。这是游戏自己的前置条件。
            if (string.Equals(Convert.ToString(val), "BreakSleep", StringComparison.OrdinalIgnoreCase))
            {
                MethodInfo sleep = aiType.GetMethod("ActivateSleepFlg", BindingFlags.Public | BindingFlags.Instance);
                if (sleep != null) { try { sleep.Invoke(ai, null); } catch { } }
            }
            try
            {
                change.Invoke(ai, new object[] { val });
                sb.Append("set ").Append(Convert.ToString(val)).Append('\n');
            }
            catch (Exception e)
            {
                sb.Append("ERROR ").Append(e.InnerException != null ? e.InnerException.Message : e.Message).Append('\n');
            }
        }

        if (getState != null)
        {
            try { sb.Append("state=").Append(Convert.ToString(getState.Invoke(ai, null))).Append('\n'); } catch { }
        }
        FieldInfo upd = aiType.GetField("_currentUpdateState", BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Public);
        if (upd != null)
        {
            try { sb.Append("update=").Append(Convert.ToString(upd.GetValue(ai))).Append('\n'); } catch { }
        }
        Type svcType = null;
        List<Type> svcCands = MatchTypes("HeroineService");
        for (int i = 0; i < svcCands.Count; i++)
            if (svcCands[i].Name == "HeroineService") { svcType = svcCands[i]; break; }
        if (svcType != null)
        {
            List<UnityEngine.Object> svcs = Instances(svcType);
            if (svcs.Count > 0)
            {
                FieldInfo cur = svcType.GetField("_currentAnimationType", BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Public);
                if (cur != null) { try { sb.Append("anim=").Append(Convert.ToString(cur.GetValue(svcs[0]))).Append('\n'); } catch { } }
            }
        }
        try
        {
            var animators = Resources.FindObjectsOfTypeAll<Animator>();
            for (int i = 0; i < animators.Length; i++)
            {
                Animator a = animators[i];
                if (a == null || a.runtimeAnimatorController == null) continue;
                if (a.runtimeAnimatorController.name != "Character_Animator_ForScript") continue;
                AnimatorClipInfo[] info = a.GetCurrentAnimatorClipInfo(0);
                if (info.Length > 0 && info[0].clip != null)
                {
                    sb.Append("L0=").Append(info[0].clip.name).Append(" len=").Append(info[0].clip.length.ToString("F2")).Append(" loop=").Append(info[0].clip.isLooping).Append('\n');
                }
                break;
            }
        }
        catch { }
    }
    static void Call(string pattern, string[] parts, StringBuilder sb)
    {
        if (parts.Length < 3) { sb.Append("ERROR call <typeRe> <method> [args]\n"); return; }
        string method = parts[2];
        List<Type> types = MatchTypes(pattern);
        for (int i = 0; i < types.Count; i++)
        {
            Type t = types[i];
            MethodInfo[] ms = t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly);
            for (int j = 0; j < ms.Length; j++)
            {
                MethodInfo m = ms[j];
                if (!string.Equals(m.Name, method, StringComparison.Ordinal)) continue;
                object inst = null;
                if (!m.IsStatic)
                {
                    List<UnityEngine.Object> all = Instances(t);
                    for (int k = 0; k < all.Count; k++)
                    {
                        var c = all[k] as Component;
                        if (c != null && c.gameObject.activeInHierarchy) { inst = c; break; }
                    }
                    if (inst == null && all.Count > 0) inst = all[0];
                    if (inst == null) { sb.Append("ERROR no instance of ").Append(t.Name).Append('\n'); return; }
                }
                ParameterInfo[] ps = m.GetParameters();
                object[] argv = new object[ps.Length];
                int supplied = parts.Length - 3;
                for (int k = 0; k < ps.Length; k++)
                {
                    if (k < supplied) argv[k] = ConvertArg(parts[3 + k], ps[k].ParameterType);
                    else if (ps[k].IsOptional) argv[k] = ps[k].DefaultValue;
                    else { sb.Append("ERROR missing arg ").Append(k).Append(' ').Append(ps[k].ParameterType.Name).Append(' ').Append(ps[k].Name).Append('\n'); return; }
                }
                object r;
                try { r = m.Invoke(inst, argv); }
                catch (Exception e)
                {
                    Exception inner = e is TargetInvocationException && e.InnerException != null ? e.InnerException : e;
                    sb.Append("THROW ").Append(inner.GetType().Name).Append(": ").Append(inner.Message).Append('\n');
                    return;
                }
                sb.Append("OK ").Append(t.Name).Append('.').Append(Sig(m)).Append(" -> ").Append(ValueOf(r)).Append('\n');
                return;
            }
        }
        sb.Append("ERROR method ").Append(method).Append(" not found on /").Append(pattern).Append("/\n");
    }

    static void SetValue(string pattern, string[] parts, StringBuilder sb)
    {
        if (parts.Length < 4) { sb.Append("ERROR set <typeRe> <member> <value>\n"); return; }
        List<Type> types = MatchTypes(pattern);
        for (int i = 0; i < types.Count; i++)
        {
            Type t = types[i];
            List<UnityEngine.Object> all = Instances(t);
            if (all.Count == 0) continue;
            object inst = all[0];
            FieldInfo f = t.GetField(parts[2], BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
            if (f != null)
            {
                f.SetValue(inst, ConvertArg(parts[3], f.FieldType));
                sb.Append("OK set ").Append(t.Name).Append('.').Append(f.Name).Append(" = ").Append(parts[3]).Append('\n');
                return;
            }
            PropertyInfo p = t.GetProperty(parts[2], BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
            if (p != null && p.CanWrite)
            {
                p.SetValue(inst, ConvertArg(parts[3], p.PropertyType), null);
                sb.Append("OK set ").Append(t.Name).Append('.').Append(p.Name).Append(" = ").Append(parts[3]).Append('\n');
                return;
            }
            sb.Append("ERROR member ").Append(parts[2]).Append(" not writable on ").Append(t.Name).Append('\n');
            return;
        }
        sb.Append("ERROR type not found /").Append(pattern).Append("/\n");
    }

    // 谁在出声：把正在播的 AudioSource 连同它的对象路径列出来 —— 自言自语事件的 id 就是 clip 名
    static void DumpAudio(StringBuilder sb)
    {
        AudioSource[] all = Resources.FindObjectsOfTypeAll<AudioSource>();
        int n = 0;
        for (int i = 0; i < all.Length; i++)
        {
            AudioSource a = all[i];
            if (a == null || !a.isPlaying || a.clip == null) continue;
            sb.Append("A ").Append(a.clip.name).Append("  t=").Append(a.time.ToString("F2")).Append("  ").Append(PathOf(a.transform)).Append('\n');
            n++;
        }
        sb.Append("playing=").Append(n).Append('\n');
    }
}
