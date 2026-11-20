import { readFileSync, writeFileSync } from 'node:fs'

// KEYS 整块重写：结构是 [[CLASS, [词...]], ...]，逐条正则容易踩括号，直接换块。
const p = 'lib/motion-class.js'
let s = readFileSync(p, 'utf8')
const start = s.indexOf('const KEYS = [')
if (start < 0) throw new Error('KEYS 未找到')
const endMark = '\n]\n'
const end = s.indexOf(endMark, start)
if (end < 0) throw new Error('KEYS 结束位置未找到')

const block = `const KEYS = [
  [MOTION_CLASS.LOCOMOTION, ['walk', 'run', 'leavechair', 'go', 'comeback', 'move', 'approach']],
  [MOTION_CLASS.POSTURE, ['sit', 'stand', 'laya', 'sleep', 'slee', 'yawn', 'stretch', 'plank', 'dance', 'lie', 'wake', 'banzai', 'guts', 'eieio', 'feellarge', 'wet']],
  [MOTION_CLASS.PROP, ['drink', 'eat', 'tea', 'coffee', 'cup', 'book', 'openbook', 'pen', 'apen', 'phone', 'headphone', 'pc', 'report', 'typing', 'write', 'magazine', 'newspaper', 'trash', 'window', 'pageflip', 'flip', 'novel', 'textbook']],
  [MOTION_CLASS.GESTURE, ['nod', 'shake', 'agree', 'think', 'laugh', 'cry', 'smile', 'shy', 'sad', 'joy', 'fun', 'anger', 'surprise', 'presshands', 'hand', 'wave', 'bow', 'reaction', 'movie', 'lookplayer', 'dryeye', 'eye', 'rub', 'music', 'sway', 'hum', 'playingwithapen']],
  [MOTION_CLASS.IDLE, ['idle', 'breath', 'base']]
]
`
s = s.slice(0, start) + block + s.slice(end + endMark.length)
writeFileSync(p, s, 'utf8')
console.log('  ✓ KEYS 重写（含 dryeye/music/apen/pageflip/base/idle）')
