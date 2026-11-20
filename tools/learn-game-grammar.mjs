// 逆向游戏自己的动作编排语法（只读分析，不改游戏）：
// 从 assets.seed.json 里还原它怎么组织 base / sub / wild / chair，再让大脑照这个语法编排。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const seed = JSON.parse(readFileSync(root + 'game/assets.seed.json', 'utf8'))

// 收集条目：{slot, id, name, semantic[], loop, durationMs}
const entries = []
const walk = (v, slot = null) => {
  if (Array.isArray(v)) return v.forEach((x) => walk(x, slot))
  if (v && typeof v === 'object') {
    if (typeof v.id === 'string') {
      entries.push({
        slot: slot || 'animations',
        id: v.id,
        name: v.name || '',
        semantic: Array.isArray(v.semantic) ? v.semantic : [],
        loop: Boolean(v.loop),
        durationMs: Number.isFinite(v.durationMs) ? v.durationMs : null
      })
      return
    }
    for (const [k, val] of Object.entries(v)) walk(val, k)
  }
}
walk(seed)

const slots = {}
for (const e of entries) slots[e.slot] = (slots[e.slot] || 0) + 1

// 只分析动画
const anims = entries.filter((e) => e.slot === 'animations' && e.id.startsWith('anim_'))
const seg = (id) => (/_(start|loop|loop2|end)$/.exec(id) || [])[1] || ''
const family = (id) => id.replace(/_(start|loop|loop2|end)$/, '')

// ① 家族结构：单段 / start+end / 三段
const fams = new Map()
for (const e of anims) {
  const f = family(e.id)
  if (!fams.has(f)) fams.set(f, { segs: new Set(), ids: [] })
  fams.get(f).segs.add(seg(e.id) || 'single')
  fams.get(f).ids.push(e.id)
}
const shapes = {}
for (const [, v] of fams) {
  const key = [...v.segs].sort().join('+')
  shapes[key] = (shapes[key] || 0) + 1
}

// ② 语义层级：用 semantic 的第 1/2 层做"层"与"类"
const layer1 = {}
const layer2 = {}
for (const e of anims) {
  const a = e.semantic[0] || '(无)'
  const b = e.semantic[1] || '(无)'
  layer1[a] = (layer1[a] || 0) + 1
  layer2[a + ' / ' + b] = (layer2[a + ' / ' + b] || 0) + 1
}

// ③ 时长分布（按家族形态）
const durs = { single: [], triple: [], loop: [] }
for (const e of anims) {
  const s = seg(e.id)
  if (!e.durationMs) continue
  if (s === 'loop' || s === 'loop2') durs.loop.push(e.durationMs)
  else if (s === 'start' || s === 'end') durs.loop.push(e.durationMs)
  else durs.single.push(e.durationMs)
}
const stat = (a) => {
  if (!a.length) return '—'
  const s = [...a].sort((x, y) => x - y)
  const med = s[Math.floor(s.length / 2)]
  return `n=${s.length} 中位=${(med / 1000).toFixed(1)}s 最短=${(s[0] / 1000).toFixed(1)}s 最长=${(s[s.length - 1] / 1000).toFixed(1)}s`
}

// ④ 场景族：work / break / story / wild 各自的家族数与典型 id
const sceneCount = {}
for (const f of fams.keys()) {
  const m = /^anim_([a-z]+)_/.exec(f)
  const k = m ? m[1] : '(other)'
  sceneCount[k] = (sceneCount[k] || 0) + 1
}

// ⑤ chair 槽是什么：控制器还是坐姿
const chairs = entries.filter((e) => e.slot === 'chairs')

// ⑥ 情绪 → 动作映射（游戏自己怎么把情绪落到动作上）
const actionMap = seed.actionMap || seed.actionmap || null

const lines = []
lines.push('# 游戏自身的动作编排语法（从 assets.seed.json 还原）')
lines.push('')
lines.push('## 槽位规模')
for (const [k, v] of Object.entries(slots).sort((a, b) => b[1] - a[1])) lines.push(`- ${k}: ${v}`)
lines.push('')
lines.push('## ① 家族结构（同一条动作被拆成几段）')
for (const [k, v] of Object.entries(shapes).sort((a, b) => b[1] - a[1])) lines.push(`- ${k}: ${v} 个家族`)
lines.push('')
lines.push('## ② 语义层级（第 1 层 = 场景，第 2 层 = 类别）')
for (const [k, v] of Object.entries(layer1).sort((a, b) => b[1] - a[1])) lines.push(`- ${k}: ${v}`)
lines.push('')
for (const [k, v] of Object.entries(layer2).sort((a, b) => b[1] - a[1]).slice(0, 14)) lines.push(`  - ${k}: ${v}`)
lines.push('')
lines.push('## ③ 时长（这是它自己的节奏，不是我们定的）')
lines.push(`- 单段动作: ${stat(durs.single)}`)
lines.push(`- 分段(start/loop/end): ${stat(durs.loop)}`)
lines.push('')
lines.push('## ④ 场景族分布')
for (const [k, v] of Object.entries(sceneCount).sort((a, b) => b[1] - a[1])) lines.push(`- ${k}: ${v} 个家族`)
lines.push('')
lines.push(`## ⑤ chair 槽 ${chairs.length} 条（游戏的"坐姿控制器"）`)
for (const c of chairs.slice(0, 8)) lines.push(`- ${c.id}  ${c.durationMs ? (c.durationMs / 1000).toFixed(1) + 's' : ''}  ${c.semantic.join('/')}`)
lines.push('')
if (actionMap) {
  lines.push('## ⑥ 情绪 → 动作（游戏自己的映射）')
  for (const [k, v] of Object.entries(actionMap)) lines.push(`- ${k}: ${Array.isArray(v) ? v.join(' / ') : v}`)
}

const out = root + 'docs/游戏编排语法.md'
writeFileSync(out, lines.join('\n'), 'utf8')

// 同时导出机器可用的一份：家族 → 段、时长、语义、场景
const grammar = {
  generatedAt: new Date().toISOString(),
  slotCounts: slots,
  families: Object.fromEntries(
    [...fams.entries()].map(([f, v]) => {
      const first = anims.find((e) => e.id === v.ids[0])
      const segDurations = {}
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
      }]
    })
  )
}
writeFileSync(root + 'lib/game-grammar.json', JSON.stringify(grammar), 'utf8')
console.log(lines.join('\n').split('\n').slice(0, 30).join('\n'))
console.log('\n  报告: 日志/游戏编排语法.md    机器用: lib/game-grammar.json')
