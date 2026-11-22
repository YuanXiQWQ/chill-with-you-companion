/**
 * HTTP 层的小工具。所有路由都靠这几个函数说话，集中一处便于以后统一加
 * 日志、CORS、压缩或限流——不用再逐个路由改。
 */
import { createHash, timingSafeEqual } from 'node:crypto'

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

/**
 * 读原始二进制体（头像 PNG / 参考音频 wav）。超过上限直接抛，不先把内存吃满。
 * 从 brain.mjs 提出来：头像和声线上传都要用同一份，别各写一遍。
 */
export async function readBinary(req, limit = 2 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('文件太大（上限 ' + Math.round(limit / 1024) + ' KB）')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export async function readBody(req, limit = 2 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) {
      // 带 code 让调用方能区分"太大"与"畸形"：以前一律当参数错，排错时只看到 400 unknown action
      const error = new Error('request body too large')
      error.code = 'BODY_TOO_LARGE'
      throw error
    }
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return { raw: '', json: {} }
  let json = null
  let parseError = ''
  try {
    json = JSON.parse(text)
  } catch (error) {
    // 以前静默变 null，调用方一律 json?.x 取值：/act 收到截断的 body 会照常花一次模型调用
    // 并推一句莫名的话，/event 更是直接 200，客户端的关键错误被完全掩盖。
    parseError = String(error && error.message || error)
    json = null
  }
  return { raw: text, json, parseError }
}

/**
 * 鉴权。要求 `Authorization: Bearer <token>` 或 `x-chill-token: <token>`
 * （游戏端两种都支持，浮窗页用后者）。
 *
 * 2026-11-14 起**没有「不校验」这条分支**：token 由 `resolveToken()` 保证非空
 * （配置 / CHILL_TOKEN / `<数据目录>/token`）。以前 `cfg.token` 为空就放行，
 * 等于本机任何进程都能读她的记忆——那不是「本机所以安全」，是「本机所以谁都能读」。
 *
 * 比较走 sha256 + timingSafeEqual：先把长度归一，再常数时间比，不按字节提前返回。
 */
export function createAuth(cfg) {
  const expected = String(cfg?.token || '')
  const digest = (value) => createHash('sha256').update(String(value)).digest()
  const want = digest(expected)
  return (req) => {
    if (!expected) return false
    const header = String(req.headers?.authorization || '')
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
    const custom = String(req.headers?.['x-chill-token'] || '')
    // 宿主转发已认证会话，游戏端与浮窗也可以直接提供令牌。
    if (bearer && timingSafeEqual(digest(bearer), want)) return true
    if (custom && timingSafeEqual(digest(custom), want)) return true
    return false
  }
}
