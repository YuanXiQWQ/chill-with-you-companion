import { readFileSync, writeFileSync } from 'node:fs'

const p = 'brain.mjs'
let s = readFileSync(p, 'utf8')
const log = []
const apply = (marker, fn) => {
  if (s.includes(marker)) { log.push('skip ' + marker.slice(0, 20)); return }
  fn(); log.push('ok   ' + marker.slice(0, 20))
}

// ① 补两条 import（HEAD 里没有 motion-class / game-grammar 的引用）
apply('from \'./lib/motion-class.js\'', () => {
  const anchor = "import { resolveConfig } from './lib/config.mjs'"
  if (!s.includes(anchor)) throw new Error('import 锚点失配')
  s = s.replace(anchor, [
    "import { classifyClip, MOTION_CLASS } from './lib/motion-class.js'",
    "import { familyOf as grammarFamilyFn } from './lib/game-grammar.js'",
    anchor
  ].join('\n'))
})

// ② 起手阶梯
apply('const STEP_MS = 360', () => {
  const OLD = [
    '  // 动作排布：按这句音频的真实时长把动作铺开，而不是全挤在 0ms',
    '  if (cues && cues.length > 0 && audio && audio.duration > 0) {',
    '    const durMs = Math.max(700, audio.duration * 1000)',
    '    if (cues.length === 1) cues[0].at = 0',
    '    else {',
    '      const span = Math.min(durMs * 0.85, 5200)',
    '      cues.forEach((c, i) => { c.at = Math.round((i / (cues.length - 1)) * span) })',
    '    }',
    '  }'
  ].join('\n')
  if (!s.includes(OLD)) throw new Error('起手铺开锚点失配')
  s = s.replace(OLD, [
    '  // 表演和语音解绑：动作按固定节拍顺序起手，与音频长度无关；口型仍严格跟音频。',
    '  if (cues && cues.length > 0) {',
    '    const STEP_MS = 360',
    '    cues.forEach((c, i) => { c.at = i * STEP_MS })',
    '  }'
  ].join('\n'))
})

// ③ normalizeCueTiming 重写
apply('const MIN_GAP = 160', () => {
  const A = s.indexOf('  function normalizeCueTiming(list, durMs, subtitleLen) {')
  if (A < 0) throw new Error('normalizeCueTiming 未找到')
  const B = s.indexOf('\n  function ', A + 10)
  if (B < 0) throw new Error('normalizeCueTiming 结尾未找到')
  const NEW = [
    '  /**',
    '   * 起手时刻排布。表演与语音解绑后只做两件事：',
    '   *   1) 同组（同 base 的 start/loop/end）保持相对顺序，不互相推远；',
    '   *   2) 相邻两个不同动作之间留最小间隔，避免互相覆盖。',
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
  s = s.slice(0, A) + NEW + s.slice(B + 1)
})

// ④ 上一段表演记忆 + 签名
apply('const perfMemo = {', () => {
  const anchor = '  function chainStartToLoop(list, durMs, subtitleLen) {'
  if (!s.includes(anchor)) throw new Error('chainStartToLoop 未找到')
  s = s.replace(anchor, [
    '  // 「她刚才在做什么」：编排据此决定"继续做"还是"重新进入"。',
    '  const perfMemo = { family: "", at: 0 }',
    '  function perfFamily() { return perfMemo.family || "" }',
    '  function perfAge() { return perfMemo.at ? Date.now() - perfMemo.at : Infinity }',
    '  function notePerf(id) {',
    '    try {',
    '      const fam = grammarFamilyFn(String(id || ""))',
    '      if (fam) perfMemo.family = fam',
    '      perfMemo.at = Date.now()',
    '    } catch { }',
    '  }',
    '',
    '  function chainStartToLoop(list, durMs, subtitleLen, lastFamily, sinceLastMs) {'
  ].join('\n'))
})

// ⑤ 形态规则
apply('const headCls = classifyClip', () => {
  const OLD = '      const startDur = startId ? (animDurationMs(startId) || 1000) : 0'
  if (!s.includes(OLD)) throw new Error('组头锚点失配')
  s = s.replace(OLD, [
    OLD,
    '',
    '      // 形态由内容决定，不由这句话的长短视频定：',
    '      //   手势（点头/害羞/笑）是一两秒的反应，展开成整族等于"每句话都做一个完整动作再回待机"；',
    '      //   道具/姿态/位移（喝茶/伸懒腰/离座）才是一件事，按家族整段走。',
    '      const headCls = classifyClip(startId || base)',
    '      const isGesture = headCls === MOTION_CLASS.GESTURE',
    '      // 同一家族刚演过且没冷：接着 hold 它的 loop，不重新进入+退出——她也正在做着这件事。',
    '      const warmSame = Boolean(lastFamily) && grammarFamilyFn(base) === lastFamily',
    '        && Number.isFinite(sinceLastMs) && sinceLastMs < 20000'
  ].join('\n'))
})

// ⑥ 延续只出 loop
apply('warmSame && has(loopId)', () => {
  const OLD = '      const rawLoop = has(loopId) ? (animDurationMs(loopId) || 600) : 0'
  if (!s.includes(OLD)) throw new Error('rawLoop 锚点失配')
  s = s.replace(OLD, [
    '      if (warmSame && has(loopId))',
    '      {',
    '        const warmLoop = Math.min(Math.max(animDurationMs(loopId) || 1200, 300), 2600)',
    '        const kept = mk(loopId, g.at, warmLoop)',
    '        kept.continued = true',
    '        out.push(kept)',
    '        continue',
    '      }',
    OLD
  ].join('\n'))
})

// ⑦ 手势只演自己
apply('if (isGesture)', () => {
  const OLD = '      // 3) 收尾过渡'
  if (!s.includes(OLD)) throw new Error('收尾锚点失配')
  s = s.replace(OLD, [
    '      if (isGesture)',
    '      {',
    '        const selfId = startId || base',
    '        const selfDur = animDurationMs(selfId) || 1500',
    '        out.push(mk(selfId, g.at, selfDur))',
    '        continue',
    '      }',
    '',
    OLD
  ].join('\n'))
})

// ⑧ loop 夹区间
apply('const loopMs = tinyLoop ? 0', () => {
  const OLD = '      const tinyLoop = rawLoop > 0 && rawLoop < 300'
  if (!s.includes(OLD)) throw new Error('tinyLoop 锚点失配')
  s = s.replace(OLD, [OLD, '      const loopMs = tinyLoop ? 0 : Math.min(Math.max(rawLoop, 300), 2600)'].join('\n'))
})

// ⑨ 收尾紧接循环
apply('const tooLong = startDur + loopMs + endDur > 9000', () => {
  const A = s.indexOf('      // 收尾该在什么时候开始：语音结束前把 end 播完。')
  if (A < 0) throw new Error('收尾时机锚点失配')
  const marker = '      const endAt = useLoop ? rawEndAt : loopAt'
  const B = s.indexOf(marker, A)
  if (B < 0) throw new Error('endAt 锚点失配')
  s = s.slice(0, A) + [
    '      // 收尾紧接循环之后，与"语音什么时候结束"无关。整组太长就不插循环。',
    '      const tooLong = startDur + loopMs + endDur > 9000',
    '      const useLoop = loopMs > 0 && !tooLong',
    '      const endAt = useLoop ? loopAt + loopMs : loopAt'
  ].join('\n') + s.slice(B + marker.length)
})

// ⑩ loopDur 用夹过的值
apply('const loopDur = useLoop ? loopMs : 0', () => {
  s = s.replace('      const loopDur = useLoop ? (hasEnd ? endAt - loopAt : rawLoop) : 0',
    '      const loopDur = useLoop ? loopMs : 0')
})

// ⑪ 循环许可与语音无关
apply('if (loopDur) out.push(mk(loopId, loopAt, loopDur))', () => {
  const OLD = '      if (loopDur && startDur + loopDur + endDur <= Math.max(windowMs * 2.5, 6000)) out.push(mk(loopId, loopAt, loopDur))'
  if (!s.includes(OLD)) throw new Error('循环许可锚点失配')
  s = s.replace(OLD, '      // 上限与语音无关：整组超过 9 秒就不插循环，否则一律插一拍。\n      if (loopDur) out.push(mk(loopId, loopAt, loopDur))')
})

// ⑫ /act 之后记下这轮家族
apply('if (prim) notePerf(prim.id)', () => {
  const OLD = '        const act = buildAct(parsed, {'
  if (!s.includes(OLD)) throw new Error('buildAct 锚点失配')
  s = s.replace(OLD, [
    "        try { const prim = (actCues || []).find((c) => c.slot === 'animations'); if (prim) notePerf(prim.id) } catch { }",
    OLD
  ].join('\n'))
})

// ⑬ 两个 chain 调用点补参数
apply('actDurMs, actChars, perfFamily(), perfAge()', () => {
  s = s.replace('        ), actDurMs, actChars)', '        ), actDurMs, actChars, perfFamily(), perfAge())')
})
apply('durMs, subtitleLen, perfFamily(), perfAge()', () => {
  s = s.replace('    ), durMs, subtitleLen)', '    ), durMs, subtitleLen, perfFamily(), perfAge())')
})

writeFileSync(p, s, 'utf8')
console.log(log.join('\n'))
