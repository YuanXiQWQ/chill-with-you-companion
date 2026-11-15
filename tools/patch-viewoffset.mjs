// 补丁 14（重写）：站位跟着镜头走。
// 目标点原来定在"沙发往椅子方向 0.55m"，换成沙发相机看就是怼在镜头上。
// 改成"沙发往相机方向 0.35m"。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let s = readFileSync(P, 'utf8')
if (s.includes('Camera roomCam =')) { console.log('  已打过'); process.exit(0) }
let hits = 0

const re = /( *)Vector3 toward = tripFromWorld - c;\r?\n(\s*)toward\.y = 0f;/
const m = s.match(re)
if (!m) throw new Error('锚点 toward 未命中')
const pad = m[1]
s = s.replace(re,
  `${pad}// 站哪由镜头决定：沙发往相机那边让 0.35m，别站进坐垫里、也别怼到镜头上\r\n` +
  `${pad}Camera roomCam = isBed ? camBed : camSofa;\r\n` +
  `${pad}Vector3 toward = roomCam != null ? (roomCam.transform.position - c) : (tripFromWorld - c);\r\n` +
  `${pad}toward.y = 0f;`)
hits++

if (!s.includes('normalized * 0.55f')) throw new Error('锚点 0.55 未命中')
s = s.replace('normalized * 0.55f', 'normalized * 0.35f')
hits++

s = s.replace(/\s*\/\/ 站到沙发前面，别站进坐垫里/, '')
writeFileSync(P, s.replace(/\r?\n/g, '\r\n'), 'utf8')
console.log('  补丁 ' + hits + ' 处')
