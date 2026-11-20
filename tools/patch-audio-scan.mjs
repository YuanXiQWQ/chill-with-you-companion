// CTS 也没掐住 —— 说明声音根本不是那条协程在放。先别猜，把正在播的 AudioSource 抓出来。
// gate 压住期间每 0.5 秒扫一次，只扫前 16 次，避免持续开销。
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

sub('扫描调用',
  /[ \t]*try \{ CancelVoiceHard\(\); \} catch \{ \}/,
  `                    try { CancelVoiceHard(); } catch { }
                    ScanAudios();`)

sub('ScanAudios 方法',
  /([ \t]*)private static void CancelVoiceHard\(\)/,
  `$1// 诊断：谁在出声。gate 压住期间扫前 16 次。
$1private static int scanCount;
$1private static void ScanAudios()
$1{
$1    if (scanCount >= 16) return;
$1    scanCount++;
$1    try
$1    {
$1        var arr = Resources.FindObjectsOfTypeAll(typeof(AudioSource));
$1        var sb = new StringBuilder();
$1        int n = 0;
$1        for (int i = 0; i < arr.Length && n < 8; i++)
$1        {
$1            var a = arr[i] as AudioSource;
$1            if (a == null || !a.isPlaying) continue;
$1            n++;
$1            sb.Append(a.gameObject.name).Append('/')
$1              .Append(a.clip != null ? a.clip.name : "-")
$1              .Append("/v").Append(a.volume.ToString("F2"))
$1              .Append("/w").Append(a.isPlaying ? "1" : "0").Append(' ');
$1        }
$1        Plugin.Log.LogInfo("audio scan #" + scanCount + " playing=" + n + " -> " + sb.ToString());
$1    }
$1    catch (Exception ex) { Plugin.Log.LogWarning("audio scan: " + ex.GetType().Name); }
$1}
$1
$1private static void CancelVoiceHard()`)

writeFileSync(P, src, 'utf8')
console.log(hits.join('\n'))
