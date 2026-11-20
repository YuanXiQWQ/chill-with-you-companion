// 我们是"插入"，不是"接管"：必须有起手与归还两段过渡。
//   起手：从她此刻可见的姿势进（现场读 rig），不是从缓存的待机姿势进。
//   归还：把身体交回**游戏此刻的姿势**（让 Animator 现场求值再读），
//         而不是交回我们开演前缓存的旧姿势 —— 那是硬切。
import { readFileSync, writeFileSync } from 'node:fs'
const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8')

// ── ① 字段 ──
if (!s.includes('private Quaternion[] exitRot;')) {
  s = s.replace('        private Quaternion[] prevPose;',
`        // 归还过渡的目标：演练结束时"游戏此刻会把她摆成什么样"，现场求值后读出来
        private Quaternion[] exitRot;
        private Vector3[] exitPos;
        private bool exitValid;
        private Quaternion[] prevPose;`)
}

// ── ② 现场求值：让游戏自己的 Animator 重算这一帧，然后读骨骼 ──
if (!s.includes('private bool CaptureGamePose')) {
  s = s.replace('        private void StepClip(float ct)',
`        /**
         * 读出"游戏自己此刻的姿势"。
         * 我们曾在 LateUpdate 里抓 bones.localRotation 当基底，但那上面是我们上一帧写回去的值，
         * 叠加路径因此每帧自乘（实测 dev=119°）。正确做法是让游戏的 Animator 当场重算一帧，
         * 再把结果读进 dst。起手与归还都用它。
         */
        private bool CaptureGamePose(Quaternion[] dst)
        {
            if (heroine == null || bones == null || bones.Length == 0 || dst == null) return false;
            bool was = heroine.enabled;
            if (!was) heroine.enabled = true;
            try { heroine.Update(0f); } catch { }
            for (int i = 0; i < bones.Length && i < dst.Length; i++)
            {
                if (bones[i] != null) dst[i] = bones[i].localRotation;
            }
            if (!was) heroine.enabled = was;
            return true;
        }

        private void StepClip(float ct)`)

// ── ③ 起手：现场读姿势，而不是沿用可能过期的缓存 ──
const oldBase = `            // 只有没在演的时候才认为 rig 上是"游戏自己的姿势"。
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
            }`
if (!s.includes(oldBase)) throw new Error('基底捕获块锚点失配')
s = s.replace(oldBase, `            // 基底 = 游戏自己的姿势。演出期间 rig 上是我们的输出，绝不能拿它当基底
            // （叠加路径会每帧自乘）。开演时现场求值一次，之后一直用这份快照。
            if (!clipActive || !baseGameValid)
            {
                if (baseGameRot == null || baseGameRot.Length != n)
                {
                    baseGameRot = new Quaternion[n];
                    baseGamePos = new Vector3[n];
                }
                if (!CaptureGamePose(baseGameRot))
                {
                    for (int i = 0; i < n; i++) baseGameRot[i] = bones[i].localRotation;
                }
                for (int i = 0; i < n; i++) baseGamePos[i] = bones[i].localPosition;
                baseGameValid = true;
            }`)

writeFileSync(p, s, 'utf8')
console.log('  ✓ 起手改用现场求值')
