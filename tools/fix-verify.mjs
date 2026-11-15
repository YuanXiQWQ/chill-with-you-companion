// 验证脚本的断言要跟着真实数据走：别把"我以为的规模"当判据。
import { readFileSync, writeFileSync } from 'node:fs'
const p = 'tools/verify-motion.mjs'
let s = readFileSync(p, 'utf8')

// ① 语法表规模：223 个家族 / 389 条动作，三段式 48 个（实测）
s = s.replace("check('语法表规模', Object.keys(grammar.families).length > 300, String(Object.keys(grammar.families).length))",
  "check('家族规模 223', Object.keys(grammar.families).length === 223, String(Object.keys(grammar.families).length))\n" +
  "check('三段式家族 48', Object.values(grammar.families).filter((f) => f.segs.includes('start') && (f.segs.includes('loop') || f.segs.includes('loop2')) && f.segs.includes('end')).length === 48, String(Object.values(grammar.families).filter((f) => f.segs.includes('start') && (f.segs.includes('loop') || f.segs.includes('loop2')) && f.segs.includes('end')).length))")

// ② 段时长：drink 单段 1833、loop 1167、end 1167（按段取，不许张冠李戴）
s = s.replace("check('duration 来自游戏', durationOf('anim_break_tea_sub_drink') === 1833, String(durationOf('anim_break_tea_sub_drink')))",
  "check('duration 单段段值', durationOf('anim_break_tea_sub_drink') === 1833, String(durationOf('anim_break_tea_sub_drink')))\n" +
  "check('duration 按段区分', durationOf('anim_break_tea_sub_drink_end') === 1167 && durationOf('anim_break_tea_sub_drink_loop') === 1167, durationOf('anim_break_tea_sub_drink_end') + '/' + durationOf('anim_break_tea_sub_drink_loop'))")

// ③ 三段展开用真的三段式家族；drink 没有 start，只能单段演（这是数据事实，不是 bug）
const tripleFam = (() => {
  const g = JSON.parse(readFileSync('lib/game-grammar.json', 'utf8'))
  const k = Object.keys(g.families).find((f) => {
    const segs = g.families[f].segs
    return segs.includes('start') && (segs.includes('loop') || segs.includes('loop2')) && segs.includes('end')
  })
  return k
})()
const oldTriple = s.slice(s.indexOf('// ── ③ 编排：三段展开'), s.indexOf('// ── ④ 编排：层切换'))
const newTriple = `// ── ③ 编排：三段展开要按说话长度铺满，且时长不被压缩 ──
{
  const FAM = '${tripleFam}'
  const r = planSequence([{ slot: 'animations', id: FAM + '_start', at: 0 }], { text: '喝口水', speechMs: 6000 })
  const ids = r.cues.filter((c) => c.slot === 'animations').map((c) => c.id)
  const total = r.cues.filter((c) => c.slot === 'animations').reduce((a, c) => Math.max(a, c.at + c.durationMs), 0)
  check('真三段式展开 start→loop×n→end', ids[0] === FAM + '_start' && ids[ids.length - 1] === FAM + '_end' && ids.filter((x) => x === FAM + '_loop' || x === FAM + '_loop2').length >= 1, ids.map((x) => x.replace(FAM, 'T')).join(' '))
  check('三段覆盖说话长度', total >= 6000, 'total=' + total + ' speech=6000')
  check('段时长逐个取自游戏', r.cues[0].durationMs === durationOf(FAM + '_start'), 'start=' + r.cues[0].durationMs + ' 表=' + durationOf(FAM + '_start'))
  // 没有 start 段的家族（drink）只能单段演，不许凭空造 _start
  const r2 = planSequence([{ slot: 'animations', id: 'anim_break_tea_sub_drink', at: 0 }], { text: '喝口水', speechMs: 6000 })
  const ids2 = r2.cues.filter((c) => c.slot === 'animations').map((c) => c.id)
  check('无 start 的家族不造段', ids2.every((id) => !id.endsWith('_start')), ids2.join(' '))
}

`
s = s.replace(oldTriple, newTriple)
writeFileSync(p, s, 'utf8')
console.log('  ✓ 验证脚本断言对齐真实数据（三段式样本家族: ' + tripleFam + '）')
