// 她始终坐在椅子上：离座类动作不能被排进表演。
// 这条不是审美问题——表演是"插入"，归还必须落回坐姿；一旦放她离座，
// 归还就没有落点（实测交接 dev 8°），而且离座那几秒她不在画面里。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isOffChair, planSequence } from '../lib/motion-class.js'

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
