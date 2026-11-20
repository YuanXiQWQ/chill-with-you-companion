// 旁观记录器的落盘器：游戏日志会被下一次启动整体覆盖，所以把 watch: 行实时抄一份。
// 用途只有一个：抓「游戏自己触发野事件」那一刻的 clip / cam / root（见 HANDOFF §9-P0）。
// 只读游戏日志，不碰游戏目录里的任何东西。
import fs from 'node:fs'
import path from 'node:path'

const GAME = process.env.CHILL_GAME_DIR || 'E:\\SteamLibrary\\steamapps\\common\\Chill With You Lo-Fi Story'
const LOG = path.join(GAME, 'BepInEx', 'LogOutput.log')
const DATA = process.env.CHILL_DATA_DIR || path.join(process.cwd(), 'data')
const OUT = path.join(DATA, 'watch-capture.log')
const TICK_MS = Number(process.env.CHILL_WATCH_TICK_MS) || 2000
const PAT = /watch: clip=|leavechair/i

let off = 0
try {
  const st = fs.statSync(LOG)
  // 接着上次的尾巴写；文件被重写过（新一次启动）就从头开始
  const prev = fs.existsSync(OUT) ? fs.statSync(OUT).size : 0
  off = prev > 0 ? Math.min(st.size, Number(fs.readFileSync(OUT, 'utf8').match(/^# offset=(\d+)/m)?.[1]) || 0) : 0
  if (off > st.size) off = 0
} catch { off = 0 }

function readNew () {
  try {
    const st = fs.statSync(LOG)
    if (st.size < off) off = 0 // 被截断/重写
    if (st.size === off) return
    const fd = fs.openSync(LOG, 'r')
    const len = st.size - off
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, off)
    fs.closeSync(fd)
    off = st.size
    const lines = buf.toString('utf8').split(/\r?\n/).filter((l) => PAT.test(l))
    for (const line of lines) fs.appendFileSync(OUT, `${new Date().toISOString()} | ${line.trim()}\n`, 'utf8')
  } catch (e) {
    fs.appendFileSync(OUT, `${new Date().toISOString()} | ! ${e.message}\n`, 'utf8')
  }
}

fs.appendFileSync(OUT, `# capture start ${new Date().toISOString()} log=${LOG} offset=${off}\n`, 'utf8')
readNew()
setInterval(readNew, TICK_MS)
console.log('capture-watch: ' + LOG + ' -> ' + OUT + ' tick=' + TICK_MS + 'ms')
