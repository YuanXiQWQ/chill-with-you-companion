// 她始终坐在椅子上：离座类动作不能被排进表演。
// 这条不是审美问题——表演是"插入"，归还必须落回坐姿；一旦放她离座，
// 归还就没有落点（实测交接 dev 8°），而且离座那几秒她不在画面里。
//
// 另外：每轮编排之前先看她此刻在播什么。判据只能用 live（游戏 Animator 当前 clip），
// 不能用 base —— base 是"我们上次演过的家族"，会一直挂在旧值上，用它必然永久误判。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isOffChair, offSeatIdle, seatGuard, planSequence } from '../lib/motion-class.js'

const OFF = [
  'anim_wild_leavechair_cup_go',
  'anim_wild_leavechair_cupcake_comeback_start',
  'anim_wild_leavechair_sofa_loop',
  'anim_wild_walk_idle',
  'anim_wild_standup_normal'
]
const ON = [
  'anim_story_base001_sub_nod',
  'anim_break_tea_sub_drink_loop',
  'anim_wild_stretchshoulder',
  'anim_story_subbase001_sub_shy'
]

test('isOffChair 认得出离座/走动', () => {
  for (const id of OFF) assert.equal(isOffChair(id), true, id + ' 应判为离座')
  for (const id of ON) assert.equal(isOffChair(id), false, id + ' 不该判为离座')
})

test('planSequence 不排离座，只留坐姿动作', () => {
  const cues = [
    { slot: 'animations', id: 'anim_wild_leavechair_cup_go', at: 0 },
    { slot: 'animations', id: 'anim_story_base001_sub_nod', at: 0 },
    { slot: 'subtitle', id: 'x' }
  ]
  const out = planSequence(cues, { text: '我去拿个纸杯' })
  const ids = out.cues.filter((c) => c.slot === 'animations').map((c) => c.id)
  assert.ok(!ids.some((id) => isOffChair(id)), '仍有离座动作: ' + ids.join(','))
  assert.ok(ids.includes('anim_story_base001_sub_nod'), '坐姿动作被误删')
  assert.ok(out.cues.some((c) => c.slot === 'subtitle'), '非动画 cue 不能被吞')
})

test('全部是离座时不产出动画', () => {
  const out = planSequence([
    { slot: 'animations', id: 'anim_wild_leavechair_sofa_go', at: 0 },
    { slot: 'animations', id: 'anim_wild_leavechair_sofa_comeback', at: 0 }
  ], { text: '我去沙发上躺一下' })
  assert.equal(out.cues.filter((c) => c.slot === 'animations').length, 0)
})

test('offSeatIdle：只有真离座才不编排，坐姿待机不误判', () => {
  assert.equal(offSeatIdle({ motion: { live: 'anim_break_movie_base_loop' } }), '')
  assert.equal(offSeatIdle({ motion: { live: 'anim_story_base001' } }), '')
  assert.equal(offSeatIdle({}), '')
  assert.equal(offSeatIdle(null), '')
  // 陈旧的 base 绝不能触发拦截（它是"上次演过的家族"，不是"现在在播什么"）
  assert.equal(offSeatIdle({ motion: { base: 'anim_wild_leavechair_sofa', live: 'anim_break_movie_base_loop' } }), '')
  assert.equal(offSeatIdle({ motion: { live: 'anim_wild_leavechair_sofa_loop' } }), 'anim_wild_leavechair_sofa_loop')
  // 我们自己正在插离座，也算离座中
  assert.equal(offSeatIdle({ motion: { active: 'anim_wild_leavechair_cup_go' } }), 'anim_wild_leavechair_cup_go')
  // 兼容把整包 /game 响应传进来的形态
  assert.equal(offSeatIdle({ game: { motion: { live: 'anim_wild_leavechair_cupcake_comeback_start' } } }), 'anim_wild_leavechair_cupcake_comeback_start')
})
test('seatGuard：离座时整段不排动作，字幕留着', () => {
  const cues = [
    { slot: 'animations', id: 'anim_story_base001_sub_nod', at: 0 },
    { slot: 'subtitle', text: '我在这儿' }
  ]
  const seated = seatGuard(cues, { motion: { live: 'anim_break_movie_base_loop' } })
  assert.equal(seated.skipped, '')
  assert.equal(seated.cues.filter((c) => c.slot === 'animations').length, 1)
  const away = seatGuard(cues, { motion: { live: 'anim_wild_leavechair_sofa_loop' } })
  assert.equal(away.skipped, 'anim_wild_leavechair_sofa_loop')
  assert.equal(away.cues.filter((c) => c.slot === 'animations').length, 0, '离座时必须零动作')
  assert.equal(away.cues.filter((c) => c.slot === 'subtitle').length, 1, '字幕不能被吞')
})
