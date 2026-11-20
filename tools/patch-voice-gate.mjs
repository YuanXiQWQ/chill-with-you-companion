// 演出期间让游戏闭嘴：我们的字幕/语音在播时，关掉游戏自己的自言自语与她的语音，播完恢复。
//
// 实测可写的两个开关（见 docs/离座真相.md §8）：
//   HeroineSelfTalkController._selfTalkProbability   int，默认 75
//   HeroineAI._heroineVoiceController
//     .CancelVoice() / .ChangeEnableHeroineTalkAnimation(bool)
//
// 幂等：每处先判断有没有打过。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let src = readFileSync(P, 'utf8')
const hits = []
function sub(name, re, rep) {
  if (new RegExp(rep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(src) && !re.test(src)) {
    hits.push('done ' + name); return
  }
  const m = src.match(re)
  if (!m) { hits.push('skip ' + name); return }
  src = src.replace(re, rep)
  hits.push('ok   ' + name + '  -' + m[0].length)
}

const GATE = `        // ── 演出期间让游戏闭嘴 ──────────────────────────────────────
        // 我们的字幕和语音在播的时候，游戏自己的"自言自语"（弹幕）和她自己的语音
        // 会一起出来，两套台词打架。这两个开关实测都能在运行时改：
        //   HeroineSelfTalkController._selfTalkProbability  int，默认 75
        //   HeroineAI._heroineVoiceController.CancelVoice() / ChangeEnableHeroineTalkAnimation(bool)
        // 演出开始关掉，结束恢复；depth 计数 + 超时兜底，免得协程被中断后一直关着。
        internal static class GameVoiceGate
        {
            private static int depth;
            private static float expireAt;
            private static bool active;
            private static int savedProbability = -1;
            private static object selfTalk;
            private static object voice;

            public static void Enter(string why, float holdSeconds)
            {
                depth++;
                expireAt = Time.unscaledTime + Mathf.Max(5f, holdSeconds);
                if (active) return;
                if (!Resolve()) return;
                try
                {
                    var pf = Field(selfTalk, "_selfTalkProbability");
                    if (pf != null)
                    {
                        savedProbability = (int)pf.GetValue(selfTalk);
                        pf.SetValue(selfTalk, 0);
                    }
                    Invoke0(voice, "CancelVoice", null);
                    Invoke1(voice, "ChangeEnableHeroineTalkAnimation", false);
                    active = true;
                    Plugin.Log.LogInfo("voice gate: 演出开始，游戏自言自语/语音已关（" + why + "）");
                }
                catch (Exception ex) { Plugin.Log.LogWarning("voice gate enter: " + ex.Message); }
            }

            public static void Exit()
            {
                depth--;
                if (depth > 0) return;
                depth = 0;
                Restore("演出结束");
            }

            // 每帧兜底：协程被停掉时没人调 Exit，靠这里恢复
            public static void Tick()
            {
                if (!active || depth > 0) return;
                if (Time.unscaledTime < expireAt) return;
                Restore("超时兜底");
            }

            private static void Restore(string why)
            {
                if (!active) return;
                try
                {
                    if (selfTalk != null && savedProbability >= 0)
                    {
                        var pf = Field(selfTalk, "_selfTalkProbability");
                        if (pf != null) pf.SetValue(selfTalk, savedProbability);
                    }
                    Invoke1(voice, "ChangeEnableHeroineTalkAnimation", true);
                    Plugin.Log.LogInfo("voice gate: 恢复游戏语音（" + why + "）");
                }
                catch (Exception ex) { Plugin.Log.LogWarning("voice gate restore: " + ex.Message); }
                finally { active = false; savedProbability = -1; }
            }

            private static FieldInfo Field(object target, string name)
            {
                if (target == null) return null;
                return target.GetType().GetField(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            }

            private static void Invoke0(object target, string name, object arg)
            {
                if (target == null) return;
                var mi = target.GetType().GetMethod(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                if (mi != null && mi.GetParameters().Length == 0) mi.Invoke(target, null);
            }

            private static void Invoke1(object target, string name, bool arg)
            {
                if (target == null) return;
                var mi = target.GetType().GetMethod(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                if (mi == null) return;
                var ps = mi.GetParameters();
                if (ps.Length == 1 && ps[0].ParameterType == typeof(bool)) mi.Invoke(target, new object[] { arg });
            }

            private static bool Resolve()
            {
                if (selfTalk != null) return true;
                try
                {
                    Type aiType = null;
                    foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
                    {
                        var t = asm.GetType("HeroineAI", false);
                        if (t != null) { aiType = t; break; }
                    }
                    if (aiType == null) return false;
                    var found = Resources.FindObjectsOfTypeAll(aiType);
                    if (found == null || found.Length == 0) return false;
                    object ai = found[0];
                    var f1 = aiType.GetField("_selfTalkController", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                    var f2 = aiType.GetField("_heroineVoiceController", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                    if (f1 != null) selfTalk = f1.GetValue(ai);
                    if (f2 != null) voice = f2.GetValue(ai);
                    if (selfTalk == null) Plugin.Log.LogWarning("voice gate: 拿不到 HeroineSelfTalkController");
                    return selfTalk != null;
                }
                catch (Exception ex) { Plugin.Log.LogWarning("voice gate resolve: " + ex.Message); return false; }
            }
        }

`

// 1) 类本体：插在 EnsureBones 之前（TriggerLeaveChair 之后）
sub('GameVoiceGate 类',
  /(?=[ \t]*private void EnsureBones\(\))/,
  GATE)

// 2) 队列播放：进入/退出
sub('播放进入 gate',
  /([ \t]*Plugin\.Log\.LogInfo\("queue: play seq=")/,
  '                GameVoiceGate.Enter("queue seq=" + item.seq, 30f);\n$1')

sub('播放退出 gate',
  /([ \t]*performing = false;\r?\n)(?=[ \t]*\}\r?\n)/,
  '$1                GameVoiceGate.Exit();\n')

// 3) 每帧兜底
sub('Tick 挂钩',
  /([ \t]*ReflectConsole\.Tick\(Plugin\.Log\);\r?\n)/,
  '$1                GameVoiceGate.Tick();\n')

writeFileSync(P, src, 'utf8')
console.log(hits.join('\n'))
console.log('GameVoiceGate 出现次数: ' + (src.split('GameVoiceGate').length - 1))
