// 专注态（upperOnly）身体锁在游戏姿势，此时"绝对过渡"没有意义：
// 够不到 clip 的目标姿势，却把 clip 的绝对姿态硬套到头上 —— 实测一个 10.5° 的
// 喝水动作被推成 20.2° 偏移。规则：upperOnly 时一律按叠加处理。
import { readFileSync, writeFileSync } from 'node:fs'
const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8')

const old = `                Quaternion q;
                if (profile.Additive)
                {`
if (!s.includes(old)) throw new Error('合成分支锚点失配')
s = s.replace(old, `                Quaternion q;
                // 专注态只让头和颈动，身体被锁在游戏姿势 —— 这时追求"绝对姿势"是自欺：
                // 够不到目标，却把 clip 的绝对姿态套到头上（10.5° 的动作推成 20.2° 偏移）。
                bool useAdditive = profile.Additive || upperOnly;
                if (useAdditive)
                {`)
writeFileSync(p, s, 'utf8')
console.log('  ✓ 专注态强制叠加，不再套绝对姿势')
