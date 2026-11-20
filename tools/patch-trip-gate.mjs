// 离座那段时间也归我们管：trip 生效期间游戏语音/弹幕保持关闭，到点自动恢复。
//
// 现状：trip 是单独一条队列条目，gate 在它上面开一下就关，之后 3~5 分钟里
// 游戏自己的自言自语又会冒出来——而这段时间她的字幕和语音是我们的。
//
// 改法：
//   brain  → trip cue 带上 durationMs = 接管窗口
//   游戏端 → TriggerLeaveChair 成功后按这个时长把 gate 压住不退出
//   Tick   → 到点自动恢复（不再要求 depth==0，否则压住的那些永远不会解）
import { readFileSync, writeFileSync } from 'node:fs'

const hits = []
function patch(file, name, re, rep) {
  let s = readFileSync(file, 'utf8')
  const m = s.match(re)
  if (!m) { hits.push('skip ' + name); return }
  s = s.replace(re, rep)
  writeFileSync(file, s, 'utf8')
  hits.push('ok   ' + name)
}

// 1) brain.mjs：trip 条目带上窗口时长
patch('brain.mjs', 'brain pendingTripCues 带 spanMs',
  /pendingTripCues = \[\{ plan: win\.plan, label: win\.label, ttlMs: 2 \* 60 \* 1000 \}\]/,
  'pendingTripCues = [{ plan: win.plan, label: win.label, spanMs: win.spanMs, ttlMs: 2 * 60 * 1000 }]')

patch('brain.mjs', 'brain trip cue 带 durationMs',
  /performance: \[\{ slot: 'trip', id: t\.plan, at: 0 \}\],/,
  "performance: [{ slot: 'trip', id: t.plan, at: 0, durationMs: t.spanMs }],")

// 2) 游戏端：分发时把时长传进去
patch('game/src/PerformerPlugin.cs', 'cue dispatch 传时长',
  /else if \(cue\.slot == "trip"\) TriggerLeaveChair\(cue\.id\);/,
  'else if (cue.slot == "trip") TriggerLeaveChair(cue.id, cue.durationMs);')

patch('game/src/PerformerPlugin.cs', 'TriggerLeaveChair 签名',
  /private static void TriggerLeaveChair\(string planName\)/,
  'private static void TriggerLeaveChair(string planName, int holdMs)')

// 3) 触发成功后压住 gate
patch('game/src/PerformerPlugin.cs', '触发后压住 gate',
  /([ \t]*)Plugin\.Log\.LogInfo\("trip: 已交给游戏自己的状态机 DebugForceLeaveChair\(" \+ plan \+ "\)"\);/,
  '$1Plugin.Log.LogInfo("trip: 已交给游戏自己的状态机 DebugForceLeaveChair(" + plan + ")");\n'
  + '$1// 离座那段的字幕和语音是我们的：把它们按接管窗口压住，到点由 Tick 自己恢复。\n'
  + '$1float holdSec = holdMs > 0 ? holdMs / 1000f : 300f;\n'
  + '$1GameVoiceGate.Enter("trip " + planName, holdSec);')

// 4) Tick 不再要求 depth==0
patch('game/src/PerformerPlugin.cs', 'Tick 到点即恢复',
  /if \(!active \|\| depth > 0\) return;\r?\n([ \t]*)if \(Time\.unscaledTime < expireAt\) return;\r?\n([ \t]*)Restore\("超时兜底"\);/,
  'if (!active) return;\n$1if (Time.unscaledTime < expireAt) return;\n$2depth = 0;\n$2Restore("到点恢复");')

// 5) Exit 时把到期时间提前，立即恢复
patch('game/src/PerformerPlugin.cs', 'Exit 立即到期',
  /([ \t]*)depth--;\r?\n([ \t]*)if \(depth > 0\) return;\r?\n([ \t]*)depth = 0;\r?\n([ \t]*)Restore\("演出结束"\);/,
  '$1depth--;\n$1if (depth > 0) return;\n$1depth = 0;\n$1expireAt = 0f;\n$1Restore("演出结束");')

console.log(hits.join('\n'))
