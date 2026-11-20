#!/usr/bin/env node
/**
 * 观察期采样器。
 *
 * 目的：把三份日志按同一条时间轴对齐，回答"她到底演了没有、卡在哪一步"。
 *   - data/cue.log / data/cue.test.log：侧车下发了什么（sandbox 的进 .test）
 *   - data/gate.log：内容类闸门改了什么（原本要演 → 实际演）
 *   - <游戏目录>/BepInEx/LogOutput.log：游戏端收到什么、真的播了哪一条
 *
 * 做法：每 SAMPLE_SEC 采一次（只读"上次之后新增的行"），每 ACT_SEC 发一句 sandbox 演出
 * （sandbox:true 不写记忆、不动好感度，但走完整链路，游戏里真的会演）。
 *
 * 用法：
 *   node tools/observe.mjs                 # 默认 30 分钟
 *   node tools/observe.mjs --minutes 5     # 短跑
 *   node tools/observe.mjs --act-every 0   # 只观察，不主动发话
 *
 * 输出：data/observe/<时间戳>.ndjson（每行一次采样），结束时打印汇总。
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = dirname(HERE)
const DATA = join(PLUGIN, 'data')
const OUT_DIR = join(DATA, 'observe')

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name)
  return i > 0 && process.argv[i + 1] != null ? process.argv[i + 1] : dflt
}
const MINUTES = Number(arg('minutes', 30))
const SAMPLE_SEC = Number(arg('sample', 30))
const ACT_SEC = Number(arg('act-every', 240))
const HOST = String(arg('host', 'http://127.0.0.1:10722'))
const GAME_LOG = String(arg('game-log', 'E:/SteamLibrary/steamapps/common/Chill with You Lo-Fi Story/BepInEx/LogOutput.log'))

const PHRASES = [
  '我先开始这一轮，二十五分钟',
  '眼睛有点干，等我揉一下',
  '这段我打算推倒重写',
  '刚才那杯茶凉了',
  '我回来了，继续',
  '有点走神，拉回来',
  '外面好像下雨了',
  '这一节写完就休息',
]

/** 文件从 offset 之后新增的内容，按行切开；返回 [新行, 新 offset]。 */
function readNew(path, offset) {
  try {
    if (!existsSync(path)) return [[], offset]
    const size = statSync(path).size
    if (size < offset) offset = 0 // 被轮转或裁剪过
    if (size === offset) return [[], offset]
    const buf = readFileSync(path)
    const slice = buf.subarray(offset, size).toString('utf8')
    const lines = slice.split(/\r?\n/).filter((l) => l.trim())
    return [lines, size]
  } catch {
    return [[], offset]
  }
}

const cursor = new Map()
function newLines(path) {
  const [lines, next] = readNew(path, cursor.get(path) || 0)
  cursor.set(path, next)
  return lines
}

async function health() {
  try {
    const r = await fetch(HOST + '/chill/v1/health', { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return { error: 'http ' + r.status }
    const j = await r.json()
    return {
      ok: j.ok, gameOnline: j.gameOnline, gameStale: j.gameStale, gameAgeMs: j.gameAgeMs,
      phase: j.state?.phase, pomo: j.state?.pomo, family: j.state?.gameFamily,
      anim: j.state?.gameAnim, queue: j.queue, assets: j.assets?.total ?? j.assets,
    }
  } catch (e) {
    return { error: String(e?.message || e) }
  }
}

async function act(text) {
  const t0 = Date.now()
  try {
    const r = await fetch(HOST + '/chill/v1/act', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, sandbox: true }),
      signal: AbortSignal.timeout(180000),
    })
    const j = await r.json().catch(() => ({}))
    return {
      text, ms: Date.now() - t0, status: r.status, error: j.error?.message || null,
      seq: j.seq ?? null, sub: j.subtitle?.text || '', emotion: j.emotion || '',
      cues: (j.performance || []).map((c) => ({ slot: c.slot, id: c.id, at: c.at, why: c.why || '' })),
      truncated: j.truncated ?? null, drop: j.droppedCues ?? null,
    }
  } catch (e) {
    return { text, ms: Date.now() - t0, status: 0, error: String(e?.message || e) }
  }
}

function pick(lines, re, cap = 40) {
  return lines.filter((l) => re.test(l)).slice(-cap)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
mkdirSync(OUT_DIR, { recursive: true })
const outPath = join(OUT_DIR, 'observe-' + stamp + '.ndjson')
writeFileSync(outPath, '', 'utf8')

const cuesPath = join(DATA, 'cue.log')
const testPath = join(DATA, 'cue.test.log')
const gatePath = join(DATA, 'gate.log')

// 起跑点：把已有内容全部吞掉，只记这一次之后的
for (const p of [cuesPath, testPath, gatePath, GAME_LOG]) {
  try { cursor.set(p, existsSync(p) ? statSync(p).size : 0) } catch { cursor.set(p, 0) }
}

const started = Date.now()
const endAt = started + MINUTES * 60000
let nextActAt = Date.now() + 5000
let phraseIx = 0
const acts = []

console.log(`观察开始：${new Date(started).toLocaleString()}，${MINUTES} 分钟，每 ${SAMPLE_SEC}s 采样，每 ${ACT_SEC || '∞'}s 发一句`)
console.log('输出：' + outPath)

while (Date.now() < endAt) {
  const row = { t: new Date().toISOString(), el: Math.round((Date.now() - started) / 1000) }

  if (ACT_SEC > 0 && Date.now() >= nextActAt) {
    nextActAt = Date.now() + ACT_SEC * 1000
    const res = await act(PHRASES[phraseIx % PHRASES.length])
    phraseIx += 1
    acts.push(res)
    row.act = res
  }

  row.health = await health()
  row.cueNew = newLines(cuesPath)
  row.cueTestNew = newLines(testPath)
  row.gateNew = newLines(gatePath)
  const gameLines = newLines(GAME_LOG)
  row.gamePlay = pick(gameLines, /play |cue in:|cues: 走|queue: play/)
  row.gameWarn = pick(gameLines, /\[Warning|\[Error|Exception|卡了|HTTP\/1\.1 4\d\d|HTTP\/1\.1 5\d\d/, 12)

  appendFileSync(outPath, JSON.stringify(row) + '\n')
  const left = Math.max(0, Math.round((endAt - Date.now()) / 1000))
  console.log(`[${row.el}s] phase=${row.health.phase} online=${row.health.gameOnline} 剩 ${left}s`)

  const wait = Math.min(SAMPLE_SEC * 1000, Math.max(0, endAt - Date.now()))
  await new Promise((r) => setTimeout(r, wait))
}

// ── 汇总 ────────────────────────────────────────────────────────────────
const okActs = acts.filter((a) => a.status === 200 && a.seq != null)
const failActs = acts.filter((a) => !(a.status === 200 && a.seq != null))
const lat = okActs.map((a) => a.ms).sort((a, b) => a - b)
const p50 = lat.length ? lat[Math.floor(lat.length / 2)] : 0
const cueCounts = okActs.map((a) => a.cues.length)
const withAnim = okActs.filter((a) => a.cues.some((c) => c.slot === 'animations')).length
const falls = okActs.filter((a) => a.cues.some((c) => /兜底/.test(c.why || '')))
const famStat = {}
for (const a of okActs) for (const c of a.cues) if (c.slot === 'animations') {
  const p = String(c.id || '').split('_').slice(1, 3).join('_')
  famStat[p] = (famStat[p] || 0) + 1
}

const summary = {
  startedAt: new Date(started).toISOString(),
  minutes: MINUTES,
  acts: acts.length, okActs: okActs.length, failedActs: failActs.length,
  actLatencyMs: { p50, max: lat.length ? lat[lat.length - 1] : 0 },
  cueCounts,
  actsWithAnimation: withAnim,
  fallbackUsed: falls.length,
  animationPrefix: famStat,
  failures: failActs.map((f) => ({ status: f.status, error: f.error, text: f.text })),
  out: outPath,
}
writeFileSync(join(OUT_DIR, 'summary-' + stamp + '.json'), JSON.stringify(summary, null, 2), 'utf8')
console.log('\n===== 汇总 =====')
console.log(JSON.stringify(summary, null, 2))
