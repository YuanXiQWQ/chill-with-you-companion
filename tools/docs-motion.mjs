// 把 README 的「动作怎么演」整段换成预算式描述，并给 CHANGELOG 记一条重构。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const R = fileURLToPath(new URL('../', import.meta.url))
const readmePath = R + 'README.md'
const changelogPath = R + 'CHANGELOG.md'

let r = readFileSync(readmePath, 'utf8')
const start = r.indexOf('### 动作怎么演')
if (start < 0) throw new Error('README 没找到「动作怎么演」段')
const end = r.indexOf('\n### ', start + 10)
const sect = `### 动作怎么演（\`[motion]\`）

**一条原则：只用乘法，不用截断。**

播之前先把这段 clip 沿时间轴走一遍，量出它的**峰值幅度**与**峰值角速度**；然后
幅度超预算就按比例降混合权重、速度超预算就按比例放慢时间轴。乘法只改变大小、
不改变形状：动作要么原样、要么等比例缩小，不会变形、也不会多出次数。

| 参数 | 默认 | 含义 |
| --- | --- | --- |
| \`Speed\` | \`0.62\` | 基准播放速度 |
| \`SpeedCap\` | \`1.25\` | 为塞进 cue 的 \`d\` 最多加速到几倍；超过就按自己的节奏演完 |
| \`BodyDegBudget\` | \`26\` | 身体峰值幅度预算（度），超出部分按比例缩 |
| \`HeadDegBudget\` | \`15\` | 头/颈峰值幅度预算（度），比身体紧 |
| \`BodySpeedBudget\` | \`320\` | 身体峰值角速度预算（°/s），超了放慢时间轴 |
| \`HeadSpeedBudget\` | \`160\` | 头/颈峰值角速度预算（°/s） |
| \`MaxSlowdown\` | \`1.6\` | 最多放慢到 1/1.6 |
| \`Weight\` | \`0.72\` | 身体混合权重天花板 |
| \`HeadWeight\` | \`1\` | 头部权重再乘一个系数 |
| \`HeadFadeMs\` | \`320\` | 头/颈淡入淡出（ms），比身体长，点头才不生硬 |
| \`ReleaseMs\` | \`300\` | 演完回落到游戏姿势的时间 |
| \`MaxClipSec\` | \`8\` | 一条 cue 最多占用骨骼多久 |
| \`RepeatWindowMs\` | \`1500\` | 同一条 clip 在窗口内重复请求不再从第 0 帧重来 |
| \`FamilyGraceMs\` | \`1500\` | 同族续演窗口（\`X_start → X_loop → X_end\` 视为一条动作） |

> 为什么不再用限速 / 限幅 / 低通：截断会削平曲线峰值，削平处会在频域里长出谐波，
> 一次点头就被"裁"成好几次微点头——这正是 0.10.0 及更早版本越调越抽的原因。
`
r = r.slice(0, start) + sect + r.slice(end)
writeFileSync(readmePath, r, 'utf8')
console.log('  ✓ README 动作段已重写')

let c = readFileSync(changelogPath, 'utf8')
if (c.includes('预算 + 乘法')) {
  console.log('  · CHANGELOG 已有')
} else {
  const block = `## [Unreleased]

### 重构：动作管道改为「预算 + 乘法」

- **删除**整条截断链：\`MaxDegPerSec\`、\`HeadMaxDegPerSec\`、\`HeadLowPassHz\`、\`HeadFollowHz\`、\`HeadReversalHz\`、\`HeadDeadZoneDeg\`、\`HeadMaxDevDeg\`、\`HeadNodMaxDevDeg\`
- **新增**播前测量 \`MeasureAndPlan()\`：沿时间轴采样整段 clip，量出身体/头部的峰值幅度与峰值角速度，结果同步到 \`/game\` 的 \`motion\` 块
- **新增**预算式缩放：幅度超预算按比例降权重，速度超预算按比例放慢时间轴（\`BodyDegBudget\` / \`HeadDegBudget\` / \`BodySpeedBudget\` / \`HeadSpeedBudget\` / \`MaxSlowdown\`）
- 保留：\`SpeedCap\`（不为塞进 \`d\` 无上限加速）、\`RepeatWindowMs\`、\`FamilyGraceMs\`、\`MaxClipSec\`、\`ReleaseMs\`、\`HeadFadeMs\`
- 新增宽松 clip 名查找 \`LookupLoose()\`：\`X_loop\` 能命中 \`anim_X_loop\`，不再退化成整组重演

> 起因：「鬼畜点头 / 连点好几下」反复调不好，根因是截断型限制器在削平的峰处产生谐波。
> 改成乘法缩放后，动作只可能变小变慢，不会变多。

`
  const head = '## [Unreleased]'
  c = c.includes(head) ? c.replace(head, block.trimEnd()) : block + c
  writeFileSync(changelogPath, c, 'utf8')
  console.log('  ✓ CHANGELOG 记重构')
}
