import { readFileSync, writeFileSync } from 'node:fs'

// ── 1) KEY 表由段名直接给类别：先看名字里的关键词（token 匹配，不做子串）──
{
  const p = 'lib/motion-class.js'
  let s = readFileSync(p, 'utf8')
  if (!s.includes('NON_PERFORMANCE_SCENES')) {
    s = s.replace('export const MOTION_CLASS = {', `// 这些是游戏自己的镜头/界面/环境动画，永远不该当表演动作下发：
// ui_* 界面动画（ui_levelup_none 长达 60 秒）、env_* 场景循环（摩天轮 600 秒）、
// start* 开场运镜、item_* 物品翻页。把它们当动作发下去，她会"消失"或定格一分钟。
export const NON_PERFORMANCE_SCENES = ['ui', 'env', 'start', 'startcamera', 'startvolume', 'item']

export function isPerformanceClip(id) {
  const s = String(id || '').replace(/^anim_/i, '').toLowerCase()
  if (!s) return false
  return !NON_PERFORMANCE_SCENES.some((pre) => s === pre || s.startsWith(pre + '_'))
}

export const MOTION_CLASS = {`)
    writeFileSync(p, s, 'utf8')
    console.log('  ✓ 增加 isPerformanceClip（ui/env/start/item 排除）')
  }
}

// ── 2) 关键词补齐：揉眼睛/听歌是手势；转笔/翻页是道具；X_base 是基础姿态 ──
{
  const p = 'lib/motion-class.js'
  let s = readFileSync(p, 'utf8')
  const add = (cls, words) => {
    const re = new RegExp(`(${cls}:\\s*\\[)`)
    if (!re.test(s)) { console.log('  ! 未找到 ' + cls + ' 列表'); return }
    s = s.replace(re, (m0) => {
      const missing = words.filter((w) => !new RegExp(`'${w}'`).test(s))
      return missing.length ? m0 + missing.map((w) => `'${w}', `).join('') : m0
    })
  }
  add('gesture', ['dryeye', 'eye', 'rub', 'music', 'headphone', 'sway', 'hum'])
  add('prop', ['apen', 'pageflip', 'flip', 'novel', 'textbook'])
  add('idle', ['base'])
  writeFileSync(p, s, 'utf8')
}

// ── 3) 挑选候选时排除非表演类 ──
{
  const p = 'lib/motion-class.js'
  let s = readFileSync(p, 'utf8')
  const anchor = `    if (!id.startsWith('anim_')) continue
    if (classifyClip(id) !== targetClass) continue`
  if (!s.includes(anchor)) throw new Error('pickCandidate 锚点失配')
  s = s.replace(anchor, `    if (!id.startsWith('anim_')) continue
    if (!isPerformanceClip(id)) continue
    if (classifyClip(id) !== targetClass) continue`)
  writeFileSync(p, s, 'utf8')
  console.log('  ✓ pickCandidate 排除非表演类')
}

// ── 4) 清单也不给模型看这些（省预算，也防它挑到 60 秒 UI 动画）──
{
  const p = 'lib/assets.js'
  let s = readFileSync(p, 'utf8')
  if (!s.includes('isPerformanceClip')) {
    s = s.replace("import { classifyClip } from './motion-class.js'",
      "import { classifyClip, isPerformanceClip } from './motion-class.js'")
    const anchor = "parts.push([entry.id, tags, slot==='animations'?classTagOf(entry.id):'', dur])"
    if (!s.includes(anchor)) throw new Error('assets 锚点失配')
    s = s.replace(anchor, `if (slot === 'animations' && !isPerformanceClip(entry.id)) continue\n    ${anchor}`)
    writeFileSync(p, s, 'utf8')
    console.log('  ✓ 清单排除非表演类')
  }
}
