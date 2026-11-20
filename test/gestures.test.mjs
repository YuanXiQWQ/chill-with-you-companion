// 姿势族查表：跨族播会把她从当前姿势里搬走，所以选动作必须在同一族里选。
// 这些用例锁住三件事：她此刻是哪一族、动作怎么换族、换不出来怎么丢。

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { table, tableError, familyOfState, familyOfClip, gesturesIn, mapGesture, applyFamily } from '../lib/gestures.mjs'

test('动作表能读到，180 条动作分在 19 个族里', () => {
  const t = table()
  assert.equal(tableError(), '')
  assert.ok(t, '表没读到')
  assert.equal(t.total, 180)
  assert.equal(Object.keys(t.families).length, 19)
})

test('她此刻的状态能落到族上', () => {
  assert.equal(familyOfState('BreakMovie'), 'BreakBase001')
  assert.equal(familyOfState('BreakReadBook'), 'BreakBase002')
  assert.equal(familyOfState('BreakTeaTime'), 'BreakBase004')
  assert.equal(familyOfState('BreakListenMusic'), 'BreakBase003')
  // 表里没有这个状态时，退一步看她此刻的动画名前缀
  assert.equal(familyOfState('Whatever', 'WorkBase002_KeyType'), 'WorkBase002')
  assert.equal(familyOfState('Whatever'), '')
})

test('各族里真有的动作能列出来，光秃秃的族名不算动作', () => {
  const tea = gesturesIn('BreakBase004')
  assert.ok(tea.includes('BreakBase004_DrinkTea'))
  assert.ok(tea.every((n) => n.includes('_')))
  assert.deepEqual(gesturesIn('不存在的族'), [])
})

test('clip id 能判断出族', () => {
  assert.equal(familyOfClip('anim_break_tea_sub_drink'), 'BreakBase004')
  assert.equal(familyOfClip('anim_story_base001_sub_shy'), 'Base001')
  assert.equal(familyOfClip('anim_work_pc_sub_thinking'), 'WorkBase002')
  assert.equal(familyOfClip('anim_wild_fidget'), 'Wild')
  assert.equal(familyOfClip(''), '')
})

test('同族原样返回，不折腾', () => {
  assert.equal(mapGesture('BreakBase001_Laugh', 'BreakBase001'), 'BreakBase001_Laugh')
})

test('跨族时优先换成语义对得上的同族动作', () => {
  // 看电影那一族有 Laugh，没有 shy —— 害羞就换成笑，这是那一族里最接近的反应
  assert.equal(mapGesture('Base001_Motion5_Shy', 'BreakBase001'), 'BreakBase001_Laugh')
  // 喝茶那一族有 DrinkTea
  assert.equal(mapGesture('Base001_DrinkTea', 'BreakBase004'), 'BreakBase004_DrinkTea')
  // 看书那一族只有 Interest / NextPage
  assert.equal(mapGesture('Base001_Motion8_Thinking', 'BreakBase002'), 'BreakBase002_Interest')
})

test('同族里没有对得上的动作时退到本族第一个手势，宁可差点也不返回空', () => {
  // 听歌那一族只有 ListenMusicLow/High，害羞没有对应 —— 以前返回空、整条丢掉，
  // 实测代价是专注时她一轮 0 条 cue（站着把台词说完，一点动作都没有）。
  assert.equal(mapGesture('Base001_Motion5_Shy', 'BreakBase003'), 'BreakBase003_ListenMusicLow')
  // 族本身就是空的才返回空（调用方据此丢掉）
  assert.equal(mapGesture('', 'BreakBase001'), '')
  assert.equal(mapGesture('Base001_Motion5_Shy', 'NoSuchFamily'), '')
})

test('整段演出按族改写：换掉能换的，丢掉换不了的，别的族采样不动手', () => {
  const act = {
    performance: [
      { slot: 'animations', id: 'anim_story_base001_sub_shy', nativeName: 'Base001_Motion5_Shy' },
      { slot: 'animations', id: 'anim_break_tea_sub_drink' },
      { slot: 'animations', id: 'anim_wild_fidget' },
      { slot: 'facial', id: 'shy' },
    ],
  }
  const st = applyFamily(act, 'BreakBase001')
  assert.equal(st.mapped, 1)
  assert.equal(act.performance[0].nativeName, 'BreakBase001_Laugh')
  // 喝茶那条没有原生名，clip 属于 BreakBase004 → 整条去掉动作；wild 那条同理
  assert.equal(st.sampledDropped, 2)
  // 表情那条不受影响
  assert.ok(act.performance.some((c) => c.slot === 'facial'))
})

test('宽松开关打开时一律不动', () => {
  const act = { performance: [{ slot: 'animations', id: 'anim_story_base001_sub_shy', nativeName: 'Base001_Motion5_Shy' }] }
  const st = applyFamily(act, 'BreakBase004', { allow: true })
  assert.equal(st.mapped, 0)
  assert.equal(act.performance[0].nativeName, 'Base001_Motion5_Shy')
})
