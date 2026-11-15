import { readFileSync, writeFileSync } from 'node:fs'
const p = 'lib/motion-class.js'
let s = readFileSync(p, 'utf8')
s = s.replace('  if (want.length === 0 || anims.length === 0) return { cues, changed: [] }',
  '  if (want.length === 0 || anims.length === 0) return { cues, changed: [], want, picked: null }')
s = s.replace("  if (want.some((w) => have.includes(w))) return { cues, changed: [] }",
  "  if (want.some((w) => have.includes(w))) return { cues, changed: [], want, picked: null }")
s = s.replace('  if (!pick) return { cues, changed: [] }', '  if (!pick) return { cues, changed: [], want, picked: null }')
s = s.replace(`  return {
    cues: out,
    changed: [{ from, to: pick.id, want: want[0], why: 'content-class-mismatch' }]
  }`, `  return {
    cues: out,
    want,
    picked: pick.id,
    changed: [{ from, to: pick.id, want: want[0], why: 'content-class-mismatch' }]
  }`)
writeFileSync(p, s, 'utf8')
console.log('  ✓ enforceContentClass 返回 want/picked')
