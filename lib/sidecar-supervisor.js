/**
 * 侧车子进程的全部生命周期：拉起 / 行缓冲 / 退出退避重启 / 换代 / 源码热更新。
 *
 * 从 index.js 的 apply() 里整块搬出来 —— 那一个函数原先 531 行，
 * 装配、监护、反代、工作模式四件事挤在一起，改任何一处都要在千行区域里找位置。
 *
 * 这里只管「进程活着没、要不要重启」。它不知道 cue、不知道 HTTP 语义，
 * 对外只暴露 ready / port / pid / 换代入口 —— 反代拿这几个值就够了。
 *
 * 两条历史教训（改动前先读）：
 *   1. 这里的任何异步路径都绝不能抛出未处理拒绝。recycle 由 fs.watch 回调触发，
 *      2026-11-13 两次「dsh 自己关了」就是未处理的 Promise 拒绝终结了整个 harness。
 *   2. 行缓冲不能假设一行就是一个 chunk。READY 行被拆开时如果认不出来，
 *      侧车明明在听、宿主这边 ready 永远 false，所有请求 503。
 */
import http from 'node:http'
import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { join } from 'node:path'

/**
 * @param {object} opts
 * @param {object} opts.ctx          cordis 上下文（借凭据用）
 * @param {Function} opts.log
 * @param {Function} opts.warn
 * @param {string} opts.servePath    serve.mjs 的绝对路径
 * @param {string} opts.here         插件根目录（spawn 的 cwd、watch 的根）
 * @param {number} opts.port         首选端口
 * @param {object} opts.rawConfig    插件配置，整体透传给侧车
 * @param {Function} opts.appendLog  侧车诊断落盘（由宿主提供，带轮转）
 * @param {Function} opts.pickCredential  (ctx, keyRef) => Promise<{keyRef,value,source}|null>
 */
export function createSidecarSupervisor({
  ctx,
  log,
  warn,
  servePath,
  here,
  port,
  rawConfig = {},
  appendLog = () => {},
  pickCredential = async () => null,
}) {
  let child = null
  let ready = false
  let upstreamPort = port
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
    const cred = await pickCredential(ctx, (rawConfig && rawConfig.keyRef) || 'DEEPSEEK_API_KEY')
    const env = {
      ...process.env,
      CHILL_BRAIN_HOST: '127.0.0.1',
      CHILL_BRAIN_PORT: String(port),
      CHILL_BRAIN_CONFIG: JSON.stringify(rawConfig || {}),
    }
    if (cred) {
      // 用独立变量名，不写 env[cred.keyRef]：用户自己设的 DEEPSEEK_API_KEY 不能被顶掉，
      // 那份是他显式配置，优先级高于这里借来的 default。
      env.CHILL_DSH_KEY = cred.value
      env.CHILL_DSH_KEY_REF = cred.keyRef
      env.CHILL_KEY_SOURCE = cred.source
      log('key from dsh credentials', { ref: cred.keyRef, source: cred.source })   // 只报来源，不报值
    }
    log('starting sidecar', { reason, port })
    child = spawn(process.execPath, [servePath], { cwd: here, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const pid = child.pid
    // 行缓冲：READY 行被拆到两个 chunk 里也必须认得出来，
    // 否则侧车明明在听，宿主这边 ready 永远 false，所有请求 503。
    let outBuf = ''
    child.stdout.on('data', (chunk) => {
      outBuf += String(chunk)
      const lines = outBuf.split(/\r?\n/)
      outBuf = lines.pop() || ''
      // 子进程吐一段不含换行的内容（栈跟踪、超长 JSON）就一路涨，
      // 这里直接丢弃最老的一半：留着也没法拼成行，还占内存。
      if (outBuf.length > 256 * 1024) outBuf = outBuf.slice(-64 * 1024)
      for (const line of lines) {
        if (!line.trim()) continue
        const readyLine = line.match(/CHILL_SIDECAR_READY\s+(\d+)/)
        if (readyLine) {
          upstreamPort = Number(readyLine[1]) || port
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
      appendLog('exit pid=' + pid + ' code=' + code + ' signal=' + signal + ' reason=' + exitReason)
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
      watcher = watch(here, { recursive: false }, (_event, file) => { try { bump(file) } catch (error) { warn('watch callback failed', { error: String(error?.message || error) }) } })
      watcher.on('error', () => {})
      const libWatcher = watch(join(here, 'lib'), { recursive: false }, (_event, file) => { try { bump(file) } catch (error) { warn('watch callback failed', { error: String(error?.message || error) }) } })
      libWatcher.on('error', () => {})
      const dispose = () => { try { watcher.close() } catch { } try { libWatcher.close() } catch { } }
      return dispose
    } catch (error) {
      warn('watch failed, hot reload disabled', { error: String(error?.message || error) })
      return () => {}
    }
  }

  function stop() {
    stopping = true
    return stopSidecar()
  }

  return {
    start(reason = 'boot') { return spawnSidecar(reason) },
    stop,
    recycleSafe,
    watchSources,
    get ready() { return ready },
    get port() { return upstreamPort },
    get pid() { return child?.pid ?? null },
    get restartCount() { return restarts.length },
    state() {
      return { ready, pid: child?.pid ?? null, port: upstreamPort, preferredPort: port, restarts: restarts.length }
    },
  }
}
