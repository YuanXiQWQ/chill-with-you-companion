#!/usr/bin/env node
/**
 * 密钥闸门：本仓库、以及（可选）数据目录里不许出现明文密钥。
 *
 *   node tools/scan-secrets.mjs              # 扫仓库，有命中就 exit 1
 *   node tools/scan-secrets.mjs --include-data
 *   node tools/scan-secrets.mjs --history    # 连 git 历史一起扫（老提交里的残留）
 *   node tools/scan-secrets.mjs --json
 *
 * 为什么要这个：token 一旦进了仓库或会话日志，撤销之前它一直是活的凭据。
 * 提交前扫一遍比事后换钥便宜得多。
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const has = (f) => args.includes('--' + f)

const PATTERNS = [
  { label: 'sk- 风格 API key', re: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { label: 'Bearer 令牌', re: /Bearer\s+([A-Za-z0-9_.-]{24,})/g },
  { label: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: 'GitHub token', re: /\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/g },
  { label: 'PEM 私钥', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { label: '赋值式的长凭据', re: /\b(?:api[_-]?key|secret|password|passwd|access[_-]?token)\s*[:=]\s*["']?([A-Za-z0-9_\-.]{24,})["']?/gi },
]
const SKIP_DIRS = new Set(['.git', 'node_modules', 'ref', 'dist', 'build', '__pycache__'])
const SKIP_EXT = /\.(wav|mp3|ogg|flac|pth|pt|ckpt|safetensors|onnx|gguf|h5|tflite|bin|bundle|assets|dll|exe|pdb|zip|7z|rar|png|jpe?g|gif|webp|bmp|ico|pdf|mp4|mov|ttf|otf|woff2?|so|dylib)$/i
const MAX_BYTES = 4 * 1024 * 1024
// 测试桩、占位符、文档示例不该报：它们本来就不是凭据
// 只放行「整体就是个占位符」的值，不能带 .* 前缀：
// 带 .* 时，"末尾恰好是 EXAMPLE 的真格式 AWS key"会被静默放过（实测漏报过一次）。
const PLACEHOLDER = /^(?:sk-(?:test|demo|xxx|fake|placeholder|your)|REDACTED[A-Z_]*$|YOUR[_-]?[A-Z_]*$|CHANGEME$|EXAMPLE[A-Z_]*$|PLACEHOLDER[A-Z_]*$)/i


const mask = (s) => (s.length <= 10 ? s.slice(0, 2) + '***' : s.slice(0, 6) + '…' + s.slice(-4) + ' len=' + s.length)

const hits = []
const scanFile = (file) => {
  let buf
  try { buf = readFileSync(file) } catch { return }
  if (buf.length > MAX_BYTES || buf.includes(0)) return
  const text = buf.toString('utf8')
  for (const { label, re } of PATTERNS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text))) {
      const value = m[1] || m[0]
      if (PLACEHOLDER.test(value)) continue
      hits.push({ file, label, masked: mask(value), line: text.slice(0, m.index).split('\n').length, value })
      if (re.lastIndex === m.index) re.lastIndex += 1
    }
  }
}
const walk = (dir, depth = 0) => {
  if (depth > 8) return
  let ents
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (e.name.startsWith('.') && e.name !== '.env.example') {
      if (SKIP_DIRS.has(e.name) || e.name === '.git') continue
    }
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      walk(full, depth + 1)
      continue
    }
    if (SKIP_EXT.test(e.name)) continue
    let st
    try { st = statSync(full) } catch { continue }
    if (!st.isFile()) continue
    if (!has('include-data')) {
      const rel = relative(ROOT, full).replace(/\\/g, '/')
      // data/ 是运行时目录：里面本来就会存用户自己的 key（llm.json）。
      // 它不进仓库，所以默认不扫；要扫就显式 --include-data。
      if (/^data\//.test(rel)) continue
    }
    scanFile(full)
  }
}
const scanHistory = async () => {
  const { execFileSync } = await import('node:child_process')
  let text = ''
  try {
    text = execFileSync('git', ['log', '-p', '--all', '--unified=0', '--no-color', '--pretty=format:__C__%H'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 120000 })
  } catch (error) {
    console.log('  ! git 历史读取失败，跳过：' + String(error && error.message || error))
    return
  }
  let sha = ''
  let file = ''
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('__C__')) { sha = line.slice(5, 12); file = ''; continue }
    if (line.startsWith('+++ b/')) { file = line.slice(6); continue }
    if (!line.startsWith('+') || line.startsWith('+++')) continue
    const body = line.slice(1)
    for (const { label, re } of PATTERNS) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(body))) {
        const value = m[1] || m[0]
        if (PLACEHOLDER.test(value)) continue
        hits.push({ file: (file || '(未知文件)') + ' @' + (sha || '(未知提交)'), label, masked: mask(value), line: 0, value, history: true })
        if (re.lastIndex === m.index) re.lastIndex += 1
      }
    }
  }
}

if (has('history')) await scanHistory()

walk(ROOT)

if (has('json')) {
  console.log(JSON.stringify({ root: ROOT, hits: hits.map(({ value, ...rest }) => rest) }, null, 2))
} else if (hits.length === 0) {
  console.log('✓ 没有明文密钥（扫描目录 ' + ROOT + (has('include-data') ? '，含 data/' : '') + '）')
} else {
  console.log('✗ 发现 ' + hits.length + ' 处明文密钥：')
  for (const h of hits) {
    const where = h.history ? h.file : relative(ROOT, h.file).replace(/\\/g, '/') + ':' + h.line
    console.log('  ' + (h.history ? '[历史] ' : '') + where + '  ' + h.label + '  ' + h.masked)
  }
  console.log('\n这些都不该出现在仓库里。撤销换钥之后，用 tools/rotate-key.mjs 把新钥只写进 credentials。')
}
process.exit(hits.length === 0 ? 0 : 1)
