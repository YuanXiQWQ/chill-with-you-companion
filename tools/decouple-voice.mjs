import { readFileSync, writeFileSync } from 'node:fs'

// ── A. lib/motion-class.js：三段式不再按说话长度重复 loop ──
{
  const p = 'lib/motion-class.js'
  let s = readFileSync(p, 'utf8')
  const OLD = [
    '    if (triple.length >= 3 && speechMs > 1200) {',
    '      // start 进入 → loop 按说话长度重复 → end 退出',
    '      const startMs = durationOf(triple[0]) || 700',
    '      const loopMs = durationOf(triple[1]) || 1900',
    '      const endMs = durationOf(triple[2]) || 700',
    '      // 向上取整：loop 次数不够会演到一半停住，宁可多一拍也不要差一截',
    '      const fill = Math.max(1, Math.ceil((Math.max(speechMs, startMs + loopMs) - startMs - endMs) / loopMs))'
  ].join('\n')
  if (!s.includes(OLD)) throw new Error('A 锚点失配（planSequence 三段块）')
  const NEW = [
    '    if (triple.length >= 3) {',
    '      // 表演和语音解绑：按游戏自己的节奏走 start → loop（一拍）→ end。',
    '      // 以前是 loop 按说话长度重复 N 次，语音长她就一直循环、语音短就被截断——',
    '      // 那是让身体去追语音，不是让她做动作。口型仍然跟音频，走的是另一条通路。',
    '      const startMs = durationOf(triple[0]) || 700',
    '      const loopRaw = durationOf(triple[1]) || 1900',
    '      // 循环段有两种极端：50ms 的微动（循环=抽搐）与上万 ms 的整段录制。各夹到可用区间。',
    '      const loopMs = Math.min(Math.max(loopRaw, 300), 2600)',
    '      const endMs = durationOf(triple[2]) || 700',
    '      const fill = 1'
  ].join('\n')
  s = s.replace(OLD, NEW)
  writeFileSync(p, s, 'utf8')
  console.log('  A ✓ planSequence 与语音解绑')
}

// ── B. brain.mjs：编排窗口不再由语音时长决定，起手间隔固定 ──
{
  const p = 'brain.mjs'
  let s = readFileSync(p, 'utf8')

  // B1 起手铺开：固定间隔，不再 span = 语音时长 × 0.85
  const OLD1 = [
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
  if (!s.includes(OLD1)) throw new Error('B1 锚点失配（动作铺开）')
  const NEW1 = [
    '  // 表演和语音解绑：动作不再按音频长度铺开（语音长就拖、语音短就挤），',
    '  // 而是按固定节拍顺序起手，各演各的。口型仍严格跟音频。',
    '  if (cues && cues.length > 0) {',
    '    const STEP_MS = 360',
    '    cues.forEach((c, i) => { c.at = i * STEP_MS })',
    '  }'
  ].join('\n')
  s = s.replace(OLD1, NEW1)

  // B2 三段展开：用游戏自己的段时长，loop 只走一拍
  const OLD2 = [
    '      const rawLoop = has(loopId) ? (animDurationMs(loopId) || 600) : 0',
    '      const tinyLoop = rawLoop > 0 && rawLoop < 300'
  ].join('\n')
  if (!s.includes(OLD2)) throw new Error('B2 锚点失配（loop 估算）')
  s = s.replace(OLD2, [
    '      const rawLoop = has(loopId) ? (animDurationMs(loopId) || 600) : 0',
    '      const tinyLoop = rawLoop > 0 && rawLoop < 300',
    '      // 循环段夹到可用区间：50ms 的微动不能循环（等于抽搐），上万 ms 的整段录制也不能整段塞进去',
    '      const loopMs = tinyLoop ? 0 : Math.min(Math.max(rawLoop, 300), 2600)'
  ].join('\n'))

  const OLD3 = [
    '      // 收尾该在什么时候开始：语音结束前把 end 播完。',
    '      const rawEndAt = hasEnd ? windowMs - endDur : 0',
    '      // 留给循环的空隙。start 和 end 本身就占满窗口时（喝茶 1833+1167 对 15 字），',
    '      // 硬塞一个 400ms 的循环只会让它在半途被收尾顶掉，观感像卡了一下。',
    '      // 不够就干脆不插 loop，end 直接接 start。',
    '      const gap = hasEnd ? rawEndAt - loopAt : 0',
    '      const useLoop = Boolean(rawLoop) && !tinyLoop && (!hasEnd || gap >= 600)',
    '      const endAt = useLoop ? rawEndAt : loopAt'
  ].join('\n')
  if (!s.includes(OLD3)) throw new Error('B3 锚点失配（收尾时机）')
  s = s.replace(OLD3, [
    '      // 收尾紧接在循环之后，不再挂到"语音结束时刻"上。',
    '      // 整组太长（比如 break_tea_sub_maker 单 start 就 8.6 秒）就跳过循环，别让她演到话说完很久还在动。',
    '      const tooLong = startDur + loopMs + endDur > 9000',
    '      const useLoop = loopMs > 0 && !tooLong',
    '      const endAt = loopAt + (useLoop ? loopMs : 0)'
  ].join('\n'))

  const OLD4 = '      const loopDur = useLoop ? (hasEnd ? endAt - loopAt : rawLoop) : 0'
  if (!s.includes(OLD4)) throw new Error('B4 锚点失配（loopDur）')
  s = s.replace(OLD4, '      const loopDur = useLoop ? loopMs : 0')

  writeFileSync(p, s, 'utf8')
  console.log('  B ✓ 编排窗口与语音解绑')
}

// ── C. 插件：clip 时长取游戏自然时长，不再被指令里的 durationMs 拉长（最多 +35%）──
{
  const p = 'game/src/PerformerPlugin.cs'
  let raw = readFileSync(p, 'utf8')
  const OLD = '            clipLen = Mathf.Max(natural, Mathf.Min(want > 0.05f ? want : natural, natural * 1.35f));'
  if (!raw.includes(OLD)) throw new Error('C 锚点失配（clipLen）')
  raw = raw.replace(OLD, [
    '            // 表演和语音解绑：一段动作就按它自己的自然时长演完。',
    '            // 以前允许指令里的 durationMs 把它撑到 1.35 倍——那是让身体去填语音的空白。',
    '            // 口型不在这里，走 mouthFlat/音频时间轴。',
    '            clipLen = natural;'
  ].join('\r\n'))
  writeFileSync(p, raw, 'utf8')
  console.log('  C ✓ clip 时长取自然时长')
}
