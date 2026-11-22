/**
 * 声线库路由（`/chill/v1/voices`）：列表 / 新建 / 激活 / 上传参考音频 / 试听 / 删除。
 *
 * 依赖全部注入：声线仓储是注入的 voices，引擎探活是 voiceProbe，
 * 试听要落盘的目录是 audioDir —— 模块自己不推导路径，避免和 brain 的 dataDir 口径不一致。
 */
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { wavDuration } from '../lib/lipsync.mjs'
import { readBinary } from '../lib/http.mjs'
import { requestSpeech } from '../lib/tts-client.mjs'

export function registerVoiceRoutes(deps) {
  const { ctx, caps, authorized, sendJson, readBody, cfg, voices, voiceProbe, voice, audioDir } = deps

  ctx.effect(() => ctx.webServer.register(caps.route({
    kind: 'prefix',
    path: '/chill/v1/voices',
    note: '声线库：GET 列表 / POST 新建 · 激活 · 上传参考音频 · 试听 / DELETE 删除',
    handler: async (req, res) => {
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      const tail = String(req.url || '').split('?')[0].replace('/chill/v1/voices', '').replace(/^\/+|\/+$/g, '')
      const parts = tail ? tail.split('/') : []
      const id = (parts[0] || '').replace(/[^A-Za-z0-9_-]/g, '')
      const action = parts[1] || ''

      if (req.method === 'GET') {
        const data = await voices.list()
        const online = await voiceProbe()
        // 引擎缺件和"离线"是两回事：缺件要给安装指引，离线只要点启动。
        const dep = voice.doctor()
        if (cfg.tts.provider === 'voicevox') {
          const voice = await voices.activeVoice()
          const speaker = Number(cfg.tts.speaker)
          const name = speaker === 10005 ? 'VOICEVOX Nemo · 女声1' : 'VOICEVOX Nemo · ' + speaker
          return sendJson(res, 200, {
            ok: true, online, ready: dep.ok, missing: dep.missing,
            provider: 'voicevox', active: voice.id,
            items: [{ id: voice.id, name, builtin: true, speedFactor: voice.speedFactor, promptLang: 'ja', textLang: 'ja' }],
          })
        }
        return sendJson(res, 200, Object.assign({ ok: true, online, ready: dep.ok, missing: dep.missing }, data))
      }

      if (req.method === 'POST') {
        if (!id) {
          const parsed = await readBody(req)
          if (!parsed || !parsed.json || typeof parsed.json !== 'object') return sendJson(res, 400, { error: 'bad json' })
          const body = parsed.json
          const r = await voices.create(body)
          return sendJson(res, r.error ? 400 : 200, r)
        }
        if (action === 'activate') {
          const r = await voices.activate(id)
          return sendJson(res, r.error ? 400 : 200, r)
        }
        if (action === 'audio') {
          try {
            const buf = await readBinary(req, 12 * 1024 * 1024)
            const r = await voices.saveAudio(id, buf)
            if (r.error) return sendJson(res, 400, r)
            return sendJson(res, 200, { ok: true, bytes: r.item.bytes, duration: r.wav.duration, rate: r.wav.rate })
          } catch (error) {
            return sendJson(res, 400, { ok: false, error: String(error?.message || error) })
          }
        }
        if (action === 'preview') {
          const v = await voices.get(id)
          if (!v) return sendJson(res, 404, { error: '没有这条声线' })
          if (!(await voiceProbe())) return sendJson(res, 503, { ok: false, error: '语音引擎没在线（先在状态页启动语音引擎）' })
          const text = 'ねえ、聞こえてる？'
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), Math.max(20000, cfg.tts.timeoutMs))
          try {
            const buf = await requestSpeech(cfg.tts, text, v, v.textLang || cfg.tts.textLang, controller.signal)
            const name = 'preview-' + v.id + '.wav'
            // 全新数据目录里 audio/ 还没建（只有 ensureDirs 会建），
    // 而"第一次进语音页点试听"正好发生在那之前，不 mkdir 就是必然 502。
    await mkdir(audioDir, { recursive: true })
    await writeFile(join(audioDir, name), buf)
            return sendJson(res, 200, {
              ok: true,
              audioUrl: '/chill/v1/audio?name=' + encodeURIComponent(name),
              bytes: buf.length,
              duration: wavDuration(buf),
            })
          } catch (error) {
            return sendJson(res, 502, { ok: false, error: String(error?.message || error) })
          } finally {
            clearTimeout(timer)
          }
        }
        return sendJson(res, 400, { error: '未知操作：' + action })
      }

      if (req.method === 'DELETE') {
        if (!id) return sendJson(res, 400, { error: 'bad id' })
        const r = await voices.remove(id)
        return sendJson(res, r.error ? 400 : 200, r)
      }
      return sendJson(res, 405, { error: 'method not allowed' })
    },
  })), 'dsh-chill-with-you-companion: /chill/v1/voices')
}
