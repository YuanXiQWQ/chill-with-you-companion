import { readFileSync, writeFileSync } from 'node:fs'

// 之前那次误改把关键词塞进了 CONTENT_TOPIC 的行数组头部，导致 triggers.some 崩掉。
// 整块重写，结构恢复为 [[触发词], [语义词], [动词 token]]。
const p = 'lib/motion-class.js'
let s = readFileSync(p, 'utf8')
const start = s.indexOf('const CONTENT_TOPIC = {')
if (start < 0) throw new Error('CONTENT_TOPIC 未找到')
const endMark = '\n}\n'
const end = s.indexOf(endMark, start)
if (end < 0) throw new Error('CONTENT_TOPIC 结束位置未找到')

const block = `const CONTENT_TOPIC = {
  prop: [
    [['喝', '水', '茶', '咖啡', '杯', '渴'], ['喝', '茶', '咖啡', '杯', '水'], ['drink']],
    [['吃', '饭', '零食'], ['吃', '饭'], ['eat']],
    [['写', '报告', '代码', '敲', '键盘'], ['写', '报告', '电脑', '键盘'], ['write', 'report', 'pc', 'typing']],
    [['看', '书', '读', '笔记', '翻页'], ['看', '书', '读'], ['read', 'book', 'pageflip', 'novel']],
    [['转笔', '笔'], ['笔', '转'], ['apen', 'pen']]
  ],
  posture: [
    [['困', '睡', '躺', '哈欠', '累'], ['哈欠', '睡', '躺', '疲'], ['yawn', 'sleep', 'lie', 'tired']],
    [['伸', '懒腰', '起来', '站'], ['伸', '站', '起'], ['stretch', 'stand', 'up']]
  ],
  locomotion: [
    [['去', '出去', '离开', '便利店', '等我', '过去'], ['离座', '回座', '走', '出去', '离开'], ['leavechair', 'go', 'walk', 'comeback']]
  ],
  gesture: [
    [['同意', '对', '是', '好', '没错'], ['点', '同意', '认'], ['nod']],
    [['不好意思', '害羞', '被夸'], ['害羞', '羞'], ['shy']],
    [['想', '觉得', '考虑'], ['思', '想', '歪头'], ['thinking', 'look', 'glance']],
    [['眼睛', '揉', '干'], ['眼'], ['dryeye', 'eye', 'rub']],
    [['音乐', '歌', '听'], ['音乐', '歌'], ['music']]
  ]
}
`
s = s.slice(0, start) + block + s.slice(end + endMark.length)
writeFileSync(p, s, 'utf8')
console.log('  ✓ CONTENT_TOPIC 重写（结构恢复）')
