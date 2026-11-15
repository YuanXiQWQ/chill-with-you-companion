// 只对账：从日志尾部取最近一段（默认 6000 行），把连续对话的表演质量算出来。
import { readFileSync } from 'node:fs'

const GAME_LOG = process.env.CHILL_GAME_LOG || 'E:\\SteamLibrary\\steamapps\\common\\Chill with You Lo-Fi Story\\BepInEx\\LogOutput.log'
const N = Number(process.argv[2] || 6000)
const all = readFileSync(GAME_LOG, 'utf8').split('\n')
const lines = all.slice(Math.max(0, all.length - N))
const body = (l) => (l.replace(/^.*?\]\s*/, '') || '').trim()
const pick = (re) => lines.map(body).filter((s) => re.test(s))

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
  movedBody: /moved=[^ ]*body:1/.test(s)
}))
const plays = pick(/^queue: play/).map((s) => ({
  waited: Number((s.match(/waited=([\d.]+)s/) || [])[1]) || 0,
  depth: Number((s.match(/depth=(\d+)/) || [])[1]) || 0
}))
const drops = pick(/^queue: dropped/).length
const expired = pick(/^queue: expired/).length
const chains = pick(/^chain:/).length

const stat = (arr) => {
  const v = arr.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return '无数据'
  return 'n=' + v.length + '  ' + v[0] + ' / ' + v[Math.floor(v.length / 2)] + ' / ' + v[v.length - 1]
}
const sum = (a) => a.reduce((x, y) => x + y, 0)

console.log('  计划段        ' + plans.length + '    完成段 ' + dones.length + '    队列丢弃 ' + drops + '    过期 ' + expired + '    衔接 ' + chains)
console.log('  fade ms       ' + stat(plans.map((p) => p.fade)))
console.log('  peakHead dps  ' + stat(dones.map((d) => d.peak)))
console.log('  限速帧        ' + sum(dones.map((d) => d.clamp)) + '（段均 ' + Math.round(sum(dones.map((d) => d.clamp)) / Math.max(1, dones.length)) + '，最大单帧跳变 ' + Math.max(0, ...dones.map((d) => d.clampMax)) + '°）')
console.log('  MISS / 没动    ' + dones.filter((d) => d.miss).length + ' / ' + dones.filter((d) => !d.movedHead && !d.movedBody).length)
console.log('  交接 deg      ' + stat(exits.map((e) => e.deg)))
console.log('  交接 dps      ' + stat(exits.map((e) => e.dps)))
console.log('  handoff dev   ' + stat(hands.map((h) => h.dev)))
console.log('  排队等待 s    ' + stat(plays.map((p) => p.waited)))
const short = dones.filter((d) => d.frames <= 24)
console.log('  短段(<=24帧)  ' + (short.length ? short.map((d) => d.id.replace(/^anim_/, '') + ':' + d.frames).join('  ') : '无'))
const worst = [...dones].sort((a, b) => b.peak - a.peak).slice(0, 5)
console.log('  峰值最高 5 段 ' + worst.map((d) => d.id.replace(/^anim_/, '') + '=' + d.peak + 'dps').join('  '))
