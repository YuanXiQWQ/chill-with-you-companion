import { readFileSync, writeFileSync } from 'node:fs'
const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

// ── 归还判定：放在采样之后、合成之前 ──
const A1 = '            headDevDeg = 0f;'
const A2 = '            float wBody = planWBody * EnvelopeAt(ct, false);'
if (!s.includes(A1 + '\n' + A2)) throw new Error('归还判定锚点失配')

const EXIT = [
  '            // 归还阶段：我们是插入，演完必须把身体还回去。',
  '            // 目标要现场问游戏"你现在会把她摆成什么样"；用开演前的旧姿势 = 交回去一个过期姿势。',
  '            float relMs = Plugin.ReleaseMs == null ? 300f : Mathf.Max(30f, Plugin.ReleaseMs.Value);',
  '            float relSec = relMs / 1000f;',
  '            bool exiting = !clipLoop && ct > clipLen;',
  '            if (exiting && !exitValid)',
  '            {',
  '                if (exitRot == null || exitRot.Length != n) exitRot = new Quaternion[n];',
  '                exitValid = CaptureGamePose(exitRot);',
  '                if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("return: " + (exitValid ? "game pose captured" : "fallback to cached base") + " rel=" + relMs.ToString("F0") + "ms");',
  '            }',
  '            float kOut = 1f;',
  '            if (exiting)',
  '            {',
  '                float kk = relSec <= 0.001f ? 1f : Mathf.Clamp01((ct - clipLen) / relSec);',
  '                kOut = Mathf.SmoothStep(0f, 1f, 1f - kk);',
  '            }'
].join('\n')
s = s.replace(A1 + '\n' + A2, EXIT + '\n' + A1 + '\n' + A2)

// ── 合成：基底随阶段切换，末尾叠加归还混合 ──
const OLD_TAIL = [
  '                if (kSwitch < 1f && prevPoseValid && prevPose != null && i < prevPose.Length)',
  '                    q = Quaternion.Slerp(prevPose[i], q, kSwitch);'
].join('\n')
if (!s.includes(OLD_TAIL)) throw new Error('合成尾部锚点失配')
const NEW_TAIL = [
  '                // 起手：从"插入那一刻的姿势"过渡进来',
  '                if (kSwitch < 1f && prevPoseValid && prevPose != null && i < prevPose.Length)',
  '                    q = Quaternion.Slerp(prevPose[i], q, kSwitch);',
  '                // 归还：交回游戏此刻的姿势，而不是硬切',
  '                if (exiting && exitValid && i < exitRot.Length)',
  '                    q = Quaternion.Slerp(exitRot[i], q, kOut);'
].join('\n')
s = s.replace(OLD_TAIL, NEW_TAIL)

// 基底：归还阶段用现场读到的姿势
const OLD_ADD = '                    q = gameRot[i] * ScaleDelta(delta, isHead ? wHead : wBody);'
if (!s.includes(OLD_ADD)) throw new Error('叠加基底锚点失配')
s = s.replace(OLD_ADD, '                    Quaternion baseNow = (exiting && exitValid && i < exitRot.Length) ? exitRot[i] : gameRot[i];\n                    q = baseNow * ScaleDelta(delta, isHead ? wHead : wBody);')

const OLD_ABS = '                    q = Quaternion.Slerp(gameRot[i], tr.localRotation, Mathf.Clamp01((isHead ? wHead : wBody) * rampW));'
if (!s.includes(OLD_ABS)) throw new Error('绝对基底锚点失配')
s = s.replace(OLD_ABS, '                    Quaternion baseNow = (exiting && exitValid && i < exitRot.Length) ? exitRot[i] : gameRot[i];\n                    q = Quaternion.Slerp(baseNow, tr.localRotation, Mathf.Clamp01((isHead ? wHead : wBody) * rampW));')

writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8')
console.log('  C ✓ 归还判定与合成分支')
