// WatchTick 之前被插进了 WatchRecorder 自己的 Update（那是死代码）。挪到 PerformerUI.Update。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let s = readFileSync(P, 'utf8')
if (!s.includes('WatchTick()')) { console.log('  源码里没有 WatchTick'); process.exit(0) }

// ① 删掉错误位置的调用
s = s.replace(/\s*Plugin\.WatchTick\(\);\r?\n(?=\s*if \(Time\.unscaledTime < nextAt\) return;)/, '\r\n')

// ② 找到 PerformerUI 类里的 Update，插第一条语句
const uiAt = s.indexOf('internal class PerformerUI : MonoBehaviour')
if (uiAt < 0) throw new Error('找不到 PerformerUI')
const head = s.slice(0, uiAt)
const tail = s.slice(uiAt)
const upRe = /( *)private void Update\(\)\r?\n( *)\{\r?\n/
const m = tail.match(upRe)
if (!m) throw new Error('PerformerUI 里没有 Update')
if (tail.slice(0, m.index).includes('Plugin.WatchTick()')) { console.log('  已插过'); process.exit(0) }
const pad = m[1]
const patched = tail.replace(upRe, (x) => x + `${pad}    Plugin.WatchTick();\r\n`)
writeFileSync(P, (head + patched).replace(/\r?\n/g, '\r\n'), 'utf8')
console.log('  ok 挪到 PerformerUI.Update')
