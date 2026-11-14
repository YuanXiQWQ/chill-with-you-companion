/**
 * HTTP 层的小工具。所有路由都靠这几个函数说话，集中一处便于以后统一加
 * 日志、CORS、压缩或限流——不用再逐个路由改。
 */

export function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', Buffer.byteLength(body))
  res.end(body)
}

export function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.statusCode = status
  res.setHeader('content-type', type)
  res.end(text)
}

export async function readBody(req, limit = 2 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return { raw: '', json: {} }
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { raw: text, json }
}

/**
 * 鉴权。cfg.token 为空 = 只允许本机直连（不校验）；配了 token 就要求
 * `Authorization: Bearer <token>` 或 `x-chill-token: <token>`（游戏端两种都支持）。
 */
export function createAuth(cfg) {
  return (req) => {
    if (!cfg.token) return true
    const header = String(req.headers?.authorization || '')
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
    const custom = String(req.headers?.['x-chill-token'] || '')
    return bearer === cfg.token || custom === cfg.token
  }
}
