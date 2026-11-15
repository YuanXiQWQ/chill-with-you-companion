import { readFileSync, writeFileSync } from 'node:fs'
const p = 'game/src/MotionClass.cs'
let s = readFileSync(p, 'utf8')

// 1) HasAny 改成 token 匹配（与 JS 同口径）
const oldHas = `        private static bool HasAny(string s, string[] keys)
        {
            for (int i = 0; i < keys.Length; i++) if (s.IndexOf(keys[i], StringComparison.Ordinal) >= 0) return true;
            return false;
        }`
if (!s.includes(oldHas)) throw new Error('HasAny 实现不一致')
s = s.replace(oldHas, `        private static bool HasAny(string s, string[] keys)
        {
            string[] tokens = TokensOf(s);
            for (int i = 0; i < keys.Length; i++) if (HasToken(tokens, keys[i])) return true;
            return false;
        }`)

// 2) Classify 里剩下的 IndexOf 兜底改 token
s = s.replace('if (s.IndexOf("_sub", StringComparison.Ordinal) >= 0) return ClipClass.Gesture;',
  'if (HasToken(TokensOf(s), "sub")) return ClipClass.Gesture;')
s = s.replace(/if \(s\.IndexOf\("wild_", StringComparison\.Ordinal\) >= 0\) return ClipClass\.Posture;|if \(s\.IndexOf\("wild_"/, 'if (HasToken(TokensOf(s), "wild")) return ClipClass.Posture;')

// 3) 去掉重复的 tokens 声明
s = s.replace(`            string s = clipName.ToLowerInvariant();
        string[] tokens = TokensOf(s);`, '            string s = clipName.ToLowerInvariant();')

writeFileSync(p, s, 'utf8')

// 4) 检查 IsIdle 是否也用了 IndexOf
const t2 = readFileSync(p, 'utf8')
const i = t2.indexOf('private static bool IsIdle')
console.log(t2.slice(i, i + 460).split('\n').map((l) => '  ' + l.trimEnd()).join('\n'))
