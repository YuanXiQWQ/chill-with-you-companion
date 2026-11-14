import assert from 'node:assert/strict'
import {
  EMPTY_MANIFEST,
  emotionFallbackCues,
  indexManifest,
  manifestSize,
  normalizeManifest,
  sanitizePerformance,
  summarizeForPrompt,
} from '../lib/assets.js'

let passed = 0
const check = (label, fn) => {
  fn()
  passed += 1
  console.log('  ok  ' + label)
}

const sample = {
  source: 'game',
  animations: [
    { id: 1001, name: 'Joy', semantic: ['happy', '笑'], durationMs: 2000 },
    { id: 852, name: 'Typing', semantic: ['working'], loop: true },
    { name: 'dirty-no-id' },
    'garbage',
    null,
    { id: 1001, name: 'JoyDup' },
  ],
  scenes: [{ id: 'room_day', name: '房间-白天', semantic: ['morning'] }],
  sfx: [{ id: 'cup_clink', name: '杯子碰碟', semantic: ['coffee'] }],
  voiceClips: [{ id: 'Voice_MainScenario_27_016', text: '君が集中した時…', lang: 'ja' }],
  bgm: [],
}

console.log('# normalizeManifest')
check('脏条目被丢，重复 id 去重', () => {
  const m = normalizeManifest(sample)
  assert.equal(m.animations.length, 2)
  assert.equal(m.animations[0].name, 'Joy')
})
check('数值 id 统一成字符串', () => {
  const m = normalizeManifest(sample)
  assert.equal(typeof m.animations[0].id, 'string')
  assert.equal(m.animations[0].id, '1001')
})
check('loop / durationMs / semantic 规整', () => {
  const m = normalizeManifest(sample)
  assert.equal(m.animations[1].loop, true)
  assert.equal(m.animations[0].durationMs, 2000)
  assert.deepEqual(m.animations[0].semantic, ['happy', '笑'])
})
check('非对象输入不崩', () => {
  for (const bad of [null, undefined, 'x', 42, []]) {
    assert.equal(manifestSize(normalizeManifest(bad)).total, 0)
  }
})
check('全空清单等于 EMPTY', () => {
  assert.equal(manifestSize(normalizeManifest({})).total, 0)
  assert.equal(EMPTY_MANIFEST.animations.length, 0)
})
check('manifestSize 汇总', () => {
  const counts = manifestSize(normalizeManifest(sample))
  assert.equal(counts.animations, 2)
  assert.equal(counts.total, 5)
})

console.log('# indexManifest')
check('每个槽位给出 id 集合', () => {
  const idx = indexManifest(normalizeManifest(sample))
  assert.ok(idx.get('animations').has('1001'))
  assert.ok(!idx.get('animations').has('5001'))
  assert.ok(idx.get('sfx').has('cup_clink'))
})

console.log('# summarizeForPrompt')
check('给 id + 语义 + 时长，不给原始 JSON', () => {
  const text = summarizeForPrompt(normalizeManifest(sample))
  assert.ok(text.includes('1001'))
  assert.ok(text.includes('happy'))
  assert.ok(text.includes('loop'))
  assert.ok(text.includes('2.0s'))
  assert.ok(!text.includes('{'))
})
check('空清单返回空串（不污染 prompt）', () => {
  assert.equal(summarizeForPrompt(EMPTY_MANIFEST), '')
})
check('预算截断会提示不许编 id', () => {
  const many = { animations: Array.from({ length: 200 }, (_, i) => ({ id: 1000 + i, semantic: ['x'] })) }
  const text = summarizeForPrompt(normalizeManifest(many), { budget: 300, perSlot: 200 })
  assert.ok(text.length < 420)
  assert.ok(text.includes('只能用上面出现过的 id'))
})
check('perSlot 限制条数并说明剩余', () => {
  const many = { animations: Array.from({ length: 50 }, (_, i) => ({ id: 1000 + i })) }
  const text = summarizeForPrompt(normalizeManifest(many), { perSlot: 10 })
  assert.ok(text.includes('另有 40 条未列出'))
})

console.log('# sanitizePerformance')
const manifest = normalizeManifest(sample)
check('合法指令原样保留并按时序排序', () => {
  const { cues, dropped } = sanitizePerformance(
    [{ slot: 'sfx', id: 'cup_clink', at: 800 }, { slot: 'anim', id: 1001, at: 0 }],
    manifest,
  )
  assert.equal(cues.length, 2)
  assert.deepEqual(cues.map((c) => c.slot), ['animations', 'sfx'])
  assert.equal(dropped.length, 0)
})
check('不在游戏清单里的 id 被剪掉', () => {
  const { cues, dropped } = sanitizePerformance(
    [{ slot: 'anim', id: 'starlight_dance', at: 0 }, { slot: 'scene', id: 'moon_base', at: 0 }],
    manifest,
  )
  assert.equal(cues.length, 0)
  assert.equal(dropped.length, 2)
  assert.ok(dropped[0].reason.startsWith('id-not-in-game-assets'))
})
check('未知槽位 / 空 id / 非对象被剪掉', () => {
  const { cues, dropped } = sanitizePerformance(
    [{ slot: 'hologram', id: 1, at: 0 }, { slot: 'anim', at: 0 }, null, 'x'],
    manifest,
  )
  assert.equal(cues.length, 0)
  assert.deepEqual(dropped.map((d) => d.reason.split(':')[0]), ['unknown-slot', 'missing-id', 'not-an-object', 'not-an-object'])
})
check('时序越界被剪掉', () => {
  const { cues, dropped } = sanitizePerformance(
    [{ slot: 'anim', id: 1001, at: -5 }, { slot: 'anim', id: 852, at: 999999 }],
    manifest,
  )
  assert.equal(cues.length, 0)
  assert.equal(dropped.filter((d) => d.reason.startsWith('at-out-of-range')).length, 2)
})
check('重复指令去重', () => {
  const { cues, dropped } = sanitizePerformance(
    [{ slot: 'anim', id: 1001, at: 0 }, { slot: 'anim', id: 1001, at: 0 }],
    manifest,
  )
  assert.equal(cues.length, 1)
  assert.equal(dropped[0].reason, 'duplicate')
})
check('超量指令按预算截断', () => {
  const many = normalizeManifest({ animations: Array.from({ length: 20 }, (_, i) => ({ id: i + 1 })) })
  const list = Array.from({ length: 10 }, (_, i) => ({ slot: 'anim', id: i + 1, at: i * 100 }))
  const { cues, dropped } = sanitizePerformance(list, many, { maxCues: 4 })
  assert.equal(cues.length, 4)
  assert.equal(dropped.filter((d) => d.reason.startsWith('over-budget')).length, 6)
})
check('槽位别名（animation/voice/sound/bgm）都认', () => {
  const { cues } = sanitizePerformance(
    [
      { slot: 'animation', id: 1001, at: 0 },
      { slot: 'voice', id: 'Voice_MainScenario_27_016', at: 500 },
    ],
    manifest,
  )
  assert.deepEqual(cues.map((c) => c.slot), ['animations', 'voiceClips'])
})

console.log('# emotionFallbackCues')
check('情绪映射到清单里存在的动作', () => {
  const cues = emotionFallbackCues('Happy', { Happy: 1001 }, manifest)
  assert.equal(cues.length, 1)
  assert.equal(cues[0].id, '1001')
})
check('映射到清单里没有的动作 → 不演（不编造）', () => {
  const cues = emotionFallbackCues('Wave', { Wave: 5001 }, manifest)
  assert.deepEqual(cues, [])
})
check('清单为空时不参与兜底', () => {
  const cues = emotionFallbackCues('Happy', { Happy: 1001 }, EMPTY_MANIFEST)
  assert.equal(cues.length, 1) // 清单为空时交给 buildAct 的老路径，这里只验行为不变
})

console.log(`\nPASS ${passed} checks`)
