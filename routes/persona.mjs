/**
 * * 从 brain.mjs 搬出来的路由组
 *
 * 依赖全部注入，模块不自己推导路径 / 不自己持有状态：
 *   ctx / caps / authorized / sendJson / readBody
 */
import { join } from 'node:path'
import { writeFile,readFile } from 'node:fs/promises'

export function registerPersonaRoutes(deps) {
  const { ctx, caps, authorized, sendJson, readBody, cfg, chars, log, existsSync, copyFileSync, readPersona, setPersona } = deps

  // ---- 人设 ----
  ctx.effect(() => ctx.webServer.register(caps.route({
    kind: 'exact',
    path: '/chill/v1/persona',
    note: '读取 / 保存人设文本',
    handler: async (req, res) => {
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      // 兼容旧接口：这里的"人设"就是当前激活角色卡的 persona 字段
      const activeCard = await chars.active()
      if (req.method === 'GET') {
        const text = await readPersona()
        return sendJson(res, 200, {
          ok: true,
          text: String(text || ''),
          characterId: activeCard ? activeCard.id : '',
          characterName: activeCard ? activeCard.name : '',
          path: activeCard ? join(chars.dir, activeCard.id + '.json') : cfg.personaPath,
          chars: String(text || '').length,
        })
      }
      if (req.method === 'POST') {
        try {
          const { raw } = await readBody(req, 256 * 1024)
          const bodyText = String(raw || '')
          // 面板发的是纯文本；也接受 {text|persona} 外壳。以前直接把整段 body 当人设落盘，
          // 于是 POST {} 会把人设覆盖成 2 个字符（内容就是一个 {}），/context 里「你是谁」下面
          // 从此只剩一个空对象。人设是最不可逆的东西，必须先拆壳、再判空。
          let text = bodyText
          if (bodyText.trim().startsWith('{')) {
            try {
              const obj = JSON.parse(bodyText.trim())
              if (obj && typeof obj === 'object') text = String(obj.text ?? obj.persona ?? '')
            } catch { /* 不是 JSON，按纯文本处理 */ }
          }
          if (!String(text).trim()) {
            return sendJson(res, 400, { ok: false, error: '人设文本不能为空（覆盖前请确认内容）' })
          }
          if (!activeCard) return sendJson(res, 409, { ok: false, error: '没有激活的角色卡' })
          // 覆盖前留一份：写坏了没有撤回
          try {
            const cardPath = join(chars.dir, activeCard.id + '.json')
            if (existsSync(cardPath)) copyFileSync(cardPath, cardPath + '.bak-' + Date.now())
          } catch (error) {
            log('persona backup failed', { error: String(error?.message || error) })
          }
          const saved = await chars.save(activeCard.id, { persona: text })
          setPersona(saved.persona)
          return sendJson(res, 200, {
            ok: true,
            characterId: saved.id,
            path: join(chars.dir, saved.id + '.json'),
            chars: String(saved.persona || "").length,
          })
        } catch (error) {
          return sendJson(res, 500, { ok: false, error: String(error?.message || error) })
        }
      }
      return sendJson(res, 405, { error: 'method not allowed' })
    },
  })), 'dsh-chill-with-you-companion: /chill/v1/persona')
}
