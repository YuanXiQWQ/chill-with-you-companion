/**
 * 用量报表。node tools/usage-report.mjs [天数]
 *
 * 读 data/usage.log，按天汇总。DeepSeek 的 prefix cache 命中价是全价的一成，
 * 所以把 hit 和 miss 分开算：只看 prompt_tokens 总量会以为很贵，其实大头被缓存吃掉了。
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(dirname(fileURLToPath(import.meta.url)))
const FILE = join(HERE, 'data', 'usage.log')
if (!existsSync(FILE)) { console.log('还没有用量记录：先让她说一句话就会开始记。'); process.exit(0) }

const rows = readFileSync(FILE, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => {
  try { return JSON.parse(l) } catch { return null }
}).filter(Boolean)
if (rows.length === 0) { console.log('usage.log 是空的。'); process.exit(0) }

// 等效计费：命中按 0.1 倍，其余按全价
const eq = (r) => r.hit * 0.1 + r.miss + r.out

const days = new Map()
for (const r of rows) {
  const d = String(r.t).slice(0, 10)
  const cur = days.get(d) || { n: 0, prompt: 0, hit: 0, miss: 0, out: 0 }
  cur.n += 1; cur.prompt += r.prompt; cur.hit += r.hit; cur.miss += r.miss; cur.out += r.out
  days.set(d, cur)
}

console.log('按天汇总（等效计费 = 命中×0.1 + 失效 + 输出）\n')
console.log('  日期          调用   prompt     命中率    失效    输出   等效计费')
for (const [d, v] of [...days].sort()) {
  const rate = v.prompt ? Math.round(v.hit / v.prompt * 100) : 0
  console.log('  ' + d + '  ' + String(v.n).padStart(5) + '  ' + String(v.prompt).padStart(7) + '  ' + String(rate).padStart(5) + '%  ' + String(v.miss).padStart(6) + '  ' + String(v.out).padStart(6) + '  ' + String(Math.round(v.hit * 0.1 + v.miss + v.out)).padStart(9))
}

const all = rows.reduce((a, r) => ({ n: a.n + 1, prompt: a.prompt + r.prompt, hit: a.hit + r.hit, miss: a.miss + r.miss, out: a.out + r.out }), { n: 0, prompt: 0, hit: 0, miss: 0, out: 0 })
const total = Math.round(all.hit * 0.1 + all.miss + all.out)
console.log('\n  合计 ' + all.n + ' 次调用')
console.log('  prompt ' + all.prompt + '  hit ' + all.hit + ' (' + Math.round(all.hit / Math.max(all.prompt, 1) * 100) + '%)  miss ' + all.miss + '  out ' + all.out)
console.log('  等效计费 ' + total + ' tok，平均每次 ' + Math.round(total / all.n) + ' tok')

// 最近几次单条
console.log('\n最近 8 次')
for (const r of rows.slice(-8)) {
  console.log('  ' + String(r.t).slice(11, 19) + '  ' + String(r.model || '').padEnd(16) + ' prompt=' + String(r.prompt).padStart(5) + ' hit=' + String(r.hit).padStart(5) + ' miss=' + String(r.miss).padStart(4) + ' out=' + String(r.out).padStart(4) + '  eq=' + Math.round(eq(r)))
}