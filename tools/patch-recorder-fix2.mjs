// 修补丁 16：记录器的启动点放错类了（插进了 WatchRecorder 自己的 Update）。
// 改成在 Plugin.Awake 里起一次。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let s = readFileSync(P, 'utf8')
let hits = 0

// ① 删掉 WatchRecorder.Update 里的自调用
const dupRe = /( *)Plugin\.EnsureWatcher\(\);\r\n *(?=if \(Time\.unscaledTime < nextAt\) return;)/g
const before = s.length
s = s.replace(dupRe, '')
if (s.length !== before) hits++

// ② 挂到 Plugin.Awake
const awRe = /( *)private void Awake\(\)\r?\n *\{\r?\n/
const m = s.match(awRe)
if (!m) throw new Error('锚点 Awake 未命中')
const pad = m[1]
s = s.replace(awRe, (x) => x + `${pad}    EnsureWatcher();\r\n`)
hits++

writeFileSync(P, s.replace(/\r?\n/g, '\r\n'), 'utf8')
console.log('  修 ' + hits + ' 处')
