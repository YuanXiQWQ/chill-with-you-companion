import { readFileSync, writeFileSync } from 'node:fs'
const p = 'brain.mjs'
let s = readFileSync(p, 'utf8')
if (s.includes('gate.log')) { console.log('  · 已有诊断'); process.exit(0) }

const old = `        if (gate.changed.length) {
          cues = gate.cues
          log('[perf] content gate: ' + JSON.stringify(gate.changed))
        }`
if (!s.includes(old)) throw new Error('闸门日志块失配')
const neu = `        // 闸门决策落盘，方便事后对照"她实际演了什么"
        try {
          const gateLine = JSON.stringify({ at: new Date().toISOString(), text: String(text || '').slice(0, 40), emotion: parsed.emotion, want: gate.want || [], changed: gate.changed, hadCues: (cues || []).filter((c) => c.slot === 'animations').map((c) => c.id) }) + '\\n'
          appendFileSync(cfg.dataDir + '/gate.log', gateLine)
        } catch { /* 诊断失败不影响演出 */ }
        if (gate.changed.length) {
          cues = gate.cues
          log('[perf] content gate: ' + JSON.stringify(gate.changed))
        }`
s = s.replace(old, neu)
writeFileSync(p, s, 'utf8')
console.log('  ✓ 闸门决策写入 gate.log')
