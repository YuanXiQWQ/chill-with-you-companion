import { readFileSync, writeFileSync } from 'node:fs'
const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

// ① 多一个缓冲区：记"我们放手前的输出"，用来量真实距离
if (!s.includes('private Quaternion[] exitFrom;')) {
  const F = [
    '        private Quaternion[] exitRot;',
    '        private Quaternion[] exitFrom;    // 放手前我们的输出，用来量"离游戏姿势还有多远"',
    '        private float exitRelSec = 0.30f;   // 归还时长：按离游戏姿势的距离算，不是固定 300ms',
    '        private float exitEndT;             // clipLen + exitRelSec'
  ].join('\n')
  const OLD = [
    '        private Quaternion[] exitRot;',
    '        private float exitRelSec = 0.30f;   // 归还时长：按离游戏姿势的距离算，不是固定 300ms',
    '        private float exitEndT;             // clipLen + exitRelSec'
  ].join('\n')
  if (!s.includes(OLD)) throw new Error('字段锚点失配')
  s = s.replace(OLD, F)
}

// ② 距离必须先存我们的姿势，再让游戏求值——否则量到的是自己刚写下的值（恒 0）
const OLD_CAP = [
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
  '                }'
].join('\n')
if (!s.includes(OLD_CAP)) throw new Error('归还捕获锚点失配')
const NEW_CAP = [
  '                if (exitRot == null || exitRot.Length != n) exitRot = new Quaternion[n];',
  '                if (exitFrom == null || exitFrom.Length != n) exitFrom = new Quaternion[n];',
  '                // 先记下"我们的输出"，再让游戏求值。顺序反了就会拿游戏刚写下的值跟自己比，距离恒为 0。',
  '                for (int b = 0; b < n; b++)',
  '                {',
  '                    exitFrom[b] = bones[b] == null ? Quaternion.identity : bones[b].localRotation;',
  '                }',
  '                exitValid = CaptureGamePose(exitRot);',
  '                // 归还时长按她现在离游戏姿势有多远决定：坐着点头差 5°，0.3s 够；',
  '                // 站起来了差 100°+，还用 0.3s 收回来就是被扫回去。上限 0.9s，与姿态类过渡同量级。',
  '                float maxDeg = 0f;',
  '                if (exitValid)',
  '                {',
  '                    for (int b = 0; b < n; b++)',
  '                    {',
  '                        if (bones[b] == null) continue;',
  '                        float d = Quaternion.Angle(exitFrom[b], exitRot[b]);',
  '                        if (d > maxDeg) maxDeg = d;',
  '                    }',
  '                }'
].join('\n')
s = s.replace(OLD_CAP, NEW_CAP)

// ③ 放开之前，把姿势精确落回游戏姿势：最后一步不许跳
const OLD_LOG = '                        if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("handoff dev="'
if (!s.includes(OLD_LOG)) throw new Error('交接日志锚点失配')
s = s.replace(OLD_LOG, [
  '                        // 最后一步精确落回游戏姿势。归还斜坡保证看得见的连续，这一次写入保证交接点为零差：',
  '                        // 斜坡在最后一帧总还剩几度，不补这一下，放手瞬间就是一个可见的跳。',
  '                        if (exitValid && exitRot != null)',
  '                        {',
  '                            for (int b = 0; b < bones.Length && b < exitRot.Length; b++)',
  '                            {',
  '                                if (bones[b] != null) bones[b].localRotation = exitRot[b];',
  '                            }',
  '                        }',
  '                        if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("handoff dev="'
].join('\n'))

writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8')
console.log('  F ✓ 距离改量真值 + 放手前精确归位')
