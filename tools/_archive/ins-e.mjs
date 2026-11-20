import { readFileSync, writeFileSync } from 'node:fs'
const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

// ① 字段：归还时长按距离算，并记住归还终点时刻
if (!s.includes('private float exitRelSec')) {
  const F = [
    '        private Quaternion[] exitRot;',
    '        private float exitRelSec = 0.30f;   // 归还时长：按离游戏姿势的距离算，不是固定 300ms',
    '        private float exitEndT;             // clipLen + exitRelSec'
  ].join('\n')
  if (!s.includes('        private Quaternion[] exitRot;')) throw new Error('字段锚点失配')
  s = s.replace('        private Quaternion[] exitRot;', F)
}

// ② 归还时长与距离挂钩
const OLD_CAP = [
  '                if (exitRot == null || exitRot.Length != n) exitRot = new Quaternion[n];',
  '                exitValid = CaptureGamePose(exitRot);',
  '                if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("return: " + (exitValid ? "game pose captured" : "fallback to cached base") + " rel=" + relMs.ToString("F0") + "ms");'
].join('\n')
if (!s.includes(OLD_CAP)) throw new Error('归还捕获锚点失配')
const NEW_CAP = [
  '                if (exitRot == null || exitRot.Length != n) exitRot = new Quaternion[n];',
  '                exitValid = CaptureGamePose(exitRot);',
  '                // 归还时长按她现在离游戏姿势有多远决定：坐着点头差 5°，0.3s 够；',
  '                // 站起来了差 100°+，还用 0.3s 收回来就是被扫回去。上限 0.9s，与姿态类过渡同量级。',
  '                float maxDeg = 0f;',
  '                if (exitValid)',
  '                {',
  '                    for (int b = 0; b < n; b++)',
  '                    {',
  '                        if (bones[b] == null) continue;',
  '                        float d = Quaternion.Angle(bones[b].localRotation, exitRot[b]);',
  '                        if (d > maxDeg) maxDeg = d;',
  '                    }',
  '                }',
  '                exitRelSec = Mathf.Clamp(0.30f + maxDeg / 180f, 0.30f, 0.90f);',
  '                exitEndT = clipLen + exitRelSec;',
  '                if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("return: " + (exitValid ? "game pose captured" : "fallback to cached base") + " dist=" + maxDeg.ToString("F1") + "deg rel=" + (exitRelSec * 1000f).ToString("F0") + "ms");'
].join('\n')
s = s.replace(OLD_CAP, NEW_CAP)

// ③ kOut 用按距离算出来的时长
const OLD_K = '                float kk = relSec <= 0.001f ? 1f : Mathf.Clamp01((ct - clipLen) / relSec);'
if (!s.includes(OLD_K)) throw new Error('kOut 锚点失配')
s = s.replace(OLD_K, '                float kk = exitRelSec <= 0.001f ? 1f : Mathf.Clamp01((ct - clipLen) / exitRelSec);')

// ④ 收尾时机跟随 exitEndT
const OLD_END = '                if (ct > clipLen + (clipLoop ? 0f : relForEnd))'
if (!s.includes(OLD_END)) throw new Error('收尾锚点失配')
s = s.replace(OLD_END, '                float endAt = exitValid ? exitEndT : clipLen + relForEnd;\n                if (ct > (clipLoop ? clipLen : endAt))')

// ⑤ 交接质量指标
const OLD_LOG = '                        clipActive = false; ReleaseBaseGameCache(); exitValid = false;'
if (!s.includes(OLD_LOG)) throw new Error('放手锚点失配')
const HANDOFF = [
  '                        // 交接差 = 放手瞬间我们的输出与游戏姿势的最大角差。',
  '                        // 这是回归过渡有没有做好的硬指标：接近 0 就是无缝交回。',
  '                        float handoff = -1f;',
  '                        if (exitValid && exitRot != null && bones != null)',
  '                        {',
  '                            handoff = 0f;',
  '                            for (int b = 0; b < bones.Length && b < exitRot.Length; b++)',
  '                            {',
  '                                if (bones[b] == null) continue;',
  '                                float d = Quaternion.Angle(bones[b].localRotation, exitRot[b]);',
  '                                if (d > handoff) handoff = d;',
  '                            }',
  '                        }',
  '                        if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("handoff dev=" + handoff.ToString("F2") + "deg rel=" + (exitRelSec * 1000f).ToString("F0") + "ms");',
  '                        clipActive = false; ReleaseBaseGameCache(); exitValid = false;'
].join('\n')
s = s.replace(OLD_LOG, HANDOFF)

writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8')
console.log('  E ✓ 归还时长按距离 + 交接差指标')
