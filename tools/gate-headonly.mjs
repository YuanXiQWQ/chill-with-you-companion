// 专注态身体锁死，此时"喝水/伸懒腰"演出来只是歪一下头 —— 与其演个假动作，
// 不如保留模型给的小手势。闸门在 headOnly 时不再往道具/姿态/位移上换。
import { readFileSync, writeFileSync } from 'node:fs'

{
  const p = 'lib/motion-class.js'
  let s = readFileSync(p, 'utf8')
  const old = '  const primary = want[0]'
  if (!s.includes(old)) throw new Error('闸门锚点失配')
  s = s.replace(old, `  const primary = want[0]
  // 专注态：身体被锁在游戏姿势，道具/姿态/位移演不出来（实测只剩脖子动 3~10°）。
  // 这种时候换成 prop 只是换个假动作，保留模型自己的小反应更诚实。
  if (opts.headOnly && primary !== 'gesture') {
    return { cues, changed: [], want, picked: null, skipped: 'head-only' }
  }`)
  writeFileSync(p, s, 'utf8')
  console.log('  ✓ 闸门支持 headOnly')
}

{
  const p = 'brain.mjs'
  let s = readFileSync(p, 'utf8')
  const old = 'text: userText,'
  if (!s.includes(old)) throw new Error('brain 锚点失配')
  // 只改 enforceContentClass 那一次调用（它排在 planSequence 之前）
  const gateCall = s.indexOf('enforceContentClass(cues, {')
  if (gateCall < 0) throw new Error('闸门调用未找到')
  const tail = s.slice(gateCall, gateCall + 400)
  const withFlag = tail.replace('text: userText,', 'text: userText,\n          headOnly: state.phase === \'focus\',')
  s = s.slice(0, gateCall) + withFlag + s.slice(gateCall + 400)
  writeFileSync(p, s, 'utf8')
  console.log('  ✓ brain 传入 headOnly（专注态）')
}
