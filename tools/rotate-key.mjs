#!/usr/bin/env node
/**
 * 一键换钥：把新 key 写进 DSH 凭据文件，并把旧的从旁路副本里抹掉。
 *
 *   node tools/rotate-key.mjs --key sk-xxxx                      # 只看会改什么
 *   node tools/rotate-key.mjs --key sk-xxxx --apply
 *   node tools/rotate-key.mjs --name DEEPSEEK_API_KEY --key sk-xxxx --apply
 *
 * 换钥的**唯一真正有效**的一步是在服务商控制台撤销旧 key；本脚本负责把新 key
 * 落到本机该落的地方、并清掉旧 key 在磁盘上的残留副本。
 * 本脚本永不打印 key 本身，只打印指纹（前 6 位 + 长度）。
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const val = (name) => {
  const i = args.indexOf('--' + name)
  if (i < 0) return null
  const next = args[i + 1]
  return next && !next.startsWith('--') ? next : true
}
const APPLY = val('apply') === true
const NAME = typeof val('name') === 'string' ? val('name') : 'DEEPSEEK_API_KEY'
const KEY = typeof val('key') === 'string' ? val('key').trim() : ''
const fingerprint = (s) => s.slice(0, 6) + '… len=' + s.length

if (!KEY) {
  console.log('用法：node tools/rotate-key.mjs --key sk-xxxx [--name DEEPSEEK_API_KEY] [--apply]')
  console.log('新 key 从哪里来：https://platform.deepseek.com/api_keys → 先删旧的，再建新的。')
  process.exit(2)
}
if (!/^[A-Za-z0-9_-]{16,}$/.test(KEY)) {
  console.log('这个不像 key（只该有字母数字和 -_）：' + fingerprint(KEY))
  process.exit(2)
}

const candidates = []
if (process.env.DSH_HOME) candidates.push(join(process.env.DSH_HOME, '.credentials.yaml'))
candidates.push(join(process.env.USERPROFILE || '', '.dsh', '.credentials.yaml'), 'D:/dshl/.dsh/.credentials.yaml')
const cred = candidates.find((p) => p && existsSync(p))
if (!cred) {
  console.log('没找到 DSH 凭据文件，试过：\n  ' + candidates.filter(Boolean).join('\n  '))
  process.exit(2)
}
console.log('凭据文件：' + cred)
console.log('目标字段：' + NAME)
console.log('新值指纹：' + fingerprint(KEY))

const raw = readFileSync(cred, 'utf8')
const eol = raw.includes('\r\n') ? '\r\n' : '\n'
const lines = raw.split(/\r?\n/)
const idx = lines.findIndex((l) => new RegExp('^' + NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:').test(l))
if (idx < 0) {
  console.log('✗ 文件里没有 ' + NAME + ' 这一项。现有字段：')
  lines.filter((l) => /^[A-Za-z0-9_]+\s*:/.test(l)).forEach((l) => console.log('  ' + l.split(':')[0]))
  process.exit(1)
}
const before = lines[idx]
const quote = /"\s*$/.test(before.trim()) ? '"' : ''
lines[idx] = NAME + ': ' + quote + KEY + quote
const nextText = lines.join(eol)

if (!APPLY) {
  console.log('· 会替换第 ' + (idx + 1) + ' 行（加 --apply 才执行）')
  console.log('· 备份：' + cred + '.bak-<时间戳>')
  process.exit(0)
}
copyFileSync(cred, cred + '.bak-' + Date.now())
// 不带 BOM：带 BOM 的配置会让解析器读出怪字段
writeFileSync(cred, nextText, 'utf8')
console.log('✓ 已写入（原文件已备份，无 BOM）')

// 旁的明文副本：会话缓存里可能留着一份，换完钥就把它抹掉
const storages = [join(process.env.DSH_HOME || 'D:/dshl/.dsh', 'storages')]
let scrubbed = 0
for (const dir of storages) {
  if (!existsSync(dir)) continue
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let ents = []
    try { ents = readdirSync(cur, { withFileTypes: true }) } catch { continue }
    for (const e of ents) {
      const full = join(cur, e.name)
      if (e.isDirectory()) { stack.push(full); continue }
      if (!/\.(json|jsonl|log|txt|md|yaml|yml)$/i.test(e.name)) continue
      let st
      try { st = statSync(full) } catch { continue }
      if (st.size > 40 * 1024 * 1024) continue
      let text
      try { text = readFileSync(full, 'utf8') } catch { continue }
      if (!/sk-[A-Za-z0-9_-]{16,}/.test(text)) continue
      const cleaned = text.replace(/\bsk-[A-Za-z0-9_-]{16,}/g, 'REDACTED_BY_ROTATE_KEY')
      if (cleaned === text) continue
      copyFileSync(full, full + '.bak-' + Date.now())
      writeFileSync(full, cleaned, 'utf8')
      scrubbed += 1
      console.log('  ✓ 抹掉残留副本：' + full)
    }
  }
}
console.log('✓ 清理完成，抹掉 ' + scrubbed + ' 个残留副本')
console.log('\n还差一步（只有你能做）：回到 https://platform.deepseek.com/api_keys 把旧 key 删掉。')
console.log('删完重启 dsh web，再在面板「模型」里点一次测试。')