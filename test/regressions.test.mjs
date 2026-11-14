/**
 * 回归：这三条都是"数据静默坏掉"的 bug，不写测试就只能在用户丢数据后才发现。
 * 每个用例都用临时目录，不碰真实数据。
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 路径里有中文：必须走 fileURLToPath，直接读 pathname 会拿到 %XX 编码
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const load = (m) => import(pathToFileURL(join(ROOT, 'lib', m)).href)
let failed = 0
const ok = (name, cond, detail) => {
  if (cond) console.log('  ok   ' + name)
  else { failed += 1; console.log('  FAIL ' + name + (detail ? '  ' + detail : '')) }
}
const tmp = (tag) => mkdtempSync(join(tmpdir(), 'chill-reg-' + tag + '-'))

// ① 长期事实的 pinned / invalidAt / links 不能被 saveFacts 丢掉
{
  const dir = tmp('facts')
  const seeded = [{ id: 'f1', text: '已闭环', kind: 'fact', importance: 3, at: 1, lastUsed: 1, hits: 1, pinned: true, invalidAt: 1700000000000, links: ['t9'] }]
  writeFileSync(join(dir, 'facts.jsonl'), seeded.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8')
  const { createMemoryStore } = await load('memory-store.mjs')
  const api = await createMemoryStore({ dir, log: () => {} }).open()
  await api.allFacts()
  await api.forget('不存在的', {})
  const back = JSON.parse(readFileSync(join(dir, 'facts.jsonl'), 'utf8').trim().split('\n')[0])
  ok('事实字段 round-trip', back.pinned === true && back.invalidAt === 1700000000000 && Array.isArray(back.links),
    JSON.stringify({ pinned: back.pinned, invalidAt: back.invalidAt, links: back.links }))
}

// ② 带 BOM 的 index.json 不能被当成损坏；内置声线顺序不能每次 load 都翻转
{
  const dir = tmp('voices')
  const refDir = join(dir, 'ref')
  mkdirSync(dir, { recursive: true })
  mkdirSync(refDir, { recursive: true })
  const body = { active: 'mine', items: [{ id: 'mine', name: '我的', file: 'mine.wav', builtin: false }] }
  writeFileSync(join(dir, 'index.json'), '\uFEFF' + JSON.stringify(body, null, 2), 'utf8')
  const mod = await load('voices.mjs')
  const voices = mod.createVoices({ dir, refDir, log: () => {} })
  const first = await voices.list()
  const second = await voices.list()
  const defs = (mod.DEFAULT_VOICES || []).map((v) => v.id)
  const head = (first.items || []).slice(0, defs.length).map((v) => v.id)
  ok('BOM 的 index.json 能读', first.items.length === defs.length + 1 && first.active === 'mine', '条数=' + first.items.length)
  ok('内置声线顺序稳定', JSON.stringify(head) === JSON.stringify(defs) && JSON.stringify(second.items.map((v) => v.id)) === JSON.stringify(first.items.map((v) => v.id)))
  ok('自定义声线没被抹掉', first.items.some((v) => v.id === 'mine'))
  const active = await voices.activeVoice()
  ok('activeVoice 给的是真实路径', !!active && !/\/ref\/ref\//.test(String(active.path)), String(active && active.path))
}

// ③ 卡内 id 与文件名不一致时，_active.json 必须指向真实文件名
{
  const dir = tmp('chars')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'satone.json'), JSON.stringify({ id: 'wrong-id', name: '聪音' }, null, 2), 'utf8')
  const { createCharacters } = await load('characters.mjs')
  const chars = createCharacters({ dir, personaPath: join(dir, 'persona.md'), log: () => {} })
  await chars.activate('satone')
  const now = await chars.active()
  const activeFile = JSON.parse(readFileSync(join(dir, '_active.json'), 'utf8'))
  ok('active() 指向文件名', !!now && now.id === 'satone', now && now.id)
  ok('_active.json 不写卡内 id', !existsSync(join(dir, 'wrong-id.json')) && String(activeFile.id || activeFile.active || '') !== 'wrong-id')
}

console.log(failed ? '失败 ' + failed + ' 项' : '回归用例全部通过')
process.exit(failed ? 1 : 0)