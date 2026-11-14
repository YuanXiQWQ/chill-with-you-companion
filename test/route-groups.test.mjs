#!/usr/bin/env node
/**
 * 角色卡与资源清单这两组路由搬出去之后的行为（routes/characters.mjs · routes/assets.mjs）。
 *
 * 这两组跟前两组不一样：它们的 handler 会改 brain 的内部状态（人设 / 资源清单）。
 * 所以搬的时候没有让模块自己存一份，而是注入 setPersona / setManifest 写回 brain 那一份——
 * 这个文件就是守这条的：模块里出现第二份状态、或者漏调写回，都要红。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { registerCharacterRoutes } from '../routes/characters.mjs'
import { registerAssetRoutes } from '../routes/assets.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const brain = readFileSync(join(ROOT, 'brain.mjs'), 'utf8')

const collect = (register) => {
  const routes = []
  const ctx = { effect: (fn) => fn(), webServer: { register: (r) => routes.push(r) } }
  const caps = { route: (def) => def, emit: () => {} }
  register({ ctx, caps })
  return routes
}

const makeRes = () => {
  const out = { status: 0, headers: {}, body: null }
  return {
    out,
    res: {
      set statusCode(v) { out.status = v },
      get statusCode() { return out.status },
      setHeader: (k, v) => { out.headers[String(k).toLowerCase()] = v },
      end: (v) => { out.body = v },
    },
  }
}

const makeReq = (method, url, payload) => {
  const bufs = payload ? [Buffer.from(JSON.stringify(payload))] : []
  return {
    method,
    url,
    headers: { host: '127.0.0.1:10723' },
    async *[Symbol.asyncIterator]() { for (const b of bufs) yield b },
    on() {},
    resume() {},
  }
}

let authOk = true
const baseDeps = () => ({
  authorized: () => authOk,
  sendJson: (res, status, value) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(value))
  },
  readBody: async (req) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString('utf8')
    return { raw, json: raw ? JSON.parse(raw) : null }
  },
})

// ================= 角色卡 =================
{
  const writes = []
  const card = { id: 'satone', name: '聪音', persona: '你是「聪音」……', lore: '' }
  const chars = {
    list: async () => ({ active: 'satone', list: [card] }),
    get: async (id) => (id === 'satone' ? card : null),
    create: async () => ({ error: '重复的 id' }),
    save: async (id) => (id === 'satone' ? card : null),
    activate: async (id) => (id === 'satone' ? card : null),
    active: async () => card,
  }
  const routes = collect((deps) => registerCharacterRoutes({
    ...deps, ...baseDeps(), chars, setPersona: (text) => writes.push(text),
  }))
  const route = routes.find((r) => r.path === '/chill/v1/characters')
  assert.ok(route, '角色卡模块要注册 /chill/v1/characters')
  assert.equal(route.kind, 'prefix')

  // 鉴权
  {
    authOk = false
    const { res, out } = makeRes()
    await route.handler(makeReq('GET', '/chill/v1/characters'), res)
    authOk = true
    assert.equal(out.status, 401, '没 token 要 401')
  }
  // 列表
  {
    const { res, out } = makeRes()
    await route.handler(makeReq('GET', '/chill/v1/characters'), res)
    assert.equal(out.status, 200)
    assert.equal(JSON.parse(out.body).active, 'satone')
  }
  // 详情
  {
    const { res, out } = makeRes()
    await route.handler(makeReq('GET', '/chill/v1/characters/satone'), res)
    assert.equal(out.status, 200)
    assert.ok(JSON.parse(out.body).card.persona.includes('聪音'))
  }
  // 激活：必须通过 setPersona 写回 brain，模块里不许自己存一份人设
  {
    const { res, out } = makeRes()
    await route.handler(makeReq('POST', '/chill/v1/characters/satone/activate'), res)
    assert.equal(out.status, 200)
    assert.equal(writes.length, 1, '激活要调一次 setPersona（否则 brain 里的人设还是旧角色）')
    assert.ok(writes[0].includes('聪音'), '写回的是卡片里的人设')
  }
  // 详情不存在 → 404
  {
    const { res, out } = makeRes()
    await route.handler(makeReq('GET', '/chill/v1/characters/nobody'), res)
    assert.equal(out.status, 404)
  }
  // 重名新建 → 400，错误文案原样给面板
  {
    const { res, out } = makeRes()
    await route.handler(makeReq('POST', '/chill/v1/characters', { id: 'satone', name: 'x' }), res)
    assert.equal(out.status, 400)
    assert.match(JSON.parse(out.body).error, /重复/)
  }
  // 方法不对 → 405
  {
    const { res, out } = makeRes()
    await route.handler(makeReq('DELETE', '/chill/v1/characters'), res)
    assert.equal(out.status, 405)
  }
}

// ================= 资源清单 =================
{
  const dataDir = mkdtempSync(join(tmpdir(), 'chill-assets-'))
  let manifest = { animations: [] }
  const emitted = []
  const routes = collect((deps) => registerAssetRoutes({
    ...deps, ...baseDeps(), log: () => {}, dataDir,
    getManifest: () => manifest,
    setManifest: (next) => { manifest = next },
    emit: (next) => emitted.push(next),
  }))
  const route = routes.find((r) => r.path === '/chill/v1/assets')
  assert.ok(route, '资源模块要注册 /chill/v1/assets')
  assert.equal(route.kind, 'exact')

  // 空清单必须拒收：上报失败时不能把大脑里已有的清单清空
  {
    const { res, out } = makeRes()
    await route.handler(makeReq('POST', '/chill/v1/assets', { animations: [] }), res)
    assert.equal(out.status, 400, '空清单要 400')
    assert.match(JSON.parse(out.body).error, /empty manifest/)
    assert.equal(emitted.length, 0, '被拒的清单不许广播出去')
  }
  // 正常上报：落盘 + 广播 + 刷新内存里的那份
  {
    const payload = { animations: [{ id: 1001, name: 'Joy', semantic: ['happy'] }] }
    const { res, out } = makeRes()
    await route.handler(makeReq('POST', '/chill/v1/assets', payload), res)
    assert.equal(out.status, 200, out.body)
    assert.equal(JSON.parse(out.body).counts.total, 1)
    assert.equal(manifest.animations.length, 1, 'brain 手里那份要跟着换')
    assert.equal(emitted.length, 1, '存下来之后要广播给订阅方')
    const onDisk = JSON.parse(readFileSync(join(dataDir, 'assets.json'), 'utf8'))
    assert.equal(onDisk.animations[0].id, '1001', '真的落盘了')
  }
  // 读回来
  {
    const { res, out } = makeRes()
    await route.handler(makeReq('GET', '/chill/v1/assets'), res)
    assert.equal(out.status, 200)
    assert.equal(JSON.parse(out.body).counts.animations, 1)
    assert.equal(out.status, 200)
  }
}

// ================= 不变量：这几条路径不许再写回 brain.mjs =================
for (const p of ['/chill/v1/characters', '/chill/v1/assets']) {
  assert.ok(!brain.includes("path: '" + p + "'"), p + ' 只许存在于 routes/ 下')
}
assert.match(brain, /registerCharacterRoutes\(\{/, 'brain 要在原位置调用角色卡注册')
assert.match(brain, /registerAssetRoutes\(\{/, 'brain 要在原位置调用资源清单注册')
assert.match(brain, /setPersona: \(text\) => \{ persona = text; personaMtime = 0 \}/,
  '人设的写回点必须是 brain 里那一处（单写者）')

console.log('  PASS 角色卡与资源清单搬出去后仍能注册、鉴权、写回 brain 那一份状态；路径不再回 brain')
