import { readFileSync, writeFileSync } from 'node:fs'

// ── A. planSequence：手势不展开成家族；同族跨轮延续；不重复同一段 ──
{
  const p = 'lib/motion-class.js'
  let s = readFileSync(p, 'utf8')

  const OLD = '    if (triple.length >= 3) {'
  if (!s.includes(OLD)) throw new Error('A 锚点失配')
  const NEW = [
    '    // 动作规模要配内容：',
    '    //   手势（点头/害羞/歪头）本来就是一两秒的反应，展开成 start→loop→end 会变成',
    '    //   "每句话都做一个完整的动作再回待机"，比说话还隆重。所以手势只播自己那一段。',
    '    //   道具/姿态/位移（喝茶/伸懒腰/离座）才是一件事，按家族整段走。',
    '    const isGesture = item.cls === MOTION_CLASS.GESTURE',
    '    // 跨轮延续：同一家族刚演过、还没冷，就接着 hold 它的 loop，而不是重新进入+退出。',
    '    // 这正是游戏自己的行为——她做着一件事，你说话，她继续做。',
    '    const sameFamily = opts.lastFamily && grammarFamily(item.cue.id) === opts.lastFamily',
    '    const warm = Number.isFinite(opts.sinceLastMs) && opts.sinceLastMs < (opts.continueWindowMs || 20000)',
    '    if (sameFamily && warm && segs.includes("loop")) {',
    '      const loopId = triple.find((x) => /_loop2?$/.test(x)) || ""',
    '      const loopMs = Math.min(Math.max(durationOf(loopId) || 1900, 300), 2600)',
    '      if (loopId) {',
    '        out.push({ ...item.cue, id: loopId, at: start, durationMs: loopMs })',
    '        notes.push({ id: grammarFamily(item.cue.id), continued: true, why: "same-family warm" })',
    '        cursor = start + loopMs',
    '        fromClass = item.cls',
    '        if (item.layer) curLayer = item.layer',
    '        continue',
    '      }',
    '    }',
    '    if (triple.length >= 3 && !isGesture) {'
  ].join('\n')
  s = s.replace(OLD, NEW)
  writeFileSync(p, s, 'utf8')
  console.log('  A ✓ 手势不展开 + 同族延续')
}

// ── B. brain：把上一段家族与时间传进编排，并在编排后记下来 ──
{
  const p = 'brain.mjs'
  let s = readFileSync(p, 'utf8')

  const OLD = [
    '        const planned = planSequence(cues, {',
    '          text: userText,',
    '          currentClass: cur.class || MOTION_CLASS.IDLE,',
    '          currentLayer: curLayer,',
    '          currentEndsAt: Number.isFinite(curLeft) && curLeft > 0 ? curLeft : 0,',
    '          speechMs,',
    '        })'
  ].join('\n')
  if (!s.includes(OLD)) throw new Error('B 锚点失配')
  const NEW = [
    '        // 上一段表演的家族与时间：让"她正在做的事"能跨句延续，而不是每句重新进入退出。',
    '        const lastPerf = state.lastPerf && state.lastPerf.family ? state.lastPerf : null',
    '        const planned = planSequence(cues, {',
    '          text: userText,',
    '          currentClass: cur.class || MOTION_CLASS.IDLE,',
    '          currentLayer: curLayer,',
    '          currentEndsAt: Number.isFinite(curLeft) && curLeft > 0 ? curLeft : 0,',
    '          speechMs,',
    '          lastFamily: lastPerf ? lastPerf.family : "",',
    '          sinceLastMs: lastPerf ? Date.now() - Number(lastPerf.at || 0) : Infinity,',
    '          continueWindowMs: 20000,',
    '        })'
  ].join('\n')
  s = s.replace(OLD, NEW)

  // 编排结果里挑主段记到 state（sandbox 也记，内存态不影响真实状态）
  const OLD2 = '        cues = planned.cues'
  if (!s.includes(OLD2)) throw new Error('B2 锚点失配')
  s = s.replace(OLD2, [
    '        cues = planned.cues',
    '        try {',
    '          const prim = (planned.cues || []).find((c) => c.slot === "animations")',
    '          if (prim) state.lastPerf = { family: grammarFamilyFn(prim.id), at: Date.now() }',
    '        } catch { /* 记录失败不影响演出 */ }'
  ].join('\n'))

  // 引入 familyOf 作为 grammarFamilyFn
  if (!s.includes('grammarFamilyFn')) throw new Error('B3 引入失败')
  s = s.replace("import { planSequence, classifyClip, enforceContentClass, MOTION_CLASS } from './lib/motion-class.js'",
    "import { planSequence, classifyClip, enforceContentClass, MOTION_CLASS } from './lib/motion-class.js'\nimport { familyOf as grammarFamilyFn } from './lib/game-grammar.js'")

  writeFileSync(p, s, 'utf8')
  console.log('  B ✓ brain 传延续参数并记录上一段')
}
