import { readFileSync, writeFileSync } from 'node:fs'
const p = 'lib/assets.js'
let s = readFileSync(p, 'utf8')

const anchor = "  let text = lines.join('\\n')"
const trunc = "  if (text.length > budget) text = text.slice(0, budget) + '\\n…（清单过长已截断，只能用上面出现过的 id）'"
if (!s.includes(anchor) || !s.includes(trunc)) { console.log('  ! 锚点缺失'); process.exit(1) }

if (!s.includes('const legend =')) {
  s = s.replace(anchor, [
    "  // 类别图例不参与截断：清单常被 budget 切短，图例必须始终在（否则模型不知道 g/p/P/l 是什么）",
    "  const legend = '- 动作类别缩写：g=手势（反应类） p=道具（喝/吃/写/敲键盘/翻书） P=姿态（起身/躺下/伸懒腰/打哈欠） l=位移（走/离座/过去） i=待机循环 u=未分类'",
    anchor,
  ].join('\n'))
}
if (!s.includes("text + '\\n' + legend")) {
  s = s.replace(trunc, trunc + "\n  text = text + '\\n' + legend")
}
writeFileSync(p, s, 'utf8')
console.log('  ✓ 图例已补回，并在截断后追加')
