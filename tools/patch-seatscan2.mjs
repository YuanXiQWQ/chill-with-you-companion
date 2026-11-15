// 补丁 7（诊断）：场景里像"沙发/床/长椅"的物体在哪、角色根在哪。
// 起因：`sofa_go` 的根位移是 0（原地动画），所以她走不到沙发。要过去就得自己挪角色根，
// 先得确认目标位置存在。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let s = readFileSync(P, 'utf8')
if (s.includes('seat candidate')) { console.log('  已打过'); process.exit(0) }

const re = /( *)Plugin\.Log\.LogInfo\("bones cached: " \+ list\.Length \+ " under " \+ root\.name\);/
const m = s.match(re)
if (!m) throw new Error('锚点未命中')
const pad = m[1]
const add = [
  '',
  pad + '// 离座动画是原地动画（根位移 0）：想真到沙发上去，得先知道沙发在哪。',
  pad + 'try',
  pad + '{',
  pad + '    int found = 0;',
  pad + '    foreach (var tr in Resources.FindObjectsOfTypeAll<Transform>())',
  pad + '    {',
  pad + '        if (tr == null || !tr.gameObject.scene.IsValid()) continue;',
  pad + '        string nm = tr.name ?? "";',
  pad + '        if (nm.IndexOf("sofa", StringComparison.OrdinalIgnoreCase) < 0',
  pad + '            && nm.IndexOf("couch", StringComparison.OrdinalIgnoreCase) < 0',
  pad + '            && nm.IndexOf("bed", StringComparison.OrdinalIgnoreCase) < 0) continue;',
  pad + '        Plugin.Log.LogInfo("seat candidate: " + nm + " world=" + tr.position.ToString("F2")',
  pad + '            + " active=" + tr.gameObject.activeInHierarchy + " parent=" + (tr.parent == null ? "-" : tr.parent.name));',
  pad + '        if (++found >= 10) break;',
  pad + '    }',
  pad + '    Plugin.Log.LogInfo("seat candidates=" + found + " charRoot=" + root.name + " world=" + root.position.ToString("F2")',
  pad + '        + " local=" + root.localPosition.ToString("F2") + " parent=" + (root.parent == null ? "-" : root.parent.name));',
  pad + '}',
  pad + 'catch (Exception ex) { Plugin.Log.LogInfo("seat scan failed: " + ex.Message); }',
].join('\r\n')
s = s.replace(re, (x) => x + add)
writeFileSync(P, s.replace(/\r?\n/g, '\r\n'), 'utf8')
console.log('  ok 诊断补丁')
