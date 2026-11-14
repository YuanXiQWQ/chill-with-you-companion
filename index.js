/**
 * dsh-chill-with-you-companion — DSH 侧插件（薄壳）。
 *
 * 2026-11-13 起，大脑本体搬到侧车进程（serve.mjs + brain.mjs），本文件只做四件事：
 *   1. 拉起侧车子进程（127.0.0.1:10723），把 DSH 里解析好的配置通过环境变量传下去；
 *   2. 把 /chill/v1/* 反代到侧车 —— 游戏端与面板都还是访问 10722，一行配置不用改；
 *   3. 监护：子进程退出就按退避重启；brain.mjs / serve.mjs / lib 改动后自动换代；
 *   4. 页面面板（package.json 的 dsh.client）保持不变。
 *
 * 为什么让 DSH 看护侧车而不是丢给计划任务：DSH 已经在跑、已经管生命周期、已经能读凭据，
 * 多一个系统级守护进程只会多一处要维护的地方。改代码只重启子进程（1 秒），不重启 dsh web。
 */
import http from 'node:http'
import { spawn } from 'node:child_process'
import { watch, appendFileSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { stat } from 'node:fs/promises'
import { resolveToken } from './lib/config.mjs'

export const name = 'dsh-chill-with-you-companion'
export const inject = ['webServer']

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVE = join(HERE, 'serve.mjs')
const PORT = Number(process.env.CHILL_BRAIN_PORT || 10723)


// 数据目录优先级与 brain.mjs 一致：配置 dataDir > CHILL_DATA_DIR > 插件目录下的 data/
// 以前无条件写 HERE/data：配了 dataDir 之后日志仍留在源码树里，排查看错目录。
let DATA_DIR = join(HERE, 'data')
// 与侧车共用同一个 token：宿主在反代时注入 x-chill-token，浏览器/面板就不必知道它。
let TOKEN = ''
const sidecarLogPath = () => join(DATA_DIR, 'sidecar.log')

/** 侧车诊断落盘：宿主 stdio 一崩就没了，退出码/尾部输出必须写到自己的文件里。 */
function appendSidecarLog(line) {
  try {
    const stamp = new Date().toISOString().slice(11, 23)
    appendFileSync(sidecarLogPath(), '[' + stamp + '] ' + line + '\n')
    const size = statSync(sidecarLogPath()).size
    if (size > 512 * 1024) {
      const keep = readFileSync(sidecarLogPath(), 'utf8').split('\n').slice(-2000).join('\n')
      writeFileSync(sidecarLogPath(), keep)
    }
  } catch { /* 落盘失败不影响运行 */ }
}

/**
 * 直接借用安装机 dsh 的凭据：宿主有 ctx.credentials 服务，refs 就是环境变量名。
 * 解析不到就返回 null —— 侧车仍会自己读 <DSH_HOME>/.credentials.yaml，两条路都在。
 * 值只在内存里传给子进程：不落盘、不进日志、不进面板。
 */
export async function pickDshCredential(ctx, keyRef) {
  const name = String(keyRef || 'DEEPSEEK_API_KEY')
  let svc = null
  try { svc = ctx && typeof ctx.get === 'function' ? ctx.get('credentials') : null } catch { svc = null }
  if (!svc || typeof svc.resolve !== 'function') return null
  try {
    const got = await svc.resolve(name)
    const value = got && typeof got.value === 'string' ? got.value.trim() : ''
    if (!value) return null   // 空值一律当没配：别让空串冒充成「已配置」
    return { keyRef: name, value, source: String(got.source || 'dsh') }
  } catch {
    return null
  }
}

export function apply(ctx, rawConfig = {}) {
  // 与 brain.mjs 同一套优先级；相对路径按插件目录解析
  {
    const want = String((rawConfig && rawConfig.dataDir) || process.env.CHILL_DATA_DIR || '').trim()
    DATA_DIR = !want
      ? join(HERE, 'data')
      : (/^[A-Za-z]:[\\/]/.test(want) || want.startsWith('/') ? want : join(HERE, want))
    try { mkdirSync(DATA_DIR, { recursive: true }) } catch { /* 已存在 */ }
    // 空 token 不再等于放行：这里生成 / 读取，侧车那边解析到同一个值。
    TOKEN = resolveToken({ explicit: rawConfig && rawConfig.token, dataDir: DATA_DIR })
  }
  const log = (...args) => {
    try {
      const logger = ctx.logger
      const write = logger?.info
      if (write) write.call(logger, '[dsh-chill-with-you-companion]', ...args)
    } catch { /* 同上：记日志永不允许抛 */ }
  }
  // 注意：cordis 的 logger.info/warn 是原型方法，内部用 this()[type]() 取真实 logger。
  // 把它从 ctx.logger 上摘下来裸调用，this 就是 undefined，会抛 TypeError: this is not a function；
  // 这行又跑在 child.on('exit') 回调里，未捕获异常会直接终结整个 harness 进程。
  // 2026-11-13 00:40~00:55 连续 5 次「dsh 突然关闭」全是这一行（warn 被 sidecar 退出触发）。
  // 所以：必须以 ctx.logger 为 this 调用，且日志失败绝不允许抛出去。
  const warn = (...args) => {
    try {
      const logger = ctx.logger
      const write = logger?.warn ?? logger?.info
      if (write) write.call(logger, '[dsh-chill-with-you-companion]', ...args)
    } catch { /* 记日志失败不能反过来杀掉宿主 */ }
  }

  let child = null
  let ready = false
  let upstreamPort = PORT
  let stopping = false
  let restarts = []
  let bootTimer = null
  let recycling = false   // 换代中：exit 回调不得再安排一次 spawn，否则一次换代漏一个 node 进程
  let watcher = null

  const noteRestart = () => {
    const now = Date.now()
    restarts = restarts.filter((at) => now - at < 60000)
    restarts.push(now)
    return restarts.length
  }

  let exitReason = 'boot'
  async function spawnSidecar(reason) {
    if (stopping) return
    ready = false
    exitReason = reason
    // 先向宿主借 key：安装机 dsh 里配过，这里就一定有，用户不必在插件里再配一遍。
    const cred = await pickDshCredential(ctx, (rawConfig && rawConfig.keyRef) || 'DEEPSEEK_API_KEY')
    const env = { ...process.env, CHILL_BRAIN_PORT: String(PORT), CHILL_BRAIN_CONFIG: JSON.stringify(rawConfig || {}) }
    if (cred) {
      // 用独立变量名，不写 env[cred.keyRef]：用户自己设的 DEEPSEEK_API_KEY 不能被顶掉，
      // 那份是他显式配置，优先级高于这里借来的 default。
      env.CHILL_DSH_KEY = cred.value
      env.CHILL_DSH_KEY_REF = cred.keyRef
      env.CHILL_KEY_SOURCE = cred.source
      log('key from dsh credentials', { ref: cred.keyRef, source: cred.source })   // 只报来源，不报值
    }
    log('starting sidecar', { reason, port: PORT })
    child = spawn(process.execPath, [SERVE], { cwd: HERE, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const pid = child.pid
    // 行缓冲：READY 行被拆到两个 chunk 里也必须认得出来，
    // 否则侧车明明在听，宿主这边 ready 永远 false，所有请求 503。
    let outBuf = ''
    child.stdout.on('data', (chunk) => {
      outBuf += String(chunk)
      const lines = outBuf.split(/\r?\n/)
      outBuf = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        const readyLine = line.match(/CHILL_SIDECAR_READY\s+(\d+)/)
        if (readyLine) {
          upstreamPort = Number(readyLine[1]) || PORT
          ready = true
          log('sidecar ready', { pid, port: upstreamPort })
        } else {
          log('sidecar|', line)
        }
      }
    })
    // 子进程被强杀时 stdout/stderr 可能报 EPIPE/ECONNRESET；没挂 error 监听就是未捕获事件
    child.stdout.on('error', () => {})
    child.stderr.on('error', () => {})
    child.stdin?.on?.('error', () => {})
    child.stderr.on('data', (chunk) => {
      const text = String(chunk).trimEnd()
      for (const line of text.split(/\r?\n/)) if (line.trim()) warn('sidecar!', line)
    })
    child.on('exit', (code, signal) => {
      ready = false
      // 先取诊断信息再写日志：万一日志层出问题，退出码也必须已经落盘
      appendSidecarLog('exit pid=' + pid + ' code=' + code + ' signal=' + signal + ' reason=' + exitReason)
      if (stopping) { log('sidecar stopped', { pid, code, signal }); return }
      if (recycling) { log('sidecar replaced by recycle', { pid, code, signal }); return }
      if (bootTimer) { clearTimeout(bootTimer); bootTimer = null }
      const count = noteRestart()
      const delay = count >= 5 ? 10000 : Math.min(1000 * count, 5000)
      warn('sidecar exited, restarting', { pid, code, signal, attempt: count, delayMs: delay })
      bootTimer = setTimeout(() => { bootTimer = null; void spawnSidecar('crash-restart') }, delay)
      if (bootTimer.unref) bootTimer.unref()
    })
    child.on('error', (error) => {
      warn('sidecar spawn failed', { error: String(error?.message || error) })
      // spawn 失败（ENOENT / EACCES / 进程数上限）时 'exit' 可能根本不触发，
      // 而全部重生逻辑都挂在 exit 上 —— 不在这里补一次，侧车就永久死亡。
      if (stopping || recycling || bootTimer) return
      ready = false
      const count = noteRestart()
      bootTimer = setTimeout(() => { bootTimer = null; void spawnSidecar('spawn-error') }, Math.min(1000 * count, 5000))
      if (bootTimer.unref) bootTimer.unref()
    })
  }

  function stopSidecar() {
    return new Promise((resolve) => {
      if (!child || child.exitCode !== null) return resolve()
      const pid = child.pid
      const done = () => resolve()
      child.once('exit', done)
      try {
        if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {})
        else child.kill('SIGTERM')
      } catch {
        try { child.kill() } catch { /* 已在退出 */ }
      }
      setTimeout(() => resolve(), 4000).unref?.()
    })
  }

  function portClosed() {
    return new Promise((resolve) => {
      const probe = http.request({ host: '127.0.0.1', port: upstreamPort, method: 'GET', path: '/chill/v1/health', timeout: 400, agent: false }, (res) => { res.destroy(); resolve(false) })
      probe.on('timeout', () => { probe.destroy(); resolve(true) })
      probe.on('error', () => resolve(true))
      probe.end()
    })
  }

  // 换代必须"绝不抛出去"：这个函数由 fs.watch 回调触发，一旦抛出未处理的 Promise 拒绝，
  // Node 会直接终结整个 harness 进程 —— 2026-11-13 两次"dsh 自己关了"就是这个。
  let cycling = false
  let queuedReason = ''
  async function recycle(reason) {
    if (cycling) {
      queuedReason = reason
      return
    }
    cycling = true
    try {
      log('recycling sidecar', { reason })
      recycling = true
      if (bootTimer) { clearTimeout(bootTimer); bootTimer = null }
      await stopSidecar()
      // 等旧监听彻底消失，避免新子进程撞 EADDRINUSE（serve.mjs 那边也有重试兜底）
      for (let i = 0; i < 10; i += 1) {
        if (await portClosed()) break
        await new Promise((r) => setTimeout(r, 200))
      }
      void spawnSidecar(reason)
    } catch (error) {
      warn('recycle failed, keeping old process', { error: String(error?.message || error) })
    } finally {
      recycling = false
      cycling = false
      if (queuedReason) {
        const next = queuedReason
        queuedReason = ''
        setTimeout(() => { recycle(next).catch(() => {}) }, 300)
      }
    }
  }

  /** 统一的"安全触发"入口：任何调用者都不会把异常泄漏成未处理拒绝。 */
  function recycleSafe(reason) {
    try {
      return recycle(reason).catch((error) => warn('recycle rejected', { error: String(error?.message || error) }))
    } catch (error) {
      warn('recycle threw synchronously', { error: String(error?.message || error) })
      return Promise.resolve()
    }
  }

  // ── 反代：游戏端与面板仍然只认 10722 ─────────────────────────────────────
  function proxy(req, res) {
    const headers = { ...req.headers, host: `127.0.0.1:${upstreamPort}` }
    if (TOKEN) headers['x-chill-token'] = TOKEN   // 面板与浮窗都不持有 token，由宿主代贴
    const upstream = http.request({ host: '127.0.0.1', port: upstreamPort, method: req.method, path: req.url, headers }, (up) => {
      res.writeHead(up.statusCode || 502, up.headers)
      up.pipe(res)
    })
    upstream.on('error', (error) => {
      // 侧车正在换代/没起来：给一个能看懂的 503，而不是挂在半空
      if (!res.headersSent) {
        res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'retry-after': '2' })
        res.end(JSON.stringify({ ok: false, error: 'sidecar not ready', detail: String(error?.message || error), port: upstreamPort }))
      } else {
        res.destroy()
      }
    })
    req.on('error', () => { try { upstream.destroy() } catch { /* 已断 */ } })
    res.on('close', () => { try { upstream.destroy() } catch { /* 已断 */ } })
    req.pipe(upstream)
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/chill/v1',
    handler: (req, res) => {
      if (!ready) {
        res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'retry-after': '2' })
        return res.end(JSON.stringify({ ok: false, error: 'sidecar starting', port: PORT }))
      }
      proxy(req, res)
    },
  }), 'dsh-chill-with-you-companion: proxy /chill/v1 → sidecar')

  // 快捷框页面走 /chill/quick，不属于 /chill/v1 前缀，以前没代理 → 打开是 404
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/chill/quick',
    handler: (req, res) => {
      if (!ready) {
        res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'retry-after': '2' })
        return res.end(JSON.stringify({ ok: false, error: 'sidecar starting', port: PORT }))
      }
      proxy(req, res)
    },
  }), 'dsh-chill-with-you-companion: proxy /chill/quick → sidecar')

  // 只给管理用的旁路：DSH 侧能直接看侧车活着没、能一键换代
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/chill/v1/admin/sidecar',
    handler: async (req, res) => {
      const body = { ok: true, ready, pid: child?.pid ?? null, port: upstreamPort, preferredPort: PORT, restarts: restarts.length, uptimeSec: Math.round(process.uptime()) }
      if (req.method === 'POST') {
        recycleSafe('admin')
        body.recycling = true
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    },
  }), 'dsh-chill-with-you-companion: GET/POST /chill/v1/admin/sidecar')

  // ── 工作模式：把控制台对话页的话，投到玩家挑的那条 DSH 对话 ──────────────
  // 只有 Host 拿得到会话服务，所以这一段在 Host 里；侧车只负责产出「聪音此刻是谁」的文本。
  function getSessionController() {
    const picks = []
    try { if (ctx && typeof ctx.get === 'function') picks.push(() => ctx.get('sessionController')) } catch { /* ignore */ }
    picks.push(() => ctx && ctx.sessionController)
    try { if (ctx && ctx.root && ctx.root !== ctx) picks.push(() => ctx.root.get && ctx.root.get('sessionController')) } catch { /* ignore */ }
    try { if (ctx && ctx.reflect && typeof ctx.reflect.get === 'function') picks.push(() => ctx.reflect.get('sessionController')) } catch { /* ignore */ }
    for (const pick of picks) {
      try {
        const value = pick()
        if (value) return value
      } catch { /* 下一个 */ }
    }
    return null
  }

  // 旁观：把「这一轮他干了什么」交给侧车的聪音链路，由它决定要不要说一句。
  // 不往那边塞人设——塞了就会干扰它本来干活的判断。
  async function sidecarObserve(payload) {
    const port = upstreamPort
    const body = JSON.stringify(payload || {})
    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) },
      body,
    }
    if (typeof AbortSignal.timeout === 'function') init.signal = AbortSignal.timeout(60000)
    const res = await fetch('http://127.0.0.1:' + port + '/chill/v1/observe', init)
    if (!res.ok) throw new Error('observe HTTP ' + res.status)
    return await res.json()
  }

  // 把「他那边在干什么」定期喂给侧车：聪音自己有数，表现才像人。
  // 只进她自己的上下文，绝不写进被观察的那条会话。
  let ambientStamp = ''
  let ambientSentAt = 0
  async function pushAmbient(work) {
    if (Date.now() - ambientSentAt < 30000) return
    let text = ''
    try {
      text = String((typeof work.ambientText === 'function' ? work.ambientText() : '') || '')
    } catch {
      return
    }
    if (text === ambientStamp) return
    try {
      const body = JSON.stringify({ text })
      await fetch('http://127.0.0.1:' + upstreamPort + '/chill/v1/ambient', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) },
        body,
      })
      ambientStamp = text
      ambientSentAt = Date.now()
    } catch { /* 侧车可能刚换代，下次轮询再推 */ }
  }

  // 工作模块按 mtime 热载：改 lib/work.mjs 不用重启整个 Harness（缓存按文件 URL + 版本号区分）
  const WORK_MODULE = join(HERE, 'lib', 'work.mjs')
  let workCache = { stamp: '', instance: null }

  async function getWork() {
    let stamp = workCache.stamp
    try {
      const info = await stat(WORK_MODULE)
      stamp = String(Math.round(info.mtimeMs)) + ':' + String(info.size)
    } catch { /* 读不到就用手上这份 */ }
    if (workCache.instance && stamp === workCache.stamp) return workCache.instance
    const href = pathToFileURL(WORK_MODULE).href + '?v=' + encodeURIComponent(stamp)
    const mod = await import(href)
    if (!mod || typeof mod.createWork !== 'function') throw new Error('lib/work.mjs 没有导出 createWork')
    const previous = workCache.instance
    workCache = {
      stamp,
      instance: mod.createWork({
        dir: join(DATA_DIR, 'work'),
        getController: getSessionController,
        observe: sidecarObserve,
        log: (...args) => log('work|', ...args),
      }),
    }
    // 旧实例的 60s 抬眼定时器与事件流都挂在它自己的闭包里，不显式停掉就是
    // 两份观察者同时跟随同一条会话：她会重复开口，定时器只增不减。
    if (previous && typeof previous.stopWatch === 'function') {
      try { await previous.stopWatch() } catch { /* 换代失败不影响新实例 */ }
    }
    log('work| module loaded v=' + stamp)
    return workCache.instance
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/chill/host/work',
    handler: async (req, res) => {
      const reply = (code, body) => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(body))
      }
      const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
      const head = url.pathname.replace('/chill/host/work', '').replace(/^\/+|\/+$/g, '').split('/')[0] || ''
      const readJson = () => new Promise((resolve) => {
        // 必须收 Buffer 再一次性解码：raw += chunk 是逐块 utf8 解码，
        // 一个汉字跨 chunk 就被换成 U+FFFD，JSON.parse 失败后静默变 {} ——
        // 现象是「POST /send 发了长中文，侧车收到空内容」。
        const chunks = []
        let size = 0
        let done = false
        const finish = (value) => { if (!done) { done = true; resolve(value) } }
        req.on('data', (chunk) => {
          size += chunk.length
          if (size > 1024 * 1024) {
            try { req.destroy() } catch { /* 已断 */ }
            return finish({})
          }
          chunks.push(chunk)
        })
        req.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          try { finish(JSON.parse(raw || '{}')) } catch { finish({}) }
        })
        req.on('error', () => finish({}))
        req.on('close', () => finish({}))
      })
      try {
        if (req.method === 'GET' && head === 'diag') {
          const names = []
          try {
            for (const key of Object.getOwnPropertyNames(ctx)) {
              if (/session|agent|prompt|remote/i.test(key)) names.push(key)
            }
          } catch { /* ignore */ }
          let reloaded = ''
          try {
            await getWork()
          } catch (error) {
            reloaded = String(error?.message || error)
          }
          return reply(200, {
            ok: true,
            controller: Boolean(getSessionController()),
            ctxGet: typeof ctx.get,
            names,
            moduleVersion: workCache.stamp,
            moduleError: reloaded,
          })
        }
        const work = await getWork()
        if (req.method === 'GET') {
          if (head === 'sessions') return reply(200, await work.sessions())
          const since = Number(url.searchParams.get('since')) || 0
          const withSessions = url.searchParams.get('sessions') === '1' || !since
          const st = await work.state({ since, withSessions })
          void pushAmbient(work)
          return reply(200, st)
        }
        if (req.method === 'POST') {
          const body = await readJson()
          if (head === 'bind') {
            const r = await work.bind(body.sessionId, body.title)
            return reply(r.error ? 400 : 200, r)
          }
          // unbind = 停止观察：只解除当前选定的这一条（老面板打的就是这个路径）。
          // release / unbind-all = 一次性解除所有正在观察的对话：
          // 在跑的投递、事件流、抬眼定时器、攒了一半的快照、持久化绑定全部收掉。
          if (head === 'unbind') return reply(200, await work.unbind())
          if (head === 'release' || head === 'unbind-all') {
            return reply(200, await work.releaseAll())
          }
          if (head === 'send') {
            const r = await work.send(body.text)
            return reply(r.error ? 400 : 200, r)
          }
          if (head === 'cancel') {
            const r = await work.cancel()
            return reply(r.error ? 400 : 200, r)
          }
          if (head === 'look') {
            // 让她主动看一眼：冷读那条会话，再判断要不要开口
            const r = await work.look()
            return reply(r.error ? 400 : 200, r)
          }
          return reply(400, { error: '未知操作：' + head })
        }
        return reply(405, { error: 'method not allowed' })
      } catch (error) {
        return reply(500, { error: String(error?.message || error) })
      }
    },
  }), 'dsh-chill-with-you-companion: /chill/host/work')

  // ── 热换代：改 brain.mjs / serve.mjs / lib 自动重启子进程 ───────────────
  function watchSources() {
    let timer = null
    // 跑在宿主进程里的文件：改它们不需要重启侧车。
    //   work.mjs —— index.js 按 mtime 直接 import 热载；
    //   index.js —— 宿主侧壳本身，改了要重启 dsh，重启侧车没有意义。
    const HOST_ONLY = new Set(['work.mjs', 'index.js'])
    const bump = (file) => {
      const name = String(file || '')
      if (!name || !/\.(mjs|js)$/.test(name)) return
      // 只有真正会被 load 的代码才值得换代；种子数据、补丁脚本、备份一律不触发
      if (/^(assets\.seed|index\.js\.bak|history-json)/.test(name)) return
      if (HOST_ONLY.has(name)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { recycleSafe('source change: ' + name) }, 400)
      if (timer.unref) timer.unref()
    }
    try {
      watcher = watch(HERE, { recursive: false }, (_event, file) => { try { bump(file) } catch (error) { warn('watch callback failed', { error: String(error?.message || error) }) } })
      watcher.on('error', () => {})
      const libWatcher = watch(join(HERE, 'lib'), { recursive: false }, (_event, file) => { try { bump(file) } catch (error) { warn('watch callback failed', { error: String(error?.message || error) }) } })
      libWatcher.on('error', () => {})
      const dispose = () => { try { watcher.close() } catch {} try { libWatcher.close() } catch {} }
      return dispose
    } catch (error) {
      warn('watch failed, hot reload disabled', { error: String(error?.message || error) })
      return () => {}
    }
  }

  ctx.effect(() => {
    void spawnSidecar('boot')
    return () => {
      stopping = true
      if (bootTimer) clearTimeout(bootTimer)
      void stopSidecar()
    }
  }, 'dsh-chill-with-you-companion: sidecar lifecycle')

  // 全局兜底：插件里任何未捕获异常 / 未处理拒绝都不许杀掉宿主。
  // 装在这里而不是改 dsh 本体——升级 dsh 不丢、purge 不碰、卸载插件即恢复默认行为。
  // 代价是吞掉异常后进程可能带着不一致状态继续跑，所以每条都落盘 + 打到 stderr，并做限流。
  ctx.effect(() => {
    const crashLog = join(DATA_DIR, 'crash.log')
    const seen = new Map()
    const record = (kind, error) => {
      const text = String((error && (error.stack || error.message)) || error || '').slice(0, 4000)
      const key = kind + '|' + text.slice(0, 160)
      const now = Date.now()
      const hit = seen.get(key) || { count: 0, first: now }
      hit.count += 1
      seen.set(key, hit)
      // 同一处错误一分钟内最多写 10 条，避免死循环刷爆磁盘
      if (hit.count > 10 && now - hit.first < 60000) return
      const line = '[' + new Date(now).toISOString() + '] ' + kind + ' #' + hit.count +
        '（进程继续运行，状态可能不一致）\n' + text + '\n\n'
      try { appendFileSync(crashLog, line) } catch { /* 记日志失败不能反过来杀掉宿主 */ }
      try { console.error('[dsh-chill-with-you-companion] ' + kind + ': ' + String(text.split('\n')[0]).slice(0, 300)) } catch {}
    }
    const onUncaught = (error) => { try { record('uncaughtException', error) } catch {} }
    const onRejection = (reason) => { try { record('unhandledRejection', reason) } catch {} }
    process.on('uncaughtException', onUncaught)
    process.on('unhandledRejection', onRejection)
    return () => {
      try { process.off('uncaughtException', onUncaught) } catch {}
      try { process.off('unhandledRejection', onRejection) } catch {}
    }
  }, 'dsh-chill-with-you-companion: 全局异常兜底')

  ctx.effect(() => watchSources(), 'dsh-chill-with-you-companion: hot reload')

  // 近况推送不该挂在前端轮询上：控制台没开的时候她也得知道他那边在做什么。
  // 60 秒一次，pushAmbient 自己还会按 30 秒节流 + 文本去重。
  ctx.effect(() => {
    let alive = true
    const tick = async () => {
      if (!alive) return
      try {
        const work = await getWork()
        await pushAmbient(work)
      } catch { /* 侧车换代中，下一次再推 */ }
    }
    const timer = setInterval(tick, 60 * 1000)
    if (timer.unref) timer.unref()
    setTimeout(tick, 8000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, 'dsh-chill-with-you-companion: 近况推送')
}
