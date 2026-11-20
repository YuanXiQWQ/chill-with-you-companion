// 补丁 11：把手动走位关掉，默认回到"游戏自己怎么演就怎么演"。
//
// 上一版我给她硬塞了 2.8 米的根位移，结果人跑到沙发那边、镜头还在书桌——
// 画面里剩下椅子糊在中间。根因是这些 clip 的语义：`leavechair_sofa_*` 全是
// "站立动作"，且 rootΔ=0（原地）。也就是说，游戏在别处把她的位置摆好再播这套，
// 不是这一套自己走过去。
//
// 所以走位改成配置项 acting.TripWalk（默认 false）：默认不动根，只播 clip。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let s = readFileSync(P, 'utf8')
if (s.includes('TripWalk = Config.Bind')) { console.log('  已打过'); process.exit(0) }

// ① 配置项（跟在 Props 后面）
const cfgRe = /( *)Props = Config\.Bind\("acting", "Props"[^\n]*\n/
if (!cfgRe.test(s)) throw new Error('锚点 cfg 未命中')
const pad = s.match(cfgRe)[1]
s = s.replace(cfgRe, (x) => x +
  `${pad}// 手动走位：离座时把角色根送到沙发/床边。默认关——\r\n` +
  `${pad}// 这些 clip 是原地动画（rootΔ=0），游戏是在别处摆好位置再播的，硬塞位移会把人放到镜头外。\r\n` +
  `${pad}TripWalk = Config.Bind("acting", "TripWalk", false, "Move the character root during leave-chair clips. Off by default.");\r\n`)

// ② 声明
const declRe = /( *)public static ConfigEntry<bool> Props;\r?\n/
if (!declRe.test(s)) throw new Error('锚点 decl 未命中')
s = s.replace(declRe, (x) => x + `${s.match(declRe)[1]}public static ConfigEntry<bool> TripWalk;\r\n`)

// ③ 用上：默认不动根
s = s.replace(
  'tripWalking = true;\r\n',
  'tripWalking = Plugin.TripWalk != null && Plugin.TripWalk.Value;\r\n',
)

writeFileSync(P, s.replace(/\r?\n/g, '\r\n'), 'utf8')
console.log('  ok 走位默认关')
