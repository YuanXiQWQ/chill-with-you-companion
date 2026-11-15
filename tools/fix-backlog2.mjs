import { readFileSync, writeFileSync } from 'node:fs'

const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8')
if (s.includes('bootSkipAtMs')) {
  console.log('  · 插件已有年龄门槛，跳过')
} else {
  const marker = 'if (!bootSynced)'
  const start = s.indexOf(marker)
  if (start < 0) throw new Error('找不到 bootSynced 判定')
  // 从 marker 后的第一个 { 开始做花括号配平，找到语句结束
  const open = s.indexOf('{', start)
  let depth = 0, end = -1
  for (let i = open; i < s.length; i += 1) {
    if (s[i] === '{') depth += 1
    else if (s[i] === '}') { depth -= 1; if (depth === 0) { end = i + 1; break } }
  }
  if (end < 0) throw new Error('配平失败')
  // 连它上面那行注释一起替换
  const lineStart = s.lastIndexOf('\n', start) + 1
  const commentStart = s.lastIndexOf('// 开机自检', lineStart)
  const from = commentStart >= 0 ? s.lastIndexOf('\n', commentStart) + 1 : lineStart
  const indentMatch = s.slice(from).match(/^[ \t]*/)
  const ind = indentMatch ? indentMatch[0] : ''
  const block = [
    `${ind}// 开机自检：大脑里可能留着上次会话的旧条目，也可能有刚推来的指令。`,
    `${ind}// 一律丢弃会把"刚推的那条"一起吞掉（测试时要重推两三次就是这么来的），`,
    `${ind}// 所以只按年龄丢：超过 BacklogTtlMs 的算旧账，新的照演。`,
    `${ind}if (!bootSynced)`,
    `${ind}{`,
    `${ind}    bootSynced = true;`,
    `${ind}    int ttlMs = Plugin.BacklogTtlMs == null ? 20000 : Mathf.Clamp(Plugin.BacklogTtlMs.Value, 0, 600000);`,
    `${ind}    bootSkipAtMs = NowUnixMs() - ttlMs;`,
    `${ind}    if (headSeq > 0) Plugin.Log.LogInfo("pull: startup sync, drop backlog older than " + ttlMs + "ms (seq=" + headSeq + ", local=" + feedSeq + ")");`,
    `${ind}}`,
  ].join('\n')
  s = s.slice(0, from) + block + s.slice(end)

  s = s.replace('        private bool bootSynced;', '        private bool bootSynced;\n        // 首次拉取的年龄门槛：比它旧的条目算上次会话旧账，不重播；新的照演\n        private long bootSkipAtMs;')
  if (!s.includes('private long bootSkipAtMs')) throw new Error('字段插入失败')

  s = s.replace('        private void StepClip(float ct)', `        private static long NowUnixMs()
        {
            return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        }

        private void StepClip(float ct)`)

  const loopRe = /(var d = JsonLite\.AsDict\(items\[i\]\);\n)(\s*)if \(d == null\) continue;\n/
  if (!loopRe.test(s)) throw new Error('条目循环锚点未找到')
  s = s.replace(loopRe, (m, a, ind2) => `${a}${ind2}if (d == null) continue;\n${ind2}if (bootSkipAtMs > 0)\n${ind2}{\n${ind2}    long atMs = JsonLite.Int(JsonLite.Get(d, "at"));\n${ind2}    if (atMs > 0 && atMs < bootSkipAtMs)\n${ind2}    {\n${ind2}        if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("pull: drop stale cue at=" + atMs);\n${ind2}        continue;\n${ind2}    }\n${ind2}}\n`)

  s = s.replace('        internal static ConfigEntry<float> SpeedCap;', '        internal static ConfigEntry<int> BacklogTtlMs;\n        internal static ConfigEntry<float> SpeedCap;')
  s = s.replace('            SpeedCap = Config.Bind("motion", "SpeedCap"', '            BacklogTtlMs = Config.Bind("interop", "BacklogTtlMs", 20000, "On the first pull after startup, cues older than this many ms are last session leftovers and get dropped; newer ones still play, so a push made just before startup is not swallowed.");\n            SpeedCap = Config.Bind("motion", "SpeedCap"')
  writeFileSync(p, s, 'utf8')
  console.log('  ✓ 插件 backlog 改为按年龄丢弃')
}
