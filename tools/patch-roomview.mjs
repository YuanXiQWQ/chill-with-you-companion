// 补丁 13：照游戏自己的做法换镜头。
//
// 扫描结果（补丁 12）——房间里本来就有三台相机，游戏靠切换它们换视角：
//   Camera_Desk  pos=(1.88, 1.09, 2.69)  goActive=False   ← 书桌视角（和 MainCamera 同位置）
//   Camera_Sofa  pos=(0.88, 0.51, 0.24)  goActive=False   ← 沙发视角
//   Camera_Bed   pos=(0.86, 1.73,-2.63)  goActive=False   ← 床视角
//   MainCamera   pos=(1.88, 1.07, 2.69)  goActive=True    ← 常驻
//   RoomCameraManager: isPlayingStory / StartCameraAnimHash
//
// 所以"她离开座位"这件事，游戏是这么做的：**切到沙发相机**，人摆在沙发那边。
// 我之前只在书桌视角里把她挪过去，镜头没跟，画面自然不对。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let s = readFileSync(P, 'utf8')
if (s.includes('SetRoomView')) { console.log('  已打过'); process.exit(0) }
let hits = 0
const subRe = (re, build, tag) => {
  const m = s.match(re)
  if (!m) throw new Error('锚点 ' + tag + ' 未命中')
  const pad = m[1] ?? ''
  s = s.replace(re, (x) => build(pad, x))
  hits++
}

// ① 相机字段
subRe(
  /( *)private Transform tripAnchor;/,
  (pad) => `${pad}private Transform tripAnchor;\r\n` +
    `${pad}// 房间相机：游戏靠切换它们换视角（Camera_Desk / Camera_Sofa / Camera_Bed）\r\n` +
    `${pad}private Camera camDesk;\r\n` +
    `${pad}private Camera camSofa;\r\n` +
    `${pad}private Camera camBed;\r\n` +
    `${pad}private bool roomCamCached;`,
  'cam fields',
)

// ② 缓存 + 切换
subRe(
  /( *)private Transform FindTripAnchor\(\)/,
  (pad) => `${pad}private void CacheRoomCameras()\r\n` +
    `${pad}{\r\n` +
    `${pad}    if (roomCamCached) return;\r\n` +
    `${pad}    roomCamCached = true;\r\n` +
    `${pad}    try\r\n` +
    `${pad}    {\r\n` +
    `${pad}        foreach (var c in Resources.FindObjectsOfTypeAll<Camera>())\r\n` +
    `${pad}        {\r\n` +
    `${pad}            if (c == null || !c.gameObject.scene.IsValid()) continue;\r\n` +
    `${pad}            string nm = c.gameObject.name ?? "";\r\n` +
    `${pad}            if (nm.IndexOf("Camera_Desk", StringComparison.OrdinalIgnoreCase) >= 0) camDesk = c;\r\n` +
    `${pad}            else if (nm.IndexOf("Camera_Sofa", StringComparison.OrdinalIgnoreCase) >= 0) camSofa = c;\r\n` +
    `${pad}            else if (nm.IndexOf("Camera_Bed", StringComparison.OrdinalIgnoreCase) >= 0) camBed = c;\r\n` +
    `${pad}        }\r\n` +
    `${pad}        Plugin.Log.LogInfo("room cams: desk=" + (camDesk != null) + " sofa=" + (camSofa != null) + " bed=" + (camBed != null));\r\n` +
    `${pad}    }\r\n` +
    `${pad}    catch (Exception ex) { Plugin.Log.LogInfo("room cams failed: " + ex.Message); }\r\n` +
    `${pad}}\r\n\r\n` +
    `${pad}// 换房间视角。用游戏自己的相机，不碰任何位置参数\r\n` +
    `${pad}private void SetRoomView(string view)\r\n` +
    `${pad}{\r\n` +
    `${pad}    CacheRoomCameras();\r\n` +
    `${pad}    bool sofa = view == "sofa";\r\n` +
    `${pad}    bool bed = view == "bed";\r\n` +
    `${pad}    if (camSofa == null && camBed == null) return; // 没有这些相机就什么都别做\r\n` +
    `${pad}    try\r\n` +
    `${pad}    {\r\n` +
    `${pad}        if (camSofa != null) camSofa.gameObject.SetActive(sofa);\r\n` +
    `${pad}        if (camBed != null) camBed.gameObject.SetActive(bed);\r\n` +
    `${pad}        var main = Camera.main;\r\n` +
    `${pad}        if (main != null && (camSofa != null || camBed != null)) main.enabled = !(sofa || bed);\r\n` +
    `${pad}        if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("room view: " + view);\r\n` +
    `${pad}    }\r\n` +
    `${pad}    catch (Exception ex) { Plugin.Log.LogInfo("room view failed: " + ex.Message); }\r\n` +
    `${pad}}\r\n\r\n` +
    `${pad}private Transform FindTripAnchor()`,
  'room view methods',
)

// ③ 离座/回来时切视角（顺带把根放到那一边，否则相机拍到的位置空着）
subRe(
  /( *)bool isBack = clipName\.IndexOf\("leavechair", StringComparison\.OrdinalIgnoreCase\) >= 0/,
  (pad) => `${pad}bool isSofa = clipName.IndexOf("_sofa", StringComparison.OrdinalIgnoreCase) >= 0;\r\n` +
    `${pad}bool isBed = clipName.IndexOf("_bed", StringComparison.OrdinalIgnoreCase) >= 0;\r\n` +
    `${pad}if (isGo && (isSofa || isBed)) SetRoomView(isSofa ? "sofa" : "bed");\r\n` +
    `${pad}if (isBack) SetRoomView("desk");\r\n` +
    `${pad}bool isBack = clipName.IndexOf("leavechair", StringComparison.OrdinalIgnoreCase) >= 0`,
  'view on trip',
)

writeFileSync(P, s.replace(/\r?\n/g, '\r\n'), 'utf8')
console.log('  补丁 ' + hits + ' 处')
