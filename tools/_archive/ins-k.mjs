import { readFileSync, writeFileSync } from 'node:fs'
const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

const A = '            if (exiting && !exitValid)'
const B = '            float kOut = 1f;'
const a = s.indexOf(A)
const b = s.indexOf(B)
if (a < 0 || b < 0 || b < a) throw new Error('归还块定位失败')

const BLOCK = [
  '            if (exiting)',
  '            {',
  '                bool firstExit = !exitValid;',
  '                if (exitRot == null || exitRot.Length != n) exitRot = new Quaternion[n];',
  '                if (exitFrom == null || exitFrom.Length != n) exitFrom = new Quaternion[n];',
  '                if (firstExit)',
  '                {',
  '                    // 首帧先记下"我们的输出"，再让游戏求值；顺序反了就是拿游戏刚写下的值跟自己比，距离恒 0。',
  '                    for (int bb = 0; bb < n; bb++)',
  '                    {',
  '                        exitFrom[bb] = bones[bb] == null ? Quaternion.identity : bones[bb].localRotation;',
  '                    }',
  '                }',
  '                // 每帧重取归还目标：交回"正在跑的那段待机"，而不是开演前的静止快照。',
  '                // 快照是死的——她的待机一直在推进，淡出落到死姿势上，放手时照样跳。',
  '                exitValid = CaptureGamePose(exitRot);',
  '                if (firstExit)',
  '                {',
  '                    float maxDeg = 0f;',
  '                    if (exitValid)',
  '                    {',
  '                        for (int bb = 0; bb < n; bb++)',
  '                        {',
  '                            if (bones[bb] == null) continue;',
  '                            float dd = Quaternion.Angle(exitFrom[bb], exitRot[bb]);',
  '                            if (dd > maxDeg) maxDeg = dd;',
  '                        }',
  '                    }',
  '                    // 距离决定归还时长：坐着点头差 5°，0.3s 够；站起来差 100°，还用 0.3s 就是被扫回去。',
  '                    exitRelSec = Mathf.Clamp(0.30f + maxDeg / 180f, 0.30f, 0.90f);',
  '                    exitEndT = clipLen + exitRelSec;',
  '                    if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("return: " + (exitValid ? "live idle" : "fallback") + " dist=" + maxDeg.ToString("F1") + "deg rel=" + (exitRelSec * 1000f).ToString("F0") + "ms");',
  '                }',
  '            }',
  ''
].join('\n')

s = s.slice(0, a) + BLOCK + s.slice(b)

// 字段：exitFrom 需要声明（上面若已存在则跳过）
if (!s.includes('private Quaternion[] exitFrom;')) {
  s = s.replace('        private Quaternion[] exitRot;',
    '        private Quaternion[] exitRot;\n        private Quaternion[] exitFrom;    // 放手前我们的输出，用来量离待机还有多远')
}

writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8')
console.log('  K ✓ 归还块重写为逐帧跟随')
