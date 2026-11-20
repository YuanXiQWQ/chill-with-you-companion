import { readFileSync, writeFileSync } from 'node:fs'
const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

const START = '            bool exiting = !clipLoop && ct > clipLen;'
const a = s.indexOf(START)
if (a < 0) throw new Error('exiting 起点未找到')
const END_MARK = '" rel=" + (exitRelSec * 1000f).ToString("F0") + "ms");'
const b = s.indexOf(END_MARK, a)
if (b < 0) throw new Error('归还日志未找到')
const closeIdx = s.indexOf('\n            }', b)
if (closeIdx < 0) throw new Error('归还块收尾未找到')

const BLOCK = [
  '            bool exiting = !clipLoop && ct > clipLen;',
  '            if (exiting)',
  '            {',
  '                bool firstExit = !exitValid;',
  '                if (exitRot == null || exitRot.Length != n) exitRot = new Quaternion[n];',
  '                if (exitFrom == null || exitFrom.Length != n) exitFrom = new Quaternion[n];',
  '                if (firstExit)',
  '                {',
  '                    // 首帧先记下"我们的输出"，再让游戏求值。顺序反了就是拿游戏刚写下的值跟自己比，距离恒 0。',
  '                    for (int bb = 0; bb < n; bb++)',
  '                    {',
  '                        exitFrom[bb] = bones[bb] == null ? Quaternion.identity : bones[bb].localRotation;',
  '                    }',
  '                }',
  '                // 每帧重取归还目标：交回"正在跑的那段待机"，而不是开演前的静止快照。',
  '                // 快照是死的——她的待机在推进，淡出落到死姿势上，放手时照样跳。',
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
  '                    // 离得远就多给点时间：坐着点头差 5°，0.3s 够；站起来差 100°，还得 0.3s 就是被扫回去。',
  '                    exitRelSec = Mathf.Clamp(0.30f + maxDeg / 180f, 0.30f, 0.90f);',
  '                    exitEndT = clipLen + exitRelSec;',
  '                    if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("return: " + (exitValid ? "live idle" : "fallback") + " dist=" + maxDeg.ToString("F1") + "deg rel=" + (exitRelSec * 1000f).ToString("F0") + "ms");',
  '                }',
  '            }'
].join('\n')

s = s.slice(0, a) + BLOCK + s.slice(closeIdx + '\n            }'.length)
writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8')
console.log('  J ✓ 归还目标逐帧跟随（重写整块）')
