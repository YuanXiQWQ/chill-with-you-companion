// 补丁 16：纯旁观记录器（不碰演出）+ 取消我自己强制的走位。
//
// 目的：让游戏自己演一次"离开椅子去沙发"，把它实际的 根坐标 / 相机 / clip 记下来，
// 而不是我继续猜。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let s = readFileSync(P, 'utf8')
if (s.includes('WatchRecorder')) { console.log('  已打过'); process.exit(0) }
let hits = 0

// ① 记录器类（放在 PerformerUI 前面，同命名空间）
const clsRe = /( *)internal class PerformerUI : MonoBehaviour/
if (!clsRe.test(s)) throw new Error('锚点 PerformerUI 未命中')
const pad = s.match(clsRe)[1]
const rec = [
  '// 纯旁观：游戏自己演的时候，人往哪走、哪台相机在拍。',
  'internal class WatchRecorder : MonoBehaviour',
  '{',
  '    private float nextAt;',
  '    private string last = "";',
  '    private void Update()',
  '    {',
  '        if (Time.unscaledTime < nextAt) return;',
  '        nextAt = Time.unscaledTime + 0.4f;',
  '        try',
  '        {',
  '            string live = "?";',
  '            Vector3 rootPos = Vector3.zero;',
  '            string camName = "-";',
  '            var ui = PerformerUI.Instance;',
  '            var heroine = ui != null ? ui.Heroine : null;',
  '            if (heroine != null)',
  '            {',
  '                rootPos = heroine.transform.position;',
  '                var infos = heroine.GetCurrentAnimatorClipInfo(0);',
  '                if (infos != null && infos.Length > 0 && infos[0].clip != null) live = infos[0].clip.name;',
  '            }',
  '            var cam = Camera.main;',
  '            if (cam != null) camName = cam.gameObject.name;',
  '            string sig = live + "|" + camName + "|" + rootPos.ToString("F2");',
  '            if (sig == last) return;',
  '            last = sig;',
  '            Plugin.Log.LogInfo("watch: clip=" + live + " cam=" + camName + " root=" + rootPos.ToString("F2"));',
  '        }',
  '        catch { }',
  '    }',
  '}',
].map((l) => pad + l).join('\r\n')
s = s.replace(clsRe, rec + '\r\n\r\n' + pad + 'internal class PerformerUI : MonoBehaviour')
hits++

// ② Plugin 里的启动器
const plugRe = /( *)public class Plugin : BaseUnityPlugin\r?\n *\{\r?\n/
if (!plugRe.test(s)) throw new Error('锚点 Plugin 未命中')
const ppad = s.match(plugRe)[1]
const launcher = [
  '',
  ppad + 'private WatchRecorder watcher;',
  '',
  ppad + 'private void EnsureWatcher()',
  ppad + '{',
  ppad + '    if (watcher != null) return;',
  ppad + '    var go = new GameObject("ChillPerformerWatch");',
  ppad + '    DontDestroyOnLoad(go);',
  ppad + '    watcher = go.AddComponent<WatchRecorder>();',
  ppad + '}',
  '',
].join('\r\n')
s = s.replace(plugRe, (x) => x + launcher)
hits++

// ③ Update 开头起一次
const upRe = /( *)private void Update\(\)\r?\n( *)\{\r?\n/
if (!upRe.test(s)) throw new Error('锚点 Update 未命中')
s = s.replace(upRe, (x) => {
  const p2 = x.match(/( *)\{\r?\n/)[1]
  return x + p2 + '    EnsureWatcher();\r\n'
})
hits++

// ④ 不再强制走位
s = s.replace('tripWalking = (isSofa || isBed) || (Plugin.TripWalk != null && Plugin.TripWalk.Value);',
  'tripWalking = (Plugin.TripWalk != null && Plugin.TripWalk.Value);')
hits++

writeFileSync(P, s.replace(/\r?\n/g, '\r\n'), 'utf8')
console.log('  补丁 ' + hits + ' 处')
