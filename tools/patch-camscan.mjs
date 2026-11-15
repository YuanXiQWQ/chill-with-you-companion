// 补丁 12（诊断）：把房间相机的情况打出来。
//
// 线索：`RoomCameraManager / Cameras_Animator` 里只有 `anim_startcamera` 这类 clip——
// 说明房间视角不是靠动画片段切的，而是靠"多台相机 + 代码切换"。
// 她离座时不换镜头，人就在书桌视角里做沙发动作 = 你说看到的那个样子。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let s = readFileSync(P, 'utf8')
if (s.includes('cam scan')) { console.log('  已打过'); process.exit(0) }

const re = /( *)Plugin\.Log\.LogInfo\("bones cached: "/
const m = s.match(re)
if (!m) throw new Error('锚点未命中')
const pad = m[1]
const add = [
  '',
  pad + '// cam scan：房间里有几台相机、谁管切换',
  pad + 'try',
  pad + '{',
  pad + '    foreach (var cam in Resources.FindObjectsOfTypeAll<Camera>())',
  pad + '    {',
  pad + '        if (cam == null || !cam.gameObject.scene.IsValid()) continue;',
  pad + '        Plugin.Log.LogInfo("cam scan: " + cam.gameObject.name + " enabled=" + cam.enabled',
  pad + '            + " goActive=" + cam.gameObject.activeInHierarchy + " depth=" + cam.depth.ToString("F1")',
  pad + '            + " pos=" + cam.transform.position.ToString("F2") + " parent=" + (cam.transform.parent == null ? "-" : cam.transform.parent.name));',
  pad + '    }',
  pad + '    foreach (var mb in Resources.FindObjectsOfTypeAll<MonoBehaviour>())',
  pad + '    {',
  pad + '        if (mb == null || !mb.gameObject.scene.IsValid()) continue;',
  pad + '        if (mb.GetType().Name.IndexOf("Camera", StringComparison.OrdinalIgnoreCase) < 0) continue;',
  pad + '        var t = mb.GetType();',
  pad + '        var fields = t.GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);',
  pad + '        int shown = 0;',
  pad + '        foreach (var f in fields)',
  pad + '        {',
  pad + '            if (f.FieldType != typeof(string) && f.FieldType != typeof(int) && f.FieldType != typeof(bool)) continue;',
  pad + '            object v = null;',
  pad + '            try { v = f.GetValue(mb); } catch { continue; }',
  pad + '            Plugin.Log.LogInfo("cam field: " + t.Name + "." + f.Name + " = " + v);',
  pad + '            if (++shown >= 12) break;',
  pad + '        }',
  pad + '        if (mb.transform.childCount > 0)',
  pad + '        {',
  pad + '            for (int ci = 0; ci < mb.transform.childCount && ci < 12; ci++)',
  pad + '            {',
  pad + '                var ch = mb.transform.GetChild(ci);',
  pad + '                Plugin.Log.LogInfo("cam child: " + t.Name + "/" + ch.name + " active=" + ch.gameObject.activeSelf',
  pad + '                    + " pos=" + ch.position.ToString("F2"));',
  pad + '            }',
  pad + '        }',
  pad + '    }',
  pad + '}',
  pad + 'catch (Exception ex) { Plugin.Log.LogInfo("cam scan failed: " + ex.Message); }',
].join('\r\n')
s = s.replace(re, (x) => add + '\r\n' + x)
writeFileSync(P, s.replace(/\r?\n/g, '\r\n'), 'utf8')
console.log('  ok cam scan')
