// 记录器改成静态方法，挂在 PerformerUI.Update 上——它一定在跑（字幕就是它画的）。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let s = readFileSync(P, 'utf8')
if (s.includes('WatchTick')) { console.log('  已打过'); process.exit(0) }

// ① Plugin 里加静态 tick
const anchor = '    public static void EnsureWatcher()\r\n'
if (!s.includes(anchor)) throw new Error('锚点 EnsureWatcher 未命中')
s = s.replace(anchor,
  '    private static float watchNextAt;\r\n' +
  '    private static string watchLast = "";\r\n\r\n' +
  '    // 旁观记录：游戏自己演的时候，人往哪走、哪台相机在拍\r\n' +
  '    public static void WatchTick()\r\n' +
  '    {\r\n' +
  '        if (Time.unscaledTime < watchNextAt) return;\r\n' +
  '        watchNextAt = Time.unscaledTime + 0.4f;\r\n' +
  '        try\r\n' +
  '        {\r\n' +
  '            string live = "?";\r\n' +
  '            Vector3 rootPos = Vector3.zero;\r\n' +
  '            string camName = "-";\r\n' +
  '            var chGo = GameObject.Find("Character");\r\n' +
  '            var heroine = chGo != null ? chGo.GetComponent<Animator>() : null;\r\n' +
  '            if (heroine != null)\r\n' +
  '            {\r\n' +
  '                rootPos = heroine.transform.position;\r\n' +
  '                var infos = heroine.GetCurrentAnimatorClipInfo(0);\r\n' +
  '                if (infos != null && infos.Length > 0 && infos[0].clip != null) live = infos[0].clip.name;\r\n' +
  '            }\r\n' +
  '            var cam = Camera.main;\r\n' +
  '            if (cam != null) camName = cam.gameObject.name;\r\n' +
  '            string sig = live + "|" + camName + "|" + rootPos.ToString("F2");\r\n' +
  '            if (sig == watchLast) return;\r\n' +
  '            watchLast = sig;\r\n' +
  '            Log.LogInfo("watch: clip=" + live + " cam=" + camName + " root=" + rootPos.ToString("F2"));\r\n' +
  '        }\r\n' +
  '        catch (Exception ex) { Log.LogError("watch failed: " + ex); }\r\n' +
  '    }\r\n\r\n' +
  anchor)

// ② PerformerUI.Update 开头调它（那个 Update 一定在跑）
const upRe = /( *)private void Update\(\)\r?\n( *)\{\r?\n/
const m = s.match(upRe)
if (!m) throw new Error('锚点 Update 未命中')
const pad = m[1]
s = s.replace(upRe, (x) => x + `${pad}    Plugin.WatchTick();\r\n`)

writeFileSync(P, s.replace(/\r?\n/g, '\r\n'), 'utf8')
console.log('  ok')
