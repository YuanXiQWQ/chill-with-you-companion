/**
 * 音频路由（/chill/v1/audio 与 /chill/v1/audio/*）：按名字或路径返回合成好的 wav。
 *
 * 依赖全部注入，模块不自己推导路径 / 不自己持有状态：
 *   ctx / caps / authorized / sendJson / serveAudio（brain 里那份合成缓存仍归 brain）
 */

export function registerAudioRoutes(deps) {
  const { ctx, caps, authorized, sendJson, serveAudio } = deps

  ctx.effect(() => ctx.webServer.register(caps.route({
    kind: 'exact',
    path: '/chill/v1/audio',
    note: '返回合成的 wav（?name=xxx.wav）',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      return serveAudio(res, url.searchParams.get('name'))
    },
  })), 'dsh-chill-with-you-companion: GET /chill/v1/audio')

  ctx.effect(() => ctx.webServer.register(caps.route({
    kind: 'prefix',
    path: '/chill/v1/audio/',
    note: '返回合成的 wav（路径形态）',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      let tail = url.pathname.slice('/chill/v1/audio/'.length)
      try { tail = decodeURIComponent(tail) } catch { /* 保留原串，交给下面判非法 */ }
      return serveAudio(res, tail)
    },
  })), 'dsh-chill-with-you-companion: GET /chill/v1/audio/*')
}
