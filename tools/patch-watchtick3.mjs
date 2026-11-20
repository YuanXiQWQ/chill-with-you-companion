// 记录器找不到角色：GameObject.Find("Character") 拿不到（场景里的对象名/层级不是那样）。
// 改成和插件一样：扫所有 Animator，取 controller 名是 Character_Animator_ForScript 的那个。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let s = readFileSync(P, 'utf8')
if (s.includes('FindHeroineForWatch')) { console.log('  已打过'); process.exit(0) }

const from = '            var chGo = GameObject.Find("Character");\r\n            var heroine = chGo != null ? chGo.GetComponent<Animator>() : null;'
if (!s.includes(from)) throw new Error('锚点未命中')
s = s.replace(from,
  '            var heroine = FindHeroineForWatch();')

// 加一个查找方法（静态，放在 WatchTick 前面）
const anchor = '    private static float watchNextAt;\r\n'
if (!s.includes(anchor)) throw new Error('锚点 watchNextAt 未命中')
s = s.replace(anchor,
  '    private static Animator FindHeroineForWatch()\r\n' +
  '    {\r\n' +
  '        try\r\n' +
  '        {\r\n' +
  '            foreach (var an in Resources.FindObjectsOfTypeAll<Animator>())\r\n' +
  '            {\r\n' +
  '                if (an == null || an.runtimeAnimatorController == null) continue;\r\n' +
  '                if (!an.gameObject.scene.IsValid() || !an.gameObject.activeInHierarchy) continue;\r\n' +
  '                if (an.runtimeAnimatorController.name.IndexOf("Character", StringComparison.OrdinalIgnoreCase) < 0) continue;\r\n' +
  '                return an;\r\n' +
  '            }\r\n' +
  '        }\r\n' +
  '        catch { }\r\n' +
  '        return null;\r\n' +
  '    }\r\n\r\n' +
  anchor)

writeFileSync(P, s.replace(/\r?\n/g, '\r\n'), 'utf8')
console.log('  ok')
