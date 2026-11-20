import { readFileSync, writeFileSync } from 'node:fs'

const p = 'brain.mjs'
let s = readFileSync(p, 'utf8')

// ① 函数签名带上"上一段家族"
const OLD_SIG = '  function chainStartToLoop(list, durMs, subtitleLen) {'
if (!s.includes(OLD_SIG)) throw new Error('签名锚点失配')
s = s.replace(OLD_SIG, '  function chainStartToLoop(list, durMs, subtitleLen, lastFamily, sinceLastMs) {')

// ② 组内展开前先按类别与延续性决定形态
const OLD_HEAD = '      const startDur = startId ? (animDurationMs(startId) || 1000) : 0'
if (!s.includes(OLD_HEAD)) throw new Error('组头锚点失配')
const NEW_HEAD = [
  '      const startDur = startId ? (animDurationMs(startId) || 1000) : 0',
  '',
  '      // ── 形态由内容决定，不由这句话的长短视频定 ──',
  '      // 手势（点头/害羞/笑/歪头）是一两秒的反应，展开成整族等于"每句话都做一个完整动作再回待机"；',
  '      // 道具/姿态/位移（喝茶/伸懒腰/离座）才是一件事，按家族整段走。',
  '      const headCls = classifyClip(startId || base)',
  '      const isGesture = headCls === MOTION_CLASS.GESTURE',
  '      // 同一家族刚演过且没冷：接着 hold 它的 loop，不要重新进入+退出（她也正在做着这件事）。',
  '      const warmSame = Boolean(lastFamily) && grammarFamilyFn(base) === lastFamily',
  '        && Number.isFinite(sinceLastMs) && sinceLastMs < 20000'
].join('\n')
s = s.replace(OLD_HEAD, NEW_HEAD)

// ③ 延续：只出 loop 就收工
const OLD_LOOP = '      const rawLoop = has(loopId) ? (animDurationMs(loopId) || 600) : 0'
if (!s.includes(OLD_LOOP)) throw new Error('loop 估锚点失配')
s = s.replace(OLD_LOOP, [
  '      if (warmSame && has(loopId))',
  '      {',
  '        const warmLoop = Math.min(Math.max(animDurationMs(loopId) || 1200, 300), 2600)',
  '        out.push(mk(loopId, g.at, warmLoop))',
  '        out[out.length - 1].continued = true',
  '        continue',
  '      }',
  OLD_LOOP
].join('\n'))

// ④ 手势：只给进入段（或自己那一段），不插 loop/end
const OLD_END = '      // 3) 收尾过渡'
if (!s.includes(OLD_END)) throw new Error('收尾锚点失配')
s = s.replace(OLD_END, [
  '      if (isGesture)',
  '      {',
  '        // 手势演自己就够：有 start 播 start，没有就播裸名（sub_nod 这类自包含段）',
  '        const selfId = startId || base',
  '        const selfDur = animDurationMs(selfId) || 1500',
  '        out.push(mk(selfId, g.at, selfDur))',
  '        continue',
  '      }',
  '',
  OLD_END
].join('\n'))

// ⑤ 两个调用点补参数
s = s.replace('        ), actDurMs, actChars)', '        ), actDurMs, actChars, lastPerfFamily, lastPerfAge)')
s = s.replace('      ), durMs, chars)', '      ), durMs, chars, lastPerfFamily, lastPerfAge)')

writeFileSync(p, s, 'utf8')
console.log('  ✓ chainStartToLoop 按类别与延续性定形态')
