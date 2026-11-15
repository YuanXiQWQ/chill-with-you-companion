// 补丁 5b：把"按住期间道具冻结"放到每帧采样里做，不动 StartClip 的缩进。
// 规则：这一条有同名道具 clip → 按进度推；没有 → 沿用上一条道具的最后姿势。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let s = readFileSync(P, 'utf8')
let hits = 0

// ① 字段
if (!s.includes('private float propProgress;')) throw new Error('propProgress 字段不见了')
if (!s.includes('lastPropClips')) {
  s = s.replace(
    '        private float propProgress;',
    '        private float propProgress;\r\n' +
      '        // 这一条没有同名道具 clip 时沿用上一条的最后姿势（否则椅子会弹回原位）\r\n' +
      '        private readonly List<GameObject> lastPropTargets = new List<GameObject>();\r\n' +
      '        private readonly List<AnimationClip> lastPropClips = new List<AnimationClip>();',
  )
  hits++
}

// ② 每帧块：换成带"冻结"的版本
const re = /\n *if \(!exiting0 && propClips\.Count > 0\)\r?\n *\{\r?\n *propProgress = [\s\S]*?\r?\n *\}\r?\n/
if (!re.test(s)) throw new Error('每帧道具块未命中')
const block = [
  '',
  '            if (!exiting0 && (propClips.Count > 0 || lastPropClips.Count > 0))',
  '            {',
  '                if (propClips.Count > 0)',
  '                {',
  '                    propProgress = segTotal > 0.01f ? Mathf.Clamp01(ts / segTotal) : 0f;',
  '                    lastPropTargets.Clear(); lastPropClips.Clear();',
  '                    lastPropTargets.AddRange(propTargets); lastPropClips.AddRange(propClips);',
  '                    for (int pi = 0; pi < propClips.Count; pi++)',
  '                    {',
  '                        var pc = propClips[pi];',
  '                        if (pc == null) continue;',
  '                        float pl = Mathf.Repeat(propProgress * pc.length, Mathf.Max(0.05f, pc.length - 0.001f));',
  '                        pc.SampleAnimation(propTargets[pi], pl);',
  '                    }',
  '                }',
  '                else',
  '                {',
  '                    // 这一条没有道具版本（沙发上"待着"）：冻在上一条的最后一帧，别让椅子自己弹回去',
  '                    for (int pi = 0; pi < lastPropClips.Count; pi++)',
  '                    {',
  '                        var pc = lastPropClips[pi];',
  '                        if (pc == null) continue;',
  '                        pc.SampleAnimation(lastPropTargets[pi], Mathf.Max(0f, pc.length - 0.001f));',
  '                    }',
  '                }',
  '            }',
  '',
].join('\r\n')
s = s.replace(re, block)
hits++

writeFileSync(P, s.replace(/\r?\n/g, '\r\n'), 'utf8')
console.log('  补丁 ' + hits + ' 处')
