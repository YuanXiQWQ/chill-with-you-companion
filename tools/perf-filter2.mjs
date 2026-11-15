import { readFileSync, writeFileSync } from 'node:fs'

// KEYS 是数组结构 [[CLASS, [词...]], ...]，不是对象。补齐关键词要按这个结构改。
{
  const p = 'lib/motion-class.js'
  let s = readFileSync(p, 'utf8')
  const addTo = (cls, words) => {
    const re = new RegExp(`(\\[MOTION_CLASS\\.${cls}, \\[)([^\\n]*?)(\\]\\],?)$`, 'm')
    const m = re.exec(s)
    if (!m) throw new Error('KEYS 里没找到 ' + cls)
    const have = new Set(m[2].match(/'[^']+'/g)?.map((x) => x.slice(1, -1)) || [])
    const missing = words.filter((w) => !have.has(w))
    if (!missing.length) return 0
    s = s.replace(re, (all, a, body, z) => a + body.replace(/\s*$/, '') + missing.map((w) => `, '${w}'`).join('') + z)
    return missing.length
  }
  const n1 = addTo('GESTURE', ['dryeye', 'eye', 'rub', 'music', 'sway', 'hum', 'playingwithapen'])
  const n2 = addTo('PROP', ['apen', 'pageflip', 'flip', 'novel', 'textbook', 'drop'])
  const n3 = addTo('IDLE', ['base'])
  writeFileSync(p, s, 'utf8')
  console.log(`  ✓ KEYS 补齐：gesture+${n1} prop+${n2} idle+${n3}`)
}

// 清单过滤：parts.push 那行的实际写法是 filter(Boolean).join(':')
{
  const p = 'lib/assets.js'
  let s = readFileSync(p, 'utf8')
  if (!s.includes('isPerformanceClip')) {
    s = s.replace("import { classifyClip } from './motion-class.js'",
      "import { classifyClip, isPerformanceClip } from './motion-class.js'")
    const anchor = "    parts.push([entry.id, tags, slot === 'animations' ? classTagOf(entry.id) : '', dur].filter(Boolean).join(':'))"
    if (!s.includes(anchor)) throw new Error('assets 锚点失配')
    s = s.replace(anchor, `    // 界面/环境/开场镜头不是表演动作，别放进给模型看的清单
    if (slot === 'animations' && !isPerformanceClip(entry.id)) continue
${anchor}`)
    writeFileSync(p, s, 'utf8')
    console.log('  ✓ 清单排除非表演类')
  }
}
