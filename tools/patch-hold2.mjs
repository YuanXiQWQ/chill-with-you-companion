// 补丁 2：让"按住"也支持分段形式（X_loop 是真实 clip），并让按住段不被速度缩放。
// 起因：基名 X_deepthink 不是 clip（真正存在的是 X_deepthink_loop/_start/_end），
// PlayAnim 解析不到就整条丢掉——行程中间那一段（沙发上待着）直接没演。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let s = readFileSync(P, 'utf8')
let hits = 0
const sub = (from, to, tag) => {
  const n = s.split(from).length - 1
  if (n !== 1) throw new Error('锚点 ' + tag + ' 命中 ' + n + ' 次（应为 1）')
  s = s.replace(from, to)
  hits++
}

// ① 分段形式也认按住：X_loop + holdMs → 这一段原地循环 holdMs
sub(
  `            if (isSegment && self != null)
            {
                names.Add(clipName);
                clips.Add(self);
            }`.replace(/\n/g, '\r\n'),
  `            if (isSegment && self != null)
            {
                names.Add(clipName);
                clips.Add(self);
                // 分段形式（X_loop）被按住：这一段就是它自己，循环 holdMs
                if (holdMs > 0 && clipName.EndsWith("_loop", StringComparison.OrdinalIgnoreCase))
                {
                    holdClipIndex = clips.Count - 1;
                    holdSpanSec = Mathf.Max(0.5f, holdMs / 1000f);
                }
            }`.replace(/\n/g, '\r\n'),
  'segment hold',
)

// ② 按住段不被速度缩放：它要的是"待够这么久"，不是"演快一点"
sub(
  '            float natural = segTotal / clipSpeed;',
  '            // 按住段按真实时长待着：速度缩放只该作用于"演"，不该作用于"等"\r\n            float natural = segHoldTotal > 0f ? segTotal : segTotal / clipSpeed;',
  'hold no speed scale',
)

writeFileSync(P, s, 'utf8')
console.log('  补丁 ' + hits + ' 处')
