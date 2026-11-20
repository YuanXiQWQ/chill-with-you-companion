// 结构复杂度：不看行数，看"改一处要动几个地方"。
// 重点量化三类脆弱面：平行数组协议、反射字符串、正则表。
import fs from 'node:fs'
import path from 'node:path'

// 仓库根现算：发布体检不允许代码里出现字面量盘符。
const ROOT = process.env.CHILL_REPO || new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p) => { try { return fs.readFileSync(ROOT + '/' + p, 'utf8') } catch { return '' } }

const out = []

// ── 1. 平行数组协议 ──────────────────────────────────────────
out.push('=== 平行数组协议（每次加字段要同步的地方）===')
const brain = read('brain.mjs')
const plugin = read('game/src/PerformerPlugin.cs')
const fields = ['slots', 'ids', 'ats', 'durations', 'holds', 'nativeNames', 'nativeSubs', 'nativeAlsos', 'stateNames', 'facials']
for (const f of fields) {
  const inBrain = (brain.match(new RegExp('act\\.' + f + '\\s*=', 'g')) || []).length
  const cap = f[0].toUpperCase() + f.slice(1)
  const inDllRead = (plugin.match(new RegExp('"' + f + '"', 'g')) || []).length
  out.push('  ' + f.padEnd(14) + ' brain 赋值 ' + inBrain + '   DLL 读 ' + inDllRead)
}
out.push('  → 每加一个 cue 字段：brain.mjs 改 1 处、DLL 两条解析分支各改 1 处、CueDto 加 1 个字段、actions.js/nativeOf 各改 1 处 = 5 处')

// ── 2. 反射字符串 ────────────────────────────────────────────
out.push('')
out.push('=== 反射字符串（游戏更新就可能静默失效）===')
const csFiles = ['game/src/PerformerPlugin.cs', 'game/src/ReflectConsole.cs', 'game/src/SceneProbe.cs', 'game/src/AnimIdMap.cs', 'game/src/GameBusy.cs']
let totalReflect = 0
for (const f of csFiles) {
  const t = read(f)
  const n = (t.match(/GetMethod\(|GetField\(|GetProperty\(|GetType\(|Enum\.Parse|GetTypes\(/g) || []).length
  totalReflect += n
  out.push('  ' + f.replace('game/src/', '').padEnd(22) + n)
}
out.push('  合计 ' + totalReflect + ' 个反射入口；每个都是一条"字符串对不上就静默 null"的路径')

// ── 3. 正则表 ────────────────────────────────────────────────
out.push('')
out.push('=== 正则表（actions.js 的判定入口）===')
const actions = read('lib/actions.js')
const reCount = (actions.match(/re: \//g) || []).length
out.push('  actions.js 里的 re: 共 ' + reCount + ' 条')
const verbCount = (actions.match(/^  [a-z_0-9]+: \{/gm) || []).length
out.push('  动词条目 ' + verbCount + ' 个')
out.push('  → 每条正则都是一个"写窄了漏判、写宽了误判"的调参点，最近的 music/sleep 就各栽了一次')

// ── 4. 单文件函数规模 ────────────────────────────────────────
out.push('')
out.push('=== 最长的函数（前 15）===')
function scanJs(file) {
  const t = read(file)
  if (!t) return []
  const lines = t.split('\n')
  const res = []
  // 顶层 function / export function
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/)
    if (!m) continue
    let depth = 0, started = false, end = i
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') { depth++; started = true }
        else if (ch === '}') depth--
      }
      if (started && depth <= 0) { end = j; break }
    }
    res.push({ file, name: m[1], len: end - i + 1 })
  }
  return res
}
function scanCs(file) {
  const t = read(file)
  if (!t) return []
  const lines = t.split('\n')
  const res = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s{4,}(?:public|private|internal|protected)\s+(?:static\s+)?(?:IEnumerator|void|bool|string|int|float|Type|object|[A-Z]\w*)\s+(\w+)\s*\(/)
    if (!m) continue
    let depth = 0, started = false, end = i
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') { depth++; started = true }
        else if (ch === '}') depth--
      }
      if (started && depth <= 0) { end = j; break }
    }
    res.push({ file, name: m[1], len: end - i + 1 })
  }
  return res
}
let fns = []
for (const f of ['brain.mjs', 'lib/client.js', 'lib/work.mjs', 'lib/core.js', 'index.js', 'lib/kb.mjs', 'lib/memory-store.mjs', 'lib/motion-class.js', 'lib/arrange.js', 'lib/needs.js', 'lib/director.js']) fns = fns.concat(scanJs(f))
for (const f of csFiles) fns = fns.concat(scanCs(f))
for (const f of fns.sort((a, b) => b.len - a.len).slice(0, 15)) {
  out.push('  ' + String(f.len).padStart(5) + ' 行  ' + f.file.replace('game/src/', '') + ' :: ' + f.name)
}
out.push('  （共识别 ' + fns.length + ' 个具名函数）')

// ── 5. 模块依赖 ──────────────────────────────────────────────
out.push('')
out.push('=== 模块依赖（谁被最多人 import）===')
const deps = new Map()
function walk(dir) {
  let ents
  try { ents = fs.readdirSync(ROOT + '/' + dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(dir ? dir + '/' + e.name : e.name); continue }
    if (!/\.(m?js|cjs)$/.test(e.name)) continue
    const p = dir ? dir + '/' + e.name : e.name
    const t = read(p)
    for (const m of t.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(p), m[1]))
      deps.set(target, (deps.get(target) || 0) + 1)
    }
  }
}
walk('')
for (const [k, v] of [...deps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  out.push('  ' + String(v).padStart(3) + ' 次  ' + k)
}

const report = out.join('\n')
fs.writeFileSync(ROOT + '/data/complexity-struct.txt', report, 'utf8')
console.log(report)
