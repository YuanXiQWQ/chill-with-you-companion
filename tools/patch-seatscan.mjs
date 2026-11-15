// 补丁 7（诊断）：把场景里像"沙发/床/长椅"的物体名与坐标打出来。
// 起因：`sofa_go` 的根位移是 0（clip 是原地动画），所以她永远走不到沙发——
// 要去沙发就得自己把角色根挪过去，先得知道沙发在哪。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let s = readFileSync(P, 'utf8')
const from = '                Plugin.Log.LogInfo("bones cached: " + list.Length + " under " + root.name);'
if (s.split(from).length - 1 !== 1) throw new Error('锚点未命中')
const to = `${from}
                // 找一找场景里像"能躺下"的东西：离座动画是原地动画（根位移 0），
                // 想真到沙发上去，得知道沙发在哪。
                try
                {
                    var all = Resources.FindObjectsOfTypeAll<Transform>();
                    int found = 0;
                    foreach (var tr in all)
                    {
                        if (tr == null || !tr.gameObject.scene.IsValid()) continue;
                        string nm = tr.name ?? "";
                        if (nm.IndexOf("sofa", StringComparison.OrdinalIgnoreCase) < 0
                            && nm.IndexOf("couch", StringComparison.OrdinalIgnoreCase) < 0
                            && nm.IndexOf("bench", StringComparison.OrdinalIgnoreCase) < 0) continue;
                        Plugin.Log.LogInfo("seat candidate: " + nm + " world=" + tr.position.ToString("F2")
                            + " parent=" + (tr.parent == null ? "-" : tr.parent.name) + " active=" + tr.gameObject.activeInHierarchy);
                        if (++found >= 12) break;
                    }
                    Plugin.Log.LogInfo("seat candidate total(capped)=" + found);
                    var self = root != null ? root : null;
                    if (self != null)
                        Plugin.Log.LogInfo("character root: " + self.name + " world=" + self.position.ToString("F2")
                            + " local=" + self.localPosition.ToString("F2") + " parent=" + (self.parent == null ? "-" : self.parent.name));
                }
                catch (Exception ex) { Plugin.Log.LogInfo("seat scan failed: " + ex.Message); }`
writeFileSync(P, s.replace(from, to).replace(/\r?\n/g, '\r\n'), 'utf8')
console.log('  ok 诊断补丁')
