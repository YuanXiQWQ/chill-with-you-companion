// 补丁 8：让她真的走过去、坐在沙发上。
//
// 现场证据（诊断补丁 7）：
//   charRoot=Character world=(2.74, 0.00, 1.70)
//   seat candidate: m_couch_mobile world=(0.00, -0.03, -0.24) parent=Platform_PC
//   seat candidate: Sofaside world=(2.32, 1.04, 1.65)（沙发边几，跳过）
//   rootΔ=0.00m  ← `sofa_go` 是原地动画，根本不带位移
//
// 结论：位移得我们自己给。去程/回程放行根位移并把它送到沙发上，按住段冻在沙发上。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let s = readFileSync(P, 'utf8')
if (s.includes('tripAnchor')) { console.log('  已打过'); process.exit(0) }
let hits = 0
const subRe = (re, build, tag) => {
  const m = s.match(re)
  if (!m) throw new Error('锚点 ' + tag + ' 未命中')
  const pad = m[1] ?? ''
  s = s.replace(re, (x) => (build ? build(pad, x) : x))
  hits++
}

// ① 字段
subRe(
  /( *)private bool posFree;/,
  (pad) => `${pad}private bool posFree;\r\n` +
    `${pad}// 沙发锚点：按名字现找（离座动画是原地动画，位移得我们自己给）\r\n` +
    `${pad}private Transform tripAnchor;\r\n` +
    `${pad}private bool tripAnchorSearched;\r\n` +
    `${pad}private bool tripWalking;\r\n` +
    `${pad}private Vector3 tripFromWorld;\r\n` +
    `${pad}private Vector3 tripToWorld;`,
  'trip fields',
)

// ② 找锚点（插在 EnsureBones 前面）
subRe(
  /( *)private void EnsureBones\(\)/,
  (pad) => `${pad}private Transform FindTripAnchor()\r\n` +
    `${pad}{\r\n` +
    `${pad}    if (tripAnchorSearched) return tripAnchor;\r\n` +
    `${pad}    tripAnchorSearched = true;\r\n` +
    `${pad}    try\r\n` +
    `${pad}    {\r\n` +
    `${pad}        foreach (var tr in Resources.FindObjectsOfTypeAll<Transform>())\r\n` +
    `${pad}        {\r\n` +
    `${pad}            if (tr == null || !tr.gameObject.scene.IsValid()) continue;\r\n` +
    `${pad}            string nm = tr.name ?? "";\r\n` +
    `${pad}            if (nm.IndexOf("couch", StringComparison.OrdinalIgnoreCase) < 0\r\n` +
    `${pad}                && nm.IndexOf("sofa", StringComparison.OrdinalIgnoreCase) < 0) continue;\r\n` +
    `${pad}            if (nm.IndexOf("side", StringComparison.OrdinalIgnoreCase) >= 0) continue;\r\n` +
    `${pad}            if (!tr.gameObject.activeInHierarchy) continue;\r\n` +
    `${pad}            tripAnchor = tr;\r\n` +
    `${pad}            Plugin.Log.LogInfo("trip anchor: " + nm + " world=" + tr.position.ToString("F2"));\r\n` +
    `${pad}            break;\r\n` +
    `${pad}        }\r\n` +
    `${pad}        if (tripAnchor == null) Plugin.Log.LogInfo("trip anchor: 没找到沙发，离座只做原地动作");\r\n` +
    `${pad}    }\r\n` +
    `${pad}    catch (Exception ex) { Plugin.Log.LogInfo("trip anchor failed: " + ex.Message); }\r\n` +
    `${pad}    return tripAnchor;\r\n` +
    `${pad}}\r\n\r\n` +
    `${pad}private void EnsureBones()`,
  'find anchor',
)

// ③ 起演时决定这一段走不走位
subRe(
  /( *)if \(!posFree && holdMs <= 0\) heldPosValid = false;/,
  (pad) => `${pad}if (!posFree && holdMs <= 0) heldPosValid = false;\r\n` +
    `${pad}// 走位：去程送到沙发，回程送回椅子，按住段原地待在沙发上\r\n` +
    `${pad}tripWalking = false;\r\n` +
    `${pad}bool isGo = clipName.IndexOf("leavechair", StringComparison.OrdinalIgnoreCase) >= 0\r\n` +
    `${pad}    && (clipName.IndexOf("_go", StringComparison.OrdinalIgnoreCase) >= 0\r\n` +
    `${pad}        || clipName.IndexOf("_start", StringComparison.OrdinalIgnoreCase) >= 0);\r\n` +
    `${pad}bool isBack = clipName.IndexOf("leavechair", StringComparison.OrdinalIgnoreCase) >= 0\r\n` +
    `${pad}    && clipName.IndexOf("comeback", StringComparison.OrdinalIgnoreCase) >= 0;\r\n` +
    `${pad}if ((isGo || isBack) && bones != null && bones.Length > 0)\r\n` +
    `${pad}{\r\n` +
    `${pad}    var anchor = FindTripAnchor();\r\n` +
    `${pad}    if (anchor != null)\r\n` +
    `${pad}    {\r\n` +
    `${pad}        tripWalking = true;\r\n` +
    `${pad}        tripFromWorld = bones[0].position;\r\n` +
    `${pad}        if (isGo)\r\n` +
    `${pad}        {\r\n` +
    `${pad}            Vector3 c = anchor.position;\r\n` +
    `${pad}            Vector3 toward = tripFromWorld - c;\r\n` +
    `${pad}            toward.y = 0f;\r\n` +
    `${pad}            if (toward.sqrMagnitude < 0.01f) toward = Vector3.forward;\r\n` +
    `${pad}            // 站到沙发前面，别站进坐垫里\r\n` +
    `${pad}            tripToWorld = c + toward.normalized * 0.55f;\r\n` +
    `${pad}            tripToWorld.y = tripFromWorld.y;\r\n` +
    `${pad}        }\r\n` +
    `${pad}        else\r\n` +
    `${pad}        {\r\n` +
    `${pad}            if (heldPosValid) tripFromWorld = heldPos;\r\n` +
    `${pad}            tripToWorld = chairHomeValid ? chairHomeWorld : tripFromWorld;\r\n` +
    `${pad}        }\r\n` +
    `${pad}        if (Plugin.VerboseCues.Value)\r\n` +
    `${pad}            Plugin.Log.LogInfo("trip walk: " + (isGo ? "go" : "back") + " from=" + tripFromWorld.ToString("F2") + " to=" + tripToWorld.ToString("F2"));\r\n` +
    `${pad}    }\r\n` +
    `${pad}}`,
  'trip walk decide',
)

// ④ 记椅子原位
subRe(
  /( *)if \(baseGameRot != null && baseGameRot\.Length == n\)/,
  (pad) => `${pad}if (!chairHomeValid && bones != null && bones.Length > 0)\r\n` +
    `${pad}{\r\n` +
    `${pad}    chairHomeWorld = bones[0].position;\r\n` +
    `${pad}    chairHomeValid = true;\r\n` +
    `${pad}}\r\n` +
    `${pad}if (baseGameRot != null && baseGameRot.Length == n)`,
  'chair home',
)

// ⑤ 椅子原位字段
subRe(
  /( *)private Vector3 tripToWorld;/,
  (pad) => `${pad}private Vector3 tripToWorld;\r\n${pad}private Vector3 chairHomeWorld;\r\n${pad}private bool chairHomeValid;`,
  'chair home fields',
)

// ⑥ 每帧推根
subRe(
  /( *)bool exiting0 = !clipLoop && ct > clipLen;/,
  (pad) => `${pad}if (tripWalking && bones != null && bones.Length > 0)\r\n` +
    `${pad}{\r\n` +
    `${pad}    // 用 clip 进度当时间轴：走位和脚步同一节奏；smoothstep 起步收尾都不硬\r\n` +
    `${pad}    float ud = segTotal > 0.01f ? Mathf.Clamp01(Mathf.Min(ct, segTotal) / segTotal) : 1f;\r\n` +
    `${pad}    float k = ud * ud * (3f - 2f * ud);\r\n` +
    `${pad}    bones[0].position = Vector3.Lerp(tripFromWorld, tripToWorld, k);\r\n` +
    `${pad}    if (segHoldTotal > 0f) heldPos = bones[0].position;\r\n` +
    `${pad}}\r\n` +
    `${pad}bool exiting0 = !clipLoop && ct > clipLen;`,
  'per frame walk',
)

writeFileSync(P, s.replace(/\r?\n/g, '\r\n'), 'utf8')
console.log('  补丁 ' + hits + ' 处')
