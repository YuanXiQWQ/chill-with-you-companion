import { readFileSync, writeFileSync } from 'node:fs'
const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

// 收尾时机：留出归还窗口，别在 clipLen 一刀切（那正是"硬切回去"的根源）
const OLD = [
  '                if (ct > clipLen)',
  '                {',
  '                    if (clipLoop) ct = clipLen > 0.01f ? ct % clipLen : 0f;',
  '                    else',
  '                    {',
  '                        clipActive = false; ReleaseBaseGameCache();',
  '                        lastFamilyEnd = Time.time;'
].join('\n')
if (!s.includes(OLD)) throw new Error('收尾锚点失配')

const NEW = [
  '                float relForEnd = (Plugin.ReleaseMs == null ? 300f : Mathf.Max(30f, Plugin.ReleaseMs.Value)) / 1000f;',
  '                // 多留一个归还窗口：这段时间里 StepClip 把姿势淡回游戏状态，之后才真正放手',
  '                if (ct > clipLen + (clipLoop ? 0f : relForEnd))',
  '                {',
  '                    if (clipLoop) ct = clipLen > 0.01f ? ct % clipLen : 0f;',
  '                    else',
  '                    {',
  '                        clipActive = false; ReleaseBaseGameCache(); exitValid = false;',
  '                        lastFamilyEnd = Time.time;'
].join('\n')
s = s.replace(OLD, NEW)

// 新一段开演：清归还状态
if (!s.includes('exitValid = false;\n            dbgPushHead')) {
  s = s.replace('            dbgPushHead = 0f; dbgPushBody = 0f;', '            exitValid = false;\n            dbgPushHead = 0f; dbgPushBody = 0f;')
}

writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8')
console.log('  D ✓ 收尾留出归还窗口')
