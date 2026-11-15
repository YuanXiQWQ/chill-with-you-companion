import { readFileSync, writeFileSync } from 'node:fs'
const p = 'brain.mjs'
let s = readFileSync(p, 'utf8')

// ① 模块级"上一段表演"记忆 + 两个取值函数（避免调用点各自找 state）
if (!s.includes('function perfFamily()')) {
  const anchor = '  function chainStartToLoop(list, durMs, subtitleLen, lastFamily, sinceLastMs) {'
  if (!s.includes(anchor)) throw new Error('anchor 失配')
  s = s.replace(anchor, [
    '  // 「她刚才在做什么」——编排要用它决定"继续做"还是"重新进入"。',
    '  // 放模块级是故意的：sandbox 与正式轮次共享同一个身体，不能用两套记忆。',
    '  const perfMemo = { family: "", at: 0 }',
    '  function perfFamily() { return perfMemo.family || "" }',
    '  function perfAge() { return perfMemo.at ? Date.now() - perfMemo.at : Infinity }',
    '  function notePerf(id) {',
    '    try {',
    '      const fam = familyOf(String(id || ""))',
    '      if (fam) perfMemo.family = fam',
    '      perfMemo.at = Date.now()',
    '    } catch { }',
    '  }',
    '',
    anchor
  ].join('\n'))
}

// ② 调用点用取值函数
s = s.replace('), actDurMs, actChars, lastPerfFamily, lastPerfAge)', '), actDurMs, actChars, perfFamily(), perfAge())')
s = s.replace('    ), durMs, subtitleLen)', '    ), durMs, subtitleLen, perfFamily(), perfAge())')

// ③ 编排完记下主段家族（两处出参都记）
if (!s.includes('notePerf(')) throw new Error('notePerf 未注入')
s = s.replace("        const act = buildAct(parsed, {", [
  "        // 记下这轮演了什么家族，下一句据此决定延续还是重开",
  "        try { const prim = (actCues || []).find((c) => c.slot === 'animations'); if (prim) notePerf(prim.id) } catch { }",
  "        const act = buildAct(parsed, {"
].join('\n'))

writeFileSync(p, s, 'utf8')
console.log('  ✓ 上一段表演记忆接上（perfMemo）')
