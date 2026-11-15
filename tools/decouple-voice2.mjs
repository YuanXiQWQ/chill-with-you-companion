import { readFileSync, writeFileSync } from 'node:fs'
const p = 'brain.mjs'
let s = readFileSync(p, 'utf8')

// ① 循环许可不该再看语音窗口
const OLD1 = '      if (loopDur && startDur + loopDur + endDur <= Math.max(windowMs * 2.5, 6000)) out.push(mk(loopId, loopAt, loopDur))'
if (!s.includes(OLD1)) throw new Error('① 锚点失配')
s = s.replace(OLD1, [
  '      // 上限与语音无关：整组超过 9 秒就不插循环（她也演不完），否则一律插一拍。',
  '      if (loopDur && startDur + loopDur + endDur <= 9000) out.push(mk(loopId, loopAt, loopDur))'
].join('\n'))

// ② normalizeCueTiming：不再把起手时刻按语音窗口归一化/压缩
const A2 = s.indexOf('  function normalizeCueTiming(list, durMs, subtitleLen) {')
if (A2 < 0) throw new Error('② 函数未找到')
const B2 = s.indexOf('\n  function ', A2 + 10)
if (B2 < 0) throw new Error('② 函数结尾未找到')
const NEW2 = [
  '  /**',
  '   * 起手时刻的排布。表演与语音解绑后，这里只做两件事：',
  '   *   1) 同一组（同 base 的 start/loop/end）保持相对顺序，不互相推远；',
  '   *   2) 相邻两个"不同的动作"之间留最小间隔，避免互相覆盖。',
  '   * 不再按语音长度做归一化压缩——那会让语音长短直接改变她做动作的快慢。',
  '   */',
  '  function normalizeCueTiming(list, durMs, subtitleLen) {',
  '    const out = []',
  '    let cursor = 0',
  '    const MIN_GAP = 160',
  '    for (const c of Array.isArray(list) ? list : []) {',
  '      if (!c || typeof c !== "object") continue',
  '      const at = Math.max(0, Number(c.at) || 0)',
  '      const group = String(c.id || "").replace(/_(start|loop2?|end)$/, "")',
  '      const prev = out.length ? out[out.length - 1] : null',
  '      const prevGroup = prev ? String(prev.id || "").replace(/_(start|loop2?|end)$/, "") : ""',
  '      const sameGroup = prev && group === prevGroup',
  '      const startAt = sameGroup ? Math.max(at, cursor) : Math.max(at, cursor + MIN_GAP)',
  '      out.push({ ...c, at: Math.round(startAt) })',
  '      cursor = startAt',
  '    }',
  '    return out',
  '  }',
  ''
].join('\n')
s = s.slice(0, A2) + NEW2 + s.slice(B2 + 1)

writeFileSync(p, s, 'utf8')
console.log('  ✓ 去掉 normalizeCueTiming 的语音归一化，循环许可与语音无关')
