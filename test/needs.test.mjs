// 需求层：一句话 → 她欠世界哪几件事。
// 这一层是"谁要做什么"的唯一判决处，以前散在 buildSuite / HIS_BODY / REACT_OK
// 三处，改一处忘一处。测试按"人的直觉"写：看到这句话，她该不该做这个动作。
import test from 'node:test'
import assert from 'node:assert/strict'
import { extractNeeds, auditNeeds } from '../lib/needs.js'
import { arrange, describeArrangement } from '../lib/arrange.js'

const anims = (r) => r.needs.filter((n) => n.kind !== 'trip')
const fams = (r) => anims(r).map((n) => n.family)
const plan = (t) => {
  const r = extractNeeds({ text: t, cues: [] })
  return arrange(r.needs, { speechMs: 4000, ambient: r.ambient })
}

test('他说自己的身体：不传染的那几类一条都不演', () => {
  for (const t of ['我累瘫了', '我有点渴了', '我肩膀酸', '我趴一会儿']) {
    assert.deepEqual(fams(extractNeeds({ text: t, cues: [] })), [], t)
  }
})

test('会传染的身体反应：他打哈欠，她跟着打', () => {
  // 看见别人打哈欠自己也想打，这不是"抄他的身体"
  assert.ok(fams(extractNeeds({ text: '我困得不行了', cues: [] })).some((f) => /yawn/.test(f)))
  assert.ok(fams(extractNeeds({ text: '我伸个懒腰', cues: [] })).some((f) => /stretch/.test(f)))
  assert.ok(fams(extractNeeds({ text: '我深呼吸一下', cues: [] })).some((f) => /breath/.test(f)))
})

test('说她自己 / 派活 / 没有主语：该演就演', () => {
  assert.ok(fams(extractNeeds({ text: '你困了吧', cues: [] })).some((f) => /yawn/.test(f)))
  assert.ok(fams(extractNeeds({ text: '伸个懒腰吧', cues: [] })).some((f) => /stretch/.test(f)))
  assert.ok(fams(extractNeeds({ text: '帮我倒杯水', cues: [] })).some((f) => /tea_sub_drink/.test(f)))
})

test('他在做事 → 她陪着做，不是抄他', () => {
  const r = extractNeeds({ text: '我写会儿代码，你别管我', cues: [] })
  const n = anims(r)[0]
  assert.equal(n.kind, 'companion')
  assert.match(n.family, /work_pc/)
})

test('主戏 + 第二拍：先喝水，再写代码', () => {
  const a = plan('先喝口水，然后接着写代码')
  assert.match(a.cues[0].id, /tea_sub_drink/)
  assert.match(a.cues[1].id, /work_pc/)
  assert.ok(a.cues[1].at >= a.cues[0].durationMs - 1, '第二拍要排在第一拍之后')
})

test('手势只当起手，内容对不上就不抢开头', () => {
  const good = plan('好耶，这个 bug 终于修好了')
  assert.match(good.cues[0].id, /nod/)
  // 「我累瘫了」既没有核心也没有反应：这一类不传染
  assert.equal(plan('我累瘫了').cues.filter((c) => c.slot === 'animations').length, 0)
})

test('模型给的分段 cue 先合并成基名，一族只出现一次', () => {
  const segs = [
    { slot: 'animations', id: 'anim_break_yawn_1_start', at: 0 },
    { slot: 'animations', id: 'anim_break_yawn_1_loop', at: 0 },
    { slot: 'animations', id: 'anim_break_yawn_1_end', at: 0 },
  ]
  const r = extractNeeds({ text: '你困了吧', cues: segs })
  const list = auditNeeds(r.needs)
  assert.equal(list.filter((n) => /yawn/.test(n.family)).length, 1)
})

test('整句在说他时，模型自己挑的不传染动作也要摘掉', () => {
  const r = extractNeeds({ text: '我累瘫了', cues: [{ slot: 'animations', id: 'anim_wild_tired_start', at: 0 }] })
  assert.deepEqual(fams(r), [])
  assert.ok(r.dropped.some((d) => /不传染/.test(d.why)))
})

test('专注态只动头颈：身体类需求被换掉而不是留空', () => {
  const r = extractNeeds({ text: '你困了吧，伸个懒腰', cues: [], phase: 'focus' })
  // 「排完再删」会让预算全花在不能演的素材上，她像掉线一样；
  // 现在是换成头颈能做的那个（yawn / stretch → nod）。
  assert.deepEqual(fams(r).sort(), ['anim_story_base001_sub_nod'])
  assert.ok(r.notes.some((n) => /专注/.test(n)))
})

test('离座是需求，独占由 arrange 决定', () => {
  const r = extractNeeds({ text: '你去沙发上躺一会儿', cues: [] })
  assert.equal(r.trip.plan, 'Sofa')
  const go = arrange(r.needs, { trip: r.trip, tripGo: true, speechMs: 3000 })
  assert.equal(go.cues.length, 1)
  assert.equal(go.cues[0].slot, 'trip')
  const stay = arrange(r.needs, { trip: r.trip, tripGo: false, speechMs: 3000 })
  assert.ok(stay.notes.some((n) => /拦下/.test(n)), '没放行要说明原因')
})

test('每条需求都带理由，出问题不用猜是哪条规则', () => {
  const r = extractNeeds({ text: '你困了吧', cues: [] })
  assert.ok(r.needs.length > 0)
  for (const n of r.needs) assert.ok(n.why && n.why.length > 3, JSON.stringify(n))
  for (const d of r.dropped) assert.ok(d.why && d.why.length > 3)
})

test('排完的结果能一句话说清', () => {
  const a = plan('先喝口水，然后接着写代码')
  const line = describeArrangement(a.cues)
  assert.match(line, /drink/)
  assert.match(line, /→/)
})
