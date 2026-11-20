// 口型一直在动：先把 GameVoiceGate 里对 ChangeEnableHeroineTalkAnimation 的调用摘掉。
//
// 原因：那个方法是"允许/禁止播说话口型"的开关，我们进入时写 false、退出时无条件写 true。
// 但原状态很可能不是 true（她没在说话时是关的），写 true 等于替游戏打开了说话口型——
// 于是演出结束后嘴一直在动。
//
// 现在的口径：只做两件确定安全的事——CancelVoice() 打断当前语音、_selfTalkProbability=0
// 停掉自言自语。口型是语音的副作用，语音停了它自己会停，不需要我们碰动画层。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let src = readFileSync(P, 'utf8')
const before = src.length

const lines = [
  /[ \t]*Invoke1\(voice, "ChangeEnableHeroineTalkAnimation", false\);\r?\n/g,
  /[ \t]*Invoke1\(voice, "ChangeEnableHeroineTalkAnimation", true\);\r?\n/g
]
let removed = 0
for (const re of lines) {
  src = src.replace(re, () => { removed++; })
}

writeFileSync(P, src, 'utf8')
console.log('删掉调用行: ' + removed)
console.log('残留 ChangeEnableHeroineTalkAnimation: ' + (src.split('ChangeEnableHeroineTalkAnimation').length - 1))
console.log('长度 ' + before + ' -> ' + src.length)
