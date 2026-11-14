#!/usr/bin/env node
/**
 * 把本机 token 同步进游戏端 BepInEx 配置。
 *
 *   node tools/sync-token.mjs --check                 # 只看：token 在哪、游戏配置里是不是空的
 *   node tools/sync-token.mjs --apply --game "<游戏目录>"
 *   node tools/sync-token.mjs --apply --cfg "<...>/local.chill.performer.cfg"
 *
 * 为什么需要它：2026-11-14 起鉴权不再允许「空 token 放行」，`ChillPerformer.dll`
 * 只从 BepInEx 配置的 `brain.Token` 取凭据。不同步过去，表现是**游戏里她一动不动**，
 * 而 `health` 全绿——因为 `/chill/v1/play` 全部 401 了，DLL 只会安静地重试。
 *
 * token 值一律不打印，只报长度和前 4 位。写之前备份成 `.bak-<时间戳>`。
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveToken } from '../lib/config.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const arg = (n, d = '') => {
  const i = args.indexOf('--' + n)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d
}
const say = (tag, msg) => console.log('  ' + tag + ' ' + msg)
const mask = (t) => (t ? t.slice(0, 4) + '…（长度 ' + t.length + '）' : '（空）')

const dataDir = (() => {
  const explicit = arg('data-dir')
  if (explicit) return explicit
  const env = String(process.env.CHILL_DATA_DIR || '').trim()
  if (env) return env
  return join(ROOT, 'data')
})()

const token = resolveToken({ dataDir })
if (!token) {
  say('×', '拿不到 token：数据目录 ' + dataDir + ' 之类的问题，先启动一次侧车让它生成')
  process.exit(2)
}
say('·', 'token 来源 = ' + (process.env.CHILL_TOKEN ? 'CHILL_TOKEN 环境变量' : join(dataDir, 'token')))
say('·', 'token = ' + mask(token))

// 找配置：--cfg 指定 > --game 下的 BepInEx/config/*.cfg（挑含 [brain] 的那个）
const findCfg = () => {
  const direct = arg('cfg')
  if (direct) return existsSync(direct) ? direct : ''
  const game = arg('game') || String(process.env.CHILL_GAME_DIR || '').trim()
  if (!game) return ''
  const dir = join(game, 'BepInEx', 'config')
  if (!existsSync(dir)) return ''
  const hits = readdirSync(dir).filter((n) => n.endsWith('.cfg')).map((n) => join(dir, n))
    .filter((p) => { try { return /^\s*\[brain\]/m.test(readFileSync(p, 'utf8')) } catch { return false } })
  return hits.length === 1 ? hits[0] : (hits[0] || '')
}

const cfgPath = findCfg()
if (!cfgPath) {
  say('×', '没找到游戏端配置：用 --game "<游戏目录>" 或 --cfg "<...>.cfg" 指一下')
  process.exit(2)
}
say('·', '游戏配置 = ' + cfgPath)

const text = readFileSync(cfgPath, 'utf8')
const lines = text.split(/\r?\n/)
let section = ''
let changed = false
for (let i = 0; i < lines.length; i++) {
  const bare = lines[i].trim()
  const head = bare.match(/^\[(.+)\]$/)
  if (head) { section = head[1].trim(); continue }
  if (section !== 'brain') continue
  const kv = bare.match(/^(Token)\s*=\s*(.*)$/i)
  if (!kv) continue
  const current = kv[2].trim()
  if (current === token) { say('✓', 'brain.Token 已经是最新的（' + mask(current) + '），不用改') }
  else {
    lines[i] = 'Token = ' + token
    changed = true
    say('·', 'brain.Token ' + (current ? '旧值 ' + mask(current) + ' → ' : '原来是空 → ') + '写入新值')
  }
  break
}

if (!changed) process.exit(0)

if (!APPLY) {
  say('·', '预演：没落盘。加 --apply 才写')
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const backup = cfgPath + '.bak-' + stamp
copyFileSync(cfgPath, backup)
// 无 BOM：BepInEx 读 cfg 时不剥 BOM，带 BOM 会让 section 名变成 "\uFEFF[brain]"
writeFileSync(cfgPath, lines.join('\r\n'), 'utf8')
say('✓', '已写入 ' + cfgPath)
say('·', '备份 ' + backup)
say('·', '游戏里正在跑的话，重启游戏（或重进一次场景）让 DLL 重新读配置')
