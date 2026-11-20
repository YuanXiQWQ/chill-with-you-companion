// TripGuard 之前靠 WatchTick 喂养 Seen()，结果被误判成"她还在离座中"——
// 日志里明明白白是 novel_base_loop，却报"离座动画 0s 前还在播"。
// 历史状态不可靠，改成看当下：现在这一帧的 clip 是不是 leavechair。
//
// 重复触发的拦截其实已经有两道了：
//   1) TriggerLeaveChair 先挂起，IsGameIdle() 不认 leavechair —— 在离座就永远不算闲
//   2) 这里再看一眼实时动画，撞上了直接拒绝
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let src = readFileSync(P, 'utf8')
const before = src.length

// 1) 删 WatchTick 里的 Seen()
src = src.replace(/[ \t]*if \(live\.IndexOf\("leavechair", StringComparison\.OrdinalIgnoreCase\) >= 0\) TripGuard\.Seen\(\);\r?\n/, '')

// 2) 替换整个 TripGuard 类（按行找边界）
const lines = src.split(/\r?\n/)
const start = lines.findIndex((l) => l.includes('internal static class TripGuard'))
if (start < 0) { console.log('找不到 TripGuard'); process.exit(1) }
let depth = 0, end = -1
for (let i = start; i < lines.length; i++) {
  for (const ch of lines[i]) {
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0 && i > start) { end = i; break } }
  }
  if (end > 0) break
}
if (end < 0) { console.log('找不到 TripGuard 收尾'); process.exit(1) }

// 连同上方两行注释一起换掉
let from = start
while (from > 0 && lines[from - 1].trim().startsWith('//')) from--

const NEW = `    // 离座在途保护：不连点。判据是"当下这一帧在不在 leavechair 动画里"，
    // 不靠历史标志——历史标志被误判过一次（明明在看书，却报还在离座）。
    internal static class TripGuard
    {
        // 返回 true = 可以触发
        public static bool TryBegin(string planName)
        {
            var h = FindHeroineForWatch();
            if (h != null)
            {
                var infos = h.GetCurrentAnimatorClipInfo(0);
                if (infos != null && infos.Length > 0 && infos[0].clip != null)
                {
                    string live = infos[0].clip.name;
                    if (live.IndexOf("leavechair", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        Log.LogInfo("trip: 忽略 " + planName + " —— 她正在离座（" + live + "）");
                        return false;
                    }
                }
            }
            return true;
        }
    }`

lines.splice(from, end - from + 1, ...NEW.split('\n'))
src = lines.join('\n')
writeFileSync(P, src, 'utf8')
console.log('TripGuard 重写: 行 ' + (from + 1) + '..' + (end + 1))
console.log('长度 ' + before + ' -> ' + src.length)
console.log('残留 Seen=' + (src.split('TripGuard.Seen').length - 1))
