// 叠加路径的基底必须是"游戏自己的待机姿势"，不能是"我们上一帧写回去的姿势"。
// 原实现每帧把 bones[i].localRotation 抓进 gameRot，而那个值上一帧刚被我们改写过，
// 于是 delta 每帧乘一次自己 → 滚动放大。实测 nod 峰值 dev=119.6° / 10519dps，
// 而规划侧量出来只有 6°/19dps —— 两个数字的差就是这条自乘。
import { readFileSync, writeFileSync } from 'node:fs'
const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8')

// ① 缓存字段
if (!s.includes('private Quaternion[] baseGameRot;')) {
  s = s.replace('        private Quaternion[] prevPose;',
    `        // 游戏自身待机姿势的缓存：演出期间不许重抓，否则会把我们自己的输出当基底
        private Quaternion[] baseGameRot;
        private Vector3[] baseGamePos;
        private bool baseGameValid;
        private Quaternion[] prevPose;`)
}

// ② 演出期间用缓存，只有"没在演"时才刷新
const oldCapture = `            int n = bones.Length;
            for (int i = 0; i < n; i++)
            {
                gamePos[i] = bones[i].localPosition;
                gameRot[i] = bones[i].localRotation;
            }`
const newCapture = `            int n = bones.Length;
            // 只有没在演的时候才认为 rig 上是"游戏自己的姿势"。
            // 演出期间 rig 上是我们的输出，拿它当基底会让 delta 自乘放大。
            if (!clipActive || !baseGameValid)
            {
                if (baseGameRot == null || baseGameRot.Length != n)
                {
                    baseGameRot = new Quaternion[n];
                    baseGamePos = new Vector3[n];
                }
                for (int i = 0; i < n; i++)
                {
                    baseGameRot[i] = bones[i].localRotation;
                    baseGamePos[i] = bones[i].localPosition;
                }
                baseGameValid = true;
            }
            if (baseGameRot != null && baseGameRot.Length == n)
            {
                for (int i = 0; i < n; i++)
                {
                    gameRot[i] = baseGameRot[i];
                    gamePos[i] = baseGamePos[i];
                }
            }`
// StepClip 里第一处 n 捕获块（演出路径）
const idx = s.indexOf(oldCapture, s.indexOf('private void StepClip(float ct)'))
if (idx < 0) throw new Error('StepClip 捕获块锚点失配')
s = s.slice(0, idx) + newCapture + s.slice(idx + oldCapture.length)

// ③ 每段开演时作废缓存（换 clip = 游戏姿势可能会变，让它重抓一次）
s = s.replace(`            prevPoseValid = true;`, `            prevPoseValid = true;
            // 新的一段：允许下一帧重新确认游戏待机姿势（场景/坐姿可能换了）
            baseGameValid = false;`)

// ④ 收演后立刻作废，下一帧用游戏自己的姿势重抓
s = s.replace('        private void StepClip(float ct)', `        private void ReleaseBaseGameCache()
        {
            baseGameValid = false;
        }

        private void StepClip(float ct)`)

// ⑤ clip 结束（clipActive=false 的三处）之后都要作废
s = s.replace(/clipActive = false;(?![\s\S]{0,80}ReleaseBaseGameCache)/g, 'clipActive = false; ReleaseBaseGameCache();')
writeFileSync(p, s, 'utf8')
console.log('  ✓ 叠加基底改为缓存的游戏待机姿势')
