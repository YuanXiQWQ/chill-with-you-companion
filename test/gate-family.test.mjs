// 内容类闸门（enforceContentClass）挑候选时，必须先按她此刻的姿势族预筛。
//
// 起因（15 分钟 break 期观察）：她坐在沙发上看书（BreakBase002），
// 「眼睛有点干，等我揉一下」被判成 want=locomotion，闸门从整张清单里挑中
// anim_wild_leavechair_cupcake_comeback_start —— 一个起身走开的三段式。
// 跨族动作随后在 applyFamily 里被整条丢掉，那一轮就退化成"兜底动作"，
// 日志看起来像"闸门改对了"，实际什么都没演。
//
// 判据：同族候选优先；本族压根没有这个类别的动作时，允许跨族（applyFamily 兜着），
// 但不能因为"族里没有"就整轮不动。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enforceContentClass } from '../lib/motion-class.js'

// 最小清单：三个族，每族给一条符合 locomotion / prop 的动作
const manifest = {
  animations: [
    { id: 'anim_wild_leavechair_cupcake_comeback_start', durationMs: 3000, semantic: ['cupcake', 'comeback'] },
    { id: 'anim_break_novel_sub_pageflip_start', durationMs: 2400, semantic: ['pageflip', 'novel'] },
    { id: 'anim_break_tea_sub_drink_start', durationMs: 2000, semantic: ['drink', 'tea'] },
    { id: 'anim_story_base001_sub_nod', durationMs: 2100, semantic: ['nod'] },
  ],
}

const cueOf = (id) => [{ slot: 'animations', id, at: 0 }]

test('闸门挑候选时不会挑到别的姿势族', () => {
  // 她在看书：want=locomotion，本族（BreakBase002）没有 locomotion 动作
  const r = enforceContentClass(cueOf('anim_story_base001_sub_nod'), {
    text: '眼睛有点干，等我揉一下',
    manifest,
    family: 'BreakBase002',
  })
  if (r.picked) {
    assert.ok(
      !/wild|leavechair/.test(r.picked),
      `挑了跨族的 ${r.picked}：本族有动作时不该跨族`,
    )
  }
})

test('本族没有这个类别时，宁可不动也不硬塞跨族动作', () => {
  // BreakBase002 只有 pageflip（prop），没有 locomotion
  const r = enforceContentClass(cueOf('anim_story_base001_sub_nod'), {
    text: '眼睛有点干，等我揉一下',
    manifest,
    family: 'BreakBase002',
  })
  // 要么不换（changed 为空），要么换成同族；不许换成 wild
  assert.ok(!r.changed.some((c) => /wild|leavechair/.test(c.to)),
    '不允许换成跨族动作：' + JSON.stringify(r.changed))
})

test('不传 family 时行为不变（老调用方仍然能挑）', () => {
  const r = enforceContentClass(cueOf('anim_story_base001_sub_nod'), {
    text: '眼睛有点干，等我揉一下',
    manifest,
  })
  assert.ok(Array.isArray(r.cues) && r.cues.length === 1)
})

test('同族有对应动作时优先挑同族', () => {
  const r = enforceContentClass(cueOf('anim_story_base001_sub_nod'), {
    text: '喝口茶',
    manifest,
    family: 'BreakBase004',
  })
  if (r.picked) assert.match(r.picked, /break_tea/, '同族有 drink 动作时不该挑别的族：' + r.picked)
})
