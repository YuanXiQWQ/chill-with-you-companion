#!/usr/bin/env node
/**
 * 发布前自检：推 GitHub 之前跑一次，看有什么会漏出去。
 *
 *   node tools/check-publish.mjs
 *
 * 干三件事：
 *   1) 按 .gitignore 算出「哪些文件真的会被提交」，连同总体积一起报；
 *   2) 对会被提交的文本文件扫一遍可疑内容（明文密钥、本机绝对路径、用户名）；
 *   3) 对会被提交的二进制 / 大文件报警（游戏资源、TTS 缓存最容易从这里漏）。
 *
 * 只读，不改任何东西。退出码：0 干净，1 有需要处理的问题。
 */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// 不能用 URL.pathname：插件路径里有中文（日志），pathname 会给出 %E6%97%A5%E5%BF%97 这种编码形式。
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const IGNORE_FILE = join(ROOT, '.gitignore')

const TEXT_EXT = /\.(js|mjs|cjs|json|md|txt|yml|yaml|html|css|cs|csproj|sln|props|py|ps1|sh|xml|toml)$/i
const BIG = 200 * 1024
const HUGE = 1024 * 1024

/** gitignore 语法只实现用到的那几样：目录、通配、精确路径、! 取反。 */
function toRule(line) {
  const raw = line.trim()
  if (raw === '' || raw.startsWith('#')) return null
  const negate = raw.startsWith('!')
  const body = (negate ? raw.slice(1) : raw).replace(/^\.\//, '').replace(/\/+$/, '')
  if (body === '') return null
  const escaped = body.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')
  // 没有斜杠的规则匹配任意层级的同名项；有斜杠的从仓库根锚定
  const anchored = body.includes('/')
  const re = new RegExp(anchored ? '^' + escaped + '(/|$)' : '(^|/)' + escaped + '(/|$)')
  return { negate, re, body }
}

const rules = existsSync(IGNORE_FILE)
  ? readFileSync(IGNORE_FILE, 'utf8').split(/\r?\n/).map(toRule).filter(Boolean)
  : []

function isIgnored(relPath) {
  let ignored = false
  for (const rule of rules) {
    if (rule.re.test(relPath)) ignored = !rule.negate
  }
  return ignored
}

const walk = (dir, out) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

// .gitignore 只能说明「正常情况下不会提交」，git add -f 进来的照样在仓库里。
// 有 git 时以真实的 index 为准，没有才退回按规则推断。
function gitTracked() {
  try {
      const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const list = out.split('\0').filter(Boolean)
    return list.length ? list : null
  } catch {
    return null
  }
}
const tracked = gitTracked()

const all = walk(ROOT, [])
const shipped = []
const ignored = []
for (const full of all) {
  const rel = relative(ROOT, full).replace(/\\/g, '/')
  // tracked 为 null 表示没有 git：退回按 .gitignore 推断
  const willShip = tracked ? tracked.includes(rel) : !isIgnored(rel)
  ;(willShip ? shipped : ignored).push({ rel, full, size: statSync(full).size })
}

const kb = (n) => (n / 1024).toFixed(0) + ' KB'
const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB'

console.log('仓库根 ' + ROOT)
console.log('规则 ' + rules.length + ' 条（来自 .gitignore）\n')
console.log('会提交 ' + shipped.length + ' 个文件，共 ' + mb(shipped.reduce((a, f) => a + f.size, 0)))
console.log('被忽略 ' + ignored.length + ' 个文件，共 ' + mb(ignored.reduce((a, f) => a + f.size, 0)) + '\n')

const problems = []
const warnings = []

// ---- 1. 明文密钥 ----
const SECRET = /(sk-[A-Za-z0-9]{20,})|(ghp_[A-Za-z0-9]{20,})|(AKIA[0-9A-Z]{16})|(-----BEGIN [A-Z ]*PRIVATE KEY-----)/
// provider 的 token 字段允许为空串，非空的才报
const TOKEN_FIELD = /"token"\s*:\s*"([^"]{12,})"/

for (const f of shipped) {
  if (!TEXT_EXT.test(f.rel)) continue
  // 体检器自己写着这些正则字面量，扫自己必然自我命中
  if (f.rel.replace(/\\/g, '/').endsWith('tools/check-publish.mjs')) continue
  const text = readFileSync(f.full, 'utf8')
  text.split(/\r?\n/).forEach((line, i) => {
    const secret = line.match(SECRET)
    if (secret) problems.push(f.rel + ':' + (i + 1) + '  明文密钥  ' + secret[1].slice(0, 12) + '…')
    const tok = line.match(TOKEN_FIELD)
    if (tok && !/^x+$/i.test(tok[1])) {
      problems.push(f.rel + ':' + (i + 1) + '  provider 里存了明文 token（' + tok[1].length + ' 字符）')
    }
  })
}

// ---- 2. 本机绝对路径 / 用户名 ----
  const PERSONAL = [
    /[A-Za-z]:[\\/]+Users[\\/]+[A-Za-z0-9_.-]+/i,   // C:\Users\name，也认正斜杠
    /[A-Za-z]:[\\/]+dsh[\\/]/i,                     // 本机工作区根
    /[A-DF-WYZ]:[\\/]+SteamLibrary/i,                 // 真实 Steam 库（X: 是文档占位，放过）
    /\/home\/[A-Za-z0-9_-]+/,                          // macOS / Linux 家目录
    /\/Users\/[A-Za-z0-9_.-]+/,
  ]
for (const f of shipped) {
    // 检查器自己写着这些正则，扫自己必然自我命中
    if (f.rel.replace(/\\/g, '/').endsWith('tools/check-publish.mjs')) continue
  if (!TEXT_EXT.test(f.rel)) continue
  readFileSync(f.full, 'utf8').split(/\r?\n/).forEach((line, i) => {
    for (const re of PERSONAL) {
      const m = line.match(re)
      if (m) problems.push(f.rel + ':' + (i + 1) + '  本机路径  ' + line.trim().slice(0, 70))
    }
  })
}

// ---- 3. 大文件 / 二进制 ----
for (const f of shipped) {
  // ---- 硬禁：模型权重与凭据，就算 git add -f 也不许进 ----
  const MODEL_WEIGHT = /\.(pth|pt|ckpt|safetensors|onnx|gguf|h5|tflite)$/i
  const SECRET_FILE = /(^|\/)(llm\.json|\.credentials\.yaml|tokens\.json|\.env(\.[^/]*)?)$/i
  if (MODEL_WEIGHT.test(f.rel)) problems.push(f.rel + '  模型权重属于私人内容，不随包')
  if (SECRET_FILE.test(f.rel)) problems.push(f.rel + '  凭据文件属于私人内容，不随包')

  if (f.size >= HUGE) problems.push(f.rel + '  ' + mb(f.size) + '  超过 1 MB，确认是否该进仓库')
  else if (f.size >= BIG) warnings.push(f.rel + '  ' + kb(f.size) + '  偏大')
  // 无扩展名的约定文件也是纯文本：LICENSE / NOTICE / CODEOWNERS / VERSION
  const isDotfile = /(^|\/)\.(gitignore|gitattributes|editorconfig)$/.test(f.rel)
  const isBareText = /(^|\/)(LICENSE|LICENCE|NOTICE|COPYING|CODEOWNERS|VERSION|AUTHORS|Makefile|Dockerfile)$/.test(f.rel)
  // 我们自己的编译产物：游戏端 BepInEx 插件。源码就在 game/src/，产物随包是刻意的——
  // 它没有下载渠道，用户不装 .NET SDK 也必须能装起来。
  const isOwnBinary = /^game\/[^/]+\.dll$/i.test(f.rel)
  if (!TEXT_EXT.test(f.rel) && !isDotfile && !isBareText && !isOwnBinary && !/\.(png|jpg|jpeg|svg|gif|webp|ico)$/i.test(f.rel)) {
    problems.push(f.rel + '  ' + kb(f.size) + '  二进制文件，确认不是游戏资源')
  }
}

// ---- 4. 聪音的默认设定必须随包 ----
// 内置角色卡不是仓库里的文件：它由 persona.md 在首次启动时播种生成（见 brain.mjs 的 seedPersona）。
// 所以随包的源头是这两样，缺一个新用户装完就是空壳。
if (!shipped.some((f) => f.rel === 'persona.md')) {
  problems.push('persona.md 缺失——聪音的默认人格是随包内容，播种角色卡要用它')
}
if (!shipped.some((f) => f.rel === 'lib/characters.mjs')) {
  problems.push('lib/characters.mjs 缺失——内置角色卡靠它播种，缺了 persona.md 也用不上')
}

// ---- 5. 明文密钥：硬门 ----
// 密钥一旦进了仓库，撤销之前它一直是活的凭据。这一条不通过就不许发布。
{
  // 用 spawnSync 而不是 execFileSync：后者抛异常时错误对象的形状随 Node 版本变，
  // 拿不到子进程输出就会变成"检查未通过"但没有任何原因，比不检查还难查。
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'scan-secrets.mjs')], { encoding: 'utf8' })
  if (r.status !== 0) {
    const out = String(r.stdout || '') + String(r.stderr || '') + (r.error ? String(r.error.message || r.error) : '')
    problems.push('明文密钥检查未通过（status=' + r.status + '）：\n' + out.trim().split('\n').slice(0, 12).join('\n  '))
  }
}

const show = (title, list, limit) => {
  if (list.length === 0) return
  console.log(title + '（' + list.length + '）')
  list.slice(0, limit).forEach((l) => console.log('  ' + l))
  if (list.length > limit) console.log('  …还有 ' + (list.length - limit) + ' 条')
  console.log()
}

show('问题', problems, 30)
show('警告', warnings, 20)

console.log('最大的 8 个会提交文件：')
shipped.slice().sort((a, b) => b.size - a.size).slice(0, 8)
  .forEach((f) => console.log('  ' + kb(f.size).padStart(8) + '  ' + f.rel))

process.exit(problems.length > 0 ? 1 : 0)
