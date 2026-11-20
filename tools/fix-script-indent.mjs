import { readFileSync, writeFileSync } from 'node:fs'
const p = 'tools/fix-model-and-backlog.mjs'
let t = readFileSync(p, 'utf8')
// core.js 那段规则的缩进是 4 空格，脚本里的模板串按 6 空格写的，改回来
t = t.replace("const oldLine = `      '按这句话", "const oldLine = `    '按这句话")
const lines = t.split('\n').map((l) => (/^      '(动作先分类|类别必须和|  说到正在喝|  说到要走|拿不准就用 g)/.test(l) ? l.replace(/^ {6}/, '    ') : l))
t = lines.join('\n')
writeFileSync(p, t, 'utf8')
console.log('  ✓ 脚本缩进已对齐')
