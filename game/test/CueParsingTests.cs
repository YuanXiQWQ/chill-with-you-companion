// JsonLite 与 AnimIdMap 的独立测试。零 Unity 依赖，用 Windows 自带的 csc 编译即可跑。
//
// 为什么这两个先测：它们是所有 cue 的入口和出口。
//   JsonLite    —— 游戏端唯一的手写 JSON 解析器，解析错一个字段就是"动作不对"而不是"报错"
//   AnimIdMap   —— 数字 id 到 clip 名的映射，漏一条就是那个 id 永远播不出来
//
// 跑法：game/test/run-tests.ps1
using System;
using System.Collections.Generic;
using ChillPerformer;

internal static class Tests
{
    private static int passed = 0;
    private static int failed = 0;
    private static readonly List<string> failures = new List<string>();

    private static void Ok(bool cond, string name, string detail)
    {
        if (cond) { passed++; return; }
        failed++;
        failures.Add(name + (string.IsNullOrEmpty(detail) ? "" : " :: " + detail));
        Console.WriteLine("  FAIL  " + name + (string.IsNullOrEmpty(detail) ? "" : "  [" + detail + "]"));
    }

    private static void Ok(bool cond, string name) { Ok(cond, name, ""); }

    private static void Eq(string actual, string expected, string name)
    {
        Ok(string.Equals(actual, expected, StringComparison.Ordinal), name,
           "got=[" + (actual ?? "<null>") + "] want=[" + expected + "]");
    }

    public static int Main()
    {
        Console.WriteLine("== JsonLite ==");
        TestScalars();
        TestNested();
        TestUnicode();
        TestEscapes();
        TestCueShape();
        TestMalformed();

        Console.WriteLine("== AnimIdMap ==");
        TestAnimIdMap();

        Console.WriteLine();
        if (failed == 0)
        {
            Console.WriteLine("OK  " + passed + " passed");
            return 0;
        }
        Console.WriteLine("FAILED  " + failed + " / " + (passed + failed));
        foreach (var f in failures) Console.WriteLine("  - " + f);
        return 1;
    }

    private static void TestScalars()
    {
        var d = JsonLite.AsDict(JsonLite.Parse("{\"a\":1,\"b\":\"x\",\"c\":true,\"d\":null,\"e\":1.5}"));
        Ok(d != null, "对象能解析");
        if (d == null) return;
        Ok(JsonLite.Int(JsonLite.Get(d, "a")) == 1, "整数");
        Eq(JsonLite.Str(JsonLite.Get(d, "b")), "x", "字符串");
        Ok(Math.Abs(JsonLite.Num(JsonLite.Get(d, "e")) - 1.5) < 1e-9, "小数");
        Ok(JsonLite.Get(d, "d") == null, "null 取出来是空");
        // 缺字段不能抛，返回默认值
        Ok(JsonLite.Int(JsonLite.Get(d, "nope")) == 0, "缺字段取 int 得 0");
        Eq(JsonLite.Str(JsonLite.Get(d, "nope")), "", "缺字段取 str 得空串");
    }

    private static void TestNested()
    {
        const string s = "{\"list\":[{\"k\":\"v1\"},{\"k\":\"v2\"}],\"deep\":{\"x\":{\"y\":7}}}";
        var d = JsonLite.AsDict(JsonLite.Parse(s));
        Ok(d != null, "嵌套对象能解析");
        if (d == null) return;
        var list = JsonLite.AsList(JsonLite.Get(d, "list"));
        Ok(list != null && list.Count == 2, "数组长度 2", list == null ? "null" : list.Count.ToString());
        if (list != null && list.Count == 2)
        {
            Eq(JsonLite.Str(JsonLite.Get(JsonLite.AsDict(list[0]), "k")), "v1", "数组第 0 项");
            Eq(JsonLite.Str(JsonLite.Get(JsonLite.AsDict(list[1]), "k")), "v2", "数组第 1 项");
        }
        var deep = JsonLite.AsDict(JsonLite.Get(d, "deep"));
        var x = JsonLite.AsDict(JsonLite.Get(deep, "x"));
        Ok(JsonLite.Int(JsonLite.Get(x, "y")) == 7, "三层嵌套");
    }

    private static void TestUnicode()
    {
        // cue 的 subtitle 是中文，这里解析错就是"她说乱码"
        var d = JsonLite.AsDict(JsonLite.Parse("{\"t\":\"那我也安静了。……我抬下头看看。\"}"));
        Eq(JsonLite.Str(JsonLite.Get(d, "t")), "那我也安静了。……我抬下头看看。", "中文原样往返");
        var j = JsonLite.AsDict(JsonLite.Parse("{\"t\":\"\\u4e2d\\u6587\"}"));
        Eq(JsonLite.Str(JsonLite.Get(j, "t")), "中文", "\\u 转义");
    }

    private static void TestEscapes()
    {
        var d = JsonLite.AsDict(JsonLite.Parse("{\"t\":\"a\\\"b\\\\c\\nd\"}"));
        Eq(JsonLite.Str(JsonLite.Get(d, "t")), "a\"b\\c\nd", "引号/反斜杠/换行转义");
        // 空容器
        var e = JsonLite.AsDict(JsonLite.Parse("{\"a\":[],\"b\":{}}"));
        Ok(JsonLite.AsList(JsonLite.Get(e, "a")).Count == 0, "空数组");
        Ok(JsonLite.AsDict(JsonLite.Get(e, "b")) != null, "空对象");
    }

    // 真实形状：cuesJson 里每一项就是一个这样的对象
    private static void TestCueShape()
    {
        const string cue =
            "{\"slot\":\"animations\",\"id\":\"anim_work_pc_sub_thinking\",\"at\":0," +
            "\"durationMs\":4000,\"holdMs\":0,\"nativeName\":\"\",\"nativeId\":0," +
            "\"nativeSub\":\"DrinkTea\",\"stateName\":\"WorkPC\",\"facial\":\"Shy_Fun\"}";
        var d = JsonLite.AsDict(JsonLite.Parse(cue));
        Ok(d != null, "cue JSON 能解析");
        if (d == null) return;
        Eq(JsonLite.Str(JsonLite.Get(d, "slot")), "animations", "cue.slot");
        Eq(JsonLite.Str(JsonLite.Get(d, "id")), "anim_work_pc_sub_thinking", "cue.id");
        Ok(JsonLite.Int(JsonLite.Get(d, "durationMs")) == 4000, "cue.durationMs");
        Eq(JsonLite.Str(JsonLite.Get(d, "nativeSub")), "DrinkTea", "cue.nativeSub");
        Eq(JsonLite.Str(JsonLite.Get(d, "stateName")), "WorkPC", "cue.stateName");
        Eq(JsonLite.Str(JsonLite.Get(d, "facial")), "Shy_Fun", "cue.facial");

        // 数组形态：cuesJson 是 string[]，每一项都要能独立解析
        const string packed =
            "[\"{\\\"id\\\":\\\"a\\\"}\",\"{\\\"id\\\":\\\"b\\\"}\"]";
        var arr = JsonLite.AsList(JsonLite.Parse(packed));
        Ok(arr != null && arr.Count == 2, "cuesJson 是长度 2 的字符串数组",
           arr == null ? "null" : arr.Count.ToString());
        if (arr == null || arr.Count != 2) return;
        Eq(JsonLite.Str(JsonLite.Get(JsonLite.AsDict(JsonLite.Parse(JsonLite.Str(arr[0]))), "id")), "a", "cuesJson[0] 二次解析");
        Eq(JsonLite.Str(JsonLite.Get(JsonLite.AsDict(JsonLite.Parse(JsonLite.Str(arr[1]))), "id")), "b", "cuesJson[1] 二次解析");
    }

    private static void TestMalformed()
    {
        // 畸形输入必须"结构化地失败"（返回 null 或空的默认值），不能抛到外层把 pull 循环打死
        string[] bad = { "", "   ", "{", "{\"a\":", "[1,2", "not json at all", "{\"a\":tru}" };
        for (int i = 0; i < bad.Length; i++)
        {
            object r = null;
            bool threw = false;
            try { r = JsonLite.Parse(bad[i]); } catch { threw = true; }
            Ok(!threw, "畸形输入不抛异常 #" + i, threw ? "threw on [" + bad[i] + "]" : "");
            // 后续读取也得安全
            bool readThrew = false;
            try
            {
                var dd = JsonLite.AsDict(r);
                if (dd != null) { JsonLite.Str(JsonLite.Get(dd, "a")); JsonLite.Int(JsonLite.Get(dd, "b")); }
                JsonLite.AsList(r);
            }
            catch { readThrew = true; }
            Ok(!readThrew, "畸形输入后续读取不抛 #" + i);
        }
    }

    private static void TestAnimIdMap()
    {
        var byId = AnimIdMap.ById;
        Ok(byId != null && byId.Count > 0, "AnimIdMap 非空");
        if (byId == null) return;

        // 名字不能重复：两个 id 指同一个 clip，说明生成时把重复项也塞了进来
        var seen = new HashSet<string>(StringComparer.Ordinal);
        int dupName = 0;
        string firstDup = null;
        foreach (var kv in byId)
        {
            if (!seen.Add(kv.Value)) { dupName++; if (firstDup == null) firstDup = kv.Value; }
        }
        Ok(dupName == 0, "clip 名不重复", dupName + " 个重复，首个=" + (firstDup ?? ""));

        // 每个 id 都要在合理区间，负数或超大都是生成器出错
        int badId = 0;
        foreach (var kv in byId)
            if (kv.Key < 0 || kv.Key > 200000) badId++;
        Ok(badId == 0, "id 在合理区间", badId + " 个越界");

        // 空名字会让 DLL 静默跳过
        int emptyName = 0;
        foreach (var kv in byId)
            if (string.IsNullOrEmpty(kv.Value)) emptyName++;
        Ok(emptyName == 0, "没有空 clip 名", emptyName + " 个空名");

        Console.WriteLine("  （AnimIdMap 共 " + byId.Count + " 条）");
    }
}
