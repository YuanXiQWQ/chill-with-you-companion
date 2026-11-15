// 修补丁 16 的两处：记录器自己找角色（不依赖 PerformerUI 的内部成员），启动器改 public static。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let s = readFileSync(P, 'utf8')
let hits = 0

// ① 不再用 PerformerUI.Instance
s = s.replace(
  `            var ui = PerformerUI.Instance;\r\n            var heroine = ui != null ? ui.Heroine : null;`,
  `            Animator heroine = null;\r\n            var chGo = GameObject.Find("Character");\r\n            if (chGo != null) heroine = chGo.GetComponent<Animator>();`,
)
hits++

// ② 启动器 public static，调用处加前缀
s = s.replace('private void EnsureWatcher()', 'public static void EnsureWatcher()')
s = s.replace('private WatchRecorder watcher;', 'private static WatchRecorder watcher;')
s = s.replace('    EnsureWatcher();', '    Plugin.EnsureWatcher();')
s = s.replace('AddComponent<WatchRecorder>()', 'AddComponent<WatchRecorder>()')
hits += 3

writeFileSync(P, s.replace(/\r?\n/g, '\r\n'), 'utf8')
console.log('  修 ' + hits + ' 处')
