import fs from 'node:fs'

// 仓库根现算：发布体检不允许代码里出现字面量盘符。
const ROOT = process.env.CHILL_REPO || new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const src = fs.readFileSync(ROOT + '/data/anim-types.txt', 'utf8')
const rows = src
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => /^[A-Za-z_0-9]+=\d+$/.test(l))
  .map((l) => {
    const i = l.lastIndexOf('=')
    return { name: l.slice(0, i), num: Number(l.slice(i + 1)) }
  })

if (rows.length < 200) {
  console.error('解析太少: ' + rows.length)
  process.exit(1)
}

const groups = new Map()
for (const r of rows) {
  const us = r.name.indexOf('_')
  const g = us > 0 ? r.name.slice(0, us) : r.name
  if (!groups.has(g)) groups.set(g, [])
  groups.get(g).push(r)
}

const parts = []
parts.push('# 游戏原生动作全表（`Bulbul.HeroineService+AnimationType`）')
parts.push('')
parts.push('来源：运行时反射 `enum HeroineService` 全量导出（`data/anim-types.txt`），共 ' + rows.length + ' 个值。')
parts.push('这些是**游戏自己会做的动作**，通过 `HeroineService.ChangeAnimation(AnimationType)` 触发。')
parts.push('')
parts.push('> 命名规则：`<基底>_<子动作>`。同一个子动作在不同基底下各实现一遍，姿势基准不同——')
parts.push('> 比如 `DrinkTea` 在 BreakBase004 / WorkBase001 / WorkBase002 / WorkBase003 里都有。')
parts.push('> 完整矩阵见 [游戏动作组合模型.md](./游戏动作组合模型.md)。')
parts.push('')

for (const [g, list] of groups) {
  parts.push('## ' + g + '（' + list.length + '）')
  parts.push('')
  for (const r of list) parts.push('- `' + r.num + '` ' + r.name)
  parts.push('')
}

fs.writeFileSync(ROOT + '/docs/游戏动作全表.md', parts.join('\n'), 'utf8')
console.log('写出 ' + rows.length + ' 条 / ' + groups.size + ' 组')
