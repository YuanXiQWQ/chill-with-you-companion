import { readFileSync, writeFileSync } from 'node:fs'
const p = 'brain.mjs'
let s = readFileSync(p, 'utf8')

if (!s.includes('enforceContentClass')) {
  s = s.replace(
    "import { planSequence, classifyClip, MOTION_CLASS } from './lib/motion-class.js'",
    "import { planSequence, classifyClip, enforceContentClass, MOTION_CLASS } from './lib/motion-class.js'"
  )
}

const old = `        // 说话长度：能拿到语音时长就用真值，否则按字幕字数估（日语约 180ms/字）
        const subText = String(parsed?.subtitle_text || parsed?.voice_text || '')
        const speechMs = Math.max(1200, Math.min(9000, subText.length * 180 || 3200))
        const planned = planSequence(cues, {
          text,
          currentClass: cur.class || MOTION_CLASS.IDLE,
          currentLayer: cur.active ? layerOf(cur.active) : '',
          currentEndsAt: Number.isFinite(curLeft) && curLeft > 0 ? curLeft : 0,
          speechMs,
        })
        cues = planned.cues
        if (planned.notes.length) log('[perf] sequence: ' + JSON.stringify(planned.notes))`
if (!s.includes(old)) throw new Error('brain 编排块锚点失配')

const neu = `        // 说话长度：能拿到语音时长就用真值，否则按字幕字数估（日语约 180ms/字）
        const subText = String(parsed?.subtitle_text || parsed?.voice_text || '')
        const speechMs = Math.max(1200, Math.min(9000, subText.length * 180 || 3200))
        const curLayer = cur.active ? layerOf(cur.active) : ''
        // 闸门：内容明确指向某类动作（喝/写/累/走）而模型选的类别完全不符，就换掉。
        // 提示词只是建议，这里才是保证；只看"完全不符"，不敢覆盖模型的部分正确选择。
        const gate = enforceContentClass(cues, {
          text,
          emotion: parsed.emotion,
          manifest,
          currentLayer: curLayer,
        })
        if (gate.changed.length) {
          cues = gate.cues
          log('[perf] content gate: ' + JSON.stringify(gate.changed))
        }
        const planned = planSequence(cues, {
          text,
          currentClass: cur.class || MOTION_CLASS.IDLE,
          currentLayer: curLayer,
          currentEndsAt: Number.isFinite(curLeft) && curLeft > 0 ? curLeft : 0,
          speechMs,
        })
        cues = planned.cues
        if (planned.notes.length) log('[perf] sequence: ' + JSON.stringify(planned.notes))`

s = s.replace(old, neu)
writeFileSync(p, s, 'utf8')
console.log('  ✓ brain 已接入内容闸门')
