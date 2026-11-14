/**
 * 资源清单路由（`/chill/v1/assets`）：游戏自报的动画 / 场景 / 音效清单。
 *
 * 清单本体归 brain（提示词与演出校验都要读），这里只通过 getManifest / setManifest 动它。
 * 空清单一律拒收：一旦上报失败，大脑会以为"游戏里什么都没有"，什么都演不了。
 */
import { join } from 'node:path'
import { writeFile, mkdir } from 'node:fs/promises'
import { normalizeManifest, manifestSize } from '../lib/assets.js'

export function registerAssetRoutes(deps) {
  const { ctx, caps, authorized, sendJson, readBody, log, dataDir, getManifest, setManifest, emit } = deps

  const report = () => {
    const manifest = getManifest()
    const counts = {}
    for (const [k, v] of Object.entries(manifest)) if (Array.isArray(v)) counts[k] = v.length
    counts.total = manifestSize(manifest).total
    return { ok: true, version: 1, counts, manifest }
  }

  ctx.effect(() => ctx.webServer.register(caps.route({
    kind: 'exact',
    path: '/chill/v1/assets',
    note: '游戏上报的资源清单（读 / 写）',
    handler: async (req, res) => {
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      if (req.method === 'GET') return sendJson(res, 200, report())
      if (req.method === 'POST') {
        try {
          const { json } = await readBody(req, 8 * 1024 * 1024)
          const next = normalizeManifest(json)
          // 空清单一律拒收：否则一旦上报失败，大脑会以为"游戏里什么都没有"，什么都演不了
          if (manifestSize(next).total === 0) {
            return sendJson(res, 400, { ok: false, error: 'empty manifest rejected' })
          }
          await mkdir(dataDir, { recursive: true })
          await writeFile(join(dataDir, 'assets.json'), JSON.stringify(next), 'utf8')
          setManifest(next)
          log('assets manifest updated', manifestSize(next))
          emit(next)
          return sendJson(res, 200, report())
        } catch (error) {
          return sendJson(res, 500, { ok: false, error: String(error?.message || error) })
        }
      }
      return sendJson(res, 405, { error: 'method not allowed' })
    },
  })), 'dsh-chill-with-you-companion: /chill/v1/assets')
}
