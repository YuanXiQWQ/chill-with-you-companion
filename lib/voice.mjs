/**
 * 语音引擎（GPT-SoVITS）的生命周期管理。
 *
 * 从 brain.mjs 抽出来的原因：这块逻辑自成闭环（探活 / 起停 / 自愈 / 预热），
 * 和对话、表演、资源都无关，混在路由里既难读也难换实现。
 *
 * 设计口径：
 *   - **探活只看端口**：TCP connect 600 ms，5 秒结果缓存（面板会并发问）。
 *   - **用户意图落在文件上**（`data/voice.want`）：看门狗据此决定要不要复活引擎，
 *     用户点停之后不会被定时任务又拉起来。
 *   - **起任务先 /end 再 /run**：wscript 活着但 python 已死时任务状态仍是 Running，
 *     直接 /run 会被拒（"任务已在运行"），表现为点了启动毫无反应。
 *   - **预热**：模型加载完的第一次合成要 17 秒左右（说话人嵌入 + 参考音频全部走一遍），
 *     所以引擎一上线先用一句极短的话把它焐热，真台词不必替冷启动买单。
 *
 * 换实现（例如换成 http 服务、或别的 TTS）只需要替换 probe/runTask/warmUp 三个方法，
 * 路由层完全不用动。
 */
export function createVoice({
  port = 9880,
  task = 'ChillGSVServer',
  watchdogTask = 'ChillGSVWatchdog',
  launcher = 'auto',
  engine = {},
  refAudioPath = '',
  wantPath,
  dataDir,
  log = () => {},
  net,
  execFileAsync,
  spawn,
  existsSync,
  writeFileSync,
  rmSync,
  appendFileSync,
  join,
  openSync,
  closeSync,
  synthesize,
  probeCacheMs = 5000,
  healCooldownMs = 45000,
  probeTimeoutMs = 600,
} = {}) {
  let probeCache = { at: 0, value: false }
  let taskCache = { at: 0, value: 'unknown' }
  let taskError = ''
  let lastHealAt = 0
  let warming = false
  // 预热重试节流：以前失败后无条件递归，引擎长期离线就会无限探测
  let warmAttempts = 0
  let lastWarmAt = 0

  const want = () => {
    try { return existsSync(wantPath) } catch { return false }
  }

  const setWant = (on) => {
    try {
      if (on) writeFileSync(wantPath, new Date().toISOString(), 'utf8')
      else if (existsSync(wantPath)) rmSync(wantPath, { force: true })
    } catch (error) {
      log('voice want flag failed', { error: String(error?.message || error) })
    }
  }

  /** 探端口。`fresh` 为真时绕过缓存（按钮动作要即时结果）。 */
  const probe = (fresh) => {
    if (!fresh && Date.now() - probeCache.at < probeCacheMs) return Promise.resolve(probeCache.value)
    return new Promise((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port })
      const done = (ok) => {
        try { socket.destroy() } catch { /* 已关 */ }
        probeCache = { at: Date.now(), value: ok }
        resolve(ok)
      }
      socket.setTimeout(probeTimeoutMs)
      socket.once('connect', () => done(true))
      socket.once('timeout', () => done(false))
      socket.once('error', () => done(false))
    })
  }

  /**
   * 计划任务的真实状态（诊断用）。
   * schtasks 输出是本地化的（中文系统 label 是「状态:」），但值仍是英文枚举，
   * 所以按字节取回后用 GBK 解码，只认状态词，不解析 label。
   */
  const taskStatus = async (fresh) => {
    const now = Date.now()
    if (!fresh && now - taskCache.at < 60000) return taskCache.value
    let value = 'unknown'
    try {
      const { stdout } = await execFileAsync('schtasks', ['/query', '/tn', task, '/fo', 'list'], {
        windowsHide: true, timeout: 8000, encoding: 'buffer',
      })
      const text = new TextDecoder('gbk').decode(stdout)
      if (/Running|正在运行/i.test(text)) value = 'Running'
      else if (/Ready|就绪|准备/i.test(text)) value = 'Ready'
      else if (/Disabled|已禁用/i.test(text)) value = 'Disabled'
      taskError = ''
    } catch (error) {
      taskError = String(error?.code || '') + ' ' + String(error?.message || error).slice(0, 120)
      value = 'missing'
    }
    taskCache = { at: now, value }
    return value
  }

  /** 杀掉监听端口的进程（计划任务 /end 经常杀不掉孤儿 python）。 */
  const killByPort = async () => {
    const killed = []
    try {
      const { stdout } = await execFileAsync('netstat', ['-ano'], { windowsHide: true, timeout: 8000, maxBuffer: 8 * 1024 * 1024 })
      const pids = new Set()
      for (const line of String(stdout || '').split(/\r?\n/)) {
        if (!line.includes('LISTENING')) continue
        if (!line.includes(`127.0.0.1:${port}`) && !line.includes(`0.0.0.0:${port}`)) continue
        const pid = Number((line.trim().split(/\s+/).pop() || '').replace(/[^0-9]/g, ''))
        if (pid) pids.add(pid)
      }
      for (const pid of pids) {
        try {
          await execFileAsync('taskkill', ['/pid', String(pid), '/F'], { windowsHide: true, timeout: 8000 })
          killed.push(pid)
        } catch { /* 已退出 */ }
      }
    } catch (error) {
      taskError = 'kill: ' + String(error?.message || error).slice(0, 100)
    }
    probeCache = { at: 0, value: false }
    return killed
  }

  /**
   * 引擎本体不随插件分发：模型和 python 环境都是几个 G 的东西，打进包里没人愿意装。
   * 插件负责的是「发现缺什么、告诉用户怎么补、补好之后自己拉起来」。
   * 这里返回结构化缺口，面板直接照着渲染，不用猜。
   */
  const doctor = () => {
    const missing = []
    const need = (id, label, path, hint) => missing.push({ id, label, path: path || '', hint })
    const py = String(engine.python || '')
    const repo = String(engine.repo || '')
    const cfgFile = String(engine.config || '')
    const refAudio = String(refAudioPath || '')
    if (!py) need('python', 'python 运行时', '', 'python: <venv>\\Scripts\\python.exe')
    else if (!existsSync(py)) need('python', 'python 运行时', py, '这个路径上没有 python.exe')
    if (!repo) need('repo', 'GPT-SoVITS 仓库', '', '填 GPT-SoVITS 解压后的目录')
    else if (!existsSync(repo)) need('repo', 'GPT-SoVITS 仓库', repo, '这个目录不存在')
    if (cfgFile && !existsSync(cfgFile)) need('config', '推理配置', cfgFile, 'tts_infer.yaml 不在这个位置')
    if (!refAudio) need('refAudio', '参考音频', '', 'ref/ 下放一段她的原声 wav')
    else if (!existsSync(refAudio)) need('refAudio', '参考音频', refAudio, '参考音频文件不存在')
    return { ok: missing.length === 0, missing, launcher }
  }

  /**
   * 直接拉引擎进程：不经过 wscript / powershell / 计划任务。
   * detached + unref 让 python 脱离本进程的作业树，Harness 重启不会顺手把它带走。
   * 只负责发起，不等端口——模型加载要几十秒，调用方不该被吊在那儿。
   */
  const spawnEngine = () => {
    const pre = doctor()
    if (!pre.ok) {
      taskError = '引擎缺件：' + pre.missing.map((m) => m.label).join('、')
      log('voice engine not ready', { missing: pre.missing.map((m) => m.id) })
      return false
    }
    const py = String(engine.python)
    const args = [String(engine.script || 'api_v2.py'), '-a', '127.0.0.1', '-p', String(port)]
    if (engine.config) args.push('-c', String(engine.config))
    let stdio = 'ignore'
    let fd = null
    if (engine.log && openSync) {
      try {
        fd = openSync(engine.log, 'a')
        stdio = ['ignore', fd, fd]
      } catch {
        stdio = 'ignore'
      }
    }
    try {
      const child = spawn(py, args, {
        cwd: engine.repo || undefined,
        detached: true,
        stdio,
        windowsHide: true,
        env: { ...process.env, ...(engine.env || {}) },
      })
      // ENOENT / EACCES 是异步事件，外层 try/catch 抓不到：
      // 不挂这个回调，侧车只会看到一行 uncaughtException，任务却记成"已经启动"。
      child.on('error', (error) => {
        taskError = '进程启动失败：' + String(error?.message || error).slice(0, 140)
        log('voice engine spawn error', { error: String(error?.message || error) })
      })
      child.unref()
      taskError = ''
      log('voice engine spawned', { pid: child.pid, script: args[0], port })
      return true
    } catch (error) {
      taskError = '拉起失败：' + String(error?.message || error).slice(0, 140)
      log('voice engine spawn failed', { error: String(error?.message || error) })
      return false
    } finally {
      if (fd !== null && closeSync) {
        try {
          closeSync(fd)
        } catch { /* 句柄已交出去 */ }
      }
    }
  }

  /** 起任务：先 /end 清掉僵死实例，再重试 /run，直到端口真的起来。 */
  const runTask = async (attempts = 4) => {
    // 端口已经在听就别再拉起一份：反复拉起会留下没人认领的 wrapper
    // （venv python → runtime python 两层）。
    if (await probe(true)) return true
    // 插件自己拉：默认走这条，不碰计划任务。
    if (launcher !== 'task' && spawnEngine()) {
      // 只发起，不等。模型加载几十秒，等在这儿会把调用方吊死；
      // warmUp() 会轮询端口，真起来之后再做预热。
      return true
    }
    if (launcher === 'spawn') return false
    try {
      await execFileAsync('schtasks', ['/end', '/tn', task], { windowsHide: true, timeout: 8000 })
    } catch { /* 没有实例在跑 */ }
    await new Promise((r) => setTimeout(r, 1200))
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await execFileAsync('schtasks', ['/run', '/tn', task], { windowsHide: true, timeout: 10000 })
      } catch { /* 下一轮再试 */ }
      for (let wait = 0; wait < 8; wait += 1) {
        await new Promise((r) => setTimeout(r, 1000))
        if (await probe(true)) return true
      }
    }
    return Boolean(await probe(true))
  }

  /** 自愈：spawn 模式下自己再拉一次；task 模式才去叫看门狗。 */
  const heal = () => {
    const now = Date.now()
    if (now - lastHealAt < healCooldownMs) return false
    lastHealAt = now
    if (launcher !== 'task') {
      if (!spawnEngine()) {
        log('voice heal skipped: engine not ready')
        return false
      }
      log('voice engine down, respawned')
      return true
    }
    try {
      const child = spawn('schtasks', ['/run', '/tn', watchdogTask], { detached: true, stdio: 'ignore', windowsHide: true })
      child.unref()
      log('voice engine down, watchdog spawned')
      return true
    } catch (error) {
      log('watchdog spawn failed', { error: String(error?.message || error) })
      return false
    }
  }

  const warmLog = (line) => {
    try { appendFileSync(join(dataDir, 'warm.log'), '[' + new Date().toISOString().slice(11, 19) + '] ' + line + '\n') } catch { /* 日志失败不影响启动 */ }
  }

  /**
   * 冷启动预热。预算用完还在等、而用户仍然想开，就自我续期。
   * synthesize 由调用方注入 —— 语音引擎不该知道 TTS 的缓存与配置。
   */
  const warmUp = (budgetMs = 600000) => {
    if (warming) return false
    warming = true
    warmLog('warm-up start budget=' + budgetMs)
    void (async () => {
      const deadline = Date.now() + budgetMs
      try {
        while (Date.now() < deadline) {
          if (await probe(true)) {
            warmLog('online, synthesizing primer')
            const startedAt = Date.now()
            const audio = await synthesize('うん。', 'ja')
            warmLog('primer=' + (audio ? (audio.cached ? 'cached' : 'fresh') : 'FAILED') + ' ms=' + (Date.now() - startedAt))
            return
          }
          await new Promise((r) => setTimeout(r, 5000))
        }
      } catch (error) {
        warmLog('ERROR ' + String(error?.message || error).slice(0, 120))
        log('voice warm-up failed', { error: String(error?.message || error) })
      } finally {
        warming = false
        // 以前这里无条件递归：引擎长期离线时每轮都重新排一次，日志无限增长、探测不停。
        // 现在只允许隔 10 分钟再来一次，且全程不超过 3 次。
        const now = Date.now()
        if (want() && warmAttempts < 3 && now - lastWarmAt > 600000) {
          let online = true
          try { online = await probe(true) } catch { online = false }
          if (!online) { lastWarmAt = now; warmAttempts += 1; warmUp() }
        }
      }
    })()
    return true
  }

  return {
    port,
    task,
    want,
    setWant,
    probe,
    taskStatus,
    killByPort,
    runTask,
    heal,
    warmUp,
    doctor,
    spawnEngine,
    error: () => taskError,
    /** 面向面板的聚合状态：端口是唯一真相，其余都是推断。 */
    async snapshot() {
      const online = await probe()
      // 没装齐就不要假装在启动——面板按 missing 直接给安装指引。
      const dep = doctor()
      return {
        online,
        port,
        task,
        launcher,
        ready: dep.ok,
        missing: dep.missing,
        taskStatus: online ? 'Running' : (dep.ok ? (want() ? 'Starting' : 'Off') : 'Missing'),
        taskError,
        synthetic: true,
      }
    },
  }
}
