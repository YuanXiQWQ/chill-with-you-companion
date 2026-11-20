import { readFileSync, writeFileSync } from 'node:fs'
const p = 'lib/motion-class.js'
let s = readFileSync(p, 'utf8')

// 1) 闸门必须返回清单里真实存在的 id，不能返回家族名（游戏端只认完整 id）
const old = "scored.push({ id: isTriple ? grammarFamily(id) : id, score })"
if (!s.includes(old)) throw new Error('候选入列锚点失配')
s = s.replace(old, "// 保留 _start 原 id：家族名 anim_x 往往不在清单里，下发过去游戏端找不到 clip\n    scored.push({ id, score })")

// 2) "喝" 只认 drink，不要用 tea 蹭分（茶 base 是场景待机，不是喝的动作）
s = s.replace("[['喝', '水', '茶', '咖啡', '杯', '渴'], ['喝', '茶', '咖啡', '杯', '水'], ['drink', 'tea']],",
  "[['喝', '水', '茶', '咖啡', '杯', '渴'], ['喝', '茶', '咖啡', '杯', '水'], ['drink']],")
writeFileSync(p, s, 'utf8')
console.log('  ✓ 闸门返回真实 id；喝 只认 drink')
