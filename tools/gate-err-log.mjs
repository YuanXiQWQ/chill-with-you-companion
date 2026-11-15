import { readFileSync, writeFileSync } from 'node:fs'
const p = 'brain.mjs'
let s = readFileSync(p, 'utf8')
const old = `        } catch (error) {
          log('[perf] planSequence failed: ' + (error && error.message))
        }`
if (!s.includes(old)) throw new Error('异常分支锚点失配')
s = s.replace(old, `        } catch (error) {
          try { appendFileSync(((cfg && cfg.dataDir) || '.') + '/gate.log', JSON.stringify({ at: new Date().toISOString(), err: String(error && error.stack || error).slice(0, 400) }) + '\\n') } catch { }
          log('[perf] planSequence failed: ' + (error && error.message))
        }`)
writeFileSync(p, s, 'utf8')
console.log('  ✓ 异常也落盘')
