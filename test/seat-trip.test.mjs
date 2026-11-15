// 离座长途：有些事必须离开椅子做，那就接管一整段时间。
// 接管期内她不在椅子上，这段时间的对话不排表演，只出字幕与语音。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideTrip, tripPlan, awayWindow, stepMs, cooldownMs, tripItems, tripWindow, stayMs, TRIPS, AWAY_TAIL_MS, COOLDOWN_MIN_MS, COOLDOWN_MAX_MS, STAY_MIN_MS, STAY_MAX_MS } from '../lib/seat-trip.js'
import { isOffChair } from '../lib/motion-class.js'

test('认得出要离座的说法，普通闲聊不启动', () => {
  assert.equal(decideTrip('我去拿个杯子').key, 'cup')
  assert.equal(decideTrip('去沙发上躺一下').key, 'sofa')
  assert.equal(decideTrip('我要出去一下').key, 'walk')
  assert.equal(decideTrip('嗯，点个头'), null)
  assert.equal(decideTrip('今天好安静'), null)
})

test('每趟行程都是「出去 → 在那做的事 → 回来」的先后关系', () => {
  for (const key of Object.keys(TRIPS)) {
    const p = tripPlan(key)
    assert.ok(p && p.steps.length >= 2, key + ' 排不出行程')
    // 时间轴严格递增，不能并行
    for (let i = 1; i < p.steps.length; i++) {
      assert.ok(p.steps[i].at > p.steps[i - 1].at, key + ' 的第 ' + i + ' 段没有排在后面')
    }
    // 最后一段必须是回来
    assert.match(p.steps[p.steps.length - 1].id, /comeback/, key + ' 没有收在回座上')
    // 第一段必须是出去
    assert.match(p.steps[0].id, /_go$/, key + ' 没有以起身开场')
  }
})

test('行程时长够长：接管至少十秒', () => {
  for (const key of Object.keys(TRIPS)) {
    const p = tripPlan(key)
    assert.ok(p.totalMs >= 10000, key + ' 只有 ' + p.totalMs + 'ms，接管不起来')
  }
})

test('行程里的段本来就是离座族，且都带 trip 标记（供过滤放行）', () => {
  const p = tripPlan('cup')
  for (const s of p.steps) {
    assert.equal(isOffChair(s.id), true, s.id + ' 不是离座族')
    assert.equal(s.trip, true)
    assert.equal(s.locked, true)
  }
})

test('接管窗口覆盖整趟行程，并在末尾多留一点余地', () => {
  const p = tripPlan('cup')
  const t0 = 1000
  const w = awayWindow(p, t0)
  assert.ok(w.from === t0)
  assert.ok(w.until >= t0 + p.totalMs + AWAY_TAIL_MS)
  assert.ok(w.trip.includes('杯子'), '窗口要能说清是哪趟：' + w.trip)
})

test('段时长取自游戏清单，不是猜的', () => {
  assert.ok(stepMs('anim_wild_leavechair_cup_go') > 5000, 'cup_go 应该有好几秒')
  assert.equal(stepMs('anim_不存在的族'), 0)
})
test('冷却 3~5 分钟：不长到"这句话她一直没接"，也不短到一句话就站起来', () => {
  assert.equal(COOLDOWN_MIN_MS, 3 * 60 * 1000)
  assert.equal(COOLDOWN_MAX_MS, 5 * 60 * 1000)
  for (const r of [0, 0.25, 0.5, 0.75, 1, 2, -1]) {
    const ms = cooldownMs(() => r)
    assert.ok(ms >= COOLDOWN_MIN_MS && ms <= COOLDOWN_MAX_MS, 'r=' + r + ' 得到 ' + ms + 'ms，越界')
  }
  // 随机会真的变，不是常数
  const many = new Set(Array.from({ length: 50 }, () => cooldownMs()))
  assert.ok(many.size > 10, '冷却算出来几乎一样，等于固定值')
})
test('沙发上"待着"是独立一条，带 holdMs，落在 3~5 分钟', () => {
  const w = tripWindow(tripPlan('sofa'), () => 0.5)
  assert.equal(w.items.length, 3, '出去 / 待着 / 回来')
  const stay = w.items[1]
  assert.ok(stay.holdMs >= STAY_MIN_MS && stay.holdMs <= STAY_MAX_MS, 'hold=' + stay.holdMs)
  assert.match(stay.id, /_loop$/, '按住的是循环段：' + stay.id)
  // 出去和回来都不按住
  assert.equal(w.items[0].holdMs, 0)
  assert.equal(w.items[2].holdMs, 0)
  // 整趟接管 = 出去 + 待着 + 回来 + 余量
  const sum = w.items.reduce((n, it) => n + (it.holdMs || it.spanMs), 0)
  assert.ok(w.awayMs > sum, '窗口要把回来也算进去')
  assert.ok(w.awayMs / 60000 >= 3, '整趟接管至少三分钟，实际 ' + Math.round(w.awayMs / 1000) + 's')
})

test('短行程（拿杯子）不按住：它没有"待着"这一段', () => {
  const w = tripWindow(tripPlan('cup'), () => 0.5)
  assert.equal(w.items.length, 2)
  assert.ok(w.items.every((it) => it.holdMs === 0))
  assert.ok(w.awayMs < 30000, '拿个杯子不该拖成几分钟')
})

test('holdMs 每次都不同（不是写死的常数）', () => {
  const many = new Set(Array.from({ length: 30 }, () => stayMs()))
  assert.ok(many.size > 5, '待着的时长几乎一样，等于固定值')
})