// 验收判据换成"幅度"：dps 用真实帧间隔算，帧一抖就失真（drink_end 计划 13 实测 32 就是噪声）。
// 幅度 = 当前姿势相对游戏待机姿势的角度，这才是"她有没有被搬走"的物理量。
import { readFileSync, writeFileSync } from 'node:fs'
const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8')

// ① 计数器
if (!s.includes('dbgPushHead')) {
  s = s.replace('        private Quaternion[] prevPose;',
    `        // 演出期间相对"游戏待机姿势"的最大推离角度：验收用这个，不用 dps
        private float dbgPushHead;
        private float dbgPushBody;
        private Quaternion[] prevPose;`)
}

// ② StepClip：每帧算推离角度
const anchor = `                float d = Quaternion.Angle(lastRot[i], q);
                lastRot[i] = q;`
if (!s.includes(anchor)) throw new Error('推离角度计算锚点失配')
s = s.replace(anchor, `                if (baseGameRot != null && baseGameRot.Length == n)
                {
                    float push = Quaternion.Angle(baseGameRot[i], q);
                    if (isHead) dbgPushHead = Mathf.Max(dbgPushHead, push);
                    else dbgPushBody = Mathf.Max(dbgPushBody, push);
                }
                float d = Quaternion.Angle(lastRot[i], q);
                lastRot[i] = q;`)

// ③ 开演清零
s = s.replace(`            prevPoseValid = true;`, `            prevPoseValid = true;
            dbgPushHead = 0f; dbgPushBody = 0f;`)

// ④ clip done 里带上计划值与实测推离，方便一行对比
s = s.replace(`+ " peakHead=" + headSpeedMax.ToString("F0") + "dps dev=" + headDevDeg.ToString("F1") + "deg"`,
  `+ " peakHead=" + headSpeedMax.ToString("F0") + "dps dev=" + headDevDeg.ToString("F1") + "deg"
                + " push=head" + dbgPushHead.ToString("F1") + "/body" + dbgPushBody.ToString("F1") + "deg"
                + " plan=head" + planHeadPeakDeg.ToString("F1") + "/body" + planBodyPeakDeg.ToString("F1") + "deg"`)
writeFileSync(p, s, 'utf8')
console.log('  ✓ clip done 增加 push= 与 plan= 幅度对比')
