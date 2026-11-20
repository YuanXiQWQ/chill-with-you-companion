// 盯一趟离座：从 go 到 comeback 的全过程（只读 /chill/v1/game）。
const URL = 'http://127.0.0.1:10722/chill/v1/game'
const LIMIT_MS = Number(process.env.CHILL_POLL_MS) || 360000
const t0 = Date.now()
let prev = ''
let sawComeback = false
const fmt = (ms) => (ms / 1000).toFixed(1) + 's'
while (Date.now() - t0 < LIMIT_MS) {
  try {
    const g = (await (await fetch(URL)).json()).game || {}
    const m = g.motion || {}
    const q = g.queue || {}
    const line = `clip=${g.clip || '-'} active=${m.active || '-'} rem=${fmt(Number(m.remainingMs) || 0)} q=${q.depth || 0} played=${q.played || 0} expired=${q.expired || 0}`
    if (line !== prev) {
      console.log(new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '  ' + line)
      prev = line
    }
    if (/comeback/.test(g.clip || '')) sawComeback = true
    if (sawComeback && !/leavechair/.test(g.clip || '')) {
      console.log(new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '  >>> 回到坐姿，全程结束')
      break
    }
  } catch (e) { console.log('! ' + e.message) }
  await new Promise((r) => setTimeout(r, 2000))
}
console.log('sawComeback=' + sawComeback)
