/**
 * 控制台 → 游戏 的推送队列，带**长轮询**。
 *
 * 为什么要有长轮询：游戏端是 Unity 协程，只能主动 GET。0.6 秒空转一次
 * 一天就是 14 万次请求，而实际有 cue 的时间不到千分之一。这里把请求挂住，
 * 有 cue 立刻回，把"定时轮询"变成"事件驱动"，且**游戏端一行代码都不用改**。
 *
 * 约束：游戏端 `req.timeout = 10` 秒，所以挂起上限默认 8 秒，留 2 秒余量。
 *
 * seq 基线用"秒"，不用毫秒：表演端把 seq 当 int32 解析，毫秒会溢出。
 */
export function createFeed({ epoch, ttlMs = 180000, keep = 40, waitMs = 8000 } = {}) {
  const feed = { seq: epoch, items: [] }
  let waiters = []
  let pulls = 0
  let holds = 0
  let pushes = 0
  // 已经交出去的最高序号。游戏端的 since 落后（超时重发、协程重入、进程重启后从 0 开始）
  // 时，不能把同一批再播一遍——一句话演两遍比丢一句难看得多。
  let delivered = 0

  function payload(since, limit = 8) {
    const cut = Date.now() - ttlMs
    // since 落后于已投递位置时，从已投递位置接着给。这是「不重复」的硬保证。
    const from = Math.max(Number(since) || 0, delivered)
    const pending = feed.items.filter((it) => it.seq > from && it.at >= cut)
    // 从最老的开始给，不是从最新的。取最后 N 条会跳过中间那批，
    // 游戏端把 since 跳到最新之后，中间的就永远演不到了。
    const items = pending.slice(0, limit)
    return {
      ok: true,
      seq: feed.seq,
      epoch,
      // resync/gap：客户端据此知道"服务端序号回退过"或"中间有东西被丢了"，避免永久卡死
      resync: since > feed.seq,
      gap: items.length > 0 && items[0].seq > from + 1,
      items,
    }
  }

  function wake() {
    if (!waiters.length) return
    const list = waiters
    waiters = []
    for (const fn of list) {
      try { fn() } catch { /* 单个失败不影响其他 */ }
    }
  }

  function push(item) {
    feed.seq += 1
    feed.items.push(Object.assign({ seq: feed.seq, at: Date.now() }, item))
    const cut = Date.now() - ttlMs
    feed.items = feed.items.filter((it) => it.at >= cut).slice(-keep)
    pushes += 1
    wake()
    return feed.seq
  }

  // 真正发出去之后才推进「已投递」水位。写在 sendJson 之前的话，
  // 连接已断、对方没收到，这条就永久丢了。
  const markDelivered = (items) => {
    if (!items || !items.length) return
    delivered = Math.max(delivered, items[items.length - 1].seq)
  }

  /**
   * 处理一次 GET /pull。有新东西、或客户端显式 wait=0，就立刻回；
   * 否则挂起到 waitMs，期间 push 会立刻唤醒。
   */
  /**
   * 这条连接还活着吗。只有真发得出去的响应才能推进「已投递」水位。
   * 为什么：游戏重启时上一轮的挂起连接是死的，push 唤醒它 → 走 finish() →
   * 水位被推到新 seq，但 sendJson 写进死 socket 什么都没到。结果重启后的
   * 第一句话永远不播（2026-11-15 实测踩到）。
   */
  const alive = (req, res) => Boolean(req && res)
    && !req.destroyed && !res.destroyed && !res.writableEnded
    && Boolean(res.socket) && !res.socket.destroyed

  function hold(req, res, { since = 0, limit = 8, wait = waitMs, sendJson } = {}) {
    pulls += 1
    const w = Math.min(waitMs, Math.max(0, Number(wait) || 0))
    const first = payload(since, limit)
    if (first.items.length || w <= 0) {
      if (alive(req, res)) markDelivered(first.items)
      return sendJson(res, 200, first)
    }
    holds += 1
    let done = false
    let timer = null
    const finish = () => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      waiters = waiters.filter((fn) => fn !== finish)
      const body = payload(since, limit)
      // 死连接不推进水位：这一条没送到，下次还得给。
      if (alive(req, res)) markDelivered(body.items)
      try { sendJson(res, 200, body) } catch { /* 客户端已断 */ }
    }
    timer = setTimeout(finish, w)
    waiters.push(finish)
    req.on('close', () => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      waiters = waiters.filter((fn) => fn !== finish)
    })
  }

  return {
    push,
    payload,
    hold,
    wake,
    get seq() { return feed.seq },
    get items() { return feed.items },
    stats: () => ({ seq: feed.seq, size: feed.items.length, waiters: waiters.length, pulls, holds, pushes, delivered }),
  }
}
