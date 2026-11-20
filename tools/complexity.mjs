// 项目复杂度体检：规模、分布、热点文件。
// 只统计代码与文档，跳过 node_modules / 语音缓存 / 知识库 / 游戏本体。
import fs from 'node:fs'
import path from 'node:path'

// 仓库根现算：发布体检不允许代码里出现字面量盘符（CHILL_REPO 可覆盖，便于在别处跑）。
const ROOT = process.env.CHILL_REPO || new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const SKIP_DIRS = new Set(['node_modules', '.git', 'audio', 'kb', 'kb-sync', 'gsv-src', 'gsv-venv', 'tools-cache'])
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.cs', '.ps1', '.ts', '.json', '.md', '.yml', '.yaml', '.html', '.css'])
// 不算"代码"的：机器数据、种子清单
const DATA_ONLY = /(anim-types|assets\.seed|live-performance|-dump|chill-enum|chill-clips|chill-skin|chill-face)/

const files = []
function walk(dir, depth) {
  let ents
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      if (depth > 6) continue
      walk(full, depth + 1)
    } else {
      const ext = path.extname(e.name).toLowerCase()
      if (!CODE_EXT.has(ext)) continue
      let st
      try { st = fs.statSync(full) } catch { continue }
      let text = ''
      try { text = fs.readFileSync(full, 'utf8') } catch { continue }
      const lines = text.split('\n').length
      // 非空非注释行更有意义
      let codeLines = 0
      for (const l of text.split('\n')) {
        const t = l.trim()
        if (!t) continue
        if (t.startsWith('//') || t.startsWith('#') || t.startsWith('*') || t.startsWith('/*')) continue
        codeLines++
      }
      files.push({
        rel: path.relative(ROOT, full).replace(/\\/g, '/'),
        ext, lines, codeLines, bytes: st.size, dataOnly: DATA_ONLY.test(e.name),
      })
    }
  }
}
walk(ROOT, 0)

const sum = (arr, k, f) => arr.reduce((a, x) => a + (f ? x[k] : x[k]), 0)

// 按顶层目录分桶
const buckets = new Map()
for (const f of files) {
  const top = f.rel.includes('/') ? f.rel.split('/')[0] : '(根)'
  if (!buckets.has(top)) buckets.set(top, { files: 0, lines: 0, codeLines: 0, bytes: 0 })
  const b = buckets.get(top)
  b.files++; b.lines += f.lines; b.codeLines += f.codeLines; b.bytes += f.bytes
}

const out = []
out.push('=== 按顶层目录 ===')
out.push('目录                 文件   总行    代码行    KB')
for (const [k, v] of [...buckets.entries()].sort((a, b) => b[1].codeLines - a[1].codeLines)) {
  out.push(
    k.padEnd(20) +
    String(v.files).padStart(4) +
    String(v.lines).padStart(7) +
    String(v.codeLines).padStart(8) +
    (v.bytes / 1024).toFixed(0).padStart(7),
  )
}

const real = files.filter((f) => !f.dataOnly)
out.push('')
out.push('=== 按扩展名（排除机器数据）===')
const byExt = new Map()
for (const f of real) {
  if (!byExt.has(f.ext)) byExt.set(f.ext, { files: 0, lines: 0, codeLines: 0 })
  const b = byExt.get(f.ext)
  b.files++; b.lines += f.lines; b.codeLines += f.codeLines
}
for (const [k, v] of [...byExt.entries()].sort((a, b) => b[1].codeLines - a[1].codeLines)) {
  out.push(k.padEnd(10) + String(v.files).padStart(4) + String(v.lines).padStart(8) + String(v.codeLines).padStart(9))
}

out.push('')
out.push('=== 最大的 22 个文件（按代码行）===')
for (const f of real.sort((a, b) => b.codeLines - a.codeLines).slice(0, 22)) {
  out.push(String(f.codeLines).padStart(6) + '  ' + String(f.lines).padStart(6) + '  ' + f.rel)
}

out.push('')
out.push('=== 合计 ===')
out.push('全部扫描文件 ' + files.length + '，代码文件 ' + real.length)
out.push('总行 ' + sum(real, 'lines') + '，代码行 ' + sum(real, 'codeLines'))

const report = out.join('\n')
fs.writeFileSync(ROOT + '/data/complexity.txt', report, 'utf8')
console.log(report.split('\n').slice(0, 30).join('\n'))
console.log('...')
console.log('report -> ' + ROOT + '/data/complexity.txt')
