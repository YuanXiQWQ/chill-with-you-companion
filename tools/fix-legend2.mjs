import { readFileSync, writeFileSync } from 'node:fs'
const p = 'lib/assets.js'
let s = readFileSync(p, 'utf8')

const anchor = "    let text = lines.join('\\n')"
if (!s.includes(anchor)) { console.log('  ! 找不到 text 组装'); process.exit(1) }

if (!s.includes('const legend =')) {
  const legend = [
    "    // 类别图例不参与截断：清单可能被 budget 切短，图例必须始终在",
    "    const legend = '- 动作类别缩写：g=手势（反应类） p=道具（喝/吃/写/敲键盘/翻书） P=姿态（起身/躺下/伸懒腰/打哈欠） l=位移（走/离座/过去） i=待机循环 u=未分类'",
    "",
  ].join('\n')
  s = s.replace(anchor, legend + anchor)
}

const trunc = "    if (text.length > budget) text = text.slice(0, budget) + '\\n…（清单过长已截断，只能用上面出现过的 id）'"
if (!s.includes(trunc)) { console.log('  ! 找不到截断行'); process.exit(1) }
if (!s.includes("text = text + '\\n' + legend")) s = s.replace(trunc, trunc + "\n    text = text + '\\n' + legend")

writeFileSync(p, s, 'utf8')
console.log('  ✓ 图例已补回并在截断后追加')
