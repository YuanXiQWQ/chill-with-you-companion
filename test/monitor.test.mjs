import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MODES, modeOf, canPlay, applyMode } from '../lib/director-mode.js'
import { createMonitor } from '../lib/game-monitor.js'
import { ACTIONS } from '../lib/actions.js'
import { classifyClip, MOTION_CLASS } from '../lib/motion-class.js'

// ---- 模式层 ----

test('她睡着优先于一切：睡着时任何输入都不排动作', () => {
  // phase 可能是 idle / break，但游戏已经把她送进 BreakSleep 了。
  // 那时候排动作等于隔几秒把她从梦里拽出来。
  for (const phase of ['idle', 'focus', 'break']) {
    const m = modeOf({ phase, heroineState: 'BreakSleep' })
    assert.equal(m.name, 'sleep', `phase=${phase} 时睡着应压过其它模式`)
    assert.equal(m.beats, 0)
  }
})

test('模式按 phase 落到 focus / break / idle', () => {
  assert.equal(modeOf({ phase: 'focus' }).name, 'focus')
  assert.equal(modeOf({ phase: 'break' }).name, 'break')
  assert.equal(modeOf({ phase: 'idle' }).name, 'idle')
  assert.equal(modeOf({}).name, 'idle', '什么都没给时按正常态')
  assert.deepEqual(Object.keys(MODES).sort(), ['break', 'busy', 'focus', 'idle', 'sleep'])
})

test('受限模式只放行上半身能演的动词', () => {
  // state 动词换的是整段行为，跟采样族分类无关——专注时放她去看电影
  // 就是直接离开工作。
  for (const name of ['focus', 'break', 'sleep', 'busy']) {
    const m = MODES[name]
    assert.equal(canPlay('movie', m), false, name + ' 不该放行 movie')
    assert.equal(canPlay('work_pc', m), false, name + ' 不该放行 work_pc')
  }
  assert.equal(canPlay('nod', MODES.focus), true)
  assert.equal(canPlay('movie', MODES.idle), true)
  // 睡觉那个动词本身不产生动作（游戏按专注时长自己送她睡）
  assert.equal(canPlay('sleep', MODES.idle), false)
})

test('头颈能演的动词只有五种，且都是手势类不带 state', () => {
  const able = Object.keys(ACTIONS)
    .filter((v) => canPlay(v, MODES.focus))
    .sort()
  assert.deepEqual(able, ['laugh', 'nod', 'shy', 'suspense', 'think'])
  // 反过来说：能演 = 手势类 + 不带 state，没有第三种判断口径
  for (const v of Object.keys(ACTIONS)) {
    const a = ACTIONS[v]
    const expect = !a.state && !a.noMotion && classifyClip(a.family) === MOTION_CLASS.GESTURE
    assert.equal(canPlay(v, MODES.focus), expect, v + ' 的判定和分类不一致')
  }
})

test('applyMode 换掉演不了的，同族去重，按拍数截断', () => {
  const mk = (verb, family, prio) => ({ verb, family, prio, anchor: 'core', kind: 'core' })
  const needs = [
    mk('stretch', ACTIONS.stretch.family, 90),
    mk('yawn', ACTIONS.yawn.family, 50),
    mk('nod', ACTIONS.nod.family, 10),
  ]
  const notes = []
  const dropped = []
  applyMode(needs, MODES.focus, { note: (m) => notes.push(m), drop: (d) => dropped.push(d) })
  // stretch 和 yawn 都换成 nod，加上本来就有的 nod → 同族只留一条
  assert.equal(needs.length, 1, '专注态只排一拍，且同族去重')
  assert.equal(needs[0].verb, 'nod')
  assert.ok(notes.some((n) => n.startsWith('专注：')))
})

test('拍数截断要留优先级高的，并写清为什么', () => {
  const low = { verb: 'nod', family: ACTIONS.nod.family, prio: 10, anchor: 'tail', kind: 'reaction' }
  const high = { verb: 'think', family: ACTIONS.think.family, prio: 90, anchor: 'lead', kind: 'reaction' }
  const needs = [low, high]
  const dropped = []
  applyMode(needs, MODES.focus, { note: () => {}, drop: (d) => dropped.push(d) })
  assert.equal(needs.length, 1)
  assert.equal(needs[0].verb, 'think', '该留优先级高的那条')
  assert.ok(dropped.length === 1 && /拍/.test(dropped[0].why), '丢弃要写明是拍数限制')
})

// ---- 监测器 ----

test('监测器只在真变化时出声，噪声不算', () => {
  const seen = []
  const mon = createMonitor({ onChange: (e) => seen.push(e.changes), log: () => {} })
  assert.deepEqual(mon.observe({ focus: false, heroState: 'WorkPC' }, 1000), [])
  // fps / 队列深度这类每拍都在变的字段不能算变化，否则等于没做差分
  assert.deepEqual(mon.observe({ focus: false, heroState: 'WorkPC', fps: 61, queue: { depth: 3 } }, 1200), [])
  const ch = mon.observe({ focus: true, timer: '24:59', heroState: 'WorkPC' }, 1600)
  assert.deepEqual(ch.map((c) => c.field), ['focus'])
  assert.equal(seen.length, 1)
})

test('专注倒计时每秒都在变，但它不是切换', () => {
  // 实测踩过：timer 进了签名，专注期间就成了每秒一次上报，又变回高频轮询。
  const seen = []
  const mon = createMonitor({ onChange: (e) => seen.push(e), log: () => {} })
  mon.observe({ focus: true, timer: '25:00', heroState: 'WorkPC' }, 1000)
  for (let i = 1; i <= 5; i += 1) {
    mon.observe({ focus: true, timer: '24:5' + (9 - i), heroState: 'WorkPC' }, 1000 + i * 1000)
  }
  assert.equal(seen.length, 0, '倒计时变化不该被当成切换')
})

test('heroState 读不到不算切换（多半是 HeroineAI 还没就绪）', () => {
  const mon = createMonitor({ onChange: () => {}, log: () => {} })
  mon.observe({ heroState: 'WorkPC' }, 1000)
  assert.deepEqual(mon.observe({ heroState: '' }, 1400), [], '读空不该被当成切走了')
  assert.equal((mon.snapshot().heroState === 'BreakSleep'), false)
})

test('她睡着时监测器能直接回答，导演据此一拍都不排', () => {
  const mon = createMonitor({ onChange: () => {}, log: () => {} })
  mon.observe({ heroState: 'WorkPC' }, 1000)
  assert.equal((mon.snapshot().heroState === 'BreakSleep'), false)
  mon.observe({ heroState: 'BreakSleep' }, 1400)
  assert.equal((mon.snapshot().heroState === 'BreakSleep'), true)
})

test('游戏在走剧情时不排动作（DLL 那时连 pull 都不做）', () => {
  const m = modeOf({ phase: 'idle', gameStory: true })
  assert.equal(m.name, 'busy')
  assert.equal(m.beats, 0, '剧情中一拍都不排，排了也只是进 feed 里过期')
  // 专注和剧情同时成立时让位给剧情：舞台整个被游戏占着
  assert.equal(modeOf({ phase: 'focus', gameStory: true }).name, 'busy')
  // 但她睡着比剧情更具体，日志口径要能分清
  assert.equal(modeOf({ gameStory: true, heroineState: 'BreakSleep' }).name, 'sleep')
})

test('剧情标记也是切换信号', () => {
  const seen = []
  const mon = createMonitor({ onChange: (e) => seen.push(e.changes), log: () => {} })
  mon.observe({ hard: false, heroState: 'Idle' }, 1000)
  assert.equal(mon.storyTelling(), false)
  const ch = mon.observe({ hard: true, busyReason: 'story-voice:Voice_MainScenario_24_005', heroState: 'MainStory' }, 1400)
  assert.ok(ch.some((c) => c.field === 'hard'), '剧情开始要报出来')
  assert.equal(mon.storyTelling(), true)
  mon.observe({ hard: false, heroState: 'Idle' }, 1800)
  assert.equal(mon.storyTelling(), false)
})

test('抖动抑制：同一组变化 250ms 内重复出现只报一次', () => {
  const seen = []
  const mon = createMonitor({ onChange: (e) => seen.push(e), log: () => {} })
  mon.observe({ heroState: 'WorkPC' }, 1000)
  mon.observe({ heroState: 'BreakSleep' }, 1400)
  mon.observe({ heroState: 'WorkPC' }, 1450)
  assert.equal(seen.length, 1, '抖动不该当成两次切换')
})

test('换机位算一次切换：构图变了，编排口径就得变', () => {
  const seen = []
  const mon = createMonitor({ onChange: (e) => seen.push(e) })
  mon.observe({ heroineReady: true, heroState: 'BreakTeaTime', cam: 'Initial', scene: 'RoomScene' }, 1000)
  // 时间要显式往前推：250ms 内连着来的变化会被抖动抑制吃掉
  mon.observe({ heroineReady: true, heroState: 'BreakTeaTime', cam: 'Desk', scene: 'RoomScene' }, 1500)
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0].changes, [{ field: 'cam', from: 'Initial', to: 'Desk' }])
  assert.equal(mon.snapshot().cam, 'Desk')
})

test('游戏自己说在演剧情（camStory）也进差分，但不顶替 hard', () => {
  const seen = []
  const mon = createMonitor({ onChange: (e) => seen.push(e) })
  mon.observe({ hard: false, camStory: false, heroineReady: true }, 1000)
  mon.observe({ hard: false, camStory: true, heroineReady: true }, 1500)
  assert.equal(seen.length, 1)
  assert.equal(mon.snapshot().camStory, true)
  // hard 仍是那套文本/语音口径，没被 camStory 悄悄改写
  assert.equal(mon.storyTelling(), false)
})
