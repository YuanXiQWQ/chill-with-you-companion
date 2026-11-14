#!/usr/bin/env node
/**
 * 鉴权与 token 落地：2026-11-14 之前 `cfg.token` 为空即放行，本机任何进程都能读她的记忆。
 * 这个文件锁住四件事：
 *   1. 没有 token 就不放行（没有「空 = 信任」这条分支）
 *   2. 常数时间比较认 Bearer / x-chill-token 两种头
 *   3. token 由 resolveToken() 保证非空，首次生成 64 位 hex 且可重复读回
 *   4. token 值不进任何响应（health / meta / view）
 */
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { createAuth } from '../lib/http.mjs'
import { resolveToken } from '../lib/config.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const brain = readFileSync(join(ROOT, 'brain.mjs'), 'utf8')
const httpSrc = readFileSync(join(ROOT, 'lib', 'http.mjs'), 'utf8')

// 1) 空 token 一律拒绝
{
  const auth = createAuth({ token: '' })
  assert.equal(auth({ headers: {} }), false, '空 token 时无头请求必须 401')
  assert.equal(auth({ headers: { 'x-chill-token': '' } }), false, '空 token 时空头也不许过')
  assert.equal(auth({ headers: { authorization: 'Bearer ' } }), false, '空 token 时空 Bearer 也不许过')
}

// 2) 两种头都认，错的不认
{
  const token = 'a'.repeat(64)
  const auth = createAuth({ token })
  assert.equal(auth({ headers: {} }), false, '没头 → 拒')
  assert.equal(auth({ headers: { 'x-chill-token': 'b'.repeat(64) } }), false, '错 token → 拒')
  assert.equal(auth({ headers: { 'x-chill-token': token } }), true, 'x-chill-token 对 → 过')
  assert.equal(auth({ headers: { authorization: 'Bearer ' + token } }), true, 'Bearer 对 → 过')
  assert.equal(auth({ headers: { authorization: 'Token ' + token } }), false, '非 Bearer 前缀 → 拒')
  // 前缀相同但长度不同：sha256 归一到定长再比，不该因为提前返回而抛
  assert.equal(auth({ headers: { 'x-chill-token': token.slice(0, 10) } }), false, '前缀不算命中')
}

// 3) 不再有「空 = 放行」的代码路径
assert.ok(!/if \(!cfg\.token\) return true/.test(httpSrc), 'http.mjs 里不许再出现空 token 放行')
assert.match(httpSrc, /timingSafeEqual/, '比较要走常数时间')
assert.match(httpSrc, /createHash\('sha256'\)/, '先 sha256 归一到定长再比')

// 4) resolveToken：配置 > 环境变量 > 文件；文件缺失时生成 64 位 hex 且可重复读回
{
  const dir = mkdtempSync(join(tmpdir(), 'chill-token-'))
  const first = resolveToken({ dataDir: dir })
  assert.match(first, /^[0-9a-f]{64}$/, '生成的 token 是 64 位 hex')
  assert.ok(existsSync(join(dir, 'token')), 'token 落到 <数据目录>/token')
  const second = resolveToken({ dataDir: dir })
  assert.equal(second, first, '第二次读到同一个值（不会每次重启换 token）')
  assert.equal(resolveToken({ explicit: 'from-config', dataDir: dir }), 'from-config', '配置优先')
  const bak = process.env.CHILL_TOKEN
  process.env.CHILL_TOKEN = 'from-env'
  assert.equal(resolveToken({ dataDir: dir }), 'from-env', '环境变量优先于文件')
  if (bak === undefined) delete process.env.CHILL_TOKEN
  else process.env.CHILL_TOKEN = bak
}

// 5) token 不进响应：health / meta 的 payload 里不能出现 cfg.token
assert.ok(!/token:\s*cfg\.token/.test(brain), 'health/meta 不能把 token 拼进响应')
assert.ok(!/res\.end\(\s*cfg\.token/.test(brain), '没有直接回吐 token 的路由')
// 只允许出现在鉴权与拼 URL 的地方
const hits = brain.split('\n').filter((l) => /cfg\.token/.test(l))
assert.ok(hits.length <= 3, 'cfg.token 的使用点应极少（实际 ' + hits.length + ' 处）')

console.log('  PASS 鉴权不放行空 token / 常数时间比较 / token 自动生成且可复用 / 值不进响应')
