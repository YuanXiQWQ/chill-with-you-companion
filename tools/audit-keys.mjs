#!/usr/bin/env node
/**
 * 本机密钥残留审计。
 *
 *   node tools/audit-keys.mjs            # 报告（有意外命中 exit 1）
 *   node tools/audit-keys.mjs --fix     # 清残留（脱敏 + 删多余的凭据备份）
 *   node tools/audit-keys.mjs --json
 *
 * 与 scan-secrets 的分工：
 *   scan-secrets  查「仓库里有没有不该提交的凭据格式」，看格式（sk-…），不看具体值。
 *   本文件        查「本机这把真 key 都在哪些文件里躺着」，看具体值（与 store 里的比对），
 *                所以它能发现 scan-secrets 发现不了的东西：会话日志、临时脚本、备份副本。
 *
 * 规矩：值只在内存里比对，输出一律打码；连长度都只给个位数。
 */
import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const JSON_OUT = args.includes('--json')
const FIX = args.includes('--fix')
const HOME = String(process.env.USERPROFILE || process.env.HOME || '')
const DSH_HOME = String(process.env.DSH_HOME || '') || join(HOME, '.dsh')
const DATA_DIR = String(process.env.CHILL_DATA_DIR || '') || join(ROOT, 'data')

const SKIP_DIRS = new Set(['.git', 'node_modules', 'ref', 'dist', 'build', '__pycache__', 'gsv-src', 'gsv-venv', 'audio'])
const SKIP_EXT = /\.(wav|mp3|ogg|flac|pth|pt|ckpt|safetensors|onnx|gguf|h5|tflite|bin|bundle|assets|dll|exe|pdb|zip|7z|rar|png|jpe?g|gif|webp|ico|pdf|mp4|mov|ttf|otf|woff2?|so|dylib|db|sqlite)$/i
const MAX_BYTES = 8 * 1024 * 1024

const mask = (s) => s.slice(0, 3) + '***' + s.slice(-2) + ' len=' + s.length

/** 读 dsh 的 refs: 段（两空格缩进），与 lib/llm.mjs 同一套解析口径。 */
const readRefs = (file) => {
  const out = {}
  let text = ''
  try { text = readFileSync(file, 'utf8') } catch { return out }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^ {2}([A-Za-z0-9_]+):\s*"?([^"\s]+)"?\s*$/)
    if (m && m[2].length >= 16) out[m[1]] = m[2]
  }
  return out
}

/** 本机所有已知的凭据文件（找副本用的）。 */
const credentialFiles = () => {
  const found = []
  const push = (file, why) => {
    try {
      const st = statSync(file)
      if (st.isFile()) found.push({ file, why, bytes: st.size, mtime: st.mtime.toISOString() })
    } catch { /* 不存在就是不存在 */ }
  }
  push(join(DSH_HOME, '.credentials.yaml'), 'dsh 凭据（正本）')
  push(join(HOME, '.dsh', '.credentials.yaml'), 'dsh 凭据（HOME 下的副本？）')
  push(join(DATA_DIR, 'llm.json'), '插件 provider 配置')
  push(join(ROOT, 'data', 'llm.json'), '插件 provider 配置（仓库内 data/）')
  push(join(ROOT, '.env'), '.env')
  push(join(DSH_HOME, '.env'), '.env（dsh）')
  // 备份、换名、手工拷贝的副本：同一个目录下带 credentials / .env 的都算
  for (const dir of [DSH_HOME, join(HOME, '.dsh'), ROOT, DATA_DIR, join(HOME, 'Desktop'), join(HOME, 'Downloads')]) {
    let ents = []
    try { ents = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of ents) {
      if (!e.isFile()) continue
      if (!/credential|\.env|keys?\.(json|ya?ml|txt)$|token/i.test(e.name)) continue
      push(join(dir, e.name), '疑似凭据副本')
    }
  }
  // 同一个文件可能被两条规则各命中一次，按路径去重
  const seen = new Set()
  return found.filter((c) => {
    const k = c.file.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// 要搜的真值：refs 里的每个 key + llm.json 里的每个 token
const secrets = []
{
  for (const [ref, value] of Object.entries(readRefs(join(DSH_HOME, '.credentials.yaml')))) secrets.push({ ref, value })
  const llmFiles = [join(DATA_DIR, 'llm.json'), join(ROOT, 'data', 'llm.json')]
  for (const file of llmFiles) {
    let raw = null
    try { raw = JSON.parse(readFileSync(file, 'utf8')) } catch { continue }
    for (const p of raw?.providers || []) {
      if (typeof p?.token === 'string' && p.token.length >= 16) secrets.push({ ref: 'llm.json token (' + (p.id || '?') + ')', value: p.token })
    }
  }
}
// 正常存放点：这些文件里出现是应该的
const EXPECTED = new Set(
  [join(DSH_HOME, '.credentials.yaml'), join(DATA_DIR, 'llm.json'), join(ROOT, 'data', 'llm.json')].map((p) => p.toLowerCase()),
)

const hits = []
const scanFile = (file) => {
  let buf
  try { buf = readFileSync(file) } catch { return }
  if (buf.length > MAX_BYTES || buf.includes(0)) return
  const text = buf.toString('utf8')
  for (const { ref, value } of secrets) {
    let at = text.indexOf(value)
    while (at >= 0) {
      hits.push({
        file,
        line: text.slice(0, at).split('\n').length,
        ref,
        masked: mask(value),
        expected: EXPECTED.has(file.toLowerCase()),
      })
      at = text.indexOf(value, at + value.length)
    }
  }
}

const walk = (dir, depth = 0) => {
  if (depth > 6) return
  let ents = []
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name === '.git') continue
      walk(full, depth + 1)
      continue
    }
    if (SKIP_EXT.test(e.name)) continue
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isFile()) scanFile(full)
  }
}

const roots = [ROOT, DSH_HOME, join(HOME, '.dsh'), DATA_DIR]
// 临时脚本：我们这类排查脚本都写在 %TEMP%，落盘就是残留
if (process.env.TEMP) roots.push(String(process.env.TEMP))
// 去重（DATA_DIR 可能就在 ROOT 里）
const seen = new Set()
for (const dir of roots) {
  const key = dir.toLowerCase()
  if (seen.has(key)) continue
  seen.add(key)
  walk(dir)
}

/**
 * 清理：
 *  · 凭据文件的备份副本（*.credentials.yaml.bak-*）—— 整份删掉，它们只是旧 key 的复印件
 *  · 别处出现的同一把 key（会话记录 / 日志 / 临时 capture）—— 就地脱敏，保留文件本身
 * 不动正本：<DSH_HOME>/.credentials.yaml 与数据目录的 llm.json 是它该待的地方。
 */
const fix = () => {
  const removed = []
  const redacted = []
  const backups = creds.filter((c) => /credential.*\.(bak|old|orig|save)|~\.credentials|\.credentials\.yaml\./i.test(basename(c.file)))
  for (const c of backups) {
    if (EXPECTED.has(c.file.toLowerCase())) continue
    try {
      unlinkSync(c.file)
      removed.push(c.file)
    } catch (error) {
      removed.push(c.file + ' （删除失败：' + String(error && error.message || error) + '）')
    }
  }
  for (const h of unexpected) {
    let text = ''
    try { text = readFileSync(h.file, 'utf8') } catch { continue }
    let next = text
    for (const { value } of secrets) {
      if (!value) continue
      next = next.split(value).join('REDACTED-' + value.length)
    }
    if (next === text) continue
    try {
      writeFileSync(h.file, next, 'utf8')
      redacted.push(h.file)
    } catch (error) {
      redacted.push(h.file + ' （写入失败：' + String(error && error.message || error) + '）')
    }
  }
  return { removed, redacted }
}

const creds = credentialFiles()
const unexpected = hits.filter((h) => !h.expected)

let fixed = null
if (FIX && unexpected.length > 0) {
  fixed = fix()
}

if (JSON_OUT) {
  console.log(JSON.stringify({
    root: ROOT,
    dshHome: DSH_HOME,
    dataDir: DATA_DIR,
    secretsTracked: secrets.map((s) => ({ ref: s.ref, masked: mask(s.value) })),
    credentialFiles: creds,
    hits: hits.map((h) => ({ ...h, masked: h.masked })),
  }, null, 2))
} else {
  console.log('密钥来源（值一律打码）：')
  if (secrets.length === 0) console.log('  · 本机没读到任何 key（refs 段与 llm.json 都是空的）')
  for (const s of secrets) console.log('  · ' + s.ref + '  ' + mask(s.value))

  console.log('\n磁盘上的凭据文件：')
  if (creds.length === 0) console.log('  · 一个都没有')
  for (const c of creds) console.log('  · ' + c.file + '  (' + c.why + ', ' + c.bytes + 'B, ' + c.mtime.slice(0, 19).replace('T', ' ') + ')')

  console.log('\n这把 key 出现在哪些文件里：')
  if (hits.length === 0) console.log('  · 一处都没有（连正常存放点都没有——可能还没配 key）')
  for (const h of hits) {
    console.log('  ' + (h.expected ? '· [正常存放] ' : '✗ [不该有] ') + h.file + ':' + h.line + '  ' + h.ref + '  ' + h.masked)
  }

  if (fixed) {
    console.log('\n清理结果：')
    for (const f of fixed.removed) console.log('  - 已删除凭据备份 ' + f)
    for (const f of fixed.redacted) console.log('  ~ 已脱敏 ' + f)
    console.log('  提醒：这些文件里原本是明文，磁盘上可能还有影子副本（卷影/回收站），真要彻底就换钥。')
    process.exit(1)
  }
  if (unexpected.length === 0) console.log('\n✓ 没有意外残留')
  else console.log('\n✗ 有 ' + unexpected.length + ' 处意外残留，逐个清掉再提交')
}
process.exit(unexpected.length === 0 ? 0 : 1)