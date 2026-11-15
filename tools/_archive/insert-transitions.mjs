// 我们是"插入"，不是"接管"：起手从她此刻的姿势进，结束把身体交回游戏此刻的姿势。
// 这个脚本一次性把三件事做对（文件是 CRLF，统一按 LF 处理再写回）。
import { readFileSync, writeFileSync } from 'node:fs'
const p = 'game/src/PerformerPlugin.cs'
const raw = readFileSync(p, 'utf8')
let s = raw.replace(/\r\n/g, '\n')
const orig = s

// ── ① 字段 ──
if (!s.includes('private Quaternion[] exitRot;')) {
  s = s.replace('        private Quaternion[] prevPose;',
`        // 归还过渡的目标：演完时"游戏此刻会把她摆成什么样"，现场求值后读出
        private Quaternion[] exitRot;
        private bool exitValid;
        private Quaternion[] prevPose;`)
}

// ── ② 现场求值 helper ──
if (!s.includes('private bool CaptureGamePose')) {
  s = s.replace('        private void StepClip(float ct)',
`        private Quaternion[] releaseBoneBuf;
        /**
         * 读出"游戏自己此刻的姿势"。
         * 不能在 LateUpdate 里直接抓 bones.localRotation —— 那上面是我们上一帧写回去的值，
         * 叠加路径会因此每帧自乘（实测 dev=119°）。让 Animator 当场重算一帧再读。
         * 起手与归还都用它。
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

// ── ③ 起手：现场求值 ──
const oldBase = `            if (!clipActive || !baseGameValid)
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
s = s.replace(oldBase, `            if (!clipActive || !baseGameValid)
            {
                if (baseGameRot == null || baseGameRot.Length != n)
                {
                    baseGameRot = new Quaternion[n];
                    baseGamePos = new Vector3[n];
                }
                // 起手：让她此刻的样子成为"插入的起点"，不是我们缓存的旧样子
                if (!CaptureGamePose(baseGameRot))
                {
                    for (int i = 0; i < n; i++) baseGameRot[i] = bones[i].localRotation;
                }
                for (int i = 0; i < n; i++) baseGamePos[i] = bones[i].localPosition;
                baseGameValid = true;
            }`)

// ── ④ 归还阶段：判定 + 现场取归还目标 + 合成顺序 ──
const oldCompose = `                Quaternion q;
                // 专注态只让头和颈动，身体被锁在游戏姿势 —— 这时追求"绝对姿势"是自欺：
                // 够不到目标，却把 clip 的绝对姿态套到头上（10.5° 的动作推成 20.2° 偏移）。
                bool useAdditive = profile.Additive || upperOnly;
                if (useAdditive)
                {
                    // 手势类：叠在游戏姿态上，她不会位移
                    q = gameRot[i] * ScaleDelta(delta, isHead ? wHead : wBody);
                }
                else
                {
                    // 道具/姿态/位移类：必须真的到她该去的位置，所以向绝对姿势过渡，
                    // 过渡时长由分类决定（600~900ms），不是瞬间覆盖。
                    float rampW = profile.RampMs <= 1f ? 1f : Mathf.SmoothStep(0f, 1f, Mathf.Clamp01((Time.time - absRampT0) / (profile.RampMs / 1000f)));
                    q = Quaternion.Slerp(gameRot[i], tr.localRotation, Mathf.Clamp01((isHead ? wHead : wBody) * rampW));
                }
                if (kSwitch < 1f && prevPoseValid && prevPose != null && i < prevPose.Length)
                    q = Quaternion.Slerp(prevPose[i], q, kSwitch);`
if (!s.includes(oldCompose)) throw new Error('合成块锚点失配')
const newCompose = `                Quaternion q;
                // 专注态够不到"绝对姿势"，追求它等于把头硬掰过去（实测 10.5° 动作推成 20.2° 偏移）
                bool useAdditive = profile.Additive || upperOnly;
                // 归还阶段用"游戏此刻的姿势"当基底，而不是开演前的快照
                Quaternion baseNow = (exiting && exitValid && i < exitRot.Length) ? exitRot[i] : gameRot[i];
                if (useAdditive)
                {
                    q = baseNow * ScaleDelta(delta, isHead ? wHead : wBody);
                }
                else
                {
                    // 道具/姿态/位移：向她该去的位置过渡，过渡时长由类别定（600~900ms）
                    float rampW = profile.RampMs <= 1f ? 1f : Mathf.SmoothStep(0f, 1f, Mathf.Clamp01((Time.time - absRampT0) / (profile.RampMs / 1000f)));
                    q = Quaternion.Slerp(baseNow, tr.localRotation, Mathf.Clamp01((isHead ? wHead : wBody) * rampW));
                }
                // 起手：从"插入那一刻的姿势"过渡进来
                if (kSwitch < 1f && prevPoseValid && prevPose != null && i < prevPose.Length)
                    q = Quaternion.Slerp(prevPose[i], q, kSwitch);
                // 归还：把身体交回游戏此刻的姿势，而不是硬切
                if (exiting && exitValid && i < exitRot.Length)
                    q = Quaternion.Slerp(exitRot[i], q, kOut);`
s = s.replace(oldCompose, newCompose)

// ── ⑤ 归还阶段的判定与权重（放在采样之后、合成之前）──
const anchorAfterSample = `            headDevDeg = 0f;
            float wBody = planWBody * EnvelopeAt(ct, false);`
if (!s.includes(anchorAfterSample)) throw new Error('归还判定锚点失配')
s = s.replace(anchorAfterSample, `            // ── 归还阶段 ──
            // 我们是插入，演完必须把身体还回去。归还目标要现场问游戏"你现在会把她摆成什么样"，
            // 用开演前的旧姿势当目标 = 交回去一个过期姿势，最后还是会跳一下。
            float relMs = Plugin.ReleaseMs == null ? 300f : Mathf.Max(30f, Plugin.ReleaseMs.Value);
            float relSec = relMs / 1000f;
            bool exiting = !clipLoop && ct > clipLen;
            if (exiting && !exitValid)
            {
                if (exitRot == null || exitRot.Length != n) exitRot = new Quaternion[n];
                exitValid = CaptureGamePose(exitRot);
                if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("return to game pose: " + (exitValid ? "captured" : "fallback") + " rel=" + relMs.ToString("F0") + "ms");
            }
            float kOut = 1f;
            if (exiting)
            {
                float kk = relSec <= 0.001f ? 1f : Mathf.Clamp01((ct - clipLen) / relSec);
                kOut = Mathf.SmoothStep(0f, 1f, 1f - kk);
            }
            headDevDeg = 0f;
            float wBody = planWBody * EnvelopeAt(ct, false);`)

// ── ⑥ 收尾时机：留出归还窗口，别在 clipLen 一刀切 ──
const oldEnd = `                if (ct > clipLen)
                {
                    if (clipLoop) ct = clipLen > 0.01f ? ct % clipLen : 0f;
                    else
                    {
                        clipActive = false; ReleaseBaseGameCache();`
if (!s.includes(oldEnd)) throw new Error('收尾锚点失配')
s = s.replace(oldEnd, `                float relForEnd = (Plugin.ReleaseMs == null ? 300f : Mathf.Max(30f, Plugin.ReleaseMs.Value)) / 1000f;
                if (ct > clipLen + (clipLoop ? 0f : relForEnd))
                {
                    if (clipLoop) ct = clipLen > 0.01f ? ct % clipLen : 0f;
                    else
                    {
                        clipActive = false; ReleaseBaseGameCache(); exitValid = false;`)

// ── ⑦ 新一段开演时清归还状态 ──
s = s.replace('            dbgPushHead = 0f; dbgPushBody = 0f;', '            dbgPushHead = 0f; dbgPushBody = 0f;\n            exitValid = false;')

if (s === orig) throw new Error('没有任何改动，锚点全部失效')
writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8')
console.log('  ✓ 起手/归还两段过渡已接上')
