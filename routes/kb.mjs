/**
 * 知识库路由（`/chill/v1/kb`）：检索、文档列表、导入、删除、同步。
 *
 * 检索与存储都在注入的 kb 里；这个文件只管 HTTP 形状（分页、limit 上限、错误码）。
 */
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

export function registerKbRoutes(deps) {
  const { ctx, caps, authorized, sendJson, readBody, cfg, kb } = deps

  // ---- 外挂知识库：库 / 文档 / 检索 ----
  ctx.effect(() => ctx.webServer.register(caps.route({
    kind: 'prefix',
    path: '/chill/v1/kb',
    note: '知识库：GET 列表·检索·读文档，POST 建库·启停·收文档，DELETE 删库·删文档',
    handler: async (req, res) => {
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
      const tail = url.pathname.replace('/chill/v1/kb', '').replace(/^\/+|\/+$/g, '')
      const parts = tail ? tail.split('/') : []
      const head = (parts[0] || '').replace(/[^A-Za-z0-9_-]/g, '')

      // 同步任务清单：GET 只算不落盘，POST 才写文件。
      // 以前整块长在 GET 分支里，浏览器/代理预取一次就在 kb-sync/ 里留一个没人要的任务文件。
      if (parts[1] === 'refresh') {
        // 更新检查：把每篇里「会随时间失效」的行挑出来，生成待核对清单。
        // 只做识别，不联网、不改库 —— 真正去查由调用方（控制台/agent）执行。
        const data = await kb.list()
        const lib = (data.libraries || []).find((l) => l.id === head)
        if (!lib) return sendJson(res, 404, { error: '没有这个库' })
        const VER_RE = /\b\d\.\d\b/
        const DATE_RE = /\d{4}-\d{2}-\d{2}/
        // 只挑「会随时间失效」的表述。单纯出现版本号不算 —— 历史版本号是事实，
        // 永远不会过期，扫进来只会把清单灌满噪音。
        const STATE_RE = /(最新|目前已|尚未|还没|即将|预计|将要|已完结|未完结|已上线|已实装|可抽|已解封|已开幕|已终幕|首曝|停服|改动|调整为|改为)/
        const topic = String(lib.name || '').replace(/[：:·\s]/g, '')

        // 找出库里真正的最新版本：只认「版本索引」类文档里 `## 4.7「...」` 这样的章节标题。
        // 全文扫 x.y 会把「4.8 起再补」「1.5 倍」都算进去，推出的下一代版本号就是错的。
        let maxVer = 0
        const docs = []
        let totalItems = 0
        for (const d of lib.docs) {
          let found = null
          try { found = await kb.getDoc(head, d.id) } catch { found = null }
          if (!found) continue
          const text = String(found.text || '')
          if (/版本/.test(String(d.name || ''))) {
            for (const m of text.matchAll(/^#{2,4}\s*(\d+)\.(\d+)\s*「/gm)) {
              maxVer = Math.max(maxVer, Number(m[1]) + Number(m[2]) / 10)
            }
          }
          const items = []
          for (const raw of text.split('\n')) {
            const line = raw.trim().replace(/^\|?\s*/, '')
            if (line.length < 8 || line.startsWith('#') || line.startsWith('>')) continue
            const reasons = []
            if (STATE_RE.test(line)) reasons.push('状态')
            if (DATE_RE.test(line) && STATE_RE.test(line)) reasons.push('日期')
            if (reasons.length && items.length < 12) items.push({ line: line.slice(0, 200), reasons })
          }
          totalItems += items.length
          docs.push({
            docId: d.id, docName: d.name,
            updatedAt: d.updatedAt || d.addedAt || '', ageDays: d.ageDays,
            itemCount: items.length, items,
          })
        }

        // 查询建议：从「最高版本 → 下一代」推出最有价值的那几条，
        // 而不是把明细丢给人自己拼。
        const queries = []
        const cur = maxVer > 0 ? maxVer.toFixed(1) : ''
        if (cur) {
          const nxt = (Math.round(maxVer * 10) + 1) / 10
          queries.push(`${topic} ${nxt.toFixed(1)} 版本 更新`)
          queries.push(`${topic} 最新版本 公告`)
          queries.push(`${topic} 版本名`)
        } else {
          queries.push(`${topic} 最新消息`)
        }
        queries.push(`${topic} 版本更新内容 汇总`)

        const staleDocs = docs.filter((d) => d.ageDays === null || d.ageDays >= 7)

        // 落盘成一份可执行任务。按钮的意义是「我现在决定跟外面同步一次」，
        // 不是过期告警 —— 所以每次点击都产出一个带时间戳的任务文件，
        // 交给能联网的一方去查，查完改原文重导。
        // 但**只有 POST 才落盘**：这是 GET，浏览器/代理/链接预览都可能预取，
        // 以前每预取一次就在 kb-sync/ 里留一个没人要的任务文件。
        const wantWrite = req.method !== 'GET'
        let taskFile = ''
        try {
          if (!wantWrite) throw new Error('read-only')
          const syncDir = join(cfg.dataDir, 'kb-sync')
          await mkdir(syncDir, { recursive: true })
          const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
          taskFile = join(syncDir, String(head) + '-' + stamp + '.md')
          const lines = []
          lines.push('# 知识库同步任务：' + lib.name)
          lines.push('')
          lines.push('- 发起时间：' + new Date().toISOString())
          lines.push('- 当前覆盖版本：' + (cur || '未识别'))
          lines.push('- 需要确认的下一代：' + (cur ? ((Math.round(maxVer * 10) + 1) / 10).toFixed(1) : '—'))
          lines.push('')
          lines.push('## 要查的')
          lines.push('')
          for (const qq of queries) lines.push('- [ ] ' + qq)
          lines.push('')
          lines.push('## 查到之后怎么做')
          lines.push('')
          lines.push('1. 改知识库对应的 markdown 原文，不要直接改库里的切片。')
          lines.push('2. 有推翻的说法，同时更新 `08-时效表.md` 的「已被推翻」。')
          lines.push('3. 跑 `node import.mjs` 重新导入，mtime 自动刷新。')
          lines.push('')
          if (docs.some((d) => d.itemCount)) {
            lines.push('## 需要留意的表述')
            lines.push('')
            for (const d of docs) {
              if (!d.itemCount) continue
              lines.push('### ' + d.docName)
              for (const it of d.items) lines.push('  ' + it.line)
              lines.push('')
            }
          }
          await writeFile(taskFile, lines.join('\n'), 'utf8')
        } catch { taskFile = '' }

        return sendJson(res, 200, {
          ok: true,
          library: { id: lib.id, name: lib.name },
          currentVersion: cur,
          nextVersion: cur ? ((Math.round(maxVer * 10) + 1) / 10).toFixed(1) : '',
          queries,
          staleDocs: staleDocs.map((d) => ({ docName: d.docName, ageDays: d.ageDays })),
          docs, totalItems, taskFile,
          hint: taskFile
            ? '同步任务已落盘，交给能联网的一方执行，查完改原文重导。'
            : 'GET 只列出待查项（不落盘）；要生成任务文件请用 POST。',
        })
      }
      if (req.method === 'GET') {
        if (head === 'mode') {
          return sendJson(res, 200, { ok: true, mode: await kb.getMode() })
        }
        if (head === 'search') {
          const q = url.searchParams.get('q') || ''
          const k = Math.min(12, Math.max(1, Number(url.searchParams.get('k')) || 5))
          const hits = await kb.search(q, { k })
          return sendJson(res, 200, { ok: true, query: q, hits })
        }
        if (!head) {
          const data = await kb.list()
          return sendJson(res, 200, Object.assign({ ok: true }, data))
        }
        if (parts[1] === 'export') {
          const r = await kb.exportPack(head)
          return sendJson(res, r.error ? 404 : 200, r)
        }
        if (parts[1] === 'docs' && parts[2]) {
          const found = await kb.getDoc(head, parts[2].replace(/[^A-Za-z0-9_-]/g, ''))
          if (!found) return sendJson(res, 404, { error: '没有这篇文档' })
          return sendJson(res, 200, {
            ok: true, library: { id: found.lib.id, name: found.lib.name },
            doc: found.doc, text: found.text,
          })
        }
        const data = await kb.list()
        return sendJson(res, 200, Object.assign({ ok: true }, data))
      }

      if (req.method === 'POST') {
        if (head === 'mode') {
          const parsed = await readBody(req)
          if (!parsed || !parsed.json) return sendJson(res, 400, { error: 'bad json' })
          const mode = await kb.setMode(parsed.json.mode)
          return sendJson(res, 200, { ok: true, mode })
        }
        if (head === 'import') {
          const parsed = await readBody(req, 16 * 1024 * 1024)
          if (!parsed || !parsed.json) return sendJson(res, 400, { error: 'bad json' })
          const r = await kb.importPack(parsed.json)
          return sendJson(res, r.error ? 400 : 200, r)
        }
        if (!head) {
          const parsed = await readBody(req)
          if (!parsed || !parsed.json) return sendJson(res, 400, { error: 'bad json' })
          const r = await kb.create(parsed.json)
          return sendJson(res, r.error ? 400 : 200, r)
        }
        if (!parts[1]) {
          const parsed = await readBody(req)
          if (!parsed || !parsed.json || typeof parsed.json !== 'object') return sendJson(res, 400, { error: 'bad json' })
          const r = await kb.update(head, parsed.json)
          return sendJson(res, r.error ? 400 : 200, r)
        }
        if (parts[1] === 'toggle') {
          let enabled
          try {
            const parsed = await readBody(req)
            if (parsed && parsed.json && typeof parsed.json.enabled === 'boolean') enabled = parsed.json.enabled
          } catch { /* 没 body 就当作取反 */ }
          const r = await kb.toggle(head, enabled)
          return sendJson(res, r.error ? 400 : 200, r)
        }
        if (parts[1] === 'docs') {
          const parsed = await readBody(req, 8 * 1024 * 1024)
          if (!parsed) return sendJson(res, 400, { error: 'empty body' })
          let name = ''
          let text = ''
          if (parsed.json && typeof parsed.json === 'object') {
            name = parsed.json.name || ''
            text = String(parsed.json.text || '')
          } else {
            name = String(req.headers['x-doc-name'] || '')
            text = parsed.raw
          }
          const r = await kb.addDoc(head, { name, text })
          return sendJson(res, r.error ? 400 : 200, r)
        }
        return sendJson(res, 400, { error: '未知操作' })
      }

      if (req.method === 'DELETE') {
        if (!head) return sendJson(res, 400, { error: 'bad id' })
        if (parts[1] === 'docs' && parts[2]) {
          const r = await kb.removeDoc(head, parts[2].replace(/[^A-Za-z0-9_-]/g, ''))
          return sendJson(res, r.error ? 400 : 200, r)
        }
        const r = await kb.remove(head)
        return sendJson(res, r.error ? 400 : 200, r)
      }
      return sendJson(res, 405, { error: 'method not allowed' })
    },
  })), 'dsh-chill-with-you-companion: /chill/v1/kb')
}
