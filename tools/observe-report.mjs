#!/usr/bin/env node
/**
 * 把 observe.mjs 的采样文件整理成一份可读报告（markdown）。
 *
 * 对齐方式：侧车下发的每条 cue 都带 seq，游戏端 `queue: play seq=N` 也带 seq——
 * 用它对账"发出去 vs 真的播了"，比按时间窗口猜准。
 *
 * 用法：node tools/observe-report.mjs data/observe/observe-XXX.ndjson [--out 报告.md]
 */
import { readFileSync, writeFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('用法：node tools/observe-report.mjs <observe-*.ndjson> [--out 报告.md]')
  process.exit(1)
}
const outIx = process.argv.indexOf('--out')
const outPath = outIx > 0 ? process.argv[outIx + 1] : file.replace(/\.ndjson$/, '-report.md')

const rows = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
const first = rows[0] || { t: '' }
const last = rows[rows.length - 1] || { t: '' }

// ── 采集 ──────────────────────────────────────────────────────────────
const acts = []
const cueRows = []
const testRows = []
const gateRows = []
const playSeqs = []
const warns = []
const health = []

for (const r of rows) {
  if (r.act) acts.push(Object.assign({ at: r.t, el: r.el }, r.act))
  for (const l of r.cueNew || []) { try { cueRows.push(JSON.parse(l)) } catch { /* 截断行 */ } }
  for (const l of r.cueTestNew || []) { try { testRows.push(JSON.parse(l)) } catch { /* 同上 */ } }
  for (const l of r.gateNew || []) { try { gateRows.push(JSON.parse(l)) } catch { /* 同上 */ } }
  for (const l of r.gamePlay || []) {
    const m = l.match(/play seq=(\d+)/)
    if (m) playSeqs.push(Number(m[1]))
  }
  for (const l of r.gameWarn || []) warns.push({ at: r.t, line: l.trim().slice(0, 160) })
  if (r.health) health.push({ at: r.t, el: r.el, ...r.health })
}

const seqs = (list) => list.map((c) => Number(c.seq)).filter((n) => Number.isFinite(n))
const sentTest = seqs(testRows)
const sentReal = seqs(cueRows)
const played = new Set(playSeqs)
const sentAll = [...sentReal, ...sentTest]
// 窗口尾巴：最后 90 秒内下发的 cue，游戏端可能还没来得及 play 就被窗口截断。
// 原来这些会被算成"发了但没播"，是误报（实测 seq 1795184503 就是这样被冤枉的）。
const tailCut = new Date(new Date(last.t).getTime() - 90 * 1000).toISOString()
const sentNearTail = new Set([...testRows, ...cueRows]
  .filter((c) => String(c.t || '') >= tailCut)
  .map((c) => Number(c.seq)))
const missedAll = sentAll.filter((s) => !played.has(s))
const missed = missedAll.filter((s) => !sentNearTail.has(s))
const missedTail = missedAll.filter((s) => sentNearTail.has(s))
const playedNotSent = [...played].filter((s) => !sentAll.includes(s))

// ── 统计 ──────────────────────────────────────────────────────────────
const okActs = acts.filter((a) => a.status === 200 && a.seq != null)
const badActs = acts.filter((a) => !(a.status === 200 && a.seq != null))
const lat = okActs.map((a) => a.ms).sort((a, b) => a - b)
const zeroCue = okActs.filter((a) => (a.cues || []).length === 0)
const fallback = okActs.filter((a) => (a.cues || []).some((c) => /兜底/.test(c.why || '')))
const rewritten = gateRows.filter((g) => Array.isArray(g.changed) && g.changed.length)
const famCount = {}
for (const a of okActs) for (const c of a.cues || []) {
  if (c.slot !== 'animations' || !c.id) continue
  const key = String(c.id).replace(/^anim_/, '').split('_').slice(0, 2).join('_')
  famCount[key] = (famCount[key] || 0) + 1
}
const onlineGaps = []
let prevOnline = health.length ? health[0].gameOnline : null
// 单调性：同一个动作 id 连着出现几轮。观察期实锤过"8 次演出 5 次同一个 nod"，
// 这件事必须一眼看出来，不能靠人事后数日志。
const streak = []
let lastId = ''
let run = 0
for (const a of okActs) {
  const ids = (a.cues || []).filter((c) => c.slot === 'animations' && c.id).map((c) => c.id)
  const id = ids[0] || ''
  if (id && id === lastId) { run += 1; streak[streak.length - 1] = { id, n: run } }
  else if (id) { run = 1; streak.push({ id, n: 1 }); lastId = id }
  else { run = 0; lastId = '' }
}
const longestRun = streak.reduce((m, s) => (s.n > m.n ? s : m), { id: '', n: 0 })
// 表情通道：专注期她只能靠脸说话，这里单列一栏
const faceCount = {}
for (const a of okActs) for (const c of a.cues || []) {
  if (c.slot === 'facial' && c.id) faceCount[c.id] = (faceCount[c.id] || 0) + 1
}
for (const h of health) {
  if (prevOnline === true && h.gameOnline === false) onlineGaps.push({ at: h.at, el: h.el, what: '掉线' })
  if (prevOnline === false && h.gameOnline === true) onlineGaps.push({ at: h.at, el: h.el, what: '恢复' })
  prevOnline = h.gameOnline
}
const staleCount = health.filter((h) => h.gameStale).length
const errCount = warns.filter((w) => /\[Error|Exception/.test(w.line)).length

const p = (n) => (lat.length ? lat[Math.min(lat.length - 1, Math.max(0, n))] : 0)
const md = []
md.push('# 观察期报告')
md.push('')
md.push(`- 采样文件：\`${file}\``)
md.push(`- 时间：${first.t} → ${last.t}（${rows.length} 次采样）`)
md.push(`- 主动演出：${acts.length} 次（成功 ${okActs.length}，失败 ${badActs.length}）`)
md.push('')
md.push('## 一、发出去 vs 真的播了')
md.push('')
md.push(`| 项 | 数 |`)
md.push(`| --- | --- |`)
md.push(`| 侧车下发（正式 cue.log） | ${sentReal.length} |`)
md.push(`| 侧车下发（sandbox cue.test.log） | ${sentTest.length} |`)
md.push(`| 游戏端 play | ${played.size} |`)
md.push(`| 发了但没播 | ${missed.length}${missed.length ? ' → ' + missed.slice(0, 8).join(', ') : ''} |`)
md.push(`| 窗口尾未等到（最后 90s，正常） | ${missedTail.length}${missedTail.length ? ' → ' + missedTail.slice(0, 8).join(', ') : ''} |`)
md.push(`| 播了但没记录到下发 | ${playedNotSent.length} |`)
md.push('')
md.push('## 二、主动演出的表现')
md.push('')
md.push(`- 端到端耗时：p50 ${p(Math.floor(lat.length / 2))}ms / p90 ${p(Math.floor(lat.length * 0.9))}ms / max ${lat.length ? lat[lat.length - 1] : 0}ms`)
md.push(`- 零动作的轮次：${zeroCue.length}${zeroCue.length ? ' → ' + zeroCue.map((a) => `"${a.text}"`).join('、') : ''}`)
md.push(`- 用了兜底动作：${fallback.length}${fallback.length ? ' → ' + fallback.map((a) => `"${a.text}"(${a.cues.map((c) => c.id).join(',')})`).join('、') : ''}`)
md.push(`- 动作前缀分布：${Object.entries(famCount).map(([k, v]) => k + '×' + v).join('、') || '（无）'}`)
md.push(`- 最长连续重复：${longestRun.n > 1 ? longestRun.id + ' × ' + longestRun.n + ' 轮' : '无（每轮都不一样）'}`)
md.push(`- 表情分布：${Object.entries(faceCount).map(([k, v]) => k + '×' + v).join('、') || '（本轮没有任何表情 cue）'}`)
md.push('')
if (badActs.length) {
  md.push('### 失败的轮次')
  md.push('')
  for (const a of badActs) md.push(`- ${a.at} "${a.text}" → status=${a.status} ${a.error || ''}`)
  md.push('')
}
md.push('## 三、闸门改写了什么')
md.push('')
md.push(`- 被改写的轮次：${rewritten.length}`)
for (const g of rewritten.slice(-8)) {
  const ch = g.changed.map((c) => `${c.from}→${c.to}`).join('；')
  md.push(`- \`${String(g.text || '').slice(0, 20)}\` emotion=${g.emotion} want=${(g.want || []).join('+')}：${ch}`)
}
md.push('')
md.push('## 四、连接与告警')
md.push('')
md.push(`- 心跳过期的采样点：${staleCount} / ${health.length}`)
md.push(`- 在线状态变化：${onlineGaps.length ? onlineGaps.map((g) => `${g.what}@${g.el}s`).join('、') : '无'}`)
md.push(`- 游戏端故障级日志：${errCount}`)
const uniqWarn = [...new Set(warns.map((w) => w.line.replace(/\d+\s*ms|seq=\d+/g, '#')))]
for (const w of uniqWarn.slice(0, 8)) md.push(`  - \`${w}\``)
md.push('')
md.push('## 五、逐轮明细')
md.push('')
md.push('| 时刻 | 台词（她说的） | 情绪 | 动作 | 耗时 | seq |')
md.push('| --- | --- | --- | --- | --- | --- |')
for (const a of acts) {
  const cues = (a.cues || []).map((c) => `${c.id || c.slot}${c.why ? '·' + c.why : ''}`).join('<br>') || '（无）'
  md.push(`| ${a.at.slice(11, 19)} | ${String(a.sub || '').slice(0, 24)} | ${a.emotion || ''} | ${cues} | ${a.ms}ms | ${a.seq ?? '—'} |`)
}
md.push('')

writeFileSync(outPath, md.join('\n'), 'utf8')
console.log(md.slice(0, 40).join('\n'))
console.log('\n报告已写入：' + outPath)
