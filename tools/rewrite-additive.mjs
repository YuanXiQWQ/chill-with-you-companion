// 一次性重写 StepClip / MeasureAndPlan 尾部：叠加式（additive）动作层。
// 用方法边界做定位，整块替换；不做逐行拼接。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const file = root + 'game/src/PerformerPlugin.cs'
let src = readFileSync(file, 'utf8')
const before = src

function sliceMethod(text, startMarker, endMarker) {
  const a = text.indexOf(startMarker)
  if (a < 0) throw new Error('找不到起点: ' + startMarker.slice(0, 40))
  const b = text.indexOf(endMarker, a)
  if (b < 0) throw new Error('找不到终点: ' + endMarker.slice(0, 40))
  return { a, b }
}

// ── 1) StepClip + 包络辅助 ───────────────────────────────────────────
const stepStart = src.indexOf('        // 每帧：先记下游戏这一帧的姿势')
const stepBegin = stepStart >= 0 ? stepStart : src.indexOf('        private void StepClip(float ct)')
const { b: stepEnd } = sliceMethod(src, 'private void StepClip(float ct)', 'private void EnsureBones()')

const newStep = `        // 每帧：记下游戏此刻的姿势 → 采样 clip → 只取 clip 相对自己首帧的"运动增量"，
        // 按权重叠在游戏姿势上。位置一律用游戏值。
        private float EnvelopeAt(float ct, bool head)
        {
            float fade = head
                ? (Plugin.HeadFadeMs == null ? 0.32f : Mathf.Max(0.02f, Plugin.HeadFadeMs.Value / 1000f))
                : clipFadeIn;
            float rel = Plugin.ReleaseMs == null ? 0.3f : Mathf.Max(0.02f, Plugin.ReleaseMs.Value / 1000f);
            float e = 1f;
            if (ct < fade) e = Mathf.Min(e, Mathf.SmoothStep(0f, 1f, ct / fade));
            float tailFrom = clipLen + (head ? rel : 0f);
            float left = tailFrom - ct;
            if (left < fade) e = Mathf.Min(e, Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(Mathf.Max(0f, left) / fade)));
            if (ct > clipLen)
            {
                float k = Mathf.Clamp01(1f - (ct - clipLen) / rel);
                e = Mathf.Min(e, Mathf.SmoothStep(0f, 1f, k));
            }
            return Mathf.Clamp01(e);
        }

        private void StepClip(float ct)
        {
            if (segClips == null || segClips.Length == 0) { clipActive = false; return; }
            int n = bones.Length;
            for (int i = 0; i < n; i++)
            {
                gamePos[i] = bones[i].localPosition;
                gameRot[i] = bones[i].localRotation;
            }
            float speed = clipSpeed > 0.01f ? clipSpeed : 0.62f;
            float ts = Mathf.Clamp(ct * speed, 0f, Mathf.Max(0f, segTotal - 0.001f));
            int idx = 0;
            while (idx < segClips.Length - 1 && ts >= segStarts[idx + 1]) idx++;
            SampleChainClip(segClips[idx], clipTarget, ts - segStarts[idx], 0);
            float wBody = planWBody * EnvelopeAt(ct, false);
            float wHead = planWHead * EnvelopeAt(ct, true);
            float switchMs = Plugin.SwitchBlendMs == null ? 260f : Mathf.Max(0f, Plugin.SwitchBlendMs.Value);
            float kSwitch = switchMs <= 1f ? 1f : Mathf.SmoothStep(0f, 1f, Mathf.Clamp01((Time.time - switchT0) / (switchMs / 1000f)));
            float dt = Mathf.Max(0.0001f, Time.deltaTime);
            for (int i = 0; i < n; i++)
            {
                var tr = bones[i];
                bool isHead = upperAllowed != null && i < upperAllowed.Length && upperAllowed[i];
                // 专注/番茄钟：只让头和颈动，身体保持游戏自己的姿态
                if (upperOnly && !isHead)
                {
                    tr.localRotation = gameRot[i];
                    tr.localPosition = gamePos[i];
                    continue;
                }
                // 叠加式：base 是 clip 自己的首帧，delta 是它自己的运动量。
                // 游戏待机姿势（gameRot）始终是基底，所以不会把她"搬"到别处 ——
                // 位移式点头的根因就是拿 clip 的绝对姿势去覆盖待机姿势。
                Quaternion baseQ = (clipBaseRot != null && i < clipBaseRot.Length) ? clipBaseRot[i] : Quaternion.identity;
                Quaternion delta = Quaternion.Inverse(baseQ) * tr.localRotation;
                Quaternion q = gameRot[i] * ScaleDelta(delta, isHead ? wHead : wBody);
                if (kSwitch < 1f && prevPose != null && i < prevPose.Length)
                    q = Quaternion.Slerp(prevPose[i], q, kSwitch);
                float d = Quaternion.Angle(lastRot[i], q);
                lastRot[i] = q;
                tr.localRotation = q;
                tr.localPosition = gamePos[i];
                if (i == headIdx) headDevDeg = Quaternion.Angle(gameRot[i], q);
                dbgMaxDeg = Mathf.Max(dbgMaxDeg, d);
                if (i == headIdx) headSpeedMax = Mathf.Max(headSpeedMax, d / dt);
            }
            dbgFrames++;
        }

        // 增量按角度轴缩放：w>1 放大手势，w<1 收敛。Slerp 权重被夹在 0..1，
        // 想"点得明显"必须自己在轴上放大，否则只能靠搬姿势。
        private static Quaternion ScaleDelta(Quaternion delta, float w)
        {
            if (Mathf.Abs(w - 1f) < 0.001f) return delta;
            float ang; Vector3 axis;
            delta.ToAngleAxis(out ang, out axis);
            if (ang > 180f) ang -= 360f;
            if (float.IsNaN(axis.x) || (axis.x == 0f && axis.y == 0f && axis.z == 0f)) return Quaternion.identity;
            return Quaternion.AngleAxis(ang * w, axis);
        }

`
src = src.slice(0, stepBegin) + newStep + src.slice(stepEnd)

// ── 2) 计划值 = 增益（可 >1，上限受预算与增益帽共同约束）──────────
const planOld = src.slice(src.indexOf('            float degBudgetBody ='), src.indexOf('            planSpeed = Mathf.Clamp(factor, 0.2f, 1f);') + '            planSpeed = Mathf.Clamp(factor, 0.2f, 1f);'.length)
if (!planOld) throw new Error('找不到计划值计算段')
const planNew = `            float degBudgetBody = Plugin.BodyDegBudget == null ? 26f : Mathf.Max(1f, Plugin.BodyDegBudget.Value);
            float degBudgetHead = Plugin.HeadDegBudget == null ? 15f : Mathf.Max(1f, Plugin.HeadDegBudget.Value);
            float spdBudgetBody = Plugin.BodySpeedBudget == null ? 320f : Mathf.Max(30f, Plugin.BodySpeedBudget.Value);
            float spdBudgetHead = Plugin.HeadSpeedBudget == null ? 160f : Mathf.Max(20f, Plugin.HeadSpeedBudget.Value);
            float slowMax = Plugin.MaxSlowdown == null ? 1.6f : Mathf.Clamp(Plugin.MaxSlowdown.Value, 1f, 6f);
            float gainBodyCap = Plugin.MotionWeight == null ? 1f : Mathf.Clamp(Plugin.MotionWeight.Value, 0.1f, 3f);
            float gainHeadCap = Plugin.HeadWeight == null ? 2.2f : Mathf.Clamp(Plugin.HeadWeight.Value, 0.1f, 4f);
            if (segClips[0] != null && segClips[0].name.StartsWith("anim_wild_", StringComparison.OrdinalIgnoreCase))
            {
                gainBodyCap *= 0.7f;
                gainHeadCap *= 0.7f;
            }
            // 增益：把 clip 自己的运动量按比例映射进预算。小于 1 是收敛，大于 1 是放大手势
            // （放大的是"动多少"，不是"人在哪儿"，所以不会位移）。
            planWBody = bodyDeg > 0.05f ? Mathf.Clamp(degBudgetBody / bodyDeg, 0f, gainBodyCap) : 0f;
            planWHead = headDeg > 0.05f ? Mathf.Clamp(degBudgetHead / headDeg, 0f, gainHeadCap) : 0f;
            float factor = 1f;
            if (bodySpd > spdBudgetBody) factor = Mathf.Min(factor, spdBudgetBody / bodySpd);
            if (headSpd > spdBudgetHead) factor = Mathf.Min(factor, spdBudgetHead / headSpd);
            if (factor < 1f) factor = Mathf.Max(factor, 1f / slowMax);
            planSpeed = Mathf.Clamp(factor, 0.2f, 1f);`
src = src.replace(planOld, planNew)

writeFileSync(file, src, 'utf8')
console.log('  ✓ StepClip 改为叠加式，计划值改为增益')
console.log('  字节 ' + before.length + ' → ' + src.length)
