// CancelVoice 显然没停住她自己的语音（她还在说）。先看清 HeroineVoiceController 到底持有什么：
// 它持有 AudioSource 就能直接 Stop，否则得换通道。只在第一次进入时打一遍字段表。
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

sub('字段诊断',
  /([ \t]*)Invoke0\(voice, "CancelVoice", null\);/,
  `$1if (!diagDone && voice != null)
$1{
$1    diagDone = true;
$1    var sb = new StringBuilder();
$1    foreach (var f in voice.GetType().GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
$1        sb.Append(f.Name).Append(':').Append(f.FieldType.Name).Append(' ');
$1    Plugin.Log.LogInfo("voice gate: HeroineVoiceController 字段 = " + sb.ToString());
$1}
$1Invoke0(voice, "CancelVoice", null);`)

sub('diagDone 字段',
  /([ \t]*)private static float nextCancelAt;\r?\n/,
  '$1private static float nextCancelAt;\n$1private static bool diagDone;\n')

writeFileSync(P, src, 'utf8')
console.log(hits.join('\n'))
