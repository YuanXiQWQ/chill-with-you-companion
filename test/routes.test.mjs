#!/usr/bin/env node
/**
 * 拆出去的路由（routes/panel.mjs · routes/avatar.mjs）要真的能注册、能应答。
 *
 * 为什么要这个文件：把 handler 从 brain.mjs 搬到模块里时，最容易出的错不是语法，
 * 而是**漏记一个依赖**——它在 brain 里是闭包变量，搬到模块里变成 `undefined`，
 * 只有那条路由被调用时才炸。冒烟覆盖不全，所以这里直接拿假 ctx/caps 把路由取出来自己调。
 *
 * 顺带守一条不变量：这些路径不许再回到 brain.mjs 里（否则下一个人又会改到两份）。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { registerPanelRoutes } from '../routes/panel.mjs'
import { registerAvatarRoutes } from '../routes/avatar.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const brain = readFileSync(join(ROOT, 'brain.mjs'), 'utf8')

// ---- 假的 Host 侧：ctx.effect 立即执行，register 只把路由收起来 ----
const collect = (register) => {
  const routes = []
  const ctx = {
    effect: (fn) => fn(),
    webServer: { register: (route) => routes.push(route) },
  }
  const caps = { route: (def) => def, emit: () => {} }
  register({ ctx, caps })
  return routes
}

// ---- 假的 req / res ----
const makeRes = () => {
  const out = { status: 0, headers: {}, body: null, ended: false }
  return {
    out,
    res: {
      set statusCode(v) { out.status = v },
      get statusCode() { return out.status },
      setHeader: (k, v) => { out.headers[String(k).toLowerCase()] = v },
      end: (v) => { out.body = v; out.ended = true },
    },
  }
}
const makeReq = (method, url, payload) => {
  const bufs = payload ? [Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload))] : []
  return {
    method,
    url,
    headers: { host: '127.0.0.1:10723' },
    async *[Symbol.asyncIterator]() { for (const b of bufs) yield b },
    on() {},
    resume() {},
  }
}

let authOk = true   // 让 401 那条用例能把鉴权关掉
const openDeps = () => ({
  authorized: () => authOk,
  sendJson: (res, status, value) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(value))
  },
  readBody: async (req, limit = 1 << 20) => {
    const chunks = []
    for await (const c of req) {
      chunks.push(c)
      if (chunks.reduce((n, x) => n + x.length, 0) > limit) throw new Error('too large')
    }
    const raw = Buffer.concat(chunks).toString('utf8')
    return { raw, json: raw ? JSON.parse(raw) : null }
  },
})

// ==== 1) /chill/v1/llm ====
{
  const llm = {
    view: () => ({ active: 'dsh-deepseek', providers: [{ id: 'dsh-deepseek' }] }),
    resolve: () => ({ id: 'dsh-deepseek', keyFrom: 'dsh' }),
    activate: () => ({ ok: false, error: 'no such provider' }),
    add: () => ({ ok: false, error: 'bad provider' }),
    remove: () => ({ ok: false, error: 'builtin' }),
    test: async () => ({ ok: true, ms: 1, model: 'x', reply: 'pong' }),
  }
  const routes = collect((deps) => registerPanelRoutes({ ...deps, ...openDeps(), llm }))
  const route = routes.find((r) => r.path === '/chill/v1/llm')
  assert.ok(route, '面板模块要注册 /chill/v1/llm')
  assert.equal(route.kind, 'exact')

  // 鉴权失败 → 401（handler 自己判，不靠外层）
  {
    authOk = false
    const { res, out } = makeRes()
    await route.handler(makeReq('GET', '/chill/v1/llm'), res)
    authOk = true
    assert.equal(out.status, 401, '没 token 要 401')
  }
  // GET → 200 且带 current
  {
    const { res, out } = makeRes()
    await route.handler(makeReq('GET', '/chill/v1/llm'), res)
    assert.equal(out.status, 200)
    const body = JSON.parse(out.body)
    assert.equal(body.current, 'dsh-deepseek', '要回当前生效的 provider')
    assert.equal(body.currentKeyFrom, 'dsh', 'key 出处（只有名字，不是 key）')
  }
  // POST action=test → probe 透传
  {
    const { res, out } = makeRes()
    await route.handler(makeReq('POST', '/chill/v1/llm', { action: 'test' }), res)
    assert.equal(out.status, 200)
    assert.equal(JSON.parse(out.body).probe.ok, true)
  }
  // 未知 action → 400，且错误里带原样 action（排查靠它）
  {
    const { res, out } = makeRes()
    await route.handler(makeReq('POST', '/chill/v1/llm', { action: 'nope' }), res)
    assert.equal(out.status, 400)
    assert.match(JSON.parse(out.body).error, /nope/)
  }
}

// ==== 2) /chill/v1/avatar ====
{
  const dataDir = mkdtempSync(join(tmpdir(), 'chill-avatar-'))
  const routes = collect((deps) => registerAvatarRoutes({ ...deps, ...openDeps(), dataDir }))
  const route = routes.find((r) => r.path === '/chill/v1/avatar')
  assert.ok(route, '头像模块要注册 /chill/v1/avatar')
  assert.equal(route.kind, 'prefix')

  // 没有图 → 404（不是 500，也不刷栈）
  {
    const { res, out } = makeRes()
    await route.handler(makeReq('GET', '/chill/v1/avatar/satone'), res)
    assert.equal(out.status, 404)
  }
  // 传非 PNG → 400
  {
    const { res, out } = makeRes()
    await route.handler(makeReq('POST', '/chill/v1/avatar/user', Buffer.from('not a png at all ....')), res)
    assert.equal(out.status, 400)
    assert.match(JSON.parse(out.body).error, /PNG/)
  }
  // 传合法 PNG → 200；随后 GET 返回 image/png 且 x-avatar-source=custom
  {
    // 1×1 PNG：签名 + IHDR 起始即可通过 isPng（只认前 4 字节与长度 > 64）
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(80)])
    const { res, out } = makeRes()
    await route.handler(makeReq('POST', '/chill/v1/avatar/user', png), res)
    assert.equal(out.status, 200, out.body)
    assert.equal(JSON.parse(out.body).bytes, png.length)

    const { res: res2, out: out2 } = makeRes()
    await route.handler(makeReq('GET', '/chill/v1/avatar/user'), res2)
    assert.equal(out2.status, 200)
    assert.equal(out2.headers['content-type'], 'image/png')
    assert.equal(out2.headers['x-avatar-source'], 'custom', '自己传的图要标 custom')
  }
  // reset → 200 且之后回到 404
  {
    const { res, out } = makeRes()
    await route.handler(makeReq('POST', '/chill/v1/avatar/user/reset'), res)
    assert.equal(out.status, 200)
    assert.equal(JSON.parse(out.body).reset, true)
    const { res: res2, out: out2 } = makeRes()
    await route.handler(makeReq('GET', '/chill/v1/avatar/user'), res2)
    assert.equal(out2.status, 404, '恢复默认后不应再读到自定义图')
  }
}

// ==== 3) 不变量：这些路径不许再写回 brain.mjs ====
assert.ok(!brain.includes("path: '/chill/v1/llm'"), '/chill/v1/llm 只许存在于 routes/panel.mjs')
assert.ok(!brain.includes("path: '/chill/v1/avatar'"), '/chill/v1/avatar 只许存在于 routes/avatar.mjs')
assert.match(brain, /registerPanelRoutes\(\{/, 'brain 要在原位置调用面板路由注册')
assert.match(brain, /registerAvatarRoutes\(\{/, 'brain 要在原位置调用头像路由注册')

console.log('  PASS /llm 与 /avatar 搬出去后仍能注册、鉴权、读写；brain 里不再有这两条路由')
