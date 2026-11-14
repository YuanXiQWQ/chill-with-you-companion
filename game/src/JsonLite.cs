// Minimal JSON reader for Unity 5.x / .NET 3.5 profile.
// JsonUtility silently returns empty arrays for object arrays on some Unity
// versions, so the performer parses its own payload. ASCII only.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

public static class JsonLite
{
    public static object Parse(string s)
    {
        if (string.IsNullOrEmpty(s)) return null;
        int i = 0;
        object v = ParseValue(s, ref i);
        return v;
    }

    public static Dictionary<string, object> AsDict(object o)
    {
        return o as Dictionary<string, object>;
    }

    public static List<object> AsList(object o)
    {
        return o as List<object>;
    }

    public static object Get(object dict, string key)
    {
        var d = dict as Dictionary<string, object>;
        if (d == null) return null;
        object v;
        return d.TryGetValue(key, out v) ? v : null;
    }

    public static string Str(object o)
    {
        if (o == null) return "";
        if (o is string) return (string)o;
        if (o is bool) return ((bool)o) ? "true" : "false";
        if (o is double) return ((double)o).ToString(CultureInfo.InvariantCulture);
        return o.ToString();
    }

    public static int Int(object o)
    {
        if (o == null) return 0;
        if (o is double) return (int)Math.Round((double)o);
        if (o is string)
        {
            double d;
            if (double.TryParse((string)o, NumberStyles.Any, CultureInfo.InvariantCulture, out d)) return (int)Math.Round(d);
        }
        return 0;
    }

    public static double Num(object o)
    {
        if (o == null) return 0;
        if (o is double) return (double)o;
        double d;
        if (o is string && double.TryParse((string)o, NumberStyles.Any, CultureInfo.InvariantCulture, out d)) return d;
        return 0;
    }

    static void SkipWs(string s, ref int i)
    {
        while (i < s.Length)
        {
            char c = s[i];
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\uFEFF') { i++; continue; }
            break;
        }
    }

    static object ParseValue(string s, ref int i)
    {
        SkipWs(s, ref i);
        if (i >= s.Length) return null;
        char c = s[i];
        if (c == '{') return ParseObject(s, ref i);
        if (c == '[') return ParseArray(s, ref i);
        if (c == '"') return ParseString(s, ref i);
        if (c == 't') { i += 4; return true; }
        if (c == 'f') { i += 5; return false; }
        if (c == 'n') { i += 4; return null; }
        return ParseNumber(s, ref i);
    }

    static Dictionary<string, object> ParseObject(string s, ref int i)
    {
        var d = new Dictionary<string, object>();
        i++; // {
        int guard = 0;
        while (true)
        {
            SkipWs(s, ref i);
            if (i >= s.Length) break;
            if (s[i] == '}') { i++; break; }
            if (s[i] == ',') { i++; continue; }
            if (++guard > s.Length + 8) break; // 兜底：坏 JSON 不许拖死主线程
            string key = ParseString(s, ref i);
            SkipWs(s, ref i);
            if (i < s.Length && s[i] == ':') i++;
            object val = ParseValue(s, ref i);
            if (key != null) d[key] = val;
        }
        return d;
    }

    static List<object> ParseArray(string s, ref int i)
    {
        var list = new List<object>();
        i++; // [
        int guard = 0;
        while (true)
        {
            SkipWs(s, ref i);
            if (i >= s.Length) break;
            if (s[i] == ']') { i++; break; }
            if (s[i] == ',') { i++; continue; }
            if (++guard > s.Length + 8) break; // 兜底
            list.Add(ParseValue(s, ref i));
        }
        return list;
    }

    static string ParseString(string s, ref int i)
    {
        // 关键：不是引号时必须吃掉一个字符，否则上层 while(true) 会原地空转冻死主线程
        if (i >= s.Length) return "";
        if (s[i] != '"') { i++; return ""; }
        i++;
        var sb = new StringBuilder();
        while (i < s.Length)
        {
            char c = s[i++];
            if (c == '"') break;
            if (c != '\\') { sb.Append(c); continue; }
            if (i >= s.Length) break;
            char e = s[i++];
            if (e == 'n') sb.Append('\n');
            else if (e == 't') sb.Append('\t');
            else if (e == 'r') sb.Append('\r');
            else if (e == 'b') sb.Append('\b');
            else if (e == 'f') sb.Append('\f');
            else if (e == 'u')
            {
                if (i + 4 <= s.Length)
                {
                    int code;
                    if (int.TryParse(s.Substring(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out code))
                        sb.Append((char)code);
                    i += 4;
                }
            }
            else sb.Append(e);
        }
        return sb.ToString();
    }

    static double ParseNumber(string s, ref int i)
    {
        int start = i;
        while (i < s.Length)
        {
            char c = s[i];
            if ((c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E') { i++; continue; }
            break;
        }
        if (i == start) i++; // 没吃掉任何数字，至少推进一格，杜绝死循环
        double d;
        if (double.TryParse(s.Substring(start, i - start), NumberStyles.Any, CultureInfo.InvariantCulture, out d)) return d;
        return 0;
    }
}
