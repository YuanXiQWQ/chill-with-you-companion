// 三处一起改：模型侧动作类别约束（提示词 + 清单标注）、游戏端 backlog 按年龄丢弃。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const must = (c, m) => { if (!c) throw new Error(m) }
const readLF = (p) => readFileSync(p, 'utf8')
const writeLF = (p, s) => writeFileSync(p, s, 'utf8')

// ── 1) assets.js：给清单每条动作标类别，并给出类别说明 ──
{
  const p = root + 'game/../lib/assets.js'
  let s = readLF(p)
  if (!s.includes("from './motion-class.js'")) {
    // assets.js 本身没有 import，插到第一个导出之前
    s = s.replace('export const EMPTY_MANIFEST', "import { classifyClip } from './motion-class.js'\n\nexport const EMPTY_MANIFEST")
    must(s.includes("classifyClip } from './motion-class.js'"), 'assets.js import 插入失败')
  }
  // 类别缩写：g=手势 p=道具 P=姿态 l=位移 i=待机 u=未分类
  const tagFn = `const CLASS_TAG = { gesture: 'g', prop: 'p', posture: 'P', locomotion: 'l', idle: 'i', unknown: 'u' }
const classTagOf = (id) => CLASS_TAG[classifyClip(id)] || 'u'
`
  if (!s.includes('const classTagOf')) {
    s = s.replace('export function summarizeForPrompt', tagFn + '\nexport function summarizeForPrompt')
  }
  must(s.includes('parts.push([entry.id, tags, dur]'), 'parts.push 未找到')
  s = s.replace('parts.push([entry.id, tags, dur].filter(Boolean).join(\':\'))',
    "parts.push([entry.id, tags, slot === 'animations' ? classTagOf(entry.id) : '', dur].filter(Boolean).join(':'))")
  must(s.includes('if (lines.length === 0) return'), 'lines 收尾未找到')
  s = s.replace("    if (lines.length === 0) return ''",
    `    if (lines.length === 0) return ''
    // 类别缩写说明必须跟着清单走，模型才知道每条动作"是什么类别"
    lines.push('- 动作类别缩写：g=手势（反应类，点头/摇头/思考/笑/害羞） p=道具（喝/吃/写/敲键盘/翻书） P=姿态（起身/躺下/伸懒腰/打哈欠） l=位移（走/离座/过去） i=待机循环 u=未分类')`)
  writeLF(p, s)
  console.log('  ✓ assets.js：清单标注类别')
}

// ── 2) core.js：按内容类别选动作的规则 ──
{
  const p = root + 'lib/core.js'
  let s = readLF(p)
  const oldLine = "      '按这句话在做什么选动作，不要只按心情套：',"
  must(s.includes(oldLine), 'core.js 规则锚点未找到')
  const add = `      '动作先分类，再选：g=手势（反应类，点头/摇头/思考/笑/害羞/垂肩） p=道具（喝/吃/写/敲键盘/翻书/看电脑） P=姿态（起身/躺下/伸懒腰/打哈欠） l=位移（走/离座/过去） i=待机循环。',
    '类别必须和这句话的内容一致，这是硬要求：',
    '  说到正在喝/吃/写/敲/看书/看电脑 → 只能选 p；说到累/困/伸懒腰/站起来 → 只能选 P；',
    '  说到要走/过去/离开椅子 → 只能选 l；其余的反应（认同、思考、害羞、笑、难过）→ 选 g。',
    '拿不准就用 g。用 p 或 P 装样子（明明没在喝却说在喝、明明没起身却躺下）比只点头更假。',
      'i 类是场景待机循环，只在真的要"保持某个状态一会儿"时才用，不拿来当反应。',
      '按这句话在做什么选动作，不要只按心情套：',`
  s = s.replace(oldLine, add)
  writeLF(p, s)
  console.log('  ✓ core.js：加入类别与内容一致性规则')
}

// ── 3) 游戏端：backlog 不再一律丢弃，改按年龄丢弃 ──
{
  const p = root + 'game/src/PerformerPlugin.cs'
  let s = readFileSync(p, 'utf8')
  must(s.includes('pull: startup sync, skip backlog up to seq='), '插件锚点未找到')
  const oldBlock = `                      // 开机自检：大脑里可能还留着上次会话的条目，这里只对齐游标，不重播
                      if (!bootSynced)
                      {
                          bootSynced = true;
                          if (headSeq > 0)
                          {
                              Plugin.Log.LogInfo("pull: startup sync, skip backlog up to seq=" + headSeq);
                              feedSeq = headSeq;
                              continue;
                          }
                      }`
  must(s.includes(oldBlock), '插件旧块文本不一致')
  const newBlock = `                      // 开机自检：大脑里可能留着上次会话留下的旧条目，也可能有刚刚推来的新指令。
                      // 一律丢弃会连"刚推的那条"一起吞掉（测试时表现为要重推两三次），
                      // 所以只按年龄丢：超过 BacklogTtlMs 的才算旧账，新的照演。
                      if (!bootSynced)
                      {
                          bootSynced = true;
                          int ttlMs = Plugin.BacklogTtlMs == null ? 20000 : Mathf.Clamp(Plugin.BacklogTtlMs.Value, 0, 600000);
                          bootSkipAtMs = NowUnixMs() - ttlMs;
                          if (headSeq > 0) Plugin.Log.LogInfo("pull: startup sync, drop backlog older than " + ttlMs + "ms (seq=" + headSeq + ", local seq=" + feedSeq + ")");
                      }`
  s = s.replace(oldBlock, newBlock)
  // 字段
  if (!s.includes('private long bootSkipAtMs')) {
    s = s.replace('        private bool bootSynced;', `        private bool bootSynced;
        // 首次拉取时的年龄门槛：比它更旧的条目算上次会话的旧账，不重播
        private long bootSkipAtMs;`)
    must(s.includes('private long bootSkipAtMs'), '字段插入失败')
  }
  // 工具函数
  if (!s.includes('private static long NowUnixMs()')) {
    s = s.replace('        private void StepClip(float ct)', `        private static long NowUnixMs()
        {
            return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        }

        private void StepClip(float ct)`)
  }
  // 条目循环里按年龄丢
  const loopAnchor = '                          var d = JsonLite.AsDict(items[i]);\n                          if (d == null) continue;\n'
  must(s.includes(loopAnchor), '条目循环锚点未找到')
  s = s.replace(loopAnchor, `                          var d = JsonLite.AsDict(items[i]);
                          if (d == null) continue;
                          // 首次同步门槛：只挡上一次会话的旧账
                          if (bootSkipAtMs > 0)
                          {
                              long atMs = JsonLite.Int(JsonLite.Get(d, "at"));
                              if (atMs > 0 && atMs < bootSkipAtMs)
                              {
                                  if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("pull: drop stale cue at=" + atMs + " (older than " + bootSkipAtMs + ")");
                                  continue;
                              }
                          }
`)
  // 配置项
  if (!s.includes('internal static ConfigEntry<int> BacklogTtlMs;')) {
    s = s.replace('        internal static ConfigEntry<float> SpeedCap;', `        internal static ConfigEntry<int> BacklogTtlMs;
        internal static ConfigEntry<float> SpeedCap;`)
    s = s.replace('            SpeedCap = Config.Bind("motion", "SpeedCap"', `            BacklogTtlMs = Config.Bind("interop", "BacklogTtlMs", 20000, "On the first pull after the game starts, cues older than this many ms are treated as last session's leftovers and dropped. Newer ones still play, so a push made just before startup is not swallowed.");
            SpeedCap = Config.Bind("motion", "SpeedCap"`)
  }
  writeFileSync(p, s, 'utf8')
  console.log('  ✓ PerformerPlugin.cs：backlog 改为按年龄丢弃')
}
