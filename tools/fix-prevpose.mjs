// 交叉淡化必须从"她此刻真实的姿势"起步。原来取的是 lastRot（上一段我们自己写入的值），
// 整场第一段时 lastRot 是恒等四元数，于是从 identity 淡到待机 = 一百多度瞬间跳变，
// 实测 dev=119.4° / peakHead=10522dps。改成 StartClip 当场读 rig 上的 localRotation。
import { readFileSync, writeFileSync } from 'node:fs'
const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8')

const old = `            if (prevPose == null || lastRot == null || prevPose.Length != lastRot.Length) prevPose = new Quaternion[lastRot == null ? 0 : lastRot.Length];
            if (prevPose.Length == lastRot.Length) System.Array.Copy(lastRot, prevPose, lastRot.Length);
            switchT0 = Time.time;`
if (!s.includes(old)) throw new Error('prevPose 捕获块锚点失配')

const neu = `            // 从 rig 上真实的当前姿势起步：这才是"以上一个动作为初始状态"。
            // 不能抄 lastRot —— 那是我们自己上次写进去的值，首次演出时它是恒等式，
            // 淡入就等于把整个骨架从 identity 拉到待机（实测 119° 跳变）。
            if (bones != null && bones.Length > 0)
            {
                if (prevPose == null || prevPose.Length != bones.Length) prevPose = new Quaternion[bones.Length];
                for (int b = 0; b < bones.Length; b++)
                {
                    if (bones[b] != null) prevPose[b] = bones[b].localRotation;
                }
                prevPoseValid = true;
            }
            else
            {
                prevPoseValid = false;
            }
            switchT0 = Time.time;`
s = s.replace(old, neu)

// 字段 + 淡化条件要认这个标志
s = s.replace('        private Quaternion[] prevPose;',
  '        private Quaternion[] prevPose;\n        // prevPose 是否真的装着"上一次可见姿势"；没装着就不许淡化\n        private bool prevPoseValid;')
s = s.replace('if (kSwitch < 1f && prevPose != null && i < prevPose.Length)',
  'if (kSwitch < 1f && prevPoseValid && prevPose != null && i < prevPose.Length)')
writeFileSync(p, s, 'utf8')
console.log('  ✓ 交叉淡化改用 rig 真实姿势起步')
