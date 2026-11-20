/**
 * * 从 brain.mjs 搬出来的路由组
 *
 * 依赖全部注入，模块不自己推导路径 / 不自己持有状态：
 *   ctx / caps / authorized / sendJson / readBody
 */

export function registerAdminRoutes(deps) {
  const { ctx, caps, authorized, sendJson, game, gameRunning } = deps

  // ---- 游戏：状态与拉起 ----
  ctx.effect(() => ctx.webServer.register(caps.route({
    kind: 'exact',
    path: '/chill/v1/admin/game',
    note: '游戏进程状态',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      // 别叫 state：外层有个同名的业务状态，遮蔽了以后加一行就会静默读错对象
      // fresh 的时机：没有心跳就真去 tasklist 查一次。带缓存的探针会把"刚关掉的游戏"
      // 继续报成运行中（45 秒缓存），面板于是把拉起按钮置灰——那正是"关掉以后拉不起来"。
      const probe = await gameRunning(!game.online())
      return sendJson(res, 200, {
        ok: true,
        running: Boolean(probe.running),
        pid: probe.pid || 0,
        stale: Boolean(probe.running) && !game.online(),
        image: game.image,
        uri: game.uri,
        error: probe.error || game.error() || '',
        inScene: Boolean(game.age() != null),
        heartbeatAgeMs: game.age(),
      })
    },
  })), 'dsh-chill-with-you-companion: GET /chill/v1/admin/game')

  ctx.effect(() => ctx.webServer.register(caps.route({
    kind: 'exact',
    path: '/chill/v1/admin/game/launch',
    note: '通过 Steam 拉起游戏',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      try {
        const result = await game.launch()
        return sendJson(res, 200, Object.assign({ image: game.image, uri: game.uri }, result))
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })), 'dsh-chill-with-you-companion: POST /chill/v1/admin/game/launch')
}
