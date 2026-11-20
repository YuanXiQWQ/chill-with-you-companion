// 让记录器自己叫一声，并把它吞掉的异常打出来。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let s = readFileSync(P, 'utf8')

s = s.replace('    watcher = go.AddComponent<WatchRecorder>();', '    watcher = go.AddComponent<WatchRecorder>();\r\n    Log.LogInfo("watcher up");')

// 记录器里被吞掉的异常露出来
s = s.replace(
  /( *)catch \{ \}\r\n( *)\}\r\n( *)\}\r\n( *)\}\r\n/,
  "$1catch (Exception ex) { Plugin.Log.LogError(\"watch failed: \" + ex.Message); }\r\n$2}\r\n$3}\r\n$4}\r\n",
)

writeFileSync(P, s.replace(/\r?\n/g, '\r\n'), 'utf8')
console.log('  ok')
