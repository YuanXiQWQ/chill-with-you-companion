// 一次性重构：离座不再由我们编排，改成调用游戏自己的状态机。
//
// 删掉的东西（全部是 2026-11-15 实测证伪的方向）：
//   · 自己搬角色根位移（TripWalk / tripFromWorld / tripToWorld / 走位 Lerp）
//   · 自己切房间相机（RoomView / CacheRoomCameras / SetRoomView / camDesk|Sofa|Bed）
//   · 自己找沙发锚点（FindTripAnchor / tripAnchor / tripAnchorSearched）
// 加上的东西：
//   · slot=trip 的 cue → TriggerLeaveChair(plan) → 反射调 HeroineAI.DebugForceLeaveChair
//
// 幂等：每一条都先判断"已改过"就跳过；锚点用正则，不吃缩进与行尾差异（CRLF/LF）。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let src = readFileSync(P, 'utf8')
out('start: ' + src.length + ' chars')

const hits = []
function sub(name, re, rep) {
  const m = src.match(re)
  if (!m) {
    // 已经改过 / 本来就没有
    const still = rep && typeof rep === 'string' && rep.length > 0 && src.includes(rep)
    hits.push((still ? 'done ' : 'skip ') + name)
    return
  }
  src = src.replace(re, rep)
  hits.push('ok   ' + name + '  -' + m[0].length)
}

const TRIGGER = `        // ── 离座：按游戏自己的开关，不再自己排演出 ───────────────────
        // 2026-11-15 实测（WatchTick + 反射通道）：
        //   Character 根全程 (2.74, 0.00, 1.70) 不动；
        //   HeroineService._currentPlace 全程 Desk（她正在播沙发动画时也是 Desk）；
        //   _heroineTransform 是空表 —— 游戏里没有可切换的摆位点；
        //   变的只有 AnimationType，由 HeroineStateLeaveChairGoSofa 的权重 + 秒表
        //   在 thinking(40~70s) / lookOutside(40~70s) / headphone(15~20s) 之间轮转，
        //   最后自己播 comeback。
        // 所以位移、镜头、时长从来不是我们的活：这里只按下开始。
        private static void TriggerLeaveChair(string planName)
        {
            try
            {
                Type aiType = null;
                foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
                {
                    var t = asm.GetType("HeroineAI", false);
                    if (t != null) { aiType = t; break; }
                }
                if (aiType == null) { Plugin.Log.LogWarning("trip: 找不到 HeroineAI，游戏版本可能变了"); return; }

                UnityEngine.Object ai = null;
                var found = Resources.FindObjectsOfTypeAll(aiType);
                if (found != null && found.Length > 0) ai = found[0];
                if (ai == null) { Plugin.Log.LogWarning("trip: HeroineAI 实例不存在"); return; }

                var mi = aiType.GetMethod("DebugForceLeaveChair",
                    BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                if (mi == null) { Plugin.Log.LogWarning("trip: HeroineAI.DebugForceLeaveChair 不存在"); return; }
                var ps = mi.GetParameters();
                if (ps.Length != 1 || !ps[0].ParameterType.IsEnum)
                {
                    Plugin.Log.LogWarning("trip: DebugForceLeaveChair 签名变了: " + (ps.Length > 0 ? ps[0].ParameterType.Name : "无参"));
                    return;
                }
                Type planType = ps[0].ParameterType;
                object plan = null;
                foreach (var n in Enum.GetNames(planType))
                {
                    if (string.Equals(n, planName, StringComparison.OrdinalIgnoreCase)) { plan = Enum.Parse(planType, n); break; }
                }
                if (plan == null)
                {
                    plan = Enum.GetValues(planType).GetValue(0);
                    Plugin.Log.LogWarning("trip: plan '" + planName + "' 不在游戏枚举里（"
                        + string.Join(",", Enum.GetNames(planType)) + "），回退到 " + plan);
                }
                mi.Invoke(ai, new object[] { plan });
                Plugin.Log.LogInfo("trip: 已交给游戏自己的状态机 DebugForceLeaveChair(" + plan + ")");
            }
            catch (Exception ex)
            {
                Plugin.Log.LogWarning("trip: 调用失败 " + ex.GetType().Name + ": " + ex.Message);
            }
        }

`

// 1) using System.Reflection
sub('using System.Reflection',
  /using System\.Collections\.Generic;\r?\n/,
  'using System.Collections.Generic;\nusing System.Reflection;\n')

// 2) 配置项
sub('config TripWalk+RoomView 声明',
  /[ \t]*public static ConfigEntry<bool> TripWalk;\r?\n[ \t]*public static ConfigEntry<bool> RoomView;\r?\n/,
  '')
sub('config TripWalk 绑定', /[ \t]*TripWalk = Config\.Bind\([^\n]*\r?\n/, '')
sub('config RoomView 绑定', /[ \t]*RoomView = Config\.Bind\([^\n]*\r?\n/, '')

// 3) 字段
for (const f of ['private Transform tripAnchor;', 'private bool tripAnchorSearched;', 'private bool tripWalking;',
  'private Vector3 tripFromWorld;', 'private Vector3 tripToWorld;',
  'private Camera camDesk;', 'private Camera camSofa;', 'private Camera camBed;']) {
  sub('field ' + f, new RegExp('[ \\t]*' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\r?\\n'), '')
}

// 4) 走位 Lerp
sub('walk lerp',
  /[ \t]*if \(tripWalking && bones != null && bones\.Length > 0\)\r?\n[ \t]*\{\r?\n[\s\S]*?\r?\n[ \t]*\}\r?\n/,
  '')

// 5) 相机缓存 + 换视角 + 沙发锚点 → 换成 TriggerLeaveChair
sub('room view block',
  /[ \t]*private void CacheRoomCameras\(\)[\s\S]*?(?=[ \t]*private void EnsureBones\(\))/,
  TRIGGER)

// 6) 走位 / 换房间视角的触发段
sub('trip walk block',
  /[ \t]*\/\/ 走位：去程送到沙发[\s\S]*?(?=[ \t]*\/\/ 分类：决定这一段的合成方式)/,
  '')

// 7) cue 分发：slot=trip → 交给游戏
sub('cue dispatch',
  /([ \t]*if \(cue\.slot == "animations"\) PlayAnim\(cue\.id, cue\.durationMs, cue\.holdMs\);\r?\n)/,
  '$1                else if (cue.slot == "trip") TriggerLeaveChair(cue.id);\n')

writeFileSync(P, src, 'utf8')
out(hits.join('\n'))
out('end: ' + src.length + ' chars')
out('残留检查: ' + ['TripWalk', 'RoomView', 'tripAnchor', 'tripWalking', 'tripFromWorld', 'camSofa', 'SetRoomView', 'CacheRoomCameras']
  .map((k) => k + '=' + (src.split(k).length - 1)).join(' '))

function out(s) { console.log(s) }
