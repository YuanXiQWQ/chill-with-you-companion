/**
 * 侧车入口：把 brain.mjs 的 13 条路由挂到一个独立的 http 服务上（默认 127.0.0.1:10723）。
 *
 * 为什么要有这一层：逻辑一行没动，只是把 ctx.webServer 换成一个真实的 http.Server。
 * 于是同一份 brain.mjs 既能被 DSH 宿主加载（开发期），也能被 serve.mjs 独立托管（运行期），
 * 改代码只要重启子进程，不用连带重启 dsh web。
 *
 * 配置来源，按优先级：
 *   1. 环境变量 CHILL_BRAIN_CONFIG（DSH 插件把 resolveConfig 之前的原始配置 JSON 塞进来）
 *   2. 命令行 --config <file.json>
 *   3. 都没有 → 空对象，由 brain.mjs 自己的 DEFAULTS 兜底
 */
import http from 'node:http'
import { readFileSync } from 'node:fs'

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const PORT = Number(process.env.CHILL_BRAIN_PORT || process.env.PORT || 10723)
const HOST = process.env.CHILL_BRAIN_HOST || '127.0.0.1'

function readConfig() {
  const inline = process.env.CHILL_BRAIN_CONFIG
  if (inline && inline.trim()) {
    try {
      return JSON.parse(inline)
    } catch (error) {
      console.error('[dsh-chill-with-you-companion] CHILL_BRAIN_CONFIG 解析失败：' + error.message)
    }
  }
  const idx = process.argv.indexOf('--config')
  if (idx > 0 && process.argv[idx + 1]) {
    try {
      return JSON.parse(readFileSync(process.argv[idx + 1], 'utf8'))
    } catch (error) {
      console.error('[dsh-chill-with-you-companion] --config 读取失败：' + error.message)
    }
  }
  return {}
}

const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })
const logger = {
  info: (...args) => console.log(`[${stamp()}] [dsh-chill-with-you-companion]`, ...args),
  warn: (...args) => console.warn(`[${stamp()}] [dsh-chill-with-you-companion][warn]`, ...args),
  error: (...args) => console.error(`[${stamp()}] [dsh-chill-with-you-companion][error]`, ...args),
  debug: () => {},
}

const routes = []
const disposers = []
// 这两张表以前只在启动时算一次：之后新注册的路由永远匹配不到（404），
// 被注销的又一直在表里继续命中。改成随 routes 变动重建。
let exact = []
let prefix = []
function rebuild() {
  exact = routes.filter((r) => r.kind === 'exact').sort((a, b) => b.path.length - a.path.length)
  prefix = routes.filter((r) => r.kind !== 'exact').sort((a, b) => b.path.length - a.path.length)
}
rebuild()
const ctx = {
  logger,
  effect: (fn) => {
    const disposer = fn()
    if (typeof disposer === 'function') disposers.push(disposer)
    return () => {}
  },
  webServer: {
    register: (route) => {
      // 存自己的那份：以前往 routes 里塞的是副本，disposer 却拿调用方的对象去 indexOf，
      // 永远 -1，于是热载一次就多一份旧路由（旧的还排在前面，先被匹配到）。
      const entry = { kind: route.kind || 'exact', path: String(route.path || ''), handler: route.handler }
      routes.push(entry)
      rebuild()
      return () => {
        const at = routes.indexOf(entry)
        if (at < 0) return
        routes.splice(at, 1)
        rebuild()
      }
    },
  },
}

const { apply } = await import('./brain.mjs')
apply(ctx, readConfig())

// 自重启：侧车自己退出，由父进程（DSH 插件）拉回来。独立运行时也能靠这条手动换代。
routes.push({
  kind: 'exact',
  path: '/chill/v1/admin/restart',
  handler: (req, res) => {
    // 配了 token 就要带；没配时维持原来的"本机回环随便调"，不改变现有行为。
    const want = String(process.env.CHILL_API_TOKEN || '').trim()
    if (want) {
      const got = String(req.headers['authorization'] || '') === 'Bearer ' + want ||
        String(req.headers['x-chill-token'] || '') === want
      if (!got) {
        res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' })
        return res.end(JSON.stringify({ ok: false, error: 'unauthorized' }))
      }
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
      return res.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: true, restarting: true, pid: process.pid }))
    setTimeout(() => { logger.info('restart requested, exiting'); process.exit(42) }, 120)
  },
})
// 这条是绕过 register 直接 push 的，表得自己重建一次（否则它匹配不到，返回 404）
rebuild()


function match(pathname) {
  for (const route of exact) if (route.path === pathname) return route
  for (const route of prefix) if (pathname.startsWith(route.path)) return route
  return null
}

/** 侧车自带的极简诊断页：不依赖 harness，浏览器直接开 http://127.0.0.1:10723/ 就能看状态。 */
function landing(res) {
  const list = routes.map((r) => `<li><code>${r.kind}</code> ${r.path}</li>`).join('')
  const html = `<!doctype html><meta charset="utf-8"><title>聪音大脑 · 侧车</title>
<style>body{font:14px/1.7 system-ui,"Microsoft YaHei";margin:32px;max-width:720px;color:#222}
code{background:#f2f2f2;padding:1px 5px;border-radius:4px}li{margin:2px 0}</style>
<h2>聪音大脑 · 侧车</h2>
<p>进程 PID <code>${process.pid}</code>，监听 <code>${HOST}:${PORT}</code>，已挂 ${routes.length} 条路由。</p>
<p>健康检查：<a href="/chill/v1/health">/chill/v1/health</a>　重启：<code>POST /chill/v1/admin/restart</code></p>
<ul>${list}</ul>
<p style="color:#777">面板本体在 DSH 的 Chill 标签页（10722 反代到这里）。</p>`
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(html)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || HOST}`)
  // 畸形百分号编码（/% 、/%E0%A4%A）会让 decodeURIComponent 抛 URIError；
  // 抛在 createServer 回调里只会被 uncaughtException 吞掉，那个请求永远不响应。
  let pathname = url.pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
    return res.end(JSON.stringify({ ok: false, error: 'bad request path' }))
  }
  if (pathname === '/' || pathname === '/index.html') return landing(res)
  const route = match(pathname)
  if (!route) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    return res.end(JSON.stringify({ ok: false, error: 'not found', path: pathname }))
  }
  Promise.resolve(route.handler(req, res)).catch((error) => {
    logger.error('handler failed', pathname, String(error && error.message || error))
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: String(error && error.message || error) }))
    }
  })
})

server.keepAliveTimeout = 15000
// 换代时上一个监听会残留 TIME_WAIT，Windows 上立刻 bind 会 EADDRINUSE：
// 这里退避重试，最多 12 次 × 400 ms，实在起不来才报错退出。
let listenAttempt = 0
let preferFixed = PORT > 0
function listen() {
  listenAttempt += 1
  // 换代时旧监听可能还占着端口（Windows 上没有 SO_REUSEADDR 会直接失败）：
  // 先在首选端口上试几次，再退到系统分配端口 —— 反正父进程是从 READY 行里读真实端口的。
  server.listen(preferFixed ? PORT : 0, HOST)
}
server.on('listening', () => {
  const actual = server.address().port
  logger.info(`sidecar listening on http://${HOST}:${actual} (routes=${routes.length}, preferred=${PORT})`)
  // 父进程读这一行拿到真实端口；独立运行时这行也是给人看的
  console.log('CHILL_SIDECAR_READY ' + actual)
})
server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE' && preferFixed) {
    // 首选端口拿不到：直接换临时端口，不再死等（等也等不出结果）
    logger.warn(`port ${PORT} busy, falling back to an ephemeral port`)
    preferFixed = false
    setTimeout(listen, 200)
    return
  }
  logger.error('sidecar listen failed', error && error.message || String(error))
  process.exit(1)
})
listen()

let closing = false
function shutdown(signal) {
  if (closing) return
  closing = true
  logger.info('sidecar shutting down (' + signal + ')')
  for (const dispose of disposers) {
    try { dispose() } catch { /* 退出路径，忽略 */ }
  }
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('uncaughtException', (error) => logger.error('uncaught', error && error.stack || String(error)))
process.on('unhandledRejection', (error) => logger.error('unhandledRejection', error && error.stack || String(error)))
