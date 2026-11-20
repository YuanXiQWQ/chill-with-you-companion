import { readFileSync, writeFileSync } from 'node:fs'

// ── A. 插件：排队时缩短归还 ramp、衔接启动、取消句间空档 ──
{
  const p = 'game/src/PerformerPlugin.cs'
  let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
  const log = []
  const apply = (m, fn) => { if (s.includes(m)) { log.push('skip ' + m.slice(0, 16)); return } fn(); log.push('ok   ' + m.slice(0, 16)) }

  // ① 字段
  apply('private bool chainEntry;', () => {
    const a = '        private bool exitValid;'
    if (!s.includes(a)) throw new Error('exitValid 锚点失配')
    s = s.replace(a, [
      a,
      '        // 排队衔接：上一套演完时后面还有动作，就用她的最后姿势当下一套的起点，',
      '        // 省掉「归还待机 → 再起手」这一整段。',
      '        private bool chainEntry;'
    ].join('\n'))
  })

  // ② 检测：队里有没有动画
  apply('private bool HasAnimPending()', () => {
    const a = '        private void StartClip(string clipName, bool loop, int durationMs)'
    if (!s.includes(a)) throw new Error('StartClip 锚点失配')
    s = s.replace(a, [
      '        // 队里还排着动画吗？（只看槽位，不看时间：时间由排队消费端控制）',
      '        private bool HasAnimPending()',
      '        {',
      '            for (int i = 0; i < pending.Count; i++)',
      '            {',
      '                var dto = pending[i].dto;',
      '                if (dto == null || dto.performance == null) continue;',
      '                for (int k = 0; k < dto.performance.Length; k++)',
      '                {',
      '                    var c = dto.performance[k];',
      '                    if (c != null && string.Equals(c.slot, "animations", StringComparison.OrdinalIgnoreCase)) return true;',
      '                }',
      '            }',
      '            return false;',
      '        }',
      '',
      a
    ].join('\n'))
  })

  // ③ 归还 ramp：后面还排着就压到 100ms
  apply('if (HasAnimPending()) exitRelSec', () => {
    const a = '                if (firstExit)'
    if (!s.includes(a)) throw new Error('firstExit 锚点失配')
    s = s.replace(a, [
      a,
      '                // 后面还排着动作：这段不用慢慢归还待机，100ms 内交接，下一套直接接上',
      '                if (HasAnimPending()) exitRelSec = 0.10f;',
    ].join('\n'))
  })

  // ④ 收尾时：把最后姿势留给下一套当起点
  apply('chainEntry = true;', () => {
    const a = '                        if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("handoff dev=" + handoff.ToString("F2") + "deg rel=" + (exitRelSec * 1000f).ToString("F0") + "ms");'
    if (!s.includes(a)) throw new Error('handoff 日志锚点失配')
    s = s.replace(a, [
      a,
      '                        // 衔接：下一套从她"此刻的姿势"起步，而不是从待机重新起手',
      '                        if (HasAnimPending())',
      '                        {',
      '                            if (prevPose != null && bones != null)',
      '                                for (int b = 0; b < bones.Length && b < prevPose.Length; b++)',
      '                                    if (bones[b] != null) prevPose[b] = bones[b].localRotation;',
      '                            prevPoseValid = true;',
      '                            chainEntry = true;',
      '                            if (Plugin.VerboseCues.Value) Plugin.Log.LogInfo("chain: 下一套接上（起点=当前姿势）");',
      '                        }'
    ].join('\n'))
  })

  // ⑤ StartClip：衔接启动用短淡入
  apply('|| chainEntry', () => {
    const a = '            bool continueFamily = clipActive && string.Equals(activeBase, fam, StringComparison.OrdinalIgnoreCase)'
    if (!s.includes(a)) throw new Error('continueFamily 锚点失配')
    s = s.replace(a, '            bool continueFamily = chainEntry || clipActive && string.Equals(activeBase, fam, StringComparison.OrdinalIgnoreCase)')
    s = s.replace('            dbgMaxDeg = 0f; dbgFrames = 0;', '            chainEntry = false;\n            dbgMaxDeg = 0f; dbgFrames = 0;')
  })

  // ⑥ 排队消费：队里还有就不插空档
  apply('int gap = pending.Count > 0 ? 0', () => {
    const a = '                int gap = Plugin.QueueGapMs == null ? 250 : Mathf.Max(0, Plugin.QueueGapMs.Value);'
    if (!s.includes(a)) throw new Error('QueueGap 锚点失配')
    s = s.replace(a, '                // 队里还有动作就不插空档：上一套刚接完，下一套立刻起手\n                int gap = pending.Count > 0 ? 0 : (Plugin.QueueGapMs == null ? 250 : Mathf.Max(0, Plugin.QueueGapMs.Value));')
  })

  writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8')
  console.log(log.join('  '))
}

// ── B. 编排：前面还排着动作 → 用上一段收尾当起步（不再自己进入） ──
{
  const p = 'brain.mjs'
  let s = readFileSync(p, 'utf8')
  const log = []
  const apply = (m, fn) => { if (s.includes(m)) { log.push('skip ' + m.slice(0, 16)); return } fn(); log.push('ok   ' + m.slice(0, 16)) }

  // ① 签名加 queueAhead
  apply('lastFamily, sinceLastMs, queueAhead)', () => {
    s = s.replace('function chainStartToLoop(list, durMs, subtitleLen, lastFamily, sinceLastMs) {',
      'function chainStartToLoop(list, durMs, subtitleLen, lastFamily, sinceLastMs, queueAhead) {')
  })

  // ② 队列深度读取
  apply('function queueAheadNow', () => {
    const a = '  function notePerf(id) {'
    if (!s.includes(a)) throw new Error('notePerf 锚点失配')
    s = s.replace(a, [
      '  // 队里还排着几条：>0 说明上一套还没演完，这一套要"接"而不是"起"。',
      '  function queueAheadNow() {',
      '    try { const snap = game.snapshot() || {}; return Number((snap.queue || {}).depth) || 0 } catch { return 0 }',
      '  }',
      '',
      a
    ].join('\n'))
  })

  // ③ 衔接分支：用身体段直接接上
  apply('上一段的收尾就是这一段的起步', () => {
    const a = '      // 1) 进入过渡。没有 start 段就从原始时间点直接开始（单段动画本来就自包含）'
    if (!s.includes(a)) throw new Error('进入段锚点失配')
    s = s.replace(a, [
      '      // 前面还排着动作：上一段的收尾就是这一段的起步。',
      '      // 她此刻正好在收尾动作里——再自己加一个 _start 等于做完一件事又"重新起手"一次。',
      '      if (Number(queueAhead) > 0)',
      '      {',
      '        const bodyId = has(loopId) ? loopId : (has(base) ? base : startId)',
      '        if (bodyId)',
      '        {',
      '          const bodyDur = Math.min(Math.max(animDurationMs(bodyId) || 1500, 300), 2600)',
      '          const cue = mk(bodyId, g.at, bodyDur)',
      '          cue.chained = true',
      '          out.push(cue)',
      '          continue',
      '        }',
      '      }',
      '',
      a
    ].join('\n'))
  })

  // ④ 两个调用点补参数
  s = s.replace('actDurMs, actChars, perfFamily(), perfAge())', 'actDurMs, actChars, perfFamily(), perfAge(), queueAheadNow())')
  s = s.replace('durMs, subtitleLen, perfFamily(), perfAge())', 'durMs, subtitleLen, perfFamily(), perfAge(), queueAheadNow())')

  writeFileSync(p, s, 'utf8')
  console.log(log.join('  '))
}
