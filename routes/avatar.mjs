/**
 * 角色头像路由（`/chill/v1/avatar`）：内置默认两张 + 自定义覆盖。
 *
 * 目录约定（从 brain.mjs 搬过来时原样保留）：
 *   data/avatar/<id>.png            玩家自己的头像（id=user）
 *   data/avatar/defaults/<id>.png   内置默认，永不改动，用于「恢复默认」
 *   data/characters/avatars/<id>.png 角色卡头像（跟着角色卡走）
 */
import { join } from 'node:path'
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { readBinary } from '../lib/http.mjs'

export function registerAvatarRoutes(deps) {
  const { ctx, caps, authorized, sendJson, dataDir } = deps

  // ---- 头像：内置默认两张（聪音企鹅 / 玩家少女），可自定义覆盖 ----
  // data/avatar/<id>.png      自定义（或首次从 defaults 复制过来的）
  // data/avatar/defaults/<id>.png  内置默认，永不改动，用于「恢复默认」
  const avatarDir = join(dataDir, 'avatar')
  const avatarDefaults = join(avatarDir, 'defaults')
  const charAvatarDir = join(dataDir, 'characters', 'avatars')
  const AVATAR_MAX = 2 * 1024 * 1024
  const isPng = (buf) => buf.length > 64 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47

  ctx.effect(() => ctx.webServer.register(caps.route({
    kind: 'prefix',
    path: '/chill/v1/avatar',
    note: '角色头像：GET 取当前图，POST 上传自定义，POST <id>/reset 恢复默认',
    handler: async (req, res) => {
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      let tail = String(req.url || '').split('?')[0].replace('/chill/v1/avatar', '').replace(/^\/+/, '').replace(/\/+$/, '')
      let reset = false
      if (tail.endsWith('/reset')) {
        reset = true
        tail = tail.slice(0, -'/reset'.length).replace(/\/+$/, '')
      }
      const id = tail.replace(/[^A-Za-z0-9_-]/g, '')
      if (!id) return sendJson(res, 400, { error: 'bad id' })
      // 角色头像跟着角色卡走：data/characters/avatars/<id>.png
      // 玩家自己的头像（id=user）不属于任何角色卡，仍在 data/avatar/ 下
      const custom = id === 'user' ? join(avatarDir, 'user.png') : join(charAvatarDir, id + '.png')
      const legacy = id === 'user' ? '' : join(avatarDir, id + '.png')
      const fallback = id === 'user' ? join(avatarDefaults, 'user.png') : join(avatarDefaults, 'character.png')

      if (req.method === 'POST') {
        try {
          if (reset) {
            rmSync(custom, { force: true })
            return sendJson(res, 200, { ok: true, id, reset: true })
          }
          const buf = await readBinary(req, AVATAR_MAX)
          if (!isPng(buf)) return sendJson(res, 400, { ok: false, error: '只收 PNG（面板会把图片转成 256×256 PNG 再传）' })
          await mkdir(id === 'user' ? avatarDir : charAvatarDir, { recursive: true })
          await writeFile(custom + '.tmp', buf)
          await rename(custom + '.tmp', custom)
          return sendJson(res, 200, { ok: true, id, bytes: buf.length })
        } catch (error) {
          return sendJson(res, 400, { ok: false, error: String(error?.message || error) })
        }
      }
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      for (const file of [custom, legacy, fallback].filter(Boolean)) {
        try {
          const [buf, info] = await Promise.all([readFile(file), stat(file)])
          res.statusCode = 200
          res.setHeader('content-type', 'image/png')
          res.setHeader('content-length', buf.length)
          res.setHeader('cache-control', 'no-store')
          res.setHeader('x-avatar-source',
            id === 'user'
              ? (file === custom ? 'custom' : 'default')
              : (file === custom ? 'card' : (legacy && file === legacy ? 'legacy' : 'default')))
          res.setHeader('x-avatar-mtime', String(Math.round(info.mtimeMs)))
          return res.end(buf)
        } catch { /* 试下一个候选 */ }
      }
      return sendJson(res, 404, { error: 'no avatar' })
    },
  })), 'dsh-chill-with-you-companion: /chill/v1/avatar')
}
