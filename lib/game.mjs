/**
 * 游戏侧桥接：判断游戏在不在跑、替用户把游戏拉起来、维护心跳状态。
 *
 * 三个口径（都是踩过坑才定下来的）：
 *   1. **拉起走 `explorer.exe "steam://rungameid/…"`**，不直接 exec 游戏 exe——
 *      直接起 exe 会丢 Steam 会话（时长、overlay、云存档都不认），而 cmd /c start
 *      会闪黑窗；explorer 是 GUI 进程，两件事都不占。
 *   2. **"在跑"看进程**（tasklist 按镜像名），不看端口也不看心跳：游戏停在标题界面
 *      时没有心跳，用心跳判会误报离线。
 *   3. **心跳是免费的在线证据**：8 秒内有心跳就直接认在跑，连 tasklist 都不必 spawn。
 */
export function createGame({
  image = 'Chill With You.exe',
  uri = 'steam://rungameid/3548580',
  log = () => {},
  execFileAsync,
  probeCacheMs = 45000,
  heartbeatFreshMs = 8000,
  heartbeatStaleMs = 12000,
} = {}) {
  let cache = { at: 0, value: { running: false, pid: 0 } }
  let heartbeat = { at: 0 }
  let lastError = ''

  // 快照带上年龄：调用方（prompt 里的"窗外已经黑了"、队列判断、选族）要能判新鲜度。
  // 以前直接返回最后一次 touch 的对象，游戏关掉几小时后仍按那时候的值出话术。
  // 超过 2× 心跳间隔就当"没有心跳"，字段清空、保留 at 供诊断。
  const snapshot = () => {
    const a = heartbeat && heartbeat.at ? Date.now() - heartbeat.at : null
    if (a != null && a > heartbeatStaleMs * 2) return { at: heartbeat.at, age: a, stale: true }
    return Object.assign({}, heartbeat, { age: a, stale: false })
  }

  /** 心跳：游戏每 HeartbeatMs 次 POST /game 调一次（面板据此显示真实场景）。 */
  const touch = (json) => {
    heartbeat = Object.assign({}, json || {}, { at: Date.now() })
    return heartbeat
  }

  const age = () => (heartbeat && heartbeat.at ? Date.now() - heartbeat.at : null)
  const online = () => {
    const a = age()
    return a != null && a < heartbeatStaleMs
  }

  /**
   * 进程活着，但游戏自己已经很久没上报了。
   *
   * 两种可能：停在标题界面（正常，没进场景就没心跳），或者是关游戏时留下的残影
   * （窗口没了、进程还没退干净）。**这两种从进程名上分不开**，所以只标出来、不擅自判定，
   * 更不去杀进程——玩家自己的游戏，杀错了就是灾难。
   */
  const isStale = (p) => Boolean(p && p.running) && !online()

  const probe = async (fresh) => {
    const now = Date.now()
    // 心跳是免费的：有就不要再 spawn 进程
    if (!fresh && heartbeat.at && now - heartbeat.at < heartbeatFreshMs) {
      return { running: true, pid: cache.value.pid || 0 }
    }
    if (!fresh && now - cache.at < probeCacheMs) return cache.value
    try {
      const { stdout } = await execFileAsync('tasklist', ['/fi', 'imagename eq ' + image, '/fo', 'csv', '/nh'], {
        windowsHide: true, timeout: 8000,
      })
      const line = String(stdout || '').split(/\r?\n/).find((l) => l.toLowerCase().includes(image.toLowerCase()))
      if (!line) {
        cache = { at: now, value: { running: false, pid: 0 } }
        return cache.value
      }
      const cells = line.split('","').map((c) => c.replace(/^"|"$/g, ''))
      const pid = Number(String(cells[1] || '').replace(/[^0-9]/g, '')) || 0
      cache = { at: now, value: { running: true, pid } }
      return cache.value
    } catch (error) {
      lastError = String(error?.message || error).slice(0, 100)
      return { running: false, pid: 0, error: lastError }
    }
  }

  /**
   * 拉起游戏。顺序是硬的：**先真检测，再拉**。
   *
   * 为什么必须 fresh 检测：面板上的"运行中"来自带缓存的探针（45 秒缓存 + 8 秒心跳快路径）。
   * 游戏刚关掉时那个缓存还在说"在跑"，于是：
   *   - 面板把按钮置灰，根本点不动；
   *   - 就算点了，非 fresh 的探针也会提前 return "已经在跑了"。
   * 结果就是"关掉以后再也拉不起来"。这里每一步都用 fresh。
   *
   * 拉起失败还有一个常见原因：游戏刚退出的十几秒里 Steam 认为该 app 仍在运行，
   * 会把 `steam://rungameid/` 的请求直接吞掉。所以给它两次机会，中间隔够时间。
   */
  const launch = async ({ attempts = 2, waitMs = 6000, gapMs = 2500 } = {}) => {
    const before = await probe(true)
    // 进程在、而且她确实在场景里上报 —— 这才是"不用拉"
    if (before.running && !isStale(before)) {
      return { ok: true, running: true, pid: before.pid, stale: false, note: '游戏已经在跑了，没有重复拉起。' }
    }
    // 进程在、但没有心跳：可能停在标题界面，也可能是刚关掉的残影。
    // 这两种从外面分不开，所以**照样发一次 URI**——Steam 对已在运行的 app 只会把窗口拉到前台，
    // 对已经死掉的会话才会真的重开。不发就永远是"点不动也拉不起"。
    const staleStart = Boolean(before.running)

    for (let n = 1; n <= attempts; n += 1) {
      try {
        await execFileAsync('explorer.exe', [uri], { windowsHide: true, timeout: 10000 })
        log('game launch requested', { uri, attempt: n, staleStart })
      } catch (error) {
        lastError = String(error?.message || error).slice(0, 100)
        if (n === attempts) return { ok: false, running: false, attempts: n, error: lastError }
        continue
      }
      // 等结果。两种起点，判据不同：
      //   - 本来没进程：进程出现就算启动成功（刚起来的游戏自然还没有心跳）；
      //   - 本来有进程但没心跳：只有**心跳回来**才算真的活过来，
      //     否则进程表一直会告诉我们"在跑"，永远看不出它其实卡死。
      const until = Date.now() + waitMs
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 600))
        const now = await probe(true)
        const alive = staleStart ? online() : now.running
        if (alive) {
          return {
            ok: true, running: true, pid: now.pid, attempts: n, stale: false,
            note: staleStart ? '游戏醒过来了，正在回到场景' : '正在启动，等它进场景后这里会显示在线',
          }
        }
      }
      // 这一轮没起来：多半是 Steam 还在收上一个会话，隔一下再来一次
      if (n < attempts) await new Promise((r) => setTimeout(r, gapMs))
    }

    return {
      ok: true, running: Boolean((await probe(true)).running), attempts,
      stale: true,
      note: staleStart
        ? '游戏进程还在但没响应：已请 Steam 把窗口带到前台。仍然没动静就手动完全退出游戏再拉。'
        : '已交给 Steam，进程还没起来（Steam 可能在更新、登录，或还需要几秒）',
    }
  }

  return {
    image,
    uri,
    probe,
    launch,
    touch,
    snapshot,
    age,
    online,
    stale: async (fresh) => isStale(await probe(fresh)),
    error: () => lastError,
  }
}
