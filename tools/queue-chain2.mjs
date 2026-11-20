import { readFileSync, writeFileSync } from 'node:fs'

// ── A. 插件：衔接时把归还压缩到 120ms（必须在距离公式之后覆盖）──
{
  const p = 'game/src/PerformerPlugin.cs'
  let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
  if (s.includes('衔接：不用等归还走完')) { console.log('  skip A'); }
  else {
    const a = 'exitRelSec = Mathf.Clamp('
    const i = s.indexOf(a)
    if (i < 0) throw new Error('exitRelSec 赋值未找到')
    const lineEnd = s.indexOf('\n', i)
    const line = s.slice(i, lineEnd)
    s = s.slice(0, lineEnd + 1) + [
      '                    // 衔接：不用等归还走完——后面还排着动作，她在收尾的最后一瞬就接上下一套。',
      '                    if (HasAnimPending()) exitRelSec = 0.12f;'
    ].join('\n') + '\n' + s.slice(lineEnd + 1)
    writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8')
    console.log('  ok   A 衔接归还 120ms  ' + line.trim())
  }
}

// ── B. 编排：去重 + 把"正在演"也算作前面还有动作 ──
{
  const p = 'brain.mjs'
  let s = readFileSync(p, 'utf8')

  if (s.includes('const dedup = out.filter')) console.log('  skip B1')
  else {
    const a = '    out.sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0))\n    return out'
    if (!s.includes(a)) throw new Error('return out 锚点失配')
    s = s.replace(a, [
      '    out.sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0))',
      '    // 去重：同一段同一时刻只该出现一次。',
      '    // planSequence 与 chainStartToLoop 各自会补进入段，两边都留就会同 id 同 at 演两遍。',
      '    const seen = new Set()',
      '    const dedup = out.filter((c) => {',
      '      const k = String(c.slot) + "|" + String(c.id) + "|" + String(c.at)',
      '      if (seen.has(k)) return false',
      '      seen.add(k)',
      '      return true',
      '    })',
      '    return dedup'
    ].join('\n'))
    console.log('  ok   B1 去重')
  }

  if (s.includes('|| playing')) console.log('  skip B2')
  else {
    const a = '    try { const snap = game.snapshot() || {}; return Number((snap.queue || {}).depth) || 0 } catch { return 0 }'
    if (!s.includes(a)) throw new Error('queueAheadNow 锚点失配')
    s = s.replace(a, [
      '    try {',
      '      const snap = game.snapshot() || {}',
      '      const depth = Number((snap.queue || {}).depth) || 0',
      '      // "正在演"也算前面有动作：这一刻她的身体不在待机里，下一套要接上去而不是重新起手。',
      '      const m = snap.motion || {}',
      '      const playing = m.active && Number(m.remainingMs) > 0 ? 1 : 0',
      '      return depth + playing',
      '    } catch { return 0 }'
    ].join('\n'))
    console.log('  ok   B2 正在演也算 ahead')
  }

  writeFileSync(p, s, 'utf8')
}
