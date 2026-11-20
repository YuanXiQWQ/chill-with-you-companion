// 把持续状态接上官方状态机。
// 这些 verb 之前走采样（family: 'anim_work_pc_sub_thinking' 之类），
// 现在改成告诉 HeroineAI "她该去干什么"，L0 的 base_start -> base_loop -> base_end
// 由游戏自己跑，循环点和归还姿势都不用我们管。
import fs from 'node:fs'

// 路径现算：发布体检不允许代码里出现字面量盘符。
const ROOT = process.env.CHILL_REPO || new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const P = ROOT + '/lib/actions.js'
let src = fs.readFileSync(P, 'utf8')

const MAP = {
  work_pc: 'WorkPC',
  work_report: 'WorkReport',
  read_book: 'WorkBook',
  novel: 'BreakReadBook',
  movie: 'BreakMovie',
  music: 'BreakListenMusic',
  sleep: 'BreakSleep',
}

let hit = 0
for (const [verb, state] of Object.entries(MAP)) {
  const re = new RegExp(`(  ${verb}: \\{[\\s\\S]*?family: '[^']*',)`)
  if (!re.test(src)) {
    console.error('miss ' + verb)
    continue
  }
  if (src.includes(`  ${verb}: {`) && new RegExp(`  ${verb}: \\{[\\s\\S]{0,400}?state: '`).test(src)) {
    console.log('skip (已有) ' + verb)
    continue
  }
  src = src.replace(re, `$1\n    // 官方状态机入口。有它就不走采样：游戏自己跑 base_start -> base_loop -> base_end。\n    state: '${state}',`)
  hit++
}
fs.writeFileSync(P, src, 'utf8')
console.log('接入 ' + hit + ' 个: ' + Object.keys(MAP).join(', '))
