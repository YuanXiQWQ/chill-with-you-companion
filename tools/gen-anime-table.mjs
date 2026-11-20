// 从游戏里导出的完整动作集，生成两份东西：
//   1) docs/动画全表.md      —— 人看：游戏到底给了她哪些动作、怎么接
//   2) lib/game-grammar.json —— 机器用：编排照着这份挑与排
import { readFileSync, writeFileSync } from 'node:fs'
import { classifyClip } from '../lib/motion-class.js'

const full = JSON.parse(readFileSync('game/clips.full.json', 'utf8'))
const seed = JSON.parse(readFileSync('game/assets.seed.json', 'utf8'))

// 语义标签只有子集有，按 id 合并
const sem = new Map()
for (const e of Array.isArray(seed.animations) ? seed.animations : []) {
  if (e && e.id) sem.set(e.id, Array.isArray(e.semantic) ? e.semantic : [])
}
// 引擎上报的清单（352 条）也带语义
try {
  const live = JSON.parse(readFileSync('data/assets.json', 'utf8'))
  for (const e of Array.isArray(live.animations) ? live.animations : []) {
    if (e && e.id && Array.isArray(e.semantic) && e.semantic.length && !sem.has(e.id)) sem.set(e.id, e.semantic)
  }
} catch {}

const med = (a) => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}
const pct = (a, p) => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]
}
const ms = (s) => Math.round(s * 1000)

// ── 家族表 ──
const fams = full.byFamily.map((f) => {
  const startId = 'anim_' + f.family.replace(/^anim_/, '') + '_start'
  const probe = f.segs.includes('start') ? startId : 'anim_' + f.family.replace(/^anim_/, '')
  const cls = classifyClip(probe)
  const sems = []
  for (const seg of f.segs) {
    const id = f.family + '_' + seg
    for (const s of sem.get(id) || []) if (!sems.includes(s)) sems.push(s)
    const base = f.family.replace(/^anim_/, '')
    for (const s of sem.get('anim_' + base + '_' + seg) || []) if (!sems.includes(s)) sems.push(s)
  }
  const durations = Object.values(f.segSeconds).map(ms)
  return { ...f, cls, sem: sems, maxMs: Math.max(...durations), single: f.segs.length === 1 }
})

const byScene = {}
for (const f of fams) (byScene[f.scene || '-'] ||= []).push(f)

const shapes = {}
for (const f of fams) {
  const has = (s) => f.segs.includes(s)
  const k = has('start') && has('end') && (has('loop') || has('loop2')) ? 'start+loop+end'
    : has('start') && has('end') ? 'start+end'
    : (has('loop') || has('loop2')) && has('end') ? 'loop+end'
    : has('start') ? 'start' : (has('loop') || has('loop2')) ? 'loop' : has('end') ? 'end' : 'single'
  shapes[k] = (shapes[k] || 0) + 1
}

// ── 机器用语法表 ──
const grammar = {
  generatedAt: new Date().toISOString(),
  source: 'game/clips.full.json（游戏 LogOutput 的 clipdump）',
  totalClips: full.animationClips,
  families: fams.length,
  shapes,
  lay: {
    story: '剧情动作',
    wild: '站立动作',
    break: '休息',
    work: '工作',
    face: '表情',
    item: '道具',
    lookplayer: '面向玩家'
  },
  byFamily: {}
}
for (const f of fams) {
  const key = f.family.startsWith('anim_') ? f.family : 'anim_' + f.family
  grammar.byFamily[key] = {
    segs: f.segs,
    scene: f.scene,
    cls: f.cls,
    semantic: f.sem,
    segDurations: Object.fromEntries(Object.entries(f.segSeconds).map(([k, v]) => [k, ms(v)])),
    durationMs: f.maxMs
  }
}
grammar.families = Object.keys(grammar.byFamily).length
writeFileSync('lib/game-grammar.json', JSON.stringify(grammar, null, 2) + '\n', 'utf8')

// ── 人看的表 ──
const clsCount = {}
for (const f of fams) clsCount[f.cls] = (clsCount[f.cls] || 0) + 1
const segDurByCls = {}
for (const f of fams) {
  (segDurByCls[f.cls] ||= []).push(...Object.values(f.segSeconds).map(ms))
}
const lines = []
lines.push('# 游戏动画全表（从游戏本体导出）', '')
lines.push(`> 来源：游戏运行时 \`clipdump\`（\`BepInEx/LogOutput.log\`），脚本 \`tools/collect-clips.mjs\` → \`game/clips.full.json\`。`, '')
lines.push(`- 动作 clip：**${full.animationClips}** 段，归入 **${fams.length}** 个家族`)
lines.push(`- 其它 clip：${full.nonAnimationClips} 段（椅子 ${full.owners['m_Chair_mobile'] || 0}、笔、环境物、UI）`)
lines.push(`- 家族形态：${Object.entries(shapes).map(([k, v]) => `\`${k}\` ${v}`).join(' · ')}`)
lines.push(`- 场景前缀：${Object.entries(byScene).map(([k, v]) => `\`${k}\` ${v.length}`).join(' · ')}`, '')

lines.push('## 一、按类别看（这决定了怎么合成）', '')
lines.push('| 类别 | 家族数 | 段时长中位 | 合成方式 |', '|---|---|---|---|')
const howCls = {
  gesture: '叠加（游戏待机做底）',
  prop: '绝对 + 620ms 过渡',
  posture: '绝对 + 900ms 过渡、独占',
  locomotion: '绝对 + 独占、不变速',
  idle: '不主动演',
  unknown: '按绝对兜底'
}
for (const k of ['gesture', 'prop', 'posture', 'locomotion', 'idle', 'unknown']) {
  const d = segDurByCls[k] || []
  lines.push(`| ${k} | ${clsCount[k] || 0} | ${med(d)} ms | ${howCls[k]} |`)
}
lines.push('')

lines.push('## 二、三段式家族（游戏自己就是这么播的）', '')
lines.push('`start` 进入 → `loop` 保持（按说话长度重复）→ `end` 退出。这些家族必须整段串起来演，只播 `start` 会硬弹回去。', '')
lines.push('| 家族 | 场景 | 类别 | start | loop | end | 语义 |', '|---|---|---|---|---|---|---|')
for (const f of fams.filter((x) => shapes && x.segs.includes('start') && x.segs.includes('end') && (x.segs.includes('loop') || x.segs.includes('loop2')))) {
  const s = f.segSeconds
  lines.push(`| \`${f.family.replace(/^anim_/, '')}\` | ${f.scene} | ${f.cls} | ${s.start != null ? ms(s.start) : '-'} | ${s.loop != null ? ms(s.loop) : (s.loop2 != null ? ms(s.loop2) : '-')} | ${s.end != null ? ms(s.end) : '-'} | ${f.sem.slice(0, 3).join('/') || '-'} |`)
}
lines.push('')

for (const scene of ['story', 'wild', 'break', 'work', 'face', 'item', 'lookplayer']) {
  const list = (byScene[scene] || []).filter((f) => f.single)
  if (!list.length) continue
  lines.push(`## 三、${scene} 单段家族（${list.length}）`, '')
  lines.push('| 家族 | 类别 | 时长 | 语义 |', '|---|---|---|---|')
  for (const f of list) lines.push(`| \`${f.family.replace(/^anim_/, '')}\` | ${f.cls} | ${f.maxMs} ms | ${f.sem.slice(0, 3).join('/') || '-'} |`)
  lines.push('')
}

lines.push('## 四、椅子动画（游戏用椅子表达坐姿）', '')
lines.push(`\`m_Chair_mobile\` 上有 ${full.owners['m_Chair_mobile'] || 0} 段 clip。她"坐着"不是靠角色动画，而是靠椅子把角色带到座位上——`, '')
lines.push('所以编排里凡是"坐着做的事"（喝茶/看书/敲键盘）都不需要额外补坐姿；换椅子等于换坐姿。', '')

lines.push('## 五、编排规则（从这张表推出来的）', '')
lines.push('1. **段时长按段取**：单段中位 ' + med(Object.values(segDurByCls).flat()) + ' ms，`loop` 段通常最短（1~2 s），`base` 类可达 17 s。给 cue 的 `d` 必须用段自己的时长。')
lines.push('2. **三段式整段演**：命中 `start+loop+end` 的家族就按说话长度铺 `loop`，别只播 `start`。')
lines.push('3. **类别决定合成与过渡**：手势叠加、道具/姿态绝对过渡、位移独占；过渡时长按 (当前类别 → 目标类别) 查表。')
lines.push('4. **层不要乱跳**：`story` 是坐着的前台动作，`wild` 是起身/走动；从 `story` 直接切 `wild` 会看起来"突然站起来"，需要过渡或换指令。')
lines.push('5. **`face` 是表情层**，与身体动作并行，不参与独占判定。')
lines.push('')
writeFileSync('docs/动画全表.md', lines.join('\n'), 'utf8')

console.log(`  家族 ${fams.length}（三段式 ${shapes['start+loop+end'] || 0}）→ docs/动画全表.md`)
console.log('  类别分布: ' + Object.entries(clsCount).map(([k, v]) => k + '=' + v).join('  '))
console.log('  语法表: lib/game-grammar.json')
