import { readFileSync, writeFileSync } from 'node:fs'
const p = 'brain.mjs'
let s = readFileSync(p, 'utf8')

// 在编排 try 之前打点：确认这段代码到底有没有被执行
const anchor = `      // ── 编排：按回复内容相关度排序，并以"她此刻的动作"作为过渡起点 ──`
if (!s.includes(anchor)) throw new Error('编排注释锚点失配')
if (s.includes('mark("plan-enter")')) { console.log('  · 已有打点'); process.exit(0) }

s = s.replace(anchor, `      mark("plan-enter", String(userText || '').slice(0, 20) + ' cues=' + ((cues || []).filter((c) => c.slot === 'animations').map((c) => c.id).join(',')))
${anchor}`)

// 打点函数放在 runTurn 之前
const marker = 'const runTurn = async (userText, options = {}) => {'
if (!s.includes(marker)) throw new Error('runTurn 锚点失配')
s = s.replace(marker, `// 临时诊断：把编排管线的进入/异常写到 gate.log
const mark = (tag, extra = '') => {
  try { appendFileSync(((cfg && cfg.dataDir) || '.') + '/gate.log', JSON.stringify({ at: new Date().toISOString(), tag, extra }) + '\\n') } catch { }
}

${marker}`)

// 异常分支也打点
s = s.replace(`      } catch (error) {
        log('[perf] planSequence failed: ' + (error && error.message))
      }`, `      } catch (error) {
        mark('plan-error', String((error && error.stack) || error).slice(0, 500))
        log('[perf] planSequence failed: ' + (error && error.message))
      }`)
writeFileSync(p, s, 'utf8')
console.log('  ✓ 打点已插入')
