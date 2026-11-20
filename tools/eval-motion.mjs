// 端到端评测：跑真模型，统计"类别对 / 内容对"，别用单次目测当结论。
// 用法：node tools/eval-motion.mjs [每例重复次数]
import { classifyClip } from '../lib/motion-class.js'

const B = 'http://127.0.0.1:10722/chill/v1'
const REPS = Number(process.argv[2]) || 3
const CASES = [
  { text: '我写代码写得有点累，先喝口水', cls: 'prop', verb: 'drink' },
  { text: '我困得不行了，伸个懒腰', cls: 'posture', verb: 'yawn|stretch' },
  // 她始终坐在椅子上：离座意图的正确结果是「不安排表演」，所以期望类别是 none（2026-11-15）
  { text: '我先去趟便利店，等我一下', cls: 'none', verb: null },
  { text: '对，就按这个来，同意', cls: 'gesture', verb: 'nod' },
  { text: '这段报告我还没写完，有点烦', cls: 'prop', verb: 'write|report|pc|typing' },
  { text: '今天天气不错啊', cls: null, verb: null }
]

const rows = []
for (const c of CASES) {
  for (let i = 0; i < REPS; i += 1) {
    const t0 = Date.now()
    let body
    try {
      const res = await fetch(B + '/act', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: c.text, sandbox: true }),
        signal: AbortSignal.timeout(120000)
      })
      body = await res.json()
    } catch (error) {
      rows.push({ ...c, ok: false, clsOk: false, verbOk: false, got: 'ERROR ' + String(error?.message || error), ms: Date.now() - t0 })
      continue
    }
    const anims = (body.performance || []).filter((x) => x.slot === 'animations')
    const ids = anims.map((x) => String(x.id || ''))
    const classes = ids.map((id) => classifyClip(id))
    // cls:'none' = 这段不该有表演（离座意图），必须是 0 条动作
  const clsOk = c.cls === 'none' ? classes.length === 0
    : c.cls === null ? classes.length > 0
      : classes.includes(c.cls)
    const verbOk = c.verb === null ? true : ids.some((id) => new RegExp(c.verb).test(id))
    rows.push({
      text: c.text,
      cls: c.cls,
      got: ids.map((id) => id.replace(/^anim_/, '')).join(' ') || '(空)',
      clsOk,
      verbOk,
      ms: Date.now() - t0
    })
  }
}

const n = rows.length
const clsPass = rows.filter((r) => r.clsOk).length
const verbPass = rows.filter((r) => r.verbOk).length
const both = rows.filter((r) => r.clsOk && r.verbOk).length
const avgMs = Math.round(rows.reduce((a, r) => a + (r.ms || 0), 0) / n)

console.log('  文本 / 期望类别 / 实得 / 类别 / 内容')
for (const r of rows) {
  console.log(`  ${r.clsOk && r.verbOk ? '✓' : '✗'} ${String(r.text).slice(0, 14).padEnd(15)} ${String(r.cls || '—').padEnd(11)} ${String(r.got).slice(0, 46).padEnd(47)} ${r.clsOk ? '类别✓' : '类别✗'} ${r.verbOk ? '内容✓' : '内容✗'}`)
}
console.log(`\n  样本 ${n} 例（${CASES.length} 场景 × ${REPS} 次）  类别 ${clsPass}/${n} (${Math.round((clsPass / n) * 100)}%)  内容 ${verbPass}/${n} (${Math.round((verbPass / n) * 100)}%)  两者 ${both}/${n}  平均 ${avgMs}ms`)
process.exit(both === n ? 0 : 1)
