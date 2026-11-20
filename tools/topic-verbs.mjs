import { readFileSync, writeFileSync } from 'node:fs'
const p = 'lib/motion-class.js'
let s = readFileSync(p, 'utf8')

const start = s.indexOf('// 话题命中表')
const end = s.indexOf('function pickCandidate(')
if (start < 0 || end < 0) throw new Error('话题表区域未找到')

const block = `// 话题命中表：[内容触发词, 语义/名字里的词, 动作 id 里该出现的动词 token]
// 第三列是关键：内容说"喝"，要落到 drink 那族，而不是名字里带"茶"的 base 待机。
const CONTENT_TOPIC = {
  prop: [
    [['喝', '水', '茶', '咖啡', '杯', '渴'], ['喝', '茶', '咖啡', '杯', '水'], ['drink', 'tea']],
    [['吃', '饭', '零食'], ['吃', '饭'], ['eat']],
    [['写', '报告', '代码', '敲', '键盘'], ['写', '报告', '电脑', '键盘'], ['write', 'report', 'pc', 'typing']],
    [['看', '书', '读', '笔记'], ['看', '书', '读'], ['read', 'book']]
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
    [['想', '觉得', '考虑'], ['思', '想', '歪头'], ['thinking', 'look', 'glance']]
  ]
}

function topicScore(cls, text, sem, id) {
  const rows = CONTENT_TOPIC[cls] || []
  const tokens = String(id || '').toLowerCase().replace(/^anim_/, '').split('_')
  // 只看第一条命中的话题：句子里的"喝"是动作，"写代码"是背景，不能让它抢
  for (const [triggers, wanted, verbs] of rows) {
    if (!triggers.some((w) => text.includes(w))) continue
    let score = wanted.some((w) => sem.includes(w)) ? 40 : 10
    if (verbs && verbs.some((v) => tokens.includes(v) || tokens.some((t) => t.startsWith(v)))) score += 35
    return score
  }
  return 0
}

`
s = s.slice(0, start) + block + s.slice(end)
s = s.replace('score += topicScore(targetClass, String(text || \'\'), sem + \'/\' + id)',
  'score += topicScore(targetClass, String(text || \'\'), sem, id)')
writeFileSync(p, s, 'utf8')
console.log('  ✓ 话题表加入动词 token 列')
