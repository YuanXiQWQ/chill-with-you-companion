// 离座：交还给游戏自己的状态机。
//
// 2026-11-15 实测把这套东西推翻重来：她"走到沙发"在坐标上不存在
// （Character 根全程不动、_currentPlace 全程 Desk、_heroineTransform 空表），
// 沙发上"待着"也不是按住一条 loop，而是 GoSofa 里权重 + 秒表的轮转。
//
// 所以侧车这一层只剩两件事：判定"主戏是离开"、在那段时间锁住编排。
// 这套测试就是在钉这两件事——顺便钉住"旧设计不许回流"。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as seat from '../lib/seat-trip.js'
import {
  decideTrip, awayWindow, awayMs, cooldownMs, LEAVE_PLANS,
  AWAY_MIN_MS, AWAY_MAX_MS, COOLDOWN_MIN_MS, COOLDOWN_MAX_MS
} from '../lib/seat-trip.js'

test('认得出要她离开椅子的说法', () => {
  assert.equal(decideTrip('去沙发上躺一下').key, 'sofa')
  assert.equal(decideTrip('帮我去拿个杯子').key, 'far')
  assert.equal(decideTrip('拿点零食过来吧').key, 'far')
  assert.equal(decideTrip('去倒杯水').key, 'far')
})

test('他说自己去拿东西，她不该起身', () => {
  assert.equal(decideTrip('我去拿个杯子'), null)
  assert.equal(decideTrip('我下去拿个外卖'), null)
})

test('普通闲聊不触发：她不该因为一句话就站起来', () => {
  assert.equal(decideTrip('嗯，点个头'), null)
  assert.equal(decideTrip('今天好安静'), null)
  assert.equal(decideTrip('这个报告我写完了'), null)
  assert.equal(decideTrip(''), null)
  assert.equal(decideTrip(null), null)
})

test('对着屏幕说的"嘴馋"不算让她起身', () => {
  // "我想吃蛋糕"是表达想吃，不是"去把蛋糕拿来"
  assert.equal(decideTrip('蛋糕看起来好好吃'), null)
  assert.equal(decideTrip('我有点想吃甜的'), null)
  // 明确让她去拿才算
  assert.ok(decideTrip('帮我拿蛋糕'))
})

test('计划名用的是游戏自己的枚举词汇，不是我们编的行程名', () => {
  for (const key of Object.keys(LEAVE_PLANS)) {
    const p = LEAVE_PLANS[key]
    assert.ok(typeof p.plan === 'string' && p.plan.length > 0, key + ' 没有 plan')
    assert.equal(p.plan[0], p.plan[0].toUpperCase(), key + ' 的 plan 应该是 PascalCase 枚举名：' + p.plan)
    // 不能带我们的行程前缀——那说明又把 clip 命名当成了计划名
    assert.ok(!/anim_|leavechair/i.test(p.plan), key + ' 的 plan 混进了 clip 名：' + p.plan)
  }
  assert.equal(LEAVE_PLANS.sofa.plan, 'Sofa')   // 实测可用的那个
})

test('接管窗口是三到五分钟，且 from/until 与 spanMs 自洽', () => {
  const t0 = 1000000
  for (const r of [0, 0.5, 0.999]) {
    const w = awayWindow({ plan: 'Sofa', label: '去沙发' }, t0, () => r)
    assert.ok(w.spanMs >= AWAY_MIN_MS && w.spanMs <= AWAY_MAX_MS, 'span=' + w.spanMs)
    assert.equal(w.from, t0)
    assert.equal(w.until, t0 + w.spanMs)
    // 窗口不决定演多久——别再把"我们排的动作总长"当成接管时长
    assert.equal(w.totalMs, undefined)
  }
})

test('窗口随机但不贴边：连着取几十次要铺满区间', () => {
  const xs = Array.from({ length: 60 }, () => awayMs())
  const min = Math.min(...xs)
  const max = Math.max(...xs)
  assert.ok(min < AWAY_MIN_MS + 60000, 'min=' + min)
  assert.ok(max > AWAY_MAX_MS - 60000, 'max=' + max)
})

test('冷却三到五分钟，随机不重复', () => {
  const xs = Array.from({ length: 30 }, () => cooldownMs())
  for (const v of xs) assert.ok(v >= COOLDOWN_MIN_MS && v <= COOLDOWN_MAX_MS, 'cd=' + v)
  assert.ok(new Set(xs).size > 5, '冷却全是同一个值，等于定时器')
})

test('旧设计不许回流：时间轴、按住、位移的导出面必须为空', () => {
  // 这些是"我们自己排一条 clip 时间轴"的残留。它们的复活说明有人又把
  // seat-trip 写回成编排器了——离座时长该由游戏自己的状态机决定。
  for (const name of ['TRIPS', 'tripPlan', 'tripItems', 'tripWindow', 'tripTtlMs',
    'stayMs', 'stepMs', 'STAY_MIN_MS', 'STAY_MAX_MS', 'AWAY_TAIL_MS', 'QUEUE_SLACK_MS']) {
    assert.equal(seat[name], undefined, name + ' 回到了 seat-trip.js，说明旧设计回流')
  }
})
