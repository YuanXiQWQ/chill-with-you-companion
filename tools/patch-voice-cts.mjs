// HeroineVoiceController 只有四个字段，没有 AudioSource：
//   _isFinishedVoice / _voiceCancellationTokenSource / _heroineAnimater / _lastVoiceDateTime
// 说明它只管口型 + "说完了没"，真正播声音的是别处，而且受 _voiceCancellationTokenSource 控制。
// CancelVoice() 显然没碰那个 CTS（她照样在说），所以直接 Cancel 它。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let src = readFileSync(P, 'utf8')
const hits = []
function sub(name, re, rep, all) {
  const m = src.match(re)
  if (!m) { hits.push('skip ' + name); return }
  src = all ? src.split(m[0]).join(rep) : src.replace(re, rep)
  hits.push('ok   ' + name)
}

// 1) 新增硬取消方法（放在 Invoke0 之前）
sub('CancelVoiceHard',
  /([ \t]*)private static void Invoke0\(object target, string name, object arg\)/,
  `$1// CancelVoice() 只改口型状态，停不了正在播的语音；真正的开关是这个 CTS。
$1private static void CancelVoiceHard()
$1{
$1    if (voice == null) return;
$1    try
$1    {
$1        var f = voice.GetType().GetField("_voiceCancellationTokenSource",
$1            BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
$1        var cts = f == null ? null : f.GetValue(voice) as System.Threading.CancellationTokenSource;
$1        if (cts != null) cts.Cancel();
$1    }
$1    catch (Exception ex) { Plugin.Log.LogWarning("voice gate cts: " + ex.GetType().Name); }
$1    Invoke0(voice, "CancelVoice", null);
$1}
$1
$1private static void Invoke0(object target, string name, object arg)`)

// 2) 两处调用换成硬取消
sub('Enter 用硬取消',
  /[ \t]*Invoke0\(voice, "CancelVoice", null\);\r?\n(?=[ \t]*Invoke1|\s*active = true)/,
  '                    CancelVoiceHard();\n')

sub('Tick 用硬取消',
  /[ \t]*try \{ Invoke0\(voice, "CancelVoice", null\); \} catch \{ \}/,
  '                    try { CancelVoiceHard(); } catch { }')

writeFileSync(P, src, 'utf8')
console.log(hits.join('\n'))
console.log('残留 Invoke0(voice, "CancelVoice"): ' + (src.split('Invoke0(voice, "CancelVoice"').length - 1))
