// 补丁 3：把 ttlMs 从 JSON 里读进 dto。
// 少了这一步，条目自带 TTL 是摆设——"回来"那一条还在全局 45s 的 TTL 下被当垃圾扔掉。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let s = readFileSync(P, 'utf8')
const from = '            dto.performance = cues.ToArray();\r\n            return dto;'
const to = '            dto.performance = cues.ToArray();\r\n            // 条目级 TTL：离座长途预排的「回来」那一条要在队里等几分钟，\r\n            // 全局 queue.TtlMs（45s）会把它当过期丢掉。\r\n            dto.ttlMs = JsonLite.Int(JsonLite.Get(root, "ttlMs"));\r\n            return dto;'
const n = s.split(from).length - 1
if (n !== 1) throw new Error('锚点命中 ' + n + ' 次')
writeFileSync(P, s.replace(from, to), 'utf8')
console.log('  ok 解析 ttlMs')
