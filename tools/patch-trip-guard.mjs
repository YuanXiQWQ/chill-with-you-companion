// 离座在途保护：她还在沙发上时不许再触发第二趟。
//
// 22:47 那次事故：一趟没走完又触发，游戏收到第二个指令直接 comeback；
// 随后 OnLeaveChairFinished() 又让她 base→go→loop 死循环——DebugForceLeaveChair
// 绕过了 LeaveChairJudge 的正常复位，HasLeaveChairPlan() 一直为真。
// 收场只能重启游戏，代价太大。所以在这里拦：
//   · 只要离座动画在播（WatchTick 每 0.4s 采样），就不许再触发；
//   · 离座动画 12 秒没出现 = 这一趟结束了，放行；
//   · 8 分钟硬上限：万一状态机真卡死，也不能让她永远不能离座。
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

const GUARD = `    // 离座在途保护：见 TriggerLeaveChair 上方注释
    internal static class TripGuard
    {
        private const float SettleSeconds = 12f;    // 离座动画 12 秒没出现 = 这一趟结束了
        private const float HardLimitSeconds = 480f; // 8 分钟硬上限，防状态机卡死
        private static bool inFlight;
        private static float lastSeenAt = -999f;
        private static float startedAt = -999f;

        // WatchTick 每 0.4s 看到离座动画就喂一次
        public static void Seen()
        {
            inFlight = true;
            lastSeenAt = Time.unscaledTime;
        }

        // 返回 true = 可以触发
        public static bool TryBegin(string planName)
        {
            if (inFlight)
            {
                float quiet = Time.unscaledTime - lastSeenAt;
                if (quiet < SettleSeconds)
                {
                    Log.LogInfo("trip: 忽略 " + planName + " —— 她还在离座中（离座动画 "
                        + quiet.ToString("F0") + "s 前还在播）");
                    return false;
                }
                float age = Time.unscaledTime - startedAt;
                if (age < HardLimitSeconds)
                {
                    Log.LogWarning("trip: 忽略 " + planName + " —— 上一趟没复位，等硬上限（已 "
                        + age.ToString("F0") + "s / " + HardLimitSeconds.ToString("F0") + "s）");
                    return false;
                }
                Log.LogWarning("trip: 上一趟超过 " + HardLimitSeconds.ToString("F0") + "s 没复位，强制放行");
            }
            inFlight = true;
            startedAt = Time.unscaledTime;
            lastSeenAt = Time.unscaledTime;
            return true;
        }
    }

`

// 1) TripGuard 类：插在 EnsureWatcher 之前（Plugin 类体内）
sub('TripGuard 类',
  /([ \t]*public static void EnsureWatcher\(\))/,
  GUARD + '$1')

// 2) WatchTick 喂状态
sub('WatchTick 喂 Seen',
  /([ \t]*)string sig = live \+ "\|" \+ camName/,
  '            if (live.IndexOf("leavechair", StringComparison.OrdinalIgnoreCase) >= 0) TripGuard.Seen();\n$1string sig = live + "|" + camName')

// 3) TriggerLeaveChair 入口拦截
sub('触发前拦截',
  /(\r?\n)( {16}Type aiType = null;)/,
  '$1                if (!Plugin.TripGuard.TryBegin(planName)) return;$1$2')

writeFileSync(P, src, 'utf8')
console.log(hits.join('\n'))
console.log('TripGuard 出现次数: ' + (src.split('TripGuard').length - 1))
