// 补丁 6：让她真的走开——根位移必须放行。
// 现象：「角色还在画面没到沙发坐着」。根因在写回那一行：
//     tr.localPosition = gamePos[i];
// 每帧把每根骨的局部位置都强制写回"游戏待机姿势"，于是 clip 里的位移（走到沙发）全被抹掉，
// 人只在原地做动作。
// 做法：离座/行走类的 clip 放行根位移；"在沙发上待着"那种按住段，把根冻在走到的位置。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let s = readFileSync(P, 'utf8')
let hits = 0
const sub = (from, to, tag) => {
  const n = s.split(from).length - 1
  if (n !== 1) throw new Error('锚点 ' + tag + ' 命中 ' + n + ' 次（应为 1）')
  s = s.replace(from, to)
  hits++
}

// ① 字段
sub(
  '        private float propProgress;',
  `        private float propProgress;
        // 根位移：离座/行走类 clip 必须放行，否则"走到沙发"这件事被写回逻辑抹掉，
        // 人只在画面里原地做动作。按住段则把根冻在走到的位置。
        private bool posFree;
        private bool heldPosValid;
        private Vector3 heldPos;
        private Vector3 rootAtClipStart;
        private bool rootStartValid;`,
  'pos fields',
)

// ② StartClip：判定放行 + 记起点
sub(
  `            planFamily = StripSuffix(clipName);`,
  `            planFamily = StripSuffix(clipName);
            // 需要走位的那几族：离座、行走。它们不改写根位移就没有意义。
            posFree = clipName.IndexOf("leavechair", StringComparison.OrdinalIgnoreCase) >= 0
                || clipName.IndexOf("_walk", StringComparison.OrdinalIgnoreCase) >= 0
                || clipName.IndexOf("_run", StringComparison.OrdinalIgnoreCase) >= 0;
            if (posFree && bones != null && bones.Length > 0)
            {
                rootAtClipStart = bones[0].localPosition;
                rootStartValid = true;
            }
            // 普通坐姿动作开始时清掉"她走开了"的记忆，免得一直冻在沙发
            if (!posFree && holdMs <= 0) heldPosValid = false;`,
  'posFree decide',
)

// ③ 写回：根位移按需放行 / 冻结
sub(
  '                tr.localPosition = gamePos[i];',
  `                if (i == 0)
                {
                    if (posFree)
                    {
                        // 放行：采样已经把根移到该去的地方，记下来给按住段用
                        heldPos = tr.localPosition;
                        heldPosValid = true;
                    }
                    else if (heldPosValid && segHoldTotal > 0f)
                    {
                        // 在沙发上"待着"：根冻在走到的位置，不然她会被拽回椅子
                        tr.localPosition = heldPos;
                    }
                    else
                    {
                        tr.localPosition = gamePos[i];
                    }
                }
                else
                {
                    tr.localPosition = gamePos[i];
                }`,
  'root position freedom',
)

// ④ clip done 日志带上根位移，事后能验证"她到底有没有走开"
sub(
  'Plugin.Log.LogInfo("clip done: " + activeClip.name',
  'Plugin.Log.LogInfo("rootΔ=" + (rootStartValid && bones != null && bones.Length > 0 ? (bones[0].localPosition - rootAtClipStart).magnitude.ToString("F2") : "-") + "m " + "clip done: " + playName',
  'root delta log',
)

writeFileSync(P, s.replace(/\r?\n/g, '\r\n'), 'utf8')
console.log('  补丁 ' + hits + ' 处')
