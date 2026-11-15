import { readFileSync } from 'node:fs'
const s = readFileSync('tools/insert-transitions.mjs', 'utf8')
const marks = []
for (let i = 0; i < s.length; i += 1) if (s[i] === String.fromCharCode(96)) marks.push(i)
console.log('  backticks=' + marks.length)
for (let k = 0; k < marks.length; k += 2) {
  const a = marks[k]
  const b = marks[k + 1]
  const lineA = s.slice(0, a).split('\n').length
  const lineB = b == null ? -1 : s.slice(0, b).split('\n').length
  console.log(`  #${k / 2} L${lineA} .. L${lineB}`)
}
