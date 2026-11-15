import { readFileSync, writeFileSync } from 'node:fs'
const p = 'lib/assets.js'
let s = readFileSync(p, 'utf8')
if (!s.includes('- 动作类别缩写')) { console.log('  · 已无图例行'); process.exit(0) }

// 把图例从 lines 里摘出来，改成截断之后再追加，保证它不会被 budget 切掉
s = s.replace(/\n[ \t]*\/\/ 类别缩写说明必须跟着清单走[^\n]*\n[ \t]*lines\.push\('- 动作类别缩写[^\n]*'\)\n/, '\n')

const anchor = "    let text = lines.join('\\n')"
if (!s.includes(anchor)) { console.log('  ! 找不到 text 组装'); process.exit(1) }
const legend = [
  "    // 类别图例不参与截断：清单可能被 budget 切短，图例必须始终在",
  "    const legend = '- 动作类别缩写：g=手势（反应类） p=道具（喝/吃/写/敲键盘/翻书） P=姿态（起身/躺下/伸懒腰/打哈欠） l=位移（走/离座/过去） i=待机循环 u=未分类'",
  "",
].join('\n')
s = s.replace(anchor, legend + anchor)

const trunc = "    if (text.length > budget) text = text.slice(0, budget) + '\\n…（清单过长已截断，只能用上面出现过的 id）'"
if (!s.includes(trunc)) { console.log('  ! 找不到截断行'); process.exit(1) }
s = s.replace(trunc, trunc + "\n    text = text + '\\n' + legend")
writeFileSync(p, s, 'utf8')
console.log('  ✓ 图例改为截断后追加')
