// 内容类别硬约束：模型选错类别时按内容改回来（不靠提示词自觉）。
import { readFileSync, writeFileSync } from 'node:fs'
const p = 'lib/motion-class.js'
let s = readFileSync(p, 'utf8')
if (s.includes('export function enforceContentClass')) { console.log('  · 已存在硬约束'); process.exit(0) }

const add = `
// ── 内容类别硬约束 ──────────────────────────────────────────────────
// 提示词只是建议，这里才是闸门：内容明确指向某类动作（喝/写/累/走），
// 而模型给的类别完全不符，就从动作库里挑一条同类别、同场景层的替换掉。
const EMOTION_WORDS = {
  Tired: ['累', '疲', '困', '睡', '哈欠', '伸'],
  Shy: ['害羞', '羞'],
  Happy: ['笑', '开心', '高兴', '喜'],
  Fun: ['玩', '趣', '笑'],
  Sad: ['难', '悲', '低'],
  Frustration: ['沮丧', '烦'],
  Confused: ['困惑', '歪头', '思'],
  Agree: ['点', '同意', '认'],
  Disagree: ['摇', '拒绝', '不同'],
  Excited: ['兴奋', '跳'],
  Guts: ['加油', '鼓劲'],
  Drink: ['喝', '茶', '咖啡', '杯']
}

function pickCandidate(targetClass, manifest, emotion, curLayer) {
  const anims = Array.isArray(manifest?.animations) ? manifest.animations : []
  const words = EMOTION_WORDS[emotion] || []
  const scored = []
  for (const e of anims) {
    const id = String(e?.id || '')
    if (!id.startsWith('anim_')) continue
    if (classifyClip(id) !== targetClass) continue
    // 只考虑整条动作：单段，或三段式的 start（后续交给编排器展开 loop/end）
    if (/_loop2?$|_end$/.test(id)) continue
    const segs = segsOf(id)
    const isTriple = segs.includes('start')
    const layer = layerOf(id)
    const sem = Array.isArray(e.semantic) ? e.semantic.join('/') : ''
    let score = 0
    if (isTriple) score += 20                      // 三段式能撑满整句话
    if (curLayer && layer === curLayer) score += 15 // 同层不穿模
    if (words.length && words.some((w) => sem.includes(w))) score += 12
    if (e.loop) score -= 5
    const d = Number(e.durationMs)
    if (Number.isFinite(d) && d >= 1200 && d <= 6000) score += 6
    scored.push({ id: isTriple ? grammarFamily(id) : id, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored[0] || null
}

/**
 * 若内容指向的类别与模型给的完全不符，替换动作。
 * @returns { cues, changed: [{from,to,want,why}] }
 */
export function enforceContentClass(cues, opts = {}) {
  const want = contentClasses(opts.text)
  const anims = asArray(cues).filter((c) => c && c.slot === 'animations')
  if (want.length === 0 || anims.length === 0) return { cues, changed: [] }

  const have = anims.map((c) => classifyClip(c.id))
  if (want.some((w) => have.includes(w))) return { cues, changed: [] }

  const curLayer = opts.currentLayer || ''
  const pick = pickCandidate(want[0], opts.manifest, opts.emotion, curLayer)
  if (!pick) return { cues, changed: [] }

  const out = cues.slice()
  const i = out.findIndex((c) => c && c.slot === 'animations')
  const from = out[i].id
  out[i] = { ...out[i], id: pick.id }
  return {
    cues: out,
    changed: [{ from, to: pick.id, want: want[0], why: 'content-class-mismatch' }]
  }
}
`
s = s.trimEnd() + '\n' + add
writeFileSync(p, s, 'utf8')
console.log('  ✓ 已加入 enforceContentClass')
