// 核心动作机制：「这句话的核心行为是什么」→ 以它为主体编一整套。
// 起因：「有点渴了」曾经演成打哈欠——模型把"喝"和"困"都当成身体反应。
// 这里先用语句判核心，判出来就把整段锁在一个族上：起手 → 核心 → 收尾。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideCore, buildSuite, CORES } from '../lib/core-action.js'
import { planSequence } from '../lib/motion-class.js'

test('语句能认出核心行为，且喝不会被认成困', () => {
  assert.equal(decideCore('我有点渴了，喝口水').core.verb, 'drink')
  assert.equal(decideCore('我困得不行了').core.verb, 'yawn')
  assert.equal(decideCore('我先去写代码了').core.verb, 'work_pc')
  assert.equal(decideCore('帮我按这个来，同意').core.verb, 'nod')
  assert.equal(decideCore('好害羞').core.verb, 'shy')
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

test('核心动作编成一整套：起手 → 核心 → 收尾', () => {
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
  for (const c of CORES) assert.ok(!/leavechair|walk|standup/.test(c.family), c.verb + ' 指向离座族: ' + c.family)
})
test('状态类核心不塞起手小动作（累瘫了先调皮一下反而怪）', () => {
  const cues = [{ slot: 'animations', id: 'anim_story_subbase001_sub_fun', at: 0 }]
  const r = buildSuite(cues, '我累瘫了')
  assert.equal(r.core.verb, 'tired')
  assert.deepEqual(r.suite.map((c) => c.role), ['core'], '只有核心，没有 pre')
})