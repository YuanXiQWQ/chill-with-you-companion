import { readFileSync, writeFileSync } from 'node:fs'
const p = 'tools/verify-motion.mjs'
let s = readFileSync(p, 'utf8')

const OLD = [
  "  check('三段覆盖说话长度', total >= 6000, 'total=' + total + ' speech=6000')"
].join('\n')
if (!s.includes(OLD)) throw new Error('断言锚点失配')

const NEW = [
  "  // 表演与语音解绑：同一句话，语音 1.5s 与 12s 必须得到同一条表演时间线",
  "  const a = planSequence([{ slot: 'animations', id: FAM + '_start', at: 0 }], { text: '喝口水', speechMs: 1500 })",
  "  const b = planSequence([{ slot: 'animations', id: FAM + '_start', at: 0 }], { text: '喝口水', speechMs: 12000 })",
  "  const tl = (r) => r.cues.filter((c) => c.slot === 'animations').map((c) => c.id + '@' + c.at + '+' + c.durationMs).join('|')",
  "  check('表演时间线与语音时长无关', tl(a) === tl(b), tl(a) + '  vs  ' + tl(b))",
  "  check('loop 只走一拍（不按语音重复）', a.cues.filter((c) => /_loop2?$/.test(c.id)).length === 1, String(a.cues.filter((c) => /_loop2?$/.test(c.id)).length))"
].join('\n')
s = s.replace(OLD, NEW)
s = s.replace('// ── ③ 编排：三段展开要按说话长度铺满，且时长不被压缩 ──', '// ── ③ 编排：三段展开按游戏自己的节奏，与语音时长解绑 ──')
writeFileSync(p, s, 'utf8')
console.log('  ✓ 断言改为"与语音无关"')
