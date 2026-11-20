// 定案：不管游戏的离座语音/字幕（Debug 入口本来也不播，实测零语音源），
// 顺序就是「先播我们的字幕+语音，语音放完再接离座」——现在已经是这个行为。
//
// 这一轮把为了关语音做的无效代码全清掉，只留下真正有效的那个开关：
//   HeroineSelfTalkController._selfTalkProbability = 0   （她自己冒出来的自言自语/弹幕）
// 删：ScanAudios 诊断、字段表打印、CancelVoiceHard（CTS 取消）。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let src = readFileSync(P, 'utf8')
const before = src.length
const hits = []
function rip(name, re, rep = '') {
  const m = src.match(re)
  if (!m) { hits.push('skip ' + name); return }
  src = src.replace(re, rep)
  hits.push('ok   ' + name + '  -' + m[0].length)
}

// 1) 扫描方法整块
rip('ScanAudios 方法',
  /[ \t]*\/\/ 诊断：谁在出声。gate 压住期间扫前 16 次。\r?\n[ \t]*private static int scanCount;[\s\S]*?\r?\n[ \t]*\}\r?\n(?=\r?\n[ \t]*private static void CancelVoiceHard)/)

rip('扫描调用', /[ \t]*ScanAudios\(\);\r?\n/)

// 2) 硬取消方法整块 → 换回普通 CancelVoice
rip('CancelVoiceHard 方法',
  /[ \t]*\/\/ CancelVoice\(\) 只改口型状态[\s\S]*?\r?\n[ \t]*\}\r?\n(?=\r?\n[ \t]*private static void Invoke0)/)

rip('调用点换回', /CancelVoiceHard\(\);/, 'Invoke0(voice, "CancelVoice", null);')

// 3) 字段表诊断
rip('字段诊断块',
  /[ \t]*if \(!diagDone && voice != null\)\r?\n[ \t]*\{[\s\S]*?\r?\n[ \t]*\}\r?\n/)

// 4) 字段
rip('diagDone 字段', /[ \t]*private static bool diagDone;\r?\n/)

writeFileSync(P, src, 'utf8')
console.log(hits.join('\n'))
console.log('长度 ' + before + ' -> ' + src.length)
console.log('残留检查: ScanAudios=' + (src.split('ScanAudios').length - 1)
  + ' CancelVoiceHard=' + (src.split('CancelVoiceHard').length - 1)
  + ' diagDone=' + (src.split('diagDone').length - 1))
