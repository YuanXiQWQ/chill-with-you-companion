// 分类口径自检：直接用线上那份分类器（lib/motion-class.js），不再自己实现一套。
//
// 为什么重写：旧版用 substring 猜类别，跟 classifyClip 的口径早就分叉了，
// 结果是"检查通过但线上分错"。这里只做两件事——统计分布、跑口径断言。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { classifyClip, isPerformanceClip, MOTION_CLASS } from '../lib/motion-class.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const full = JSON.parse(readFileSync(root + 'game/clips.full.json', 'utf8'))

const names = []
const push = (v) => {
  if (typeof v === 'string') { if (v) names.push(v); return }
  if (Array.isArray(v)) return v.forEach(push)
  if (v && typeof v === 'object') return Object.values(v).forEach(push)
}
// 只认真实 clip id：byFamily 每项是 {family, segs[]}，id = family 或 family_seg
for (const fam of (full.byFamily || [])) { if (!fam || !fam.family) continue; const f = String(fam.family); names.push(f); for (const s of (fam.segs || [])) names.push(f + "_" + s) }

const uniq = [...new Set(names.map((x) => String(x).trim()).filter(Boolean))]
const buckets = new Map()
for (const id of uniq) {
  const cls = classifyClip(id) || 'unknown'
  if (!buckets.has(cls)) buckets.set(cls, [])
  buckets.get(cls).push(id)
}

const ORDER = [
  MOTION_CLASS.GESTURE, MOTION_CLASS.PROP, MOTION_CLASS.POSTURE,
  MOTION_CLASS.LOCOMOTION, MOTION_CLASS.IDLE, 'unknown'
]

console.log('  动作库：' + uniq.length + ' 条\n')
for (const cls of ORDER) {
  const list = buckets.get(cls) || []
  if (!list.length && cls === 'unknown') continue
  const sample = list.slice(0, 3).map((x) => x.replace(/^anim_/, '')).join('  ')
  console.log('  ' + String(cls).padEnd(11) + String(list.length).padStart(4) + '   ' + sample)
}
const known = ORDER.filter((c) => c !== 'unknown').reduce((a, c) => a + (buckets.get(c) || []).length, 0)
console.log('\n  合计：' + uniq.length + ' 条，已归类 ' + known + ' 条，未归类 ' + (uniq.length - known) + ' 条')

// ── 口径断言：把踩过的坑钉住 ──
let pass = 0, fail = 0
const check = (label, ok, actual) => {
  if (ok) { pass++; console.log('  PASS  ' + label) }
  else { fail++; console.log('  FAIL  ' + label + '  ' + String(actual ?? '')) }
}

const cls = (id) => classifyClip(id)
check('点头是手势', cls('anim_story_base001_sub_nod') === MOTION_CLASS.GESTURE, cls('anim_story_base001_sub_nod'))
check('base001 不被当成 base 前缀（看企鹅不是待机）', cls('anim_story_base001_sub_lookpenguin') !== MOTION_CLASS.IDLE, cls('anim_story_base001_sub_lookpenguin'))
check('喝茶是道具', cls('anim_break_tea_sub_drink') === MOTION_CLASS.PROP, cls('anim_break_tea_sub_drink'))
check('打哈欠起手是姿态', cls('anim_break_yawn_1_start') === MOTION_CLASS.POSTURE, cls('anim_break_yawn_1_start'))
check('离座是位移', cls('anim_wild_leavechair_sofa_go') === MOTION_CLASS.LOCOMOTION, cls('anim_wild_leavechair_sofa_go'))
check('场景 base 循环算待机', [cls('anim_break_tea_base_loop'), cls('anim_story_subbase001_base_loop'), cls('anim_break_movie_base_loop')].every((c) => c === MOTION_CLASS.IDLE), [cls('anim_break_tea_base_loop'), cls('anim_break_movie_base_loop')].join(' '))
const probe = uniq.filter((id) => /^(ui|env|fx)_/.test(id))
if (probe.length) {
  check('非表演动画判 false', probe.every((id) => !isPerformanceClip(id)), probe.slice(0, 2).join(' '))
} else {
  check('非表演动画判 false（样本为空，按空过）', true, '')
}
check('空串不崩', cls('') !== undefined, String(cls('')))

console.log('\n  分类口径：' + pass + '/' + (pass + fail) + ' 通过')
process.exit(fail ? 1 : 0)
