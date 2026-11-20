// 完整对话模拟：按真实节奏跑一段聊天，然后把游戏端日志逐条对账。
//
// 目的不是"看她答得好不好"，而是看**表演链路在连续对话里有没有断点**：
//   每句的形态是否符合内容、段与段之间过渡多长、有没有被顶掉的半截动作、
//   排队有没有挤压/丢弃、口型有没有数据。
import { readFileSync, writeFileSync } from 'node:fs'

const HOST = 'http://127.0.0.1:10722/chill/v1'
const GAME_LOG = process.env.CHILL_GAME_LOG || 'E:\\SteamLibrary\\steamapps\\common\\Chill with You Lo-Fi Story\\BepInEx\\LogOutput.log'

const TURNS = [
  { t: '早啊，今天有点困', note: '姿态（困/哈欠）' },
  { t: '我先写会儿代码', note: '道具（键盘/写字）' },
  { t: '有点渴了，喝口水', note: '道具（喝水）' },
  { t: '伸个懒腰', note: '姿态（伸展）' },
  { t: '嗯……', note: '短句/停顿' },
  { t: '我去拿个纸杯', note: '位移（离座）' },
  { t: '回来了，坐好', note: '位移（回座）' },
  { t: '哈哈哈你好搞笑', note: '手势（笑）' },
  { t: '我有点不好意思', note: '手势（害羞）' },
  { t: '那再陪我一会儿', note: '收尾/亲近' }
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const get = async (p) => (await fetch(HOST + p, { signal: AbortSignal.timeout(30000) })).json()
const post = async (p, body) => (await fetch(HOST + p, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body), signal: AbortSignal.timeout(180000)
})).json()

async function idle(maxMs = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    try {
      const g = (await get('/game')).game
      if (!g.queue.depth && !g.queue.performing && !g.motion.active) return true
    } catch { }
    await sleep(400)
  }
  return false
}

const logStart = (() => {
  try { return readFileSync(GAME_LOG, 'utf8').split('\n').length } catch { return 0 }
})()

console.log('  轮次  内容                      动作                                   时长   尾')
const rows = []
for (const [i, turn] of TURNS.entries()) {
  await idle()
  const r = await post('/act', { text: turn.t, sandbox: true })
  const anim = (r.performance || []).filter((c) => c.slot === 'animations')
  const span = anim.length ? Math.max(...anim.map((c) => (Number(c.at) || 0) + (Number(c.durationMs) || 0))) : 0
  const ids = anim.map((c) => String(c.id).replace(/^anim_/, '') + '@' + c.at + '+' + (c.durationMs || 0) + (c.chained ? '接' : ''))
  const sub = String((r.subtitle && r.subtitle.text) || r.subtitle || '')
  rows.push({ i: i + 1, text: turn.t, note: turn.note, sub, ids, span, durationMs: r.durationMs, mouth: Number(r.mouthFrames) || 0 })
  console.log('  ' + String(i + 1).padStart(2) + '    ' + turn.t.padEnd(22) + '  ' + (ids.join(' ').slice(0, 76).padEnd(76)) + String(span).padStart(5) + '  ' + (turn.note))
  // 两句之间留一点真实停顿（1.2~2.4s 随机），并等这一句演完
  await sleep(1200 + Math.random() * 1200)
  await idle()
}

// 打断测试：一句演到一半就发下一句
await idle()
const a = await post('/act', { text: '我给你讲个事', sandbox: true })
await sleep(900)
const b = await post('/act', { text: '算了，先不讲了', sandbox: true })
const animB = (b.performance || []).filter((c) => c.slot === 'animations')
console.log('  打断  同时两句 → 第二句 ' + animB.map((c) => c.id.replace(/^anim_/, '') + '@' + c.at + (c.chained ? '(接)' : '')).join(' ') + '  首句 ' + (a.performance || []).filter((c) => c.slot === 'animations').map((c) => c.id.replace(/^anim_/, '')).join(' '))
await idle(40000)

// ── 对账游戏端日志 ──
const lines = readFileSync(GAME_LOG, 'utf8').split('\n').slice(logStart)
const body = (l) => (l.replace(/^.*?\]\s*/, '') || '').trim()
const pick = (re) => lines.filter((l) => re.test(l)).map(body)

const plans = pick(/^plan anim/).map((s) => ({
  id: (s.match(/^plan (anim_\S+)/) || [])[1] || '',
  fade: Number((s.match(/fade=(\d+)ms/) || [])[1]) || 0,
  peakBody: Number((s.match(/peakBody=(\d+)deg/) || [])[1]) || 0,
  wall: Number((s.match(/wall=([\d.]+)/) || [])[1]) || 0
}))
const exits = pick(/^exit:/).map((s) => ({
  deg: Number((s.match(/deg=([\d.]+)/) || [])[1]) || 0,
  over: Number((s.match(/over=(\d+)ms/) || [])[1]) || 0,
  dps: Number((s.match(/=> (\d+)dps/) || [])[1]) || 0,
  chained: /chained/.test(s)
}))
const hands = pick(/^handoff dev=/).map((s) => ({
  dev: Number((s.match(/dev=([\d.]+)/) || [])[1]) || 0,
  rel: Number((s.match(/rel=(\d+)ms/) || [])[1]) || 0,
  pending: Number((s.match(/pending=(\d+)/) || [])[1]) || 0
}))
const dones = pick(/^clip done:/).map((s) => ({
  id: (s.match(/^clip done: (\S+)/) || [])[1] || '',
  frames: Number((s.match(/frames=(\d+)/) || [])[1]) || 0,
  peak: Number((s.match(/peakHead=(\d+)dps/) || [])[1]) || 0,
  clamp: Number((s.match(/clamp=(\d+)/) || [])[1]) || 0,
  clampMax: Number((s.match(/clamp=\d+\D+(\d+)d/) || [])[1]) || 0,
  miss: /MISS/.test(s),
  movedHead: /moved=head:1/.test(s),
  movedBody: /moved=body:1/.test(s) || /moved=.*body:1/.test(s)
}))
const plays = pick(/^queue: play/).map((s) => ({
  waited: Number((s.match(/waited=([\d.]+)s/) || [])[1]) || 0,
  depth: Number((s.match(/depth=(\d+)/) || [])[1]) || 0
}))
const drops = pick(/^queue: dropped/).length
const expired = pick(/^queue: expired/).length
const chains = pick(/^chain:/).length

const num = (a) => a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y)
const stat = (a) => {
  const v = num(a)
  if (!v.length) return { n: 0 }
  return { n: v.length, min: v[0], med: v[Math.floor(v.length / 2)], max: v[v.length - 1] }
}
const sum = (a) => a.reduce((x, y) => x + y, 0)

const report = {
  轮次: rows.length + 1,
  口型有数据的句数: rows.filter((r) => r.mouth > 0).length,
  动作段数: plans.length,
  完成的段: dones.length,
  'peakHead dps': stat(dones.map((d) => d.peak)),
  '段内被限速的帧': { 总计: sum(dones.map((d) => d.clamp)), 段均: Math.round(sum(dones.map((d) => d.clamp)) / Math.max(1, dones.length)), 最大单帧跳变: Math.max(0, ...dones.map((d) => d.clampMax)) },
  'MISS 段数': dones.filter((d) => d.miss).length,
  'moved 未达成': dones.filter((d) => !d.movedHead && !d.movedBody).length,
  'fade ms': stat(plans.map((p) => p.fade)),
  '交接 deg': stat(exits.map((e) => e.deg)),
  '交接 dps': stat(exits.map((e) => e.dps)),
  'handoff dev': stat(hands.map((h) => h.dev)),
  '短段(<=20帧)': dones.filter((d) => d.frames <= 20).map((d) => d.id.replace(/^anim_/, '') + ':' + d.frames),
  '排队等待 s': stat(plays.map((p) => p.waited)),
  排队丢弃: drops,
  排队过期: expired,
  衔接次数: chains,
  带队列交接: exits.filter((e) => e.chained).length
}

writeFileSync('data/sim-report.json', JSON.stringify({ report, rows, plans, exits, hands, dones, plays }, null, 2))
console.log('\n  === 对账 ===')
for (const [k, v] of Object.entries(report)) {
  const txt = typeof v === 'object' && v !== null && 'n' in v
    ? (v.n ? 'n=' + v.n + '  ' + v.min + ' / ' + v.med + ' / ' + v.max : '无数据')
    : JSON.stringify(v)
  console.log('  ' + k.padEnd(16) + txt)
}
console.log('\n  明细已存 data/sim-report.json')
