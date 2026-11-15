import { readFileSync, writeFileSync } from 'node:fs'
const p = 'brain.mjs'
let s = readFileSync(p, 'utf8')
const log = []
const apply = (marker, fn) => { if (s.includes(marker)) { log.push('skip ' + marker.slice(0, 18)); return } fn(); log.push('ok   ' + marker.slice(0, 18)) }

// ① 补 planSequence / layerOf 的导入
apply('planSequence, classifyClip', () => {
  s = s.replace("import { classifyClip, MOTION_CLASS } from './lib/motion-class.js'",
    "import { planSequence, classifyClip, enforceContentClass, MOTION_CLASS } from './lib/motion-class.js'")
  s = s.replace("import { familyOf as grammarFamilyFn } from './lib/game-grammar.js'",
    "import { familyOf as grammarFamilyFn, layerOf } from './lib/game-grammar.js'")
})

// ② 闸门 + 编排（内容优先，时序与语音无关）
apply('enforceContentClass(cues', () => {
  const anchor = '    // 表演和语音解绑：动作按固定节拍顺序起手，与音频长度无关；口型仍严格跟音频。'
  if (!s.includes(anchor)) throw new Error('插入点失配')
  const BLOCK = [
    '    // 闸门：内容明确指向某类动作（喝/写/累/走）而模型选的类别完全不符，就换掉。',
    '    // 提示词只是建议，这里才是保证；只覆盖"完全不符"，不敢动模型的部分正确选择。',
    '    if (cues && cues.length > 0) {',
    '      try {',
    '        const snap = game.snapshot() || {}',
    '        const cur = snap.motion || {}',
    '        const curLeft = Number(cur.remainingMs)',
    '        const curLayer = cur.active ? layerOf(cur.active) : ""',
    '        const gate = enforceContentClass(cues, {',
    '          text: userText,',
    '          headOnly: state.phase === "focus",',
    '          emotion: parsed.emotion,',
    '          manifest,',
    '          currentLayer: curLayer,',
    '        })',
    '        // 门决策落盘：事后能对照"她本来要演什么、被改成了什么"',
    '        try {',
    '          const gateLine = JSON.stringify({',
    '            at: new Date().toISOString(),',
    '            text: String(userText || "").slice(0, 40),',
    '            emotion: parsed.emotion,',
    '            want: gate.want || null,',
    '            picked: gate.picked || null,',
    '            changed: gate.changed,',
    '            manCount: Array.isArray(manifest && manifest.animations) ? manifest.animations.length : 0,',
    '            hadCues: (cues || []).filter((c) => c.slot === "animations").map((c) => c.id),',
    '          }) + "\\n"',
    '          appendFileSync(((cfg && cfg.dataDir) || ".") + "/gate.log", gateLine)',
    '        } catch { /* 诊断失败不影响演出 */ }',
    '        if (gate.changed && gate.changed.length) {',
    '          cues = gate.cues',
    '          log("[perf] content gate: " + JSON.stringify(gate.changed))',
    '        }',
    '        // 编排：排序 + 冲突串行化 + 按"她正在做的事"算过渡。',
    '        // 表演与语音解绑后这里不再传说话时长做"铺满"，只传延续信息。',
    '        const planned = planSequence(cues, {',
    '          text: userText,',
    '          currentClass: cur.class || MOTION_CLASS.IDLE,',
    '          currentLayer: curLayer,',
    '          currentEndsAt: Number.isFinite(curLeft) && curLeft > 0 ? curLeft : 0,',
    '          lastFamily: perfFamily(),',
    '          sinceLastMs: perfAge(),',
    '          continueWindowMs: 20000,',
    '        })',
    '        cues = planned.cues',
    '        if (planned.notes && planned.notes.length) log("[perf] sequence: " + JSON.stringify(planned.notes))',
    '      } catch (error) {',
    '        log("[perf] planSequence failed: " + (error && error.message))',
    '      }',
    '    }',
    anchor
  ].join('\n')
  s = s.replace(anchor, BLOCK)
})

writeFileSync(p, s, 'utf8')
console.log(log.join('\n'))
