// 补丁 4：道具跟着动 —— 她起身时椅子也要跟着动。
// 现象：`anim_wild_leavechair_sofa_go` 在角色身上演了，但 `m_Chair_mobile`
// 那个 ChairAnimationCtr 里的同名 clip 没人放，于是"人走了、椅子原地不动"。
// 做法：同一个 clip 名在几个 animator 上都有时（角色 + 椅子/书本/杯子…），
// 每帧按同一进度把每个 owner 的对应 clip 都采样一遍。
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

// ① 记录"同一 clip 名出现在哪些 animator 上"
sub(
  `                    Animator owner;
                    if (clipOwners.TryGetValue(c.name, out owner))
                    {
                        if (owner != null && !owner.gameObject.activeInHierarchy && usable) clipOwners[c.name] = a;
                        continue;
                    }
                    clipOwners[c.name] = a;
                    clipNames.Add(c.name);`.replace(/\n/g, '\r\n'),
  `                    List<Animator> holders;
                    if (clipExtraOwners.TryGetValue(c.name, out holders)) { if (!holders.Contains(a) && usable) holders.Add(a); }
                    else clipExtraOwners[c.name] = new List<Animator> { a };
                    Animator owner;
                    if (clipOwners.TryGetValue(c.name, out owner))
                    {
                        if (owner != null && !owner.gameObject.activeInHierarchy && usable) clipOwners[c.name] = a;
                        continue;
                    }
                    clipOwners[c.name] = a;
                    clipNames.Add(c.name);`.replace(/\n/g, '\r\n'),
  'clipExtraOwners build',
)

// ② 字段
sub(
  `        private AnimationClip[] segClips;`.replace(/\n/g, '\r\n'),
  `        // 同一 clip 名可能同时存在于角色和道具（m_Chair_mobile 的 ChairAnimationCtr 就有 136 条同名），
        // 只演角色 = 人走了椅子不动。这里记下所有 owner，演出时按同一进度逐个采样。
        private readonly Dictionary<string, List<Animator>> clipExtraOwners = new Dictionary<string, List<Animator>>();
        private readonly List<GameObject> propTargets = new List<GameObject>();
        private readonly List<AnimationClip> propClips = new List<AnimationClip>();
        // 道具没有"身体预算"那套，进度按归一化走：角色走到几成，道具也走到几成。
        private float propProgress;

        private AnimationClip[] segClips;`.replace(/\n/g, '\r\n'),
  'prop fields',
)

// ③ StartClip 里收集这一条的 props（在 BuildSequence 之前，名字已归一）
sub(
  '            BuildSequence(clipName, holdMs);',
  `            // 这一条有哪些道具要一起动
            propTargets.Clear();
            propClips.Clear();
            {
                List<Animator> holders;
                if (clipExtraOwners.TryGetValue(clipName, out holders))
                {
                    for (int hi = 0; hi < holders.Count; hi++)
                    {
                        var an = holders[hi];
                        if (an == null || an.gameObject == owner.gameObject) continue;
                        if (!an.gameObject.activeInHierarchy) continue;
                        var ctrl = an.runtimeAnimatorController;
                        if (ctrl == null) continue;
                        var cl = ctrl.animationClips;
                        if (cl == null) continue;
                        for (int ci = 0; ci < cl.Length; ci++)
                        {
                            if (cl[ci] != null && string.Equals(cl[ci].name, clipName, StringComparison.Ordinal))
                            {
                                propTargets.Add(an.gameObject);
                                propClips.Add(cl[ci]);
                                break;
                            }
                        }
                    }
                }
                if (propTargets.Count > 0 && Plugin.VerboseCues.Value)
                    Plugin.Log.LogInfo("props follow: " + clipName + " → " + propTargets.Count + " 个道具");
            }
            BuildSequence(clipName, holdMs);`,
  'collect props',
)

// ④ 每帧：按归一化进度把道具也推到位（归还阶段停手，交给游戏自己的 animator）
{
  // 这一处的换行是混的（前几次补丁留下了 LF 行），用正则匹配
  const re = /( *bool exiting0 = !clipLoop && ct > clipLen;\r?\n *if \(!exiting0\) SampleChainClip\(segClips\[idx\], clipTarget, ts - segStarts\[idx\], 0\);)/
  if (!re.test(s)) throw new Error('锚点 sample props per frame 未命中')
  s = s.replace(re, (m) => m.replace(/\r?\n/g, '\r\n') + [
    '',
    '            if (!exiting0 && propClips.Count > 0)',
    '            {',
    '                propProgress = segTotal > 0.01f ? Mathf.Clamp01(ts / segTotal) : 0f;',
    '                for (int pi = 0; pi < propClips.Count; pi++)',
    '                {',
    '                    var pc = propClips[pi];',
    '                    if (pc == null) continue;',
    '                    float pl = Mathf.Repeat(propProgress * pc.length, Mathf.Max(0.05f, pc.length - 0.001f));',
    '                    pc.SampleAnimation(propTargets[pi], pl);',
    '                }',
    '            }',
  ].join('\r\n'))
  hits++
}

// 收尾：把混进来的 LF 行统一成 CRLF（C# 编译无所谓，但下次按行匹配别再来一遍）
s = s.replace(/\r?\n/g, '\r\n')
writeFileSync(P, s, 'utf8')
console.log('  补丁 ' + hits + ' 处')
