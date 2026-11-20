// 给 ChillPerformer.dll 加"按住"能力：一段循环能按住几分钟，按完再接下一段。
// 目的：离座长途（去沙发躺 3~5 分钟）需要她在沙发上真的待着，而不是 20 秒就回来。
// 改动全部是可选的：不带 holdMs 的 cue 行为与以前完全一致。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let s = readFileSync(P, 'utf8')
const before = s
let hits = 0

const sub = (from, to, tag) => {
  const n = s.split(from).length - 1
  if (n !== 1) throw new Error('锚点 ' + tag + ' 命中 ' + n + ' 次（应为 1）')
  s = s.replace(from, to)
  hits++
}

// ① CueDto / ActDto / PendingAct 加字段
sub(
  '        public int durationMs;\r\n        public string text;\r\n    }',
  '        public int durationMs;\r\n        // holdMs：把这一族的循环段按住这么久（毫秒）。0 = 按自然长度演完。\r\n        // 离座长途用它把"在沙发上待着"变成长时间接管的一个 cue，而不是几分钟的重复 cue。\r\n        public int holdMs;\r\n        public string text;\r\n    }',
  'CueDto.holdMs',
)
sub(
  '        // 这一句的语音时长（毫秒）。<=0 表示没拿到，回退到按字数估。\r\n        public double durationMs;\r\n    }',
  '        // 这一句的语音时长（毫秒）。<=0 表示没拿到，回退到按字数估。\r\n        public double durationMs;\r\n        // 这一条在队列里最多能等多久（毫秒）。0 = 用全局 queue.TtlMs。\r\n        // 离座长途要预排"回来"那一条，它得在沙发上等三五分钟，全局 45s 会把它当过期丢掉。\r\n        public int ttlMs;\r\n    }',
  'ActDto.ttlMs',
)
sub(
  '            public ActDto dto;\r\n            public int seq;\r\n            public float at;      // 入队时刻（unscaled）\r\n            public string src;',
  '            public ActDto dto;\r\n            public int seq;\r\n            public float at;      // 入队时刻（unscaled）\r\n            public string src;\r\n            public int ttlMs;     // 0 = 用全局 queue.TtlMs',
  'PendingAct.ttlMs',
)

// ② 队列按条目 TTL 过期
sub(
  `            int ttl = Plugin.QueueTtlMs == null ? 20000 : Mathf.Max(0, Plugin.QueueTtlMs.Value);
            if (ttl <= 0) return;
            float now = Time.unscaledTime;
            for (int i = pending.Count - 1; i >= 0; i--)
            {
                float age = now - pending[i].at;
                if (age > ttl / 1000f)
                {`.replace(/\n/g, '\r\n'),
  `            // 条目级 TTL：离座长途预排的"回来"那一条要在队里等三五分钟，
            // 全局 45s 会把正常的等待当成过期。0 仍走全局。
            int globalTtl = Plugin.QueueTtlMs == null ? 20000 : Mathf.Max(0, Plugin.QueueTtlMs.Value);
            float now = Time.unscaledTime;
            for (int i = pending.Count - 1; i >= 0; i--)
            {
                int ttl = pending[i].ttlMs > 0 ? pending[i].ttlMs : globalTtl;
                if (ttl <= 0) continue;
                float age = now - pending[i].at;
                if (age > ttl / 1000f)
                {`.replace(/\n/g, '\r\n'),
  'PruneExpired per-item ttl',
)

// ③ 入队时带上 ttlMs（两条入队路径：回滚路径 + 正常路径）
{
  const from = 'pending.Add(new PendingAct { dto = dto, seq = seq, at = Time.unscaledTime, src = src });'
  const to = 'pending.Add(new PendingAct { dto = dto, seq = seq, at = Time.unscaledTime, src = src, ttlMs = dto == null ? 0 : dto.ttlMs });'
  const n = s.split(from).length - 1
  if (n !== 2) throw new Error('入队锚点命中 ' + n + ' 次（应为 2）')
  s = s.split(from).join(to)
  hits += 2
}

// ④ cue 里读 holdMs（两条路径：performance 数组 / ids 数组）
sub(
  '                    cue.durationMs = JsonLite.Int(JsonLite.Get(d, "durationMs"));\r\n                    cues.Add(cue);',
  '                    cue.durationMs = JsonLite.Int(JsonLite.Get(d, "durationMs"));\r\n                    cue.holdMs = JsonLite.Int(JsonLite.Get(d, "holdMs"));\r\n                    cues.Add(cue);',
  'cue parse performance',
)
sub(
  '                        cue.durationMs = (durs != null && k < durs.Count) ? JsonLite.Int(durs[k]) : 0;\r\n                        cues.Add(cue);',
  '                        cue.durationMs = (durs != null && k < durs.Count) ? JsonLite.Int(durs[k]) : 0;\r\n                        var holds = JsonLite.AsList(JsonLite.Get(root, "holds"));\r\n                        cue.holdMs = (holds != null && k < holds.Count) ? JsonLite.Int(holds[k]) : 0;\r\n                        cues.Add(cue);',
  'cue parse ids',
)

// ⑤ 播放：把 holdMs 传下去
sub(
  'if (cue.slot == "animations") PlayAnim(cue.id, cue.durationMs);',
  'if (cue.slot == "animations") PlayAnim(cue.id, cue.durationMs, cue.holdMs);',
  'Perform -> PlayAnim',
)
sub(
  'private void PlayAnim(string idOrName, int durationMs)',
  'private void PlayAnim(string idOrName, int durationMs, int holdMs = 0)',
  'PlayAnim sig',
)
sub(
  '            StartClip(playName, false, durationMs);',
  '            StartClip(playName, false, durationMs, holdMs);',
  'PlayAnim -> StartClip',
)

// ⑥ 段表：记录"这一段被按住多久"，并让采样对按住段取模循环
sub(
  `        private AnimationClip[] segClips;
        private float[] segStarts;
        private float segTotal;`.replace(/\n/g, '\r\n'),
  `        private AnimationClip[] segClips;
        private float[] segStarts;
        private float segTotal;
        // segHold[i] > 0 表示这一段被按住这么久（秒），采样时对它取模 → 原地循环。
        // 只有 holdMs 的 cue 才会出现，普通 cue 全是 0，行为不变。
        private float[] segHold;
        private float segHoldTotal;`.replace(/\n/g, '\r\n'),
  'segHold field',
)
sub(
  'private void BuildSequence(string clipName)',
  'private void BuildSequence(string clipName, int holdMs = 0)',
  'BuildSequence sig',
)
sub(
  `                if (loop != null)
                {
                    int reps = Mathf.Clamp(Mathf.RoundToInt(1.4f / Mathf.Max(0.2f, loop.length)), 1, 5);
                    for (int i = 0; i < reps; i++) { names.Add(baseName + "_loop"); clips.Add(loop); }
                }`.replace(/\n/g, '\r\n'),
  `                if (loop != null)
                {
                    if (holdMs > 0)
                    {
                        // 按住：循环段只放一条，时长由 segHold 撑开（采样时取模）
                        names.Add(baseName + "_loop");
                        clips.Add(loop);
                        holdClipIndex = clips.Count - 1;
                        holdSpanSec = Mathf.Max(0.5f, holdMs / 1000f);
                    }
                    else
                    {
                        int reps = Mathf.Clamp(Mathf.RoundToInt(1.4f / Mathf.Max(0.2f, loop.length)), 1, 5);
                        for (int i = 0; i < reps; i++) { names.Add(baseName + "_loop"); clips.Add(loop); }
                    }
                }`.replace(/\n/g, '\r\n'),
  'BuildSequence hold branch',
)
sub(
  '            var names = new List<string>();\r\n            var clips = new List<AnimationClip>();',
  '            var names = new List<string>();\r\n            var clips = new List<AnimationClip>();\r\n            int holdClipIndex = -1;\r\n            float holdSpanSec = 0f;',
  'BuildSequence locals',
)
sub(
  `            if (clips.Count == 0) { segClips = new AnimationClip[0]; segStarts = new float[1]; segTotal = 0f; return; }
            segClips = clips.ToArray();
            segStarts = new float[segClips.Length + 1];
            segTotal = 0f;
            for (int i = 0; i < segClips.Length; i++)
            {
                segStarts[i] = segTotal;
                segTotal += Mathf.Max(0.05f, segClips[i].length);
            }`.replace(/\n/g, '\r\n'),
  `            if (clips.Count == 0) { segClips = new AnimationClip[0]; segStarts = new float[1]; segHold = new float[0]; segTotal = 0f; segHoldTotal = 0f; return; }
            segClips = clips.ToArray();
            segStarts = new float[segClips.Length + 1];
            segHold = new float[segClips.Length];
            segTotal = 0f;
            segHoldTotal = 0f;
            for (int i = 0; i < segClips.Length; i++)
            {
                float natural = Mathf.Max(0.05f, segClips[i].length);
                float span = natural;
                if (holdClipIndex == i && holdSpanSec > 0f)
                {
                    segHold[i] = holdSpanSec;
                    segHoldTotal = holdSpanSec;
                    span = holdSpanSec;
                }
                segStarts[i] = segTotal;
                segTotal += span;
            }`.replace(/\n/g, '\r\n'),
  'BuildSequence timeline',
)

// ⑦ 两处采样：按住段取模
sub(
  '            while (idx < segClips.Length - 1 && tt >= segStarts[idx + 1]) idx++;\r\n                SampleChainClip(segClips[idx], clipTarget, tt - segStarts[idx], 0);',
  '            while (idx < segClips.Length - 1 && tt >= segStarts[idx + 1]) idx++;\r\n                float lt = tt - segStarts[idx];\r\n                if (segHold != null && idx < segHold.Length && segHold[idx] > 0f) lt = Mathf.Repeat(lt, Mathf.Max(0.05f, segClips[idx].length));\r\n                SampleChainClip(segClips[idx], clipTarget, lt, 0);',
  'sample (measure)',
)

// ⑧ clipLen 不被 MaxClipSec 截断（按住段本来就是长的）
sub(
  '            clipLen = Mathf.Clamp(Mathf.Min(clipLen, maxClipSec), 0.2f, 30f);',
  '            // 按住段例外：它天生就比 MaxClipSec 长，按秒截断会让"沙发上待着"变成 8 秒\r\n            clipLen = segHoldTotal > 0f ? Mathf.Clamp(Mathf.Min(clipLen, segTotal), 0.2f, 900f) : Mathf.Clamp(Mathf.Min(clipLen, maxClipSec), 0.2f, 30f);',
  'clipLen clamp',
)
sub(
  '            BuildSequence(clipName);',
  '            BuildSequence(clipName, holdMs);',
  'StartClip -> BuildSequence',
)
sub(
  'private void StartClip(string clipName, bool loop, int durationMs)',
  'private void StartClip(string clipName, bool loop, int durationMs, int holdMs = 0)',
  'StartClip sig',
)

writeFileSync(P, s, 'utf8')
console.log('  补丁 ' + hits + ' 处，文件 ' + before.length + ' → ' + s.length + ' 字节')
