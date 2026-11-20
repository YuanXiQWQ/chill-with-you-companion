// 动作导演系统：「这句话的核心行为是什么」→ 以它为主体编一整套。
// 起因：「有点渴了」曾经演成打哈欠——模型把"喝"和"困"都当成身体反应。
// 这里先用语句判核心，判出来就把整段锁在一个族上：起手 → 核心 → 收尾。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideCore, buildSuite, ORDERED_ACTIONS } from '../lib/director.js'
import { planSequence } from '../lib/motion-class.js'

test('语句能认出核心行为，且喝不会被认成困', () => {
  assert.equal(decideCore('有点渴了，喝口水').core.verb, 'drink')
  assert.equal(decideCore('困得不行了').core.verb, 'yawn')
  assert.equal(decideCore('我先去写代码了').core.verb, 'work_pc')
  assert.equal(decideCore('帮我按这个来，同意').core.verb, 'nod')
  assert.equal(decideCore('好害羞').core.verb, 'shy')
})

test('他的身体不是她的动作', () => {
  // 前半句"我渴了"和后半句"喝口水"主语都是他 —— 她不该去演喝
  assert.equal(decideCore('我有点渴了，喝口水').core, null)
  assert.equal(decideCore('我困得不行了').core, null)
  assert.equal(decideCore('我要睡一会儿了').core, null)
  // 做事类共享：他说他在写代码，她可以陪着一起来
  assert.equal(decideCore('我先去写代码了').core.verb, 'work_pc')
  assert.equal(decideCore('我看会儿书').core.verb, 'read_book')
})

test('一句话里两件事：核心在前，收尾在后', () => {
  const r = decideCore('先喝口水，然后接着写代码')
  assert.equal(r.core.verb, 'drink')
  assert.equal(r.also[0].verb, 'work_pc')
})

test('认不出动词时不改结构（只认模型给的）', () => {
  const cues = [
    { slot: 'animations', id: 'anim_story_base001_sub_shy', at: 0 },
    { slot: 'subtitle', text: 'x' }
  ]
  const r = buildSuite(cues, '嗯……')
  assert.equal(r.from, 'cue')
  assert.equal(r.suite.length, 0)
  assert.equal(r.cues.filter((c) => c.slot === 'animations').length, 1)
})

test('主戏编成一整套：起手 → 核心 → 收尾', () => {
  const cues = [{ slot: 'animations', id: 'anim_story_base001_sub_nod', at: 0 }]
  const r = buildSuite(cues, '嗯，先喝口水，然后接着写代码')
  const roles = r.suite.map((c) => c.role)
  assert.deepEqual(roles, ['pre', 'core', 'after'])
  assert.equal(r.suite[1].id, 'anim_break_tea_sub_drink')
  assert.equal(r.suite[2].id, 'anim_work_pc_sub_thinking')
  assert.ok(r.suite.every((c) => c.locked === true), '整套必须锁定顺序')
})

test('手势类核心不追加起手/收尾（一点头就是一整句）', () => {
  const cues = [{ slot: 'animations', id: 'anim_break_tea_base', at: 0 }]
  const r = buildSuite(cues, '嗯，我同意')
  assert.equal(r.suite.length, 1)
  assert.equal(r.suite[0].role, 'core')
  assert.equal(r.suite[0].id, 'anim_story_base001_sub_nod')
})

test('锁定的一整套不会被 planSequence 重排', () => {
  const r = buildSuite([{ slot: 'animations', id: 'anim_story_base001_sub_nod', at: 0 }], '嗯，先喝口水，然后接着写代码')
  const planned = planSequence(r.cues, { text: '嗯，先喝口水，然后接着写代码', currentLayer: 'break' })
  const ids = planned.cues.filter((c) => c.slot === 'animations').map((c) => c.id)
  assert.deepEqual(ids, ['anim_story_base001_sub_nod', 'anim_break_tea_sub_drink', 'anim_work_pc_sub_thinking'])
})

test('核心表里的族都不是离座族', () => {
  for (const c of ORDERED_ACTIONS) assert.ok(!/leavechair|walk|standup/.test(c.family), c.verb + ' 指向离座族: ' + c.family)
})
test('状态类核心不塞起手小动作（累瘫了先调皮一下反而怪）', () => {
  const cues = [{ slot: 'animations', id: 'anim_story_subbase001_sub_fun', at: 0 }]
  const r = buildSuite(cues, '累瘫了')
  assert.equal(r.core.verb, 'tired')
  assert.deepEqual(r.suite.map((c) => c.role), ['core'], '只有核心，没有 pre')
})

test('模型自己挑的"他身体"动作也要摘掉', () => {
  const yawn = [{ slot: 'animations', id: 'anim_break_yawn_1_start', at: 0 }]
  // 整句在说他 → 打哈欠这条不该留（实测模型会自己挑）
  assert.deepEqual(buildSuite(yawn, '我困得不行了').cues, [])
  // 说他之外的情况照旧
  assert.equal(buildSuite(yawn, '你困得不行了吧').cues.length, 1)
  // 做事类是陪伴，不摘
  const pc = [{ slot: 'animations', id: 'anim_work_pc_sub_thinking_start', at: 0 }]
  assert.equal(buildSuite(pc, '我写会儿代码，你别管我').cues.length, 1)
  // 派活句式（帮我…）不算在说他
  assert.equal(buildSuite(yawn, '帮我看看这个，我都困了').cues.length, 1)
})

test('分段 cue 合并成一条，别在演出开头抽一下', () => {
  // 游戏端收到分段 cue 只能播那一段，三段之间各归还一次姿势 → 张嘴/收回/张嘴
  const segs = [
    { slot: 'animations', id: 'anim_break_yawn_1_start', at: 0, durationMs: 2333 },
    { slot: 'animations', id: 'anim_break_yawn_1_loop', at: 0, durationMs: 2000 },
    { slot: 'animations', id: 'anim_break_yawn_1_end', at: 0, durationMs: 3000 },
  ]
  const anims = buildSuite(segs, '随便说句话').cues.filter((c) => c.slot === 'animations')
  assert.equal(anims.length, 1, '三条段合成一条')
  assert.equal(anims[0].id, 'anim_break_yawn_1', '保留基名，让游戏端自己拼组')
  assert.equal(anims[0].durationMs, 3000, '时长取最长那一段')
  // 不是分段的原样留着
  const one = [{ slot: 'animations', id: 'anim_story_base001_sub_nod', at: 0 }]
  assert.equal(buildSuite(one, '嗯').cues.filter((c) => c.slot === 'animations').length, 1)
  // 别的槽位不受影响
  const mixed = [
    { slot: 'animations', id: 'anim_break_yawn_1_start', at: 0 },
    { slot: 'emotions', id: 'Sleepy', at: 0 },
  ]
  assert.equal(buildSuite(mixed, '嗯').cues.filter((c) => c.slot === 'emotions').length, 1)
})
