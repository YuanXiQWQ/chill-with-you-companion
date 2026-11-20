import { readFileSync, writeFileSync } from 'node:fs'
const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

// 归还目标每帧重取：交回"正在跑的待机"，而不是开演前的静止快照。
// 快照是死的：她的待机在走，淡出落到一个静止姿势上，最后还是要跳一下。
const OLD = [
  '            if (exiting && !exitValid)',
  '            {',
  '                if (exitRot == null || exitRot.Length != n) exitRot = new Quaternion[n];',
  '                if (exitFrom == null || exitFrom.Length != n) exitFrom = new Quaternion[n];',
  '                // 先记下"我们的输出"，再让游戏求值。顺序反了就会拿游戏刚写下的值跟自己比，距离恒为 0。',
  '                for (int b = 0; b < n; b++)',
  '                {',
  '                    exitFrom[b] = bones[b] == null ? Quaternion.identity : bones[b].localRotation;',
  '                }',
  '                exitValid = CaptureGamePose(exitRot);'
].join('\n')
if (!s.includes(OLD)) throw new Error('逐帧归还锚点失配')
const NEW = [
  '            if (exiting)',
  '            {',
  '                bool firstExit = !exitValid;',
  '                if (exitRot == null || exitRot.Length != n) exitRot = new Quaternion[n];',
  '                if (exitFrom == null || exitFrom.Length != n) exitFrom = new Quaternion[n];',
  '                if (firstExit)',
  '                {',
  '                    // 首帧：先记下"我们的输出"，再让游戏求值。顺序反了就会拿游戏刚写下的值跟自己比，距离恒为 0。',
  '                    for (int b = 0; b < n; b++)',
  '                    {',
  '                        exitFrom[b] = bones[b] == null ? Quaternion.identity : bones[b].localRotation;',
  '                    }',
  '                }',
  '                // 每一帧都重新问游戏"你此刻把她摆在哪"：她的待机在推进，目标必须跟着走。',
  '                // 固定快照 = 淡出落到一个死姿势上，放手时还是要跳一下。',
  '                exitValid = CaptureGamePose(exitRot);',
  '                if (!firstExit) goto exitReady;'
].join('\n')
s = s.replace(OLD, NEW)

// 首帧才算距离与时长，并补上 exitReady 标签
const OLD2 = [
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
if (!s.includes(OLD2)) throw new Error('距离块锚点失配')
s = s.replace(OLD2, [
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
].join('\n'))

const OLD3 = '                if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("return: "'
if (!s.includes(OLD3)) throw new Error('return 日志锚点失配')
s = s.replace(OLD3, [
  '                exitReady:',
  '                if (firstExit && Plugin.VerboseCues.Value) Plugin.Log.LogInfo("return: "'
].join('\n'))

// 放手前再取一次最新姿势（上面的标签让非首帧跳过计算，这里不受影响）
writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8')
console.log('  I ✓ 归还目标逐帧跟随游戏待机')
