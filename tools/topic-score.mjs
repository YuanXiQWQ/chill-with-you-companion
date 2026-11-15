// 候选评分加"话题命中"：只按类别挑会挑到 magicalprincess_eat 这种名字奇怪的动作，
// 内容里说到"喝水"就该落到喝茶/拿杯子那族上。
import { readFileSync, writeFileSync } from 'node:fs'
const p = 'lib/motion-class.js'
let s = readFileSync(p, 'utf8')
if (s.includes('CONTENT_TOPIC')) { console.log('  · 已有话题表'); process.exit(0) }

const topicTable = `// 话题命中表：内容里出现左边的词，就给语义/名字里出现右边词的动作加分
const CONTENT_TOPIC = {
  prop: [
    [['喝', '水', '茶', '咖啡', '杯', '渴'], ['喝', '茶', '咖啡', '杯', '水']],
    [['吃', '饭', '零食'], ['吃', '饭']],
    [['写', '报告', '代码', '敲', '键盘'], ['写', '报告', '电脑', '键盘']],
    [['看', '书', '读', '笔记'], ['看', '书', '读']]
  ],
  posture: [
    [['困', '睡', '躺', '哈欠', '累'], ['哈欠', '睡', '躺', '疲']],
    [['伸', '懒腰', '起来', '站'], ['伸', '站', '起']]
  ],
  locomotion: [
    [['去', '出去', '离开', '便利店', '等我', '过去'], ['离座', '回座', '走', '出去', '离开']]
  ],
  gesture: [
    [['同意', '对', '是', '好', '没错'], ['点', '同意', '认']],
    [['不好意思', '害羞', '被夸'], ['害羞', '羞']],
    [['想', '觉得', '考虑'], ['思', '想', '歪头']]
  ]
}

function topicScore(cls, text, haystack) {
  const rows = CONTENT_TOPIC[cls] || []
  let best = 0
  for (const [triggers, wanted] of rows) {
    if (!triggers.some((w) => text.includes(w))) continue
    if (wanted.some((w) => haystack.includes(w))) best = Math.max(best, 30)
  }
  return best
}

`
s = s.replace('function pickCandidate(', topicTable + 'function pickCandidate(')

// pickCandidate 增加 text 参数与话题分
s = s.replace('function pickCandidate(targetClass, manifest, emotion, curLayer) {', 'function pickCandidate(targetClass, manifest, emotion, curLayer, text) {')
s = s.replace(`    if (words.length && words.some((w) => sem.includes(w))) score += 12`,
`    if (words.length && words.some((w) => sem.includes(w))) score += 12
    // 话题命中权重最高：说到底在喝什么，比"同层"重要
    score += topicScore(targetClass, String(text || ''), sem + '/' + id)`)
s = s.replace('const pick = pickCandidate(want[0], opts.manifest, opts.emotion, curLayer)',
  'const pick = pickCandidate(want[0], opts.manifest, opts.emotion, curLayer, opts.text)')
writeFileSync(p, s, 'utf8')
console.log('  ✓ 候选评分加入话题命中')
