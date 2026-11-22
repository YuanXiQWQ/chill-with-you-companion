// apply() 的装配测试：验证「它把该挂的东西挂上了」。
//
// 路由是用 ctx.effect(() => ctx.webServer.register(...)) 挂的，所以必须真跑 effect
// 才能看到路由。lifecycle 那条 effect 会拉子进程，这里按 label 跳过它 ——
// 侧车真实拉起由回归脚本覆盖（live-performance.ps1）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, name, inject } from '../index.js'

function mockCtx() {
  const routes = []
  const effects = []
  return {
    routes,
    effects,
    webServer: { register(route) { routes.push(route); return () => {} } },
    connection: { admit: () => ({ rejection: 401 }) },
    effect(fn, label) { effects.push({ fn, label }); return () => {} },
    logger: { info() {}, warn() {} },
    get() { return null },
  }
}

/** 跑掉所有不会拉子进程的 effect，把路由和兜底都装配起来。 */
function drainEffects(ctx, { skip = /sidecar lifecycle/ } = {}) {
  const disposers = []
  for (const e of ctx.effects) {
    if (skip.test(e.label)) continue
    const d = e.fn()
    if (typeof d === 'function') disposers.push(d)
  }
  return disposers
}

test('插件元信息没被改坏', () => {
  assert.equal(name, 'dsh-chill-with-you-companion')
  assert.deepEqual(inject, ['webServer', 'connection'])
})

test('apply 挂上四条路由，路径与种类都没变', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chill-apply-'))
  try {
    const ctx = mockCtx()
    apply(ctx, { dataDir: dir })
    const disposers = drainEffects(ctx)
    try {
      const got = ctx.routes.map((r) => r.kind + ' ' + r.path).sort()
      assert.deepEqual(got, [
        'exact /chill/quick',
        'exact /chill/v1/admin/sidecar',
        'prefix /chill/host/work',
        'prefix /chill/v1',
      ])
      for (const r of ctx.routes) assert.equal(typeof r.handler, 'function', r.path + ' 的 handler 不是函数')
    } finally {
      for (const d of disposers) { try { d() } catch {} }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('apply 注册了侧车生命周期与热更新，且都由 effect 托管', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chill-apply-'))
  try {
    const ctx = mockCtx()
    apply(ctx, { dataDir: dir })
    const labels = ctx.effects.map((e) => e.label).join(' | ')
    assert.match(labels, /sidecar lifecycle/)
    assert.match(labels, /hot reload/)
    assert.match(labels, /全局异常兜底/)
    for (const e of ctx.effects) assert.equal(typeof e.fn, 'function', e.label + ' 的 effect 不是函数')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('敏感宿主路由要求插件令牌或 DSH 所有者会话', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chill-apply-auth-'))
  const ctx = mockCtx()
  ctx.connection.admit = (req) => {
    if (req.headers.origin) return { rejection: 403 }
    if (req.headers.cookie === 'session=owner') return { peer: { principal: { kind: 'owner' } } }
    if (req.headers.cookie === 'session=guest') return { peer: { principal: { kind: 'guest' } } }
    return { rejection: 401 }
  }
  apply(ctx, { dataDir: dir, token: 'fixture-token' })
  const disposers = drainEffects(ctx)

  /**
   * 调用一个已注册的宿主处理器并记录返回状态。
   *
   * @param {string} path 请求路径。
   * @param {object} headers 请求头。
   * @param {string} method HTTP 方法。
   * @return {Promise<number>} HTTP 状态码。
   */
  async function request(path, headers = {}, method = 'GET') {
    const route = ctx.routes.find((r) => r.kind === 'exact' && r.path === path)
      || ctx.routes.find((r) => r.kind === 'prefix' && path.startsWith(r.path))
    const res = {
      statusCode: 0,
      setHeader() {},
      writeHead(status) { this.statusCode = status },
      end() {},
    }
    await route.handler({ method, url: path, headers }, res)
    return res.statusCode
  }

  try {
    assert.equal(await request('/chill/v1/llm'), 401)
    assert.equal(await request('/chill/v1/llm', {}, 'POST'), 401)
    assert.equal(await request('/chill/v1/quickbox', {}, 'POST'), 401)
    assert.equal(await request('/chill/v1/admin/sidecar', {}, 'POST'), 401)
    assert.equal(await request('/chill/host/work'), 401)
    assert.equal(await request('/chill/v1/health', {}, 'POST'), 401)
    assert.equal(await request('/chill/v1/llm', { cookie: 'session=guest' }), 403)
    assert.equal(await request('/chill/v1/llm', { cookie: 'session=owner', origin: 'https://untrusted.invalid' }), 403)
    assert.equal(await request('/chill/v1/llm', { authorization: 'Bearer wrong' }), 401)
    assert.equal(await request('/chill/v1/llm', { authorization: 'Bearer fixture-token' }), 503)
    assert.equal(await request('/chill/v1/llm', { cookie: 'session=owner' }), 503)
    assert.equal(await request('/chill/v1/admin/sidecar', { cookie: 'session=owner' }), 200)
  } finally {
    for (const dispose of disposers) dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('侧车没起来时，公开探活返回 503', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chill-apply-'))
  try {
    const ctx = mockCtx()
    apply(ctx, { dataDir: dir })
    const disposers = drainEffects(ctx)
    try {
      const route = ctx.routes.find((r) => r.path === '/chill/v1')
      assert.ok(route, '没找到 /chill/v1 的代理路由')
      const res = {
        headersSent: false,
        status: 0,
        body: '',
        writeHead(code) { this.status = code; this.headersSent = true; return this },
        end(text) { this.body = text },
      }
      route.handler({ method: 'GET', url: '/chill/v1/health', headers: {}, on() {}, pipe() {} }, res)
      assert.equal(res.status, 503)
      assert.match(res.body, /sidecar (starting|not ready)/)
    } finally {
      for (const d of disposers) { try { d() } catch {} }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
