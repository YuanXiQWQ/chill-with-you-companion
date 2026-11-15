import { readFileSync, writeFileSync } from 'node:fs'

// ── ① 双编排收敛：planSequence 只排序/串行化，不再展开家族 ──
{
  const p = 'lib/motion-class.js'
  let s = readFileSync(p, 'utf8')
  const log = []
  const apply = (m, fn) => { if (s.includes(m)) { log.push('skip ' + m.slice(0, 18)); return } fn(); log.push('ok   ' + m.slice(0, 18)) }

  apply('// 展开已交给 chainStartToLoop', () => {
    const A = s.indexOf('    const isGesture = item.cls === MOTION_CLASS.GESTURE')
    if (A < 0) throw new Error('展开段起点未找到')
    const B = s.indexOf('    } else {', A)
    if (B < 0) throw new Error('展开段 else 未找到')
    const C = s.indexOf('      cursor = start + dur', B)
    if (C < 0) throw new Error('单段分支结尾未找到')
    const NEW = [
      '    // 展开已交给 chainStartToLoop：这里只决定"演哪一条、什么时候开始"，',
      '    // 由它决定"这一段怎么拆成 start→loop→end、要不要延续、要不要接队"。',
      '    // 两边都展开过，就会同 id 同 at 下发两遍（历史 bug）。',
      '    const ownMs2 = durationOf(item.cue.id)',
      '    const dur = Math.max(600, ownMs2 || Number(item.cue.durationMs) || 2400)',
      '    out.push({ ...item.cue, at: start, durationMs: dur })',
      '    cursor = start + dur'
    ].join('\n')
    s = s.slice(0, A) + NEW + s.slice(C + '      cursor = start + dur'.length)
  })

  writeFileSync(p, s, 'utf8')
  console.log(log.join('  '))
}

// ── ② amp 基线：从"进入过渡结束"起算，才和 plan 同量纲 ──
{
  const p = 'game/src/PerformerPlugin.cs'
  let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
  const log = []
  const apply = (m, fn) => { if (s.includes(m)) { log.push('skip ' + m.slice(0, 18)); return } fn(); log.push('ok   ' + m.slice(0, 18)) }

  apply('bool capAmp = !ampStartValid && (ct >= clipFadeIn', () => {
    const OLD = [
      '            bool capAmp = !ampStartValid;',
      '            if (capAmp) ampStartValid = true;'
    ].join('\n')
    if (!s.includes(OLD)) throw new Error('capAmp 锚点失配')
    s = s.replace(OLD, [
      '            // 基线取"进入过渡结束之后"的姿势：不然 amp 会把进入时的混合量算进幅度，',
      '            // 和 plan（只量 clip 自身幅度）差一个量级，看起来像计划错了。',
      '            bool capAmp = !ampStartValid && ct >= clipFadeIn * 0.9f;',
      '            if (capAmp) ampStartValid = true;'
    ].join('\n'))
  })

  writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8')
  console.log(log.join('  '))
}
