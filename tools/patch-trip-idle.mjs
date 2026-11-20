// 23:13:56 那次没走成：她在泡茶（anim_break_tea_sub_maker_*），DebugForceLeaveChair 调了
// 但游戏正忙子动作，直接把调用吞了 —— trip.log 记了 start，画面里没动。
//
// 改法：trip 请求先挂起，等 WatchTick 看到她回到 base 待机再真正 invoke；
// 30 秒还没闲下来就丢弃并在日志里说清楚。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let src = readFileSync(P, 'utf8')
const hits = []
function sub(name, re, rep) {
  const m = src.match(re)
  if (!m) { hits.push('skip ' + name); return }
  src = src.replace(re, rep)
  hits.push('ok   ' + name)
}

// 1) 让 PerformerUI 能拿到 heroine
sub('FindHeroineForWatch 可见性',
  /private static Animator FindHeroineForWatch\(\)/,
  'internal static Animator FindHeroineForWatch()')

// 2) TriggerLeaveChair 改成"挂起 + 等空闲"
sub('改名为 FireLeaveChair',
  /private static void TriggerLeaveChair\(string planName, int holdMs\)/,
  'private static void FireLeaveChair(string planName, int holdMs)')

sub('新增挂起入口',
  /([ \t]*)private static void FireLeaveChair\(string planName, int holdMs\)/,
  `$1// 请求入口：游戏可能在泡茶/翻书，这时候调会被吞掉，所以先挂起等它闲下来。
$1internal static void TriggerLeaveChair(string planName, int holdMs)
$1{
$1    if (!Plugin.TripGuard.TryBegin(planName)) return;
$1    pendingPlan = planName;
$1    pendingHoldMs = holdMs;
$1    pendingUntil = Time.unscaledTime + 30f;
$1    if (!TryFlushTrip())
$1        Plugin.Log.LogInfo("trip: " + planName + " 已挂起，等她回到待机再走（最多等 30s）");
$1}
$1
$1// 每帧试一次：空闲就点火
$1internal static bool TryFlushTrip()
$1{
$1    if (pendingPlan == null) return true;
$1    if (Time.unscaledTime > pendingUntil)
$1    {
$1        Plugin.Log.LogWarning("trip: " + pendingPlan + " 等空闲超时，丢掉这次请求");
$1        pendingPlan = null;
$1        return true;
$1    }
$1    if (!IsGameIdle()) return false;
$1    string plan = pendingPlan;
$1    pendingPlan = null;
$1    FireLeaveChair(plan, pendingHoldMs);
$1    return true;
$1}
$1
$1// 只看动画名：base/idle 结尾才算闲，_sub_ 这类子动作（泡茶、翻页、喝东西）算忙
$1private static bool IsGameIdle()
$1{
$1    var h = Plugin.FindHeroineForWatch();
$1    if (h == null) return true;
$1    var infos = h.GetCurrentAnimatorClipInfo(0);
$1    if (infos == null || infos.Length == 0 || infos[0].clip == null) return true;
$1    string n = infos[0].clip.name;
$1    if (n.IndexOf("leavechair", StringComparison.OrdinalIgnoreCase) >= 0) return false;
$1    if (n.IndexOf("_sub_", StringComparison.OrdinalIgnoreCase) >= 0
$1        && n.IndexOf("_end", StringComparison.OrdinalIgnoreCase) < 0) return false;
$1    return n.EndsWith("_base_loop", StringComparison.OrdinalIgnoreCase)
$1        || n.EndsWith("_base", StringComparison.OrdinalIgnoreCase)
$1        || n.EndsWith("_base_end", StringComparison.OrdinalIgnoreCase)
$1        || n.EndsWith("_idle", StringComparison.OrdinalIgnoreCase)
$1        || n.StartsWith("anim_story_base", StringComparison.OrdinalIgnoreCase);
$1}
$1
$1private static void FireLeaveChair(string planName, int holdMs)`)

// 3) 字段
sub('挂起字段',
  /([ \t]*)private static bool tripInFlight;\r?\n/,
  '$1private static bool tripInFlight;\n$1private static string pendingPlan;\n$1private static int pendingHoldMs;\n$1private static float pendingUntil;\n')

writeFileSync(P, src, 'utf8')
console.log(hits.join('\n'))
