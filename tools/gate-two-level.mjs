import { readFileSync, writeFileSync } from 'node:fs'
const p = 'lib/motion-class.js'
let s = readFileSync(p, 'utf8')

const start = s.indexOf('export function enforceContentClass')
if (start < 0) throw new Error('enforceContentClass 未找到')

const body = `// 清单里每条 id 的语义（闸门判断"这条动作到底在干什么"用）
function semanticIndex(manifest) {
  const map = new Map()
  const anims = Array.isArray(manifest?.animations) ? manifest.animations : []
  for (const e of anims) {
    const id = String(e?.id || '')
    if (!id) continue
    const sem = Array.isArray(e.semantic) ? e.semantic.join('/') : String(e.name || '')
    map.set(id, sem)
  }
  return map
}

function semOf(map, id) {
  if (map.has(id)) return map.get(id)
  const fam = grammarFamily(id)
  for (const suffix of ['_start', '_loop', '_end', '']) {
    if (map.has(fam + suffix)) return map.get(fam + suffix)
  }
  return ''
}

/**
 * 内容闸门。两级判定，越靠后越严：
 *   ① 类别不符 —— 内容首要类别是 prop，模型给的却是 gesture：直接换。
 *   ② 类别对但内容不对 —— 内容说"伸懒腰"，模型给的是同类别的 fidget：
 *      模型那条在话题上得分为 0，而库里存在能得分的同类动作，才换。
 * 只有这两级都过不了才动手；其余一律尊重模型。
 * @returns { cues, changed, want, picked }
 */
export function enforceContentClass(cues, opts = {}) {
  const want = contentClasses(opts.text)
  const anims = asArray(cues).filter((c) => c && c.slot === 'animations')
  if (want.length === 0 || anims.length === 0) return { cues, changed: [], want, picked: null }

  const primary = want[0]
  const have = anims.map((c) => classifyClip(c.id))
  const sem = semanticIndex(opts.manifest)
  const curLayer = opts.currentLayer || ''
  const text = String(opts.text || '')

  const replace = (why) => {
    const pick = pickCandidate(primary, opts.manifest, opts.emotion, curLayer, text)
    if (!pick) return { cues, changed: [], want, picked: null }
    const out = cues.slice()
    const i = out.findIndex((c) => c && c.slot === 'animations')
    const from = out[i].id
    out[i] = { ...out[i], id: pick.id }
    return { cues: out, want, picked: pick.id, changed: [{ from, to: pick.id, want: primary, why }] }
  }

  // ① 类别不符
  if (!have.includes(primary)) return replace('content-class-mismatch')

  // ② 类别对，但模型这条在内容话题上完全没得分
  const modelTopic = Math.max(...anims.map((c) => topicScore(primary, text, semOf(sem, c.id), c.id)))
  if (modelTopic > 0) return { cues, changed: [], want, picked: null }

  const pick = pickCandidate(primary, opts.manifest, opts.emotion, curLayer, text)
  if (!pick) return { cues, changed: [], want, picked: null }
  if (topicScore(primary, text, semOf(sem, pick.id), pick.id) <= 0) {
    return { cues, changed: [], want, picked: null }
  }
  const out = cues.slice()
  const i = out.findIndex((c) => c && c.slot === 'animations')
  const from = out[i].id
  out[i] = { ...out[i], id: pick.id }
  return { cues: out, want, picked: pick.id, changed: [{ from, to: pick.id, want: primary, why: 'content-topic-mismatch' }] }
}
`
s = s.slice(0, start) + body
writeFileSync(p, s, 'utf8')
console.log('  ✓ 闸门升级为两级判定（类别 → 话题）')
