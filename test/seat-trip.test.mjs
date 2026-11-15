// 离座长途：有些事必须离开椅子做，那就接管一整段时间。
// 接管期内她不在椅子上，这段时间的对话不排表演，只出字幕与语音。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideTrip, tripPlan, awayWindow, stepMs, TRIPS, AWAY_TAIL_MS } from '../lib/seat-trip.js'
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
