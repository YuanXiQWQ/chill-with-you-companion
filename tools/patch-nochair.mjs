// 补丁 9：别再用离座动画驱动椅子。
//
// 截图现场：椅子被推到镜头前，整块挡住画面。原因是我把 `leavechair_*` 这套 clip
// 也套到椅子上（`m_Chair_mobile` 上有 136 条同名 clip），可那套椅子动画是按
// 另一套场景锚点摆的——采样过来就把椅子甩到镜头前，而且停在那儿。
//
// 结论：她起身离开时，椅子就该留在书桌前。道具跟随只保留给"东西在手上/桌上"那类。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let s = readFileSync(P, 'utf8')
if (s.includes('skipPropForTrip')) { console.log('  已打过'); process.exit(0) }

const re = /( *)if \(clipTarget2 == null\)/
const m = s.match(/( *)if \(propClips\.Count > 0\)\r?\n/)
// 直接在收集道具的那一段前面加一道闸：离座/回来这两族不碰道具
const anchor = /( *)List<Animator> holders;\r?\n(\s*)if \(clipExtraOwners\.TryGetValue\(clipName, out holders\)\)/
if (!anchor.test(s)) throw new Error('锚点未命中')
const pad = s.match(anchor)[1]
s = s.replace(anchor, `${pad}// 离座/回来这两族的椅子动画是按另一套锚点摆的，套过来会把椅子甩到镜头前\r\n` +
  `${pad}bool skipPropForTrip = clipName.IndexOf("leavechair", StringComparison.OrdinalIgnoreCase) >= 0;\r\n` +
  `${pad}List<Animator> holders;\r\n${pad}if (!skipPropForTrip && clipExtraOwners.TryGetValue(clipName, out holders))`)

writeFileSync(P, s.replace(/\r?\n/g, '\r\n'), 'utf8')
console.log('  ok 离座不驱动道具')
