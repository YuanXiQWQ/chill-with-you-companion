import { readFileSync, writeFileSync } from 'node:fs'

const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

const START = '            if (exiting)\n'
const END_MARK = 'exitRelSec = Mathf.Clamp(0.30f + maxDeg / 180f, 0.30f, 0.90f);'
const a = s.indexOf(START)
const b = s.indexOf(END_MARK)
if (a < 0 || b < 0) throw new Error('归还段锚点失配 a=' + a + ' b=' + b)
const lineEnd = s.indexOf('\n', b) + 1

const NEW = [
  '            if (exiting)',
  '            {',
  '                bool firstExit = !exitValid;',
  '                if (exitRot == null || exitRot.Length != n) exitRot = new Quaternion[n];',
  '                if (exitFrom == null || exitFrom.Length != n) exitFrom = new Quaternion[n];',
  '                if (firstExit)',
  '                {',
  '                    // 首帧先记下"我们的输出"，再让游戏求值；顺序反了就是拿游戏刚写下的值跟自己比，距离恒 0。',
  '                    // 这段必须只在首帧跑：每帧都覆盖 exitFrom，斜坡就等于失效，最后一帧会硬跳回待机。',
  '                    for (int bb = 0; bb < n; bb++)',
  '                        exitFrom[bb] = bones[bb] == null ? Quaternion.identity : bones[bb].localRotation;',
  '                }',
  '                // 每帧重取归还目标：交回"正在跑的那段待机"，而不是开演前的静止快照。',
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
  '                    // 后面还排着动作：不用等满归还窗口，但也不许为了"快"切一刀 ——',
  '                    // 上限 0.25s 是按"这段距离最多走 0.25s"算的，下一段自己的进入过渡会接着把它走完。',
  '                    if (HasAnimPending() && exitRelSec > 0.25f) exitRelSec = 0.25f;',
  '                    dbgExitDeg = maxDeg;',
  '                    dbgExitSec = exitRelSec;',
  '                    if (Plugin.VerboseCues != null && Plugin.VerboseCues.Value)',
  '                        Plugin.Log.LogInfo("exit: deg=" + maxDeg.ToString("F1") + " over=" + (exitRelSec * 1000f).ToString("F0") + "ms => " + (maxDeg / Mathf.Max(0.01f, exitRelSec)).ToString("F0") + "dps" + (HasAnimPending() ? " chained" : ""));',
  '                }'
].join('\n') + '\n'

s = s.slice(0, a) + NEW + s.slice(lineEnd)
writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8')

// 回读确认结构
const back = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const i = back.indexOf(START)
console.log(back.slice(i, i + 1750))
