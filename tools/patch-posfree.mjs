// 补丁 15：位置别再一帧一帧写回去了。
//
// 你说的对：游戏里视野不变，人自己走到沙发坐下。那她的位移一定在**骨骼**里
// （髋骨之类的 localPosition 位移），而不是在这个 Character 根上——根位移实测是 0。
//
// 而我把**每一根骨**的 localPosition 每帧都写回缓存姿势：
//     tr.localPosition = gamePos[i];
// 位移（不管在根上还是髋上）全被抹掉了，只剩旋转，所以她永远原地动。
//
// 改成：位置一律不写回，交给采样结果（SampleAnimation 每帧写的是绝对值，不会漂）。
// 顺带：房间相机切换默认关——视野不该变。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let s = readFileSync(P, 'utf8')
if (s.includes('hipsIdx')) { console.log('  已打过'); process.exit(0) }
let hits = 0

// ① 整块位置写回删掉
const blockRe = /\r\n( *)if \(i == 0\)\r\n\1\{\r\n[\s\S]*?\r\n\1\}\r\n\1else\r\n\1\{\r\n\1    tr\.localPosition = gamePos\[i\];\r\n\1\}/
if (!blockRe.test(s)) throw new Error('锚点 位置写回 未命中')
s = s.replace(blockRe, '\r\n                // 位置不再写回：采样给的绝对值就是答案。写回会把髋骨/根的位移整条抹掉。')
hits++

// ② 髋骨诊断：这一段到底有没有把人挪走
const fRe = /( *)private bool posFree;/
if (!fRe.test(s)) throw new Error('锚点 posFree 未命中')
const pad = s.match(fRe)[1]
s = s.replace(fRe, `${pad}private bool posFree;\r\n` +
  `${pad}// 诊断：髋骨位移有多大（她到底有没有走开）\r\n` +
  `${pad}private int hipsIdx = -1;\r\n` +
  `${pad}private Vector3 hipsAtStart;`)
hits++

// ③ EnsureBones 里认髋骨
const bRe = /( *)Plugin\.Log\.LogInfo\("bones cached: "/
if (!bRe.test(s)) throw new Error('锚点 bones cached 未命中')
const bpad = s.match(bRe)[1]
s = s.replace(bRe, `${bpad}for (int hi = 0; hi < list.Length; hi++)\r\n` +
  `${bpad}{\r\n` +
  `${bpad}    var hn = list[hi].name ?? "";\r\n` +
  `${bpad}    if (hn.IndexOf("hips", StringComparison.OrdinalIgnoreCase) >= 0) { hipsIdx = hi; break; }\r\n` +
  `${bpad}}\r\n` +
  `${bpad}${'Plugin.Log.LogInfo("hips idx=" + hipsIdx);'.replace(/^/, '')}\r\n` +
  `${bpad}Plugin.Log.LogInfo("bones cached: "`)
hits++

// ④ 起演时记下髋骨起点
const sRe = /( *)posFree = clipName\.IndexOf\("leavechair"/
if (!sRe.test(s)) throw new Error('锚点 posFree 赋值 未命中')
const spad = s.match(sRe)[1]
s = s.replace(sRe, `${spad}if (hipsIdx >= 0 && bones != null && hipsIdx < bones.Length) hipsAtStart = bones[hipsIdx].localPosition;\r\n${spad}posFree = clipName.IndexOf("leavechair"`)
hits++

// ⑤ clip done 日志带上髋位移
s = s.replace('"rootΔ=" + (rootStartValid', '"hipsΔ=" + (hipsIdx >= 0 && bones != null && hipsIdx < bones.Length ? (bones[hipsIdx].localPosition - hipsAtStart).magnitude.ToString("F2") : "-") + "m " + "rootΔ=" + (rootStartValid')
hits++

// ⑥ 房间相机默认关
s = s.replace('if (isGo && (isSofa || isBed)) SetRoomView(isSofa ? "sofa" : "bed");',
  'if (Plugin.RoomView != null && Plugin.RoomView.Value && isGo && (isSofa || isBed)) SetRoomView(isSofa ? "sofa" : "bed");')
s = s.replace('if (isBack) SetRoomView("desk");',
  'if (Plugin.RoomView != null && Plugin.RoomView.Value && isBack) SetRoomView("desk");')
hits += 2

// ⑦ RoomView 配置
const cRe = /( *)TripWalk = Config\.Bind\("acting", "TripWalk"[^\n]*\n/
if (!cRe.test(s)) throw new Error('锚点 TripWalk cfg 未命中')
const cpad = s.match(cRe)[1]
s = s.replace(cRe, (x) => x +
  `${cpad}// 离座时切房间相机（Camera_Sofa / Camera_Bed）。默认关：游戏的视野本来不变，\r\n` +
  `${cpad}// 人是自己走到沙发坐下的。\r\n` +
  `${cpad}RoomView = Config.Bind("acting", "RoomView", false, "Switch room camera during leave-chair. Off by default.");\r\n`)
hits++

const dRe = /( *)public static ConfigEntry<bool> TripWalk;\r?\n/
if (!dRe.test(s)) throw new Error('锚点 TripWalk decl 未命中')
s = s.replace(dRe, (x) => x + `${s.match(dRe)[1]}public static ConfigEntry<bool> RoomView;\r\n`)
hits++

writeFileSync(P, s.replace(/\r?\n/g, '\r\n'), 'utf8')
console.log('  补丁 ' + hits + ' 处')
