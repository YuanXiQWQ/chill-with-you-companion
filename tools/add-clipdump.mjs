// 把游戏里的完整动画集导出到日志（只读，不改游戏文件）。
// 目的：编排要参考"游戏的全部动作"，而不是插件上报的那 352 条子集。
import { readFileSync, writeFileSync } from 'node:fs'
const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8')

if (!s.includes('clipdump')) {
  s = s.replace(`            Plugin.Log.LogInfo("clip assets indexed: " + clipAssets.Count);`,
`            Plugin.Log.LogInfo("clip assets indexed: " + clipAssets.Count);
            // clipdump：把完整动作集打到日志（含所属控制器与时长），供离线生成动作全表。
            // 纯输出，不碰任何游戏资源。
            if (Plugin.VerboseCues != null && Plugin.VerboseCues.Value)
            {
                var seenDump = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
                var animators2 = Resources.FindObjectsOfTypeAll<Animator>();
                foreach (var a2 in animators2)
                {
                    if (a2 == null || a2.runtimeAnimatorController == null) continue;
                    string owner = a2.gameObject != null ? a2.gameObject.name : "-";
                    string ctrl = a2.runtimeAnimatorController.name ?? "-";
                    foreach (var c2 in a2.runtimeAnimatorController.animationClips)
                    {
                        if (c2 == null || string.IsNullOrEmpty(c2.name)) continue;
                        if (!seenDump.Add(owner + "/" + c2.name)) continue;
                        Plugin.Log.LogInfo("clipdump " + owner + " " + ctrl + " " + c2.name + " " + c2.length.ToString("F3"));
                    }
                }
            }`)
  writeFileSync(p, s, 'utf8')
  console.log('  ✓ 增加 clipdump（VerboseCues 时输出完整动作集）')
}
