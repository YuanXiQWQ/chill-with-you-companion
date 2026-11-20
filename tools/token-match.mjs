// 分类器改成按 token（下划线切开）匹配：lookpenguin 里的 pen、suspense 里的 pen 都算误判源。
import { readFileSync, writeFileSync } from 'node:fs'

// ── JS 侧 ──
{
  const p = 'lib/motion-class.js'
  let s = readFileSync(p, 'utf8')
  const old = `export function classifyClip(id) {
  const s = String(id || '').toLowerCase()
  if (!s) return MOTION_CLASS.UNKNOWN
  for (const [cls, keys] of KEYS) if (keys.some((k) => s.includes(k))) return cls`
  if (!s.includes(old)) throw new Error('classifyClip 锚点失配')
  const neu = `// 按 token 比对：id 用 _ 切开，token 相等才算命中；
// 长键（>=4 字符）允许 token 前缀，用来吃掉 nod1 / thinking1 这类编号后缀。
// 不做整串 includes —— lookpenguin 会被 pen 命中，suspense 也是。
function tokensOf(id) {
  return String(id || '').toLowerCase().replace(/^anim_/, '').split('_').filter(Boolean)
}
function hasToken(tokens, key) {
  return tokens.some((t) => t === key || (key.length >= 4 && t.startsWith(key)))
}

export function classifyClip(id) {
  const s = String(id || '').toLowerCase()
  if (!s) return MOTION_CLASS.UNKNOWN
  const tokens = tokensOf(s)
  for (const [cls, keys] of KEYS) if (keys.some((k) => hasToken(tokens, k))) return cls`
  s = s.replace(old, neu)
  // 后面的 _sub / idle 兜底也改成 token 判断
  s = s.replace("if (s.includes('_sub')) return MOTION_CLASS.GESTURE", "if (tokens.includes('sub')) return MOTION_CLASS.GESTURE")
  s = s.replace(
    "if (s.includes('idle') || s.includes('breath') || s.includes('base_loop') || s.includes('base_start') || s.includes('base_end') || s.endsWith('_base')) return MOTION_CLASS.IDLE",
    "if (tokens.includes('idle') || tokens.includes('breath') || (tokens.includes('base') && tokens.some((t) => t === 'loop' || t === 'start' || t === 'end'))) return MOTION_CLASS.IDLE"
  )
  s = s.replace("if (s.includes('wild_')) return MOTION_CLASS.POSTURE", "if (tokens.includes('wild')) return MOTION_CLASS.POSTURE")
  writeFileSync(p, s, 'utf8')
  console.log('  ✓ JS 分类器改为 token 匹配')
}

// ── C# 侧（同一口径，否则两端对"这段算什么"理解不同） ──
{
  const p = 'game/src/MotionClass.cs'
  let s = readFileSync(p, 'utf8')
  if (s.includes('HasToken')) { console.log('  · C# 已是 token 匹配'); }
  else {
    const marker = 'public static ClipClass Classify(string clipName)'
    const i = s.indexOf(marker)
    if (i < 0) throw new Error('C# Classify 未找到')
    // 找到方法体结束（配平花括号）
    const open = s.indexOf('{', i)
    let depth = 0, end = -1
    for (let k = open; k < s.length; k += 1) {
      if (s[k] === '{') depth += 1
      else if (s[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break } }
    }
    const body = s.slice(i, end)
    // 把 body 里的 s.Contains("x") 换成 HasToken(tokens, "x")
    const patched = body
      .replace(/string s = \(clipName \|\| ""\)\.ToLowerInvariant\(\);/, 'string s = (clipName ?? "").ToLowerInvariant();')
      .replace(/s\.Contains\("([^"]+)"\)/g, 'HasToken(tokens, "$1")')
      .replace(/string s = ([^\n]+)\n/, (m, expr) => `string s = ${expr}\n        string[] tokens = TokensOf(s);\n`)
    const helper = `        // token 匹配：id 用 _ 切开，token 相等才算命中；长键允许前缀（nod1 / thinking1）
        private static string[] TokensOf(string id)
        {
            string v = id ?? "";
            if (v.StartsWith("anim_")) v = v.Substring(5);
            return v.Split(new[] { '_' }, StringSplitOptions.RemoveEmptyEntries);
        }

        private static bool HasToken(string[] tokens, string key)
        {
            for (int i = 0; i < tokens.Length; i++)
            {
                if (tokens[i] == key) return true;
                if (key.Length >= 4 && tokens[i].StartsWith(key)) return true;
            }
            return false;
        }

`
    s = s.slice(0, i) + patched + s.slice(end)
    // 帮手插在 Classify 之前
    s = s.replace(marker, helper + marker)
    // 兜底：s.Contains("wild_") 之类不在 Classify 里的调用保持原样，只换已有 HasToken 覆盖的部分
    s = s.replace(/s\.Contains\("_sub"\)/g, 'HasToken(tokens, "sub")')
    s = s.replace(/s\.Contains\("wild_"\)/g, 'HasToken(tokens, "wild")')
    writeFileSync(p, s, 'utf8')
    console.log('  ✓ C# 分类器改为 token 匹配')
  }
}
