// 补丁 10：道具跟随默认关掉。
//
// 现象：「椅子和窗户照样动」——我加的道具跟随把椅子、窗户这些物体的同名 clip 也演了一遍。
// 那套动画是按别的场景锚点摆的，套到她身上 = 屋子自己在动（还有个看不见的人）。
//
// 做法：加配置 acting.Props（默认 false）。真要跟随再打开，按族逐个试。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let s = readFileSync(P, 'utf8')
if (s.includes('Props = Config.Bind')) { console.log('  已打过'); process.exit(0) }

// ① 配置项
const cfgRe = /( *)FollowGameMixer = Config\.Bind\([^\n]*\n/
const m = s.match(cfgRe)
if (!m) throw new Error('锚点 cfg 未命中')
const pad = m[1]
s = s.replace(cfgRe, (x) => x +
  `${pad}// 让椅子、窗户这些道具跟着同名 clip 一起动。默认关：\r\n` +
  `${pad}// 那套动画是按别的场景锚点摆的，套过来会把物体甩到位（实测：椅子糊住整个镜头）。\r\n` +
  `${pad}Props = Config.Bind("acting", "Props", false, "Let props (chair, window…) play their same-named clip. Off by default.");\r\n`)

// ② 声明
const declRe = /( *)internal static ConfigEntry<bool> FollowGameMixer;\r?\n/
if (!declRe.test(s)) throw new Error('锚点 decl 未命中')
s = s.replace(declRe, (x) => x + `${s.match(declRe)[1]}public static ConfigEntry<bool> Props;\r\n`)

// ③ 用上
s = s.replace(
  'bool skipPropForTrip = clipName.IndexOf("leavechair", StringComparison.OrdinalIgnoreCase) >= 0;',
  'bool skipPropForTrip = Plugin.Props == null || !Plugin.Props.Value\r\n' +
    '                || clipName.IndexOf("leavechair", StringComparison.OrdinalIgnoreCase) >= 0;',
)

writeFileSync(P, s.replace(/\r?\n/g, '\r\n'), 'utf8')
console.log('  ok 道具跟随默认关')
