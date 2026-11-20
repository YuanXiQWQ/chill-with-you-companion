import { readFileSync, writeFileSync } from 'node:fs'

// ── 1) 语法表按"段"记时长：家族级 durationMs 是取第一条命中的段，会张冠李戴 ──
{
  const p = 'tools/learn-game-grammar.mjs'
  let s = readFileSync(p, 'utf8')
  if (!s.includes('segDurations')) {
    s = s.replace(`      return [f, {
        segs: [...v.segs],
        scene: (/^anim_([a-z]+)_/.exec(f) || [])[1] || '',
        semantic: first ? first.semantic : [],
        durationMs: first ? first.durationMs : null
      }]`,
`      const segDurations = {}
      for (const id of v.ids) {
        const e = anims.find((x) => x.id === id)
        const seg = (/_(start|loop|loop2|end)$/.exec(id) || [])[1] || 'single'
        if (e && Number.isFinite(e.durationMs)) segDurations[seg] = e.durationMs
      }
      return [f, {
        segs: [...v.segs],
        scene: (/^anim_([a-z]+)_/.exec(f) || [])[1] || '',
        semantic: first ? first.semantic : [],
        segDurations,   // 每段自己的时长：单段动作 4 秒、loop 1.9 秒，不能混用
        durationMs: first ? first.durationMs : null
      }]`)
    writeFileSync(p, s, 'utf8')
    console.log('  ✓ 生成器改为按段记时长')
  }
}

// ── 2) durationOf 读段级时长 ──
{
  const p = 'lib/game-grammar.js'
  let s = readFileSync(p, 'utf8')
  const old = `export function durationOf(id) {
  const fam = grammar.families?.[familyOf(id)]
  const d = fam?.durationMs
  return Number.isFinite(d) && d > 0 ? d : null
}`
  if (!s.includes(old)) throw new Error('durationOf 锚点失配')
  s = s.replace(old, `export function durationOf(id) {
  const fam = grammar.families?.[familyOf(id)]
  const seg = segmentOf(id)
  const d = fam?.segDurations?.[seg] ?? fam?.durationMs
  return Number.isFinite(d) && d > 0 ? d : null
}`)
  writeFileSync(p, s, 'utf8')
  console.log('  ✓ durationOf 按段取时长')
}

// ── 3) 闸门话题阈值：10 分只是"触发词命中但语义没对上"，不算满足 ──
{
  const p = 'lib/motion-class.js'
  let s = readFileSync(p, 'utf8')
  const old = '  if (modelTopic > 0) return { cues, changed: [], want, picked: null }'
  if (!s.includes(old)) throw new Error('话题阈值锚点失配')
  s = s.replace(old, `  // 30 分才是"语义真的对上"；10 分只是触发词命中，不能算满足
  if (modelTopic >= 30) return { cues, changed: [], want, picked: null }`)
  s = s.replace("  if (topicScore(primary, text, semOf(sem, pick.id), pick.id) <= 0) {",
    "  if (topicScore(primary, text, semOf(sem, pick.id), pick.id) < 30) {")
  writeFileSync(p, s, 'utf8')
  console.log('  ✓ 闸门话题阈值 30')
}
