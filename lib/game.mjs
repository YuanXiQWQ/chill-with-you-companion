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

  const snapshot = () => heartbeat

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

  /** 拉起游戏。已经在跑就直接返回，避免重复请求 Steam。 */
  const launch = async () => {
    const before = await probe(true)
    if (before.running) return { ok: true, running: true, pid: before.pid, note: '游戏已经在跑了' }
    try {
      await execFileAsync('explorer.exe', [uri], { windowsHide: true, timeout: 10000 })
      log('game launch requested', { uri })
    } catch (error) {
      return { ok: false, running: false, error: String(error?.message || error) }
    }
    // 给 Steam 一点时间把进程拉起来，能等到就顺手报个 pid
    for (let i = 0; i < 10; i += 1) {
      await new Promise((r) => setTimeout(r, 900))
      const now = await probe(true)
      if (now.running) return { ok: true, running: true, pid: now.pid, note: '正在启动，等它进场景后这里会显示在线' }
    }
    return { ok: true, running: false, note: '已交给 Steam，进程还没起来（Steam 可能在更新或登录）' }
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
    error: () => lastError,
  }
}
