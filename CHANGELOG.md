## [Unreleased]

### 重构：动作管道改为「预算 + 乘法」

- **删除**整条截断链：`MaxDegPerSec`、`HeadMaxDegPerSec`、`HeadLowPassHz`、`HeadFollowHz`、`HeadReversalHz`、`HeadDeadZoneDeg`、`HeadMaxDevDeg`、`HeadNodMaxDevDeg`
- **新增**播前测量 `MeasureAndPlan()`：沿时间轴采样整段 clip，量出身体/头部的峰值幅度与峰值角速度，结果同步到 `/game` 的 `motion` 块
- **新增**预算式缩放：幅度超预算按比例降权重，速度超预算按比例放慢时间轴（`BodyDegBudget` / `HeadDegBudget` / `BodySpeedBudget` / `HeadSpeedBudget` / `MaxSlowdown`）
- 保留：`SpeedCap`（不为塞进 `d` 无上限加速）、`RepeatWindowMs`、`FamilyGraceMs`、`MaxClipSec`、`ReleaseMs`、`HeadFadeMs`
- 新增宽松 clip 名查找 `LookupLoose()`：`X_loop` 能命中 `anim_X_loop`，不再退化成整组重演

> 起因：「鬼畜点头 / 连点好几下」反复调不好，根因是截断型限制器在削平的峰处产生谐波。
> 改成乘法缩放后，动作只可能变小变慢，不会变多。

# 变更记录

本文件记录每个版本的可见变化。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 编排收敛：一个展开点（2026-11-15）

`planSequence` 与 `chainStartToLoop` 原来**都能决定下发内容**：前者把一条动作摊成
start→loop→end，后者再摊一次。于是同一段同 `at` 会下发两遍（第二句曾出现两条
`movie_sub_laugh_start@160`），而且规则加在前者会被后者覆盖 —— 改了没效果。

现在只有一条通路：

| 阶段 | 谁 | 只做什么 |
| --- | --- | --- |
| 排序 | `planSequence` | 定顺序、避开层切换、给过渡时间；**一条动作就是一条** |
| 展开 | `chainStartToLoop` | 定形态（手势单段 / 道具姿态位移整族）、延续（20s 内接 loop）、接队（queueAhead>0 时不出 `_start`） |
| 出口 | `dedupe` | 同 `slot|id|at` 只留一条 |

顺带修的分类 bug：`anim_break_tea_base_loop` 这类**场景 base 循环**被 token 里的 `tea`
判成 prop，编排会去"演她正在做的待机"。现在 `_(base|subbase\d*|idle|breath)(_loop)?$` 一律 idle，
`_single`（单段版）后缀判类前先剥掉。

回归：`run-tests` 21/21、`verify-motion` 36/36、`eval-motion 3` 18/18、`test-live` **14/14**。
`verify-motion` 新增两条钉子：「planSequence 只排不展开」「planSequence 不产出 loop 段」。
## 排队衔接：上一段收尾直接当下一段的起步（2026-11-15）

排队原来是「演完 → 归还待机 → 等 250ms → 下一套重新起手」，句与句之间必然有一个回待机的空档。
现在两头都做了检测：

| 端 | 检测 | 行为 |
| --- | --- | --- |
| 插件 | `HasAnimPending()`（逐帧） | 归还途中一来新动作，归还窗口压到 **50ms**；句间空档归零 |
| 插件 | 释放瞬间 | 她的最后姿势存进 `prevPose`，下一套以它起步（短淡入 120ms），`chainEntry` 标记 → 日志 `chain:` |
| 编排 | `queueAheadNow()` = 队列深度 + 是否正在演 | >0 时不发自己的 `_start`，直接给身体段（`_loop`/裸名），会话入队 |

顺带修掉一个老 bug：`planSequence` 与 `chainStartToLoop` 各自会补进入段，同一段同 `at`
会出现两次（第二句曾下发两条 `movie_sub_laugh_start@160`）。现在出口统一去重。

实测（两句同时发，第二句必然排在第一句后面）：

```
queue: play seq=…354 depth=0 waited=0.2s
handoff dev=0.00deg rel=50ms pending=1     ← 归还被压到 50ms
chain: 下一套接上（起点=当前姿势）
queue: play seq=…355 depth=0 waited=3.1s   ← 上一套真的演完了才放
handoff dev=0.00deg rel=713ms pending=0    ← 队里空了，恢复按距离伸缩的归还
```

`waited=3.1s` 就是"动作完整播完之后再放下一套"的证据：第二条从入队到起手等了整整一个动作时长。
`rel=50ms` 与 `rel=713ms` 的对比说明归还窗口是跟着队列状态走的，不是固定值。

回归：`run-tests` 21/21、`verify-motion` 36/36、`eval-motion 3` 18/18、`test-live` 13/13。
## 编排按内容定形态，动作不再"每句话做一个完整动作"（2026-11-15）

解绑之后还剩下三处不自然，都用游戏自己的行为校正：

| 问题 | 之前 | 现在 |
| --- | --- | --- |
| 手势被摊成整族 | 点头也走 `start→loop→end`，2327→5160ms | 手势只演自己那一段（2167ms） |
| 同一件事重复起手 | 刚喝完茶，下一句又 `start→loop→end` 重来一遍 | 同族 20s 内延续：只 hold 它的 `loop`（1167ms，带 `continued` 标记） |
| 动作规模与内容无关 | 短应答与长叙述一样铺满 5 秒 | 形态由类别决定：手势=单段，道具/姿态/位移=整族 |

实现落在真正执行编排的函数 `chainStartToLoop`（`planSequence` 只做排序与冲突串行化，
之前改在它上面会被后面的展开覆盖掉——这也是"改了没效果"的老坑）。
`perfMemo` 记住上一段的家族与时间，跨句延续；超过 20s 视为冷了，重新起手。

实测：

```
喝茶        4327ms  drink@160+1833  drink_loop@1993+1167  drink_end@3160+1167
接着喝      1327ms  drink_loop@160+1167 (续)
点头        2327ms  sub_nod@160+2167
打哈欠      5793ms  yawn_1_start@160+2333  loop@2493+300  end@2793+3000
```

回归：`run-tests` 21/21、`verify-motion` 36/36、`eval-motion 3` 18/18。
## 表演与语音解绑，只有口型跟音频（2026-11-15）

之前身体是"追着语音走"的：静音时长短就压缩、长就重复循环，同一句话说快说慢她会演得不一样。
现在**表演按游戏自己的节奏**，口型仍然严格跟音频。

四处耦合逐一解开：

| 位置 | 之前 | 现在 |
| --- | --- | --- |
| `planSequence` 三段展开 | `loop` 按说话长度重复 `ceil(speech/loop)` 次 | `loop` 只走**一拍**（夹到 300–2600ms） |
| `brain.chainStartToLoop` | `end` 挂在"语音结束前"，`loop` 填满空隙 | `end` 紧接 `loop`；整组 >9s 才不插循环 |
| `brain.normalizeCueTiming` | 起手时刻按语音窗口归一化压缩 | 只保证组内顺序 + 相邻动作 ≥160ms 间隔 |
| 插件 `clipLen` | 指令 `durationMs` 可把 clip 撑到 **1.35 倍** | 取 clip 自然时长（`natural`） |

留下的 `durationMs` 只有两个用途，都与表演无关：语音播放（`hold = 语音时长 + 1.2s`）与口型帧表。

离线证明（同一条动作，语音 1.5s / 4s / 12s）：

```
语音  1500ms → 表演 4767ms  start@0+1167  loop@1167+2600  end@3767+1000
语音  4000ms → 表演 4767ms  start@0+1167  loop@1167+2600  end@3767+1000
语音 12000ms → 表演 4767ms  start@0+1167  loop@1167+2600  end@3767+1000
```

游戏内实测时间线（全部只由游戏的段时长决定）：

```
break_movie_sub_laugh  start@160+1500 loop@1660+2500 end@4160+1000  = 5160ms
break_tea_sub_drink    start@160+1833 loop@1993+1167 end@3160+1167  = 4327ms
break_yawn_1           start@160+2333 loop@2493+300  end@2793+3000  = 5793ms
```

顺带把 `verify-motion` 的旧断言（"三段覆盖说话长度"）改成两条新不变量：
**同一条表演在 1.5s 与 12s 语音下时间线完全一致**、**loop 只走一拍**。现在 36/36。
## 起手与回归：按「插入」来做（2026-11-15）

我们是插进游戏里的表演，不是接管的动画机。两头都要自己负责：

- **起手**：`CaptureGamePose()` 让 Animator 当场求值再读，从她此刻的姿势进（之前用的是可能过期的缓存）。
- **回归**：目标改成**游戏正在跑的那段待机，每帧重取**，淡出追着移动的目标走，最后一帧精确落位。
  固定快照 + 固定 300ms 收回 = 交回一个死姿势，实测交接差 22.58°。
- 归还时长按真实距离给：`clamp(0.30 + maxDeg/180, 0.30, 0.90)`。

实测交接差：`drink 0.00°` / `yawn 0.71°` / `nod 0.00°`，归还 747–898ms。

被证伪并记录的做法：**直接改游戏正在跑的待机**（`Animator.CrossFadeInFixedTime`）——
它认的是状态名，我们只有 clip 名，8/8 次 `held=False`，且游戏自己的待机状态机会继续推进。
详见 `docs/起手与回归.md`。
## 参考游戏完整动画（2026-11-15）

之前编排只认识 389 条子集。现在把游戏运行时能被驱动的**全部动作**导出来当依据：

- `clipdump`（VerboseCues 时输出，纯只读）→ `tools/collect-clips.mjs` → `game/clips.full.json`
  **477 段动作 / 243 个家族**（另有 71 段椅子、笔、环境物、UI 的 clip）。
- `tools/gen-anime-table.mjs` → `docs/动画全表.md`（人看）+ `lib/game-grammar.json`（编排用）。
- 看清的三件事：
  1. 家族形态：`start+loop+end` 48、`single` 154、纯 `loop` 20、其它 21 —— 三段式是游戏自己的"进入→保持→退出"。
  2. **坐姿由椅子给**：`m_Chair_mobile` 上 71 段 clip 负责把她带到座位上，演坐着的事不用再补坐姿。
  3. 非表演类必须排除：`ui_*`（`ui_levelup_none` 60 秒）、`env_*`（摩天轮 600 秒）、`start*` 开场运镜、
     `item_*` 翻页 —— 当动作发下去她会"消失"或定格一分钟。已加 `isPerformanceClip()`，清单与候选都过滤。

分类同时补齐：揉眼睛/听歌/转笔 → 手势，翻页/转笔 → 道具，`X_base` 段 → 待机
（注意 `base001` 是子动作名，不是基础姿态，按 token 匹配会把整族判错，已改成按**段名后缀**判）。

全量语法表落地后回归：`node tools/verify-motion.mjs` 35/35、`node tools/run-tests.mjs` 21/21、
`node tools/eval-motion.mjs 2` 12/12（类别与内容全对）。
## 游戏内实测修的四条（2026-11-15，开着游戏量出来的）

判据只有一条：**规划侧预测的幅度，等于落地后的幅度**。都带日志证据。

1. **叠加基底自乘**（首段点头 `peakHead=10519dps dev=119.6°`）
   叠加路径每帧把 `bones[i].localRotation` 抓进 `gameRot`，而那个值上一帧刚被我们写回。
   于是 `delta` 每帧乘自己，越滚越大。修法：缓存"游戏自己的待机姿势"，演出期间只读不抓。
   → 实测 `18dps / 0.0°`，规划侧预测 6°。

2. **交叉淡化起点错**（整场第一段从 identity 淡入）
   `prevPose` 抄的是 `lastRot`（我们自己写的），首段时它是恒等式，淡入等于把骨架从
   identity 拉到待机。修法：当场读 rig 的真实 `localRotation`，并用 `prevPoseValid` 把关。
   → 骨架不再被"搬"一次。

3. **`upper` 的语义错了**（喝水只剩歪头 3~10°）
   两处叠加出这个结果：`scopeFor` 按**名字**判范围（不是 `_base`/`wild_` 就 `upper`），
   而 `upper` 的实现是**硬锁非头骨**——抬手动作被吞掉。
   修法：范围跟着**类别**走（道具/姿态/位移 → `full`，手势 → `upper`）；
   `upper` 语义改为"只叠加、不搬身体"，删掉硬锁。
   → 喝水 `push body=78.7°`，与规划侧 78.7° 一致，前臂 `Character_LeftForeArm` 真的抬起来了。

4. **绝对过渡在专注态没有意义**
   专注时身体锁着，够不到 clip 的目标姿势，却把它的绝对姿态套到头上（10.5° 的动作推成 20.2° 偏移）。
   修法：`useAdditive = profile.Additive || upperOnly`。

验收口径同时改了：`dps` 用真实帧间隔算，帧一抖就失真（同一段能读到 13 和 32），
所以新增 `push=head/body` 幅度字段与 `plan=` 并排打印，用**幅度**对账。
叠加类现在逐条对得上（0.4° 内），绝对类的峰值 dps 落在 13–74（修复前 10519）。
## 编排层：照游戏自己的语法演（2026-11-15）

**分类**（`game/src/MotionClass.cs` + `lib/motion-class.js`，两端同口径）
- 五类：手势 / 道具 / 姿态 / 位移 / 待机。分类决定**合成方式**：手势走叠加（游戏待机永远做底，身体不会被搬走），道具与姿态走绝对过渡（手要真的够到杯子），位移独占且不变速。
- 分类改为 **token 匹配**：`anim_*_lookpenguin` 不再因为里面有 `pen` 被判成道具。

**过渡**（`MotionRules.TransitionMs`）
- (当前类别 → 目标类别) 的过渡时长矩阵；她此刻在演什么，决定了下一段怎么接进来。

**编排**（`lib/game-grammar.js` + `brain.mjs`）
- 从 `assets.seed.json` 反向还原游戏自己的语法并存成 `lib/game-grammar.json`：5 个场景层（剧情动作/站立动作/休息/工作/表情）、46 个三段式家族、单段动作中位 4.0s、loop 段中位 1.9s。
- 编排按这套语法走：层锁定（不在同一层就记 `layer-switch` 并留过渡）、三段展开（start → loop 按说话长度重复 → end）、**用游戏自己的时长**，不再为塞进 cue 的 `d` 而加速。

**内容闸门**（`enforceContentClass`）
- 内容明确指向某类（喝/写/累/走）而模型选的类别完全不符时，按类别 + 话题 + 动词 token 从动作库里换一条；只换"完全不符"，模型的部分正确选择不动。
- 闸门返回的必须是清单里真实存在的 id（家族名 `anim_x` 往往不在清单里，下发过去游戏端找不到 clip）。

**联调修复**
- 编排先前接在 `spark()` 里且用了未定义的 `text`，异常被 catch 吞掉 → 编排与闸门从未真正执行。现在接在 `runTurn` 的 cue 组装之后、沙箱分支之外，`/act` 的 `sandbox:true` 轮次也能验证。
- 游戏端首次拉取不再无条件丢弃 backlog：改按 `interop.BacklogTtlMs`（默认 20s）只丢旧账，刚推的指令照演——测试不用再重推两三次。
## [0.10.1] - 2026-11-15

游戏端：合成语音接进游戏自己的混音器。

### 新增

- 语音源挂到游戏的 `AudioMixerGroup`：游戏里「语音」那一路的音量与静音对她生效，不再是插件自己的一条独立音量
- 回退链 `voice → master → 不挂`：组名对不上时自动降级，最坏情况退回原来的独立输出，**不会因此没声**
- `[audio]` 三个新配置：`FollowGameMixer`（默认开）、`MixerGroupMatch`（默认 `voice`）、`MixerGroupFallback`（默认 `master`）
- `/chill/v1/game` 增加 `mixer` 字段，报出实际挂到哪一组；首次解析把候选组写一行日志，便于核对

### 修复：鬼畜点头

- 头部单独限速 `motion.HeadMaxDegPerSec`（默认 110°/s，身体仍 300°/s）+ 单独淡入淡出 `HeadFadeMs`
- `motion.SpeedCap`（默认 1.25）堵住"为塞进 cue 时长把动作加速到 6×"的路径
- 同一组 `start/loop/end` 改成**接着演**：`FamilyGraceMs` 内到达就沿用同一条时间线，淡入从 0.45s 压到 0.12s（组内三次起手是点头的主因）
- 同一条动作在演时又被点名 → 跳过（`RepeatWindowMs`），不再从第 0 帧重来
- 演完不立刻交还骨骼，改用 `ReleaseMs` 平滑收尾
- `motion.MaxClipSec`（默认 8）防整组拖尾二十秒
- 头部驱动换成一阶低通 → **临界阻尼弹簧**（`motion.HeadSpringHz` 默认 1.0Hz）：旧做法对“快而小”的信号只削幅度、跟得很紧，观感就是高频抽动；弹簧有质量，快信号推不动它
- `motion.HeadWeight`（默认 1.0）：头/颈完全交给 clip，游戏自身待机摆动不再以 28% 权重漏进来变成"几乎没位移的抽动"
- 幅度上限从硬钳位改 `tanh` 软饱和（边界不再抖）；换段处 180ms 交叉淡化，段与段之间不再跳一下
- 点头频率再做一层：`motion.HeadLowPassHz`（默认 1.2Hz 一阶低通）+ `HeadMaxDevDeg`（14°，nod/shake 族 8°），并把循环段重放从最多 5 遍收到最多 2 遍、短于 0.45s 的循环只演一遍
- 短 id（无 `anim_` 前缀）自动补全；分段名查不到时不再退化成一整组
- `[motion]` 现场走 `/chill/v1/game` 的 `motion` 字段（`played` / `skippedRepeat` / `speedCapped`）

### 新增：表演排队

- 表演端改成**本地队列**：大脑端与表演端各排各的队、互不同步，指令到一条排一条，严格先来先演
- **不打断**：正在说的那句一定说完；新的一句只排队，不掐断上一句
- 游戏自己在演剧情时让台，队内条目按 TTL 过期，不补播旧话
- `[queue]` 段四个配置：`Enabled` / `Max`（默认 4，满了丢最旧）/ `TtlMs`（默认 20 秒）/ `GapMs`（默认 250 毫秒）
- `/chill/v1/game` 的 `queue` 字段报 `depth` / `played` / `dropped` / `expired` / `maxDepth`；`/chill/v1/health` 的 `queue` 报大脑端自己的水位
- `Enabled=false` 回到旧行为（只演最新一条），是现成回滚开关
### 变更

- `[audio] Volume` 的语义从「绝对音量」改为「在游戏那一路电平之上再乘的系数」，默认仍 0.85

### 修复

- 语音音量与游戏面板脱钩：此前拉低或静音游戏语音，她照样以固定音量说话
## [0.10.0] - 2026-11-14

### 新增

- **一条命令自检全链路**：`node tools/doctor.mjs` 一次跑完 12 项检查（运行时 / 仓库 / 数据目录 / 游戏本体 / 游戏端 / token 同步 / 侧车 / 宿主 / 路由 / 版本 / 模型 key / 语音），逐项给出结论与该执行的命令。**只读**——不生成 token、不写配置、不改 dll，可以反复跑。
- **给它一个 agent 能读的输出**：`--json` 返回单个 JSON 对象，每项带 `status`（`pass` / `warn` / `fail` / `skip`）、`detail`（路径、数量、在线状态等现场）、`fix[]`（该执行的命令），外加汇总的 `next[]`。装坏了不用猜，把这份输出交给替你装机的那位就行。

### 文档

- `AGENTS.md` 的故障排查改成可执行的样子：先跑自检 → 按 `next[]` 逐条处理 → 复检；症状对照表加了「自检里看哪一项」一列，并写明允许碰哪些文件、不许碰哪些。
- `README.md` 增加**权限边界**一节：能动的只有游戏端插件与配置、数据目录、本仓库自身；游戏本体、系统目录、其它 profile 一律不碰。
- `ARCHITECTURE.md` 增加**陪伴上下文**一节：上下文按「稳定前缀 → 易变状态 → 记忆窗口 → 本轮输入」四层裁剪，附新增状态量的四条判据。

### 修复

- 自检不再按字面拼 `_Data` 目录（实际的 Unity 数据目录跟着 exe 名走），避免把正常安装误报成残缺安装。
## 重构（续四）：外围路由收尾，brain.mjs → 2,267 行（累计 −26.2%）

这一轮补搬五组，并**明确划出停止线**：

| 模块 | 搬走的路由 |
| --- | --- |
| `routes/audio.mjs` | `/chill/v1/audio`（`?name=` 与路径两种形态） |
| `routes/mood.mjs` | `/chill/v1/spark` · `/chill/v1/ambient` |
| `routes/persona.mjs` | `/chill/v1/persona` |
| `routes/admin.mjs` | `/chill/v1/admin/game` · `/admin/game/launch` |
| `routes/admin-voice.mjs` | `/chill/v1/admin/voice`（动词仍由 brain 注册） |

- `/observe` + `/context` **试搬后回滚**：185 行要注入 25 个内部件，搬出去只是把闭包摊成参数表，
  架构没变好还把"一轮怎么走"拆散了。判据写进 ARCHITECTURE：读写内部件 > 6 个就留在 brain
- `admin-voice` 是个例外形态：`start/stop/restart` 三个动词由 brain 在注册后继续用 `voiceAction` 挂，
  所以模块 `return { voiceAction }` 交回注册器，调用点一行没改
- 提取器（临时脚本）踩到的坑：`--imports "join:node:path"` 按冒号 `split` 会得到 `from != node`，
  `node --check` 通过、一 import 就 `ERR_MODULE_NOT_FOUND: Cannot find package node`。改成按第一个冒号切
- `test/route-registry.test.mjs` 扩到 11 组 / 14 条路径，并单独确认 `admin-voice` 真的把 `voiceAction` 交回来
  （否则 brain 里三个语音动词会静默消失——这类"少注册一条"的错，只有守门测试能提前抓到）
## 重构（续三）：声线库与知识库路由外迁，brain.mjs → 2,441 行

- `routes/voices.mjs`：`/chill/v1/voices` 整条（列表 / 新建 / 激活 / 上传参考音频 / 试听 / 删除）。
  试听段要 `mkdir -p audio/` 再落 wav，目录从 deps 注入，不在模块里重新推导
- `routes/kb.mjs`：`/chill/v1/kb` 整条（230 行，本轮最大一块）。检索与存储都在 `lib/kb.mjs`，
  这段只管 HTTP 形状
- 累计：`brain.mjs` 3,072 → 2,441 行（−631，−20.5%），路由 31 条不变、拆成 6 个文件
- 两个搬家期的坑：
  1. 判断"import 加没加"时用了 `includes("registerVoiceRoutes")`，而调用点本身就会命中 → import 没写进去，
     侧车起来第一行就 `ReferenceError: registerVoiceRoutes is not defined`。改成匹配完整的 import 语句
  2. `test/hygiene.test.mjs` 只在 `brain.mjs` 里数路由，搬走 7 条后报"路由太少：24"。改成 brain + `routes/*` 合起来数
- 新增 `test/route-registry.test.mjs`：用最小依赖把六组路由各注册一遍，校验路径不缺不重、不回 brain，
  并断言注册点下限（注册点 ≠ 路由条数：有的注册点用前缀一次覆盖多条）
## 重构（续二）：角色卡与资源清单路由外迁，brain.mjs → 2,741 行

- `routes/characters.mjs`：`/chill/v1/characters`（列表 / 详情 / 保存 / 新建 / 激活）。
  激活会改"当前人设"，但人设本体留在 brain——模块只调注入的 `setPersona` 写回一处
- `routes/assets.mjs`：`/chill/v1/assets` + `assetReport`。清单本体留在 brain，模块经
  `getManifest` / `setManifest` 动它；空清单依然一律拒收（上报失败不能把已有清单清空）
- 这次没立 `personaStore` / `assetStore`：状态留在原处、只把代码搬走，比分家更省事且没有双份状态
- 搬家时抓到一处只在运行时报的错：模块里还留着 `manifest = next` / `manifestSize(manifest)`，
  而 `manifest` 是 brain 的变量 → `POST /chill/v1/assets` 直接 500 "manifest is not defined"。
  冒烟当场红，改成 `setManifest(next)` / `manifestSize(next)`。
  查这类问题的办法：拿假 ctx 起一遍 brain，POST 同一个载荷，把响应体打出来——比看 500 猜快得多
- 新增 `test/route-groups.test.mjs`：角色卡激活必须调一次 `setPersona`、资源空清单必须 400 且不广播、
  正常上报要落盘+广播+刷新内存，并锁住"路径不许再回 brain.mjs"与"人设只有一个写入口"
## 重构（续）：路由开始外迁，brain.mjs 3,072 → 2,823 行

- `routes/panel.mjs`：`/chill/v1/llm`（控制台「模型」页的读写口）整条搬走。
  选它打头是因为 handler 只碰注入进来的 `llm`，不读写 brain 内部状态，可以整块搬
- `routes/avatar.mjs`：`/chill/v1/avatar` 整条搬走，目录约定（`data/avatar` / `defaults` / `characters/avatars`）
  与 `AVATAR_MAX` / `isPng` 一起进模块；`readBinary` 提到 `lib/http.mjs`（声线上传也用同一份）
- brain 侧只剩两次注册调用，位置与原注册点一致（`kind: prefix` 的匹配顺序不受影响）
- 搬家时踩到两个只在运行时才炸的坑：`rmSync` 在 `node:fs` 而不在 `node:fs/promises`（`node --check` 通过、
  一 import 就 SyntaxError）；`cfg.dataDir` 在模块里不存在，改成注入的 `dataDir`
- 新增 `test/routes.test.mjs`：用假 ctx/caps 把路由取出来，直测 401、GET、POST action 分支、
  头像上传/读取/reset，并锁住"这两条路径不许再写回 brain.mjs"
## 重构：brain.mjs 拆出两块（3,072 → 2,930 行）

- `lib/state-file.mjs`：`state.json` 的加载、白名单合并、写前对账、原子落盘。
  从 brain 里搬走 `loadState` / `saveState` 共 84 行，附带两条硬规则（外部编辑优先、tmp+rename）。
  brain 侧只剩 `const state = stateFile.state` 与 `loadState` / `saveState` 两个别名，调用点一行没改
- `lib/model-client.mjs`：请求体拼装、重试、跨 provider 降级、用量记账回调（依赖注入）。
  搬走 `callModel` 共 67 行。注意工厂要放在 `recordUsage` 之后——引用在调用时求值，声明在后就是 TDZ 报错
- 拆的过程中真抓到一个 bug：`nowIso()` 没跟着搬过去，`save()` 一写就抛、被 catch 吞掉，
  表现是「state.json 根本不生成」而日志里只有一行 save failed。冒烟用例「focus_start 之后 state.json 真的写了 phase」立刻红了
- 新增两个直测文件：`test/state-file.test.mjs`（默认值 / 白名单 / 原子写 / 外部编辑优先 / 坏文件隔离）、
  `test/model-client.test.mjs`（假 fetch 测重试与降级、请求体开关、无 key 报错）
- 路由注册**没搬**，原因写进 ARCHITECTURE.md「拆分边界」：handler 直接闭包改 `persona` / `manifest`，
  得先有 owner 对象才能动，不是机械位移
## 安全：本机任何进程都能读她的记忆（`cfg.token` 为空即放行）

- 根因：`lib/http.mjs` 的 `createAuth(cfg)` 在 `cfg.token` 为空时直接 `return true`，
  而 `lib/config.mjs` 的默认值就是 `token: ''`。结果：本机任何进程/脚本 `curl 127.0.0.1:10723/chill/v1/chat`
  都能读到全部聊天记录、状态、知识库
- 现在：`cfg.token` 为空 = **全部拒绝**；比较走 `sha256` + `timingSafeEqual`（常数时间，不泄漏前缀长度）；
  `Bearer` 与 `x-chill-token` 两种头都认
- token 自动生成：`resolveToken()` 优先级 **配置 `token` → `CHILL_TOKEN` → `<数据目录>/token`**；
  文件不存在时生成 32 字节随机（64 位 hex），`mode 0o600`
- 三条调用路径都已接上：宿主反代给侧车的请求由 `index.js` 统一贴 `x-chill-token`（面板不持有 token）；
  快捷浮窗的页面地址由侧车拼成 `/chill/quick?t=<token>`，页面转成请求头；游戏端读 BepInEx 配置的 `brain.Token`
- 新增 `tools/sync-token.mjs`：把本机 token 写进游戏端 `BepInEx/config/local.chill.performer.cfg`
  （写前备份 `.bak-<时间戳>`，不带 BOM）。**忘了这步的表现是「游戏里她一动不动，而 health 全绿」**——
  DLL 只会安静地重试被拒的请求
- `health` / `meta` 仍然是公开的（验收与探活要用），里面不含任何密钥/token
- 新增 `test/auth.test.mjs`：空 token 不放行、错 token 403→401、两种头、token 文件复用、值不进响应

## 修复：清理记忆被「下一次保存」整份盖回去

- 现象：手工清空 `<数据目录>/state.json` 的内存相关字段后，进程下一次保存把内存里的旧值
  整份写回，`lastTopic` / `recentSubs` 又回来了，看起来像没删
- 现在 `saveState()` 写之前先和盘上对账：**盘上被别人改过就以盘上为准**（`stateSeenHash` 比对），
  并留一行 `state reloaded: 盘上被外部改过` 日志
- `lib/memory-store.mjs` 的 `appendTurn()` 同样先对账（行数比对）：外部删过几行就以盘上重建，
  不会在下次裁剪时把删掉的轮次又「复活」
- 顺带修掉一个真事故：`state.json` 是**直接 `writeFile`**，撞上进程换代就剩半份 JSON，
  下次启动按坏文件隔离成 `state.json.bad-*`（2026-11-14 真发生过，被隔离那份其实内容合法——是读到了写一半）。
  现在整份写一律 `tmp + rename`；`loadState()` 解析失败先等 150ms 重读一次再判死
- 新增冒烟用例「外部改过 state.json，下一次保存不许盖回去」

## 修复：DeepSeek 抖一下，整轮就哑了

- 以前只有一个 20s 超时 + `retries` 次原地重试，没有降级：主力 provider 一挂，这一轮就没有台词
- 现在 `callModel()` 走**降级链**：先用当前 provider 重试够，再顺着 `llm.candidates()`
  （只含有 key 且有 `baseUrl` 的）换下一家；换家时 `body.model` 跟着换，日志留一行 `model fallback`
- 返回值多两个字段：`providerId`（这一轮谁答的）与 `fallback`（是不是降级来的），面板/日志可以据此判断
- 新增 `test/llm-fallback.test.mjs`：候选顺序、无 key 不混入、`body.model` 随候选切换

## 修复：快捷框说的话进不了控制台记录

- 根因：`isAutomation()` 只认「Origin/Referer 是面板端口」的请求为真人对话，
  而快捷浮窗的页面是**侧车自己发的**（Origin 就是 `10723`），天生不等于面板端口 `10722`，
  于是每次说话都被判成自动化 → `sandbox` → 不进 `turns.jsonl`、只写 `cue.test.log`。
  `health` 全绿、字幕照出，所以完全看不出来
- 快捷页发 `/act` 时带 `x-chill-quick: 1` 认领身份；`isAutomation()` 认这个头就按真人对话处理。
  别的裸 `fetch` / curl 仍然没有 Origin，照样按测试处理（保护不变）
- 实测：带头请求后 `turns.jsonl` 从 82 行 → 84 行（user + assistant 一对），
  `/chill/v1/chat` 最后两组就是快捷框那两句；不带头再发一次，行数不变（差 0）
- `cue.log` 也回到真实演出日志，不再落 `cue.test.log`

## 浮窗高度砍到三分之一（560 → 187）

- `CHILL_QUICKBOX_HEIGHT` 默认 560 → **187**，`quickfloat.ps1` 的 `-Height` 默认同步
- `MinimumSize` 高度 340 → 140，否则 187 会被最小高度顶回去
- 实测：窗口 `645x280` 物理 = `430 x 186.7` 逻辑，圆角 region 仍在（`rgnKind=3`），
  版面只剩标题条 / 聪音行 / 一行提示 / 输入框

## 浮窗：去掉「清空」，最小化与关闭换位

- `tools/quick.html` 删掉「清空」按钮及其 `clearBtn` 监听（连 `localStorage` 显示历史的那段一起）；
  输入框的 `Esc` 清空输入保留，`Enter` / `Shift+Enter` 不变
- 标题栏按键改成 Windows 习惯顺序：`−` 在左、`✕` 在最右
  （Dock 是「后加的排最右」，所以调整了 `Controls.Add` 的先后）
- 实测：`x=2386 '−'` → `x=2443 '✕'`；页面 HTML 里已无 `id="clear"`

## 浮窗取消 PIN：不再强制置顶，就是个普通窗口

- 去掉标题栏的 `PIN` 键与全部 `TopMost` 逻辑：不设 `WS_EX_TOPMOST`，不抢焦点，
  可以被别的窗口盖住，Alt+Tab / 任务栏里正常出现
- 保留 `−` 最小化、`✕` 关闭、拖拽移动、圆角、DPI 自适应、单实例、位置记忆
- `POST /chill/v1/quickbox` 的响应不再带 `topmost` 字段
- 实测：`topmost=False`、`rgnKind=3`（圆角 region 仍在）、子窗口只剩 `✕` / `−`

## 浮窗：最小化、圆角、按 DPI 渲染

- 标题栏三个键：`−` 最小化（`WindowState = Minimized`）、`PIN` 切置顶、`✕` 关闭；
  统一走 `New-StripButton`，34px 高、无边框、hover 变 `--line` 色
- 圆角两道：Win11 `DwmSetWindowAttribute(hwnd, 33, DWMWCP_ROUND)` 出系统圆角与阴影；
  再叠一层 `CreateRoundRectRgn` + `SetWindowRgn` 的窗口 region——只做前者的话
  WebView2 子窗口会方方正正盖住圆角。实测 `GetWindowRgn` 返回 3（复杂区域）、
  `DwmGetWindowAttribute(33)` 返回 2
- 声明 `SetProcessDPIAware` + 按 `DpiX/96` 换算实际像素：150% 屏上窗口仍是 430×560「逻辑」大小，
  但由 WebView2 按真实像素密度渲染，不再被合成器整窗拉伸（645×840）
- 被 `windowsHide: true` 拉起时第一次 `ShowWindow` 会继承 `SW_HIDE`，窗口起来就是最小化的；
  `Shown` 里显式 `SW_RESTORE` 兜住
- 位置存 `pos.json`（关窗时写），删掉即回到右下角默认位

## 快捷框改成原生浮窗：WinForms + WebView2，常驻置顶，不碰浏览器

浏览器 `--app` 方案的硬伤不是尺寸，是**它借用用户的浏览器**：进程和任务栏条目混在一起、
关掉浏览器连框一起关、profile 记忆窗口边界、扩展和同步提示挤在 430 宽的窗里。
所以默认路径换掉：

- 新增 `tools/quickfloat.ps1`：WinForms 无边框窗口 + WebView2 控件，加载同一个 `/chill/quick` 页面。
  窗口 `TopMost`，可拖、可缩、PIN 键切换置顶、X 关；位置存 `<数据目录>/quickfloat/pos.json`
- 单实例：`Local\ChillQuickFloat` 互斥体；再点一次只把已有窗口提到前台
- WebView2 的 user data 目录独立在 `<数据目录>/quickfloat/WebView2`，和用户浏览器完全隔离；
  运行时/SDK 自动在 `D:\dshl`、`%LOCALAPPDATA%\DSHL`、NuGet 缓存里找，找不到可 `-SdkDir` 指定
- `POST /chill/v1/quickbox` 默认返回 `mode: 'widget'`；老的浏览器方案保留成 `?browser=1` 兜底
  （独立 profile + `place-window.ps1` 摆位那套照旧）
- 进程证据：浮窗 = `powershell.exe` → `msedgewebview2.exe`，全程 0 个 `msedge.exe`；
  窗口实测 `430x560 visible=True topmost=True`

## 修复：快捷框把尺寸污染给别的浏览器窗口

症状：先开快捷聊天，再开 Harness 或别的 `--app` 窗口，新窗口尺寸变成快捷框的 430×560。

病因不在 CSS，在 Chromium **按 profile 记住上一次 app 窗口的边界**——快捷框原来跟默认
profile 共用，`--window-size=430,560` 被记进了那个 profile，之后所有 app 窗口都继承它。

改法（全部在插件里，用户不用装东西、不用改注册表）：

- 快捷框用独立 profile：`--user-data-dir=<数据目录>/quickbox-profile`
- 尺寸显式传，可用 `CHILL_QUICKBOX_WIDTH` / `CHILL_QUICKBOX_HEIGHT` 覆盖
- 新增 `tools/place-window.ps1`：Chromium 会把 app 窗口建成隐藏/最小化（实测 158×26 @ -21333），
  `--window-size` 治不了；脚本按进程命令行认出该 profile 的窗口，`MoveWindow` 到工作区右下角并
  `ShowWindow(…,1)` 唤出，以「真的可见」为成功判据。ps1 保持纯 ASCII（PS 5.1 按 ANSI 读非 BOM 文件）
- 摆位输出写 `<数据目录>/quickbox-place.log`；`stdio` 必须走 pipe——重定向到文件 fd 时 PS 5.1 不输出任何东西
- 新增 `test/quickbox.test.mjs`：守住独立 profile、显式尺寸、摆位兜底、ps1 纯 ASCII 四件事

实测：快捷框 430×560 @ 工作区右下角（1245,411），Harness 窗口 1400×900 @ (120,60)，互不影响。

## 新增：密钥残留审计 `tools/audit-keys.mjs`，闸门支持 `--history`

`scan-secrets --history` 把 git 全部历史也翻一遍（工作树干净 ≠ 仓库干净）。
`audit-keys` 拿本机在用的 key 值去比对仓库 / 数据目录 / dsh 存储与会话日志 / 临时目录，
报告同一把 key 都躺在哪；`--fix` 删凭据备份副本、就地脱敏别处命中，不动正本。

首次跑就抓到 4 类真实残留：`credentials.yaml.bak-*` 旧钥复印件、会话记录里被粘贴过的
`ARK_API_KEY`、工作区变更 capture 里的明文 token。

## 内置只剩「与对话共用」一条

模型页的默认清单里现在只有 **DeepSeek · 与对话共用**。本地 llama.cpp / ollama 也从内置移除——
要本地模型就在「再加一条」里填 `http://127.0.0.1:8080/v1/chat/completions`（或你的端口）+ 模型名，
key 留空即可。老 `llm.json` 里已有的 `local` / `dsh-ark` 条目照旧保留，只是不再算内置。

## 去掉内置的豆包 ARK

模型页只留两条内置：**DeepSeek · 与对话共用**（默认）和本地 llama.cpp / ollama。
豆包已从默认清单移除；之前自己加过的那条仍在你自己的 `llm.json` 里，不会被删。
要再添回来，就按「再加一条」填 `https://ark.cn-beijing.volces.com/api/v3/chat/completions` 和自己的 key。

## 模型 tab：去掉密钥来源选项，默认与对话共用

面板不再问"密钥从哪来"：默认那条就是「DeepSeek · 与对话共用」，
自己加的 provider 填 key 就用自己那套、留空就跟着对话那把走。
`llm.add()` 对空 token 自动落到 `DEEPSEEK_API_KEY`；卡片的 chip 回到「key 就绪 / 无 key」二态。

## 新增：key 直接复用安装机 dsh 的，不用再配一遍

宿主插件启动侧车前会调 dsh 的 ctx.credentials.resolve(keyRef)（默认 DEEPSEEK_API_KEY），
把解析到的凭据通过环境变量交给侧车——用户在 dsh 里配过的那一份。解析不到才回退到
<DSH_HOME>/.credentials.yaml 与 llm.json。

顺带：/chill/v1/health 增加 keySource 字段（只报来源，值是永远不回显的）；
health.hasApiKey 改成先算布尔再用，避免 keySource 的拼接路径碰到 key 本身；
新增 test/host-key.test.mjs 11 条用例锁死"空值当没配""服务缺席不崩""日志不含值"。

## 修复：只设环境变量时 health 谎报没有 key

AGENTS.md §5 写着 key 解析顺序是「环境变量 → .credentials.yaml → llm.json」，
但 lib/llm.mjs 的 resolve() 从来没读过环境变量：只设 DEEPSEEK_API_KEY 的机器
health.hasApiKey 会是 false，面板显示"没配 key"。已补上最后一档回落。

## 修复：测试依赖本机凭据（干净机器必红）

server.smoke.mjs 断言 hasApiKey === true，而本机配了 key 所以一直绿，CI 第一次跑就红。
测试改为自建空 DSH_HOME + 注入假 key，与本机环境无关。

## 新增：tools/push-via-api.mjs

github.com:443 不通时用 Git Data API 推送（国内常见）。照抄 author / committer / 时区 / 父提交，
推完自动把本地同步到远端提交。

## CI：windows-latest 上跑语法 / 密钥 / 体检 / 全部测试

只跑 Windows：插件是 net472 + BepInEx，卸载用例还依赖目录联接。
并设 fetch-depth: 0——默认浅克隆会让"推向本地裸仓库"的测试报 shallow update not allowed。

## [未发布]

## [0.9.0] - 2026-11-14

开源前的缺陷清扫。这一版没有新功能，全部是"会让新用户踩坑"的修。

### 修复：状态与记忆

- **state.json 只写不读**——重启后好感度、心情、精力、番茄钟计数全部回落默认值，面板却显示已保存。
  现在启动时读回并按白名单合并，坏文件改名留证后回落默认值
- /act 里 TTS 抛异常会把整轮打成 502，而回复此时已经写进记忆——
  记忆里她说过、游戏里没演。现在 TTS 失败降级为纯字幕，表演照常下发

### 修复：稳定性

- 侧车换代改用 `taskkill /T`：以前不带 `/T`，侧车自己拉起的 python TTS 会变孤儿进程
- spawn 失败时补一次重启：error 事件后 exit 未必触发，而重生逻辑全挂在 exit 上
- READY 行改行缓冲：CHILL_SIDECAR_READY 被拆到两个 chunk 就永远 ready=false，所有请求 503
- 热载 lib/work.mjs 时先停旧实例的 watcher：以前每改一次就多一份观察者，
  表现为她重复开口、定时器只增不减
- 畸形百分号编码不再让请求挂死（decodeURIComponent 抛 URIError 被静默吞掉）

### 修复：接口

- /chill/host/work 的请求体改为收 Buffer 后一次性解码：逐 chunk 拼接会把跨块的中文
  变成 U+FFFD，JSON.parse 失败后静默变空对象
- 快捷框页面补进宿主代理：/chill/quick 不在 /chill/v1 前缀里，以前 10722 上是 404
- /admin/game、/admin/game/launch、/admin/voice（含 start/stop/restart）补鉴权

### 修复：目录与日志

- sidecar.log、usage.log、tts.log、cue.log、voice.want 全部跟随 dataDir，
  不再无条件写进插件源码树
- ref/ref-index.json 去掉 present / bytes：那是本机状态，clone 下来就是假的

### 安装：一条命令

- 新增 `tools/install.mjs`：目录联接 → profile 依赖与 `dsh.profile.bundles` → 游戏端 DLL → 逐项 ✓/✗。
  `--check` 只体检、可反复跑；改 profile 前自动备份，**不删任何已存在的目录**
  （Windows 的 junction 在 `lstat` 里不是 symlink，判错就会把插件目录删掉，所以先改判据再动手）
- 新增 `NOTICE.md`：说清 `game/` 两个产物的来源、为何随包、以及不随包的东西（音频 / 权重 / 凭据）。
  `PUBLISHING.md` 里"不许进"和"全部随包"的矛盾按这份口径统一

### 修复：面板

- 轮询 `/chat` 瞬时失败不再把整页刷成"连不上大脑"红条（健康状态由 `/health` 决定）
- localStorage 缓存改为节流 5 秒、只存最近 60 条：以前每说一句话就全量 stringify 200 条
- 删掉 `onSay` 里没用上的 payload 死代码；推送文案按返回里是否真有 `seq` 分两种，
  不再写"已推给游戏 seq=?"这种不存在的记录

### 新增：建库一条命令

`tools/gh-bootstrap.mjs`：校验 token → 建远端仓库（个人或组织）→ 推送 → 补描述与 topics。
token 只从 `GH_TOKEN` / `--token` 读，永不打印、永不落盘；推送用一次性 URL，成功后写回的 remote 不带凭据。

### 新增：卸载与换钥

- **`tools/uninstall.mjs`**：装的反向操作。三条硬规矩——只摘 `realpath` 指回本仓库的目录联接、
  绝不递归删目录、数据目录（记忆/好感度/`llm.json`/语音缓存）一个字节不碰。
  默认只看不动，`--apply` 才执行；`--game … --remove-dll` 才连游戏端 DLL 一起清；
  `test/uninstall.test.mjs` 18 条回归，含"同名普通目录不删""联接指向别处不删"两条安全边界。
- **`tools/scan-secrets.mjs`**：明文凭据闸门（`sk-` / Bearer / AKIA / `ghp_` / PEM / 赋值式长串），
  已接进 `check-publish.mjs` 当硬门；占位符与测试桩不误报。
- **`tools/rotate-key.mjs`**：一条命令换钥——写进 DSH 凭据（带备份、不带 BOM）、
  抹掉会话缓存里的残留副本（带备份、替换后先验 JSON 再落盘）、打印"只有你能做"的撤销那一步。
  永不打印 key 本身，只给前 6 位指纹。
- **`test/hygiene.test.mjs`**：静态卫生，拦"语法通过、跑到那行才炸"的错。
  成因很具体：`require is not defined in ES module scope` 这一轮犯了三次，全是 `node --check` 全绿。

### 修复：实机打接口打出来的

- **`POST /chill/v1/persona` 会把当前角色卡的人设覆盖成 2 个字符**：以前把整段 body 当人设落盘，
  发一个 `{}` 就把它存成 `{}`，之后 `/context` 里「你是谁」下面只剩一个空对象。
  现在先拆 `{text|persona}` 外壳、判空后返回 400，覆盖前还会留一份 `.bak-<时间戳>`。
  补了两条回归，并验证过「把判空改坏，测试会红」——不是假绿。
- `serve.mjs` 路由表的两处（disposer 拿副本删不掉、`exact/prefix` 只算一次）已在上一轮修，
  这轮用 600 次轻请求压过：路由数恒定 31，零非 200，日志无异常行、无体积膨胀。

### 测试：把三处静默故障固化成回归

打接口打不出新 bug 之后，把「症状不指向病因」的三处补成断言（每条都验证过"注入缺陷会变红"）：

- **状态真的写盘**：`focus_start` 之后直接读 `state.json`，断言 `phase==='focus'` 且带 `savedAt`。
  以前 `loadState` 漏掉时，只测内存的用例全绿，重启就失忆。
- **sandbox 不写长期记忆**：`sandbox:true` 说一句特征串，断言 `turns` 条数不变、全库查不到这句话。
- **一轮进行中 `/observe` 回 `busy`**：给假 fetch 加可变延迟造出"正在进行"的窗口，
  断言旁白请求不排队、不插队。否则两句话会挤进同一轮，记忆跟着乱。

烟测从 25 条涨到 28 条。

### 已验证不是 bug（省得下次重报）

- `/chill/v1/audio`、`/chill/v1/avatar`、`/chill/v1/kb` 都有名称白名单，目录穿越被挡（400 `bad name`）；
- `/chill/quick` 不回显查询串，没有反射型 XSS；
- `/chill/v1/admin/game/launch` 忽略请求体里的 `path`，只按配置启动游戏，不能起任意进程；
- 空文本 / 空对象的 `/act` 不写记忆（轮数不变）；
- `/chill/v1/voices/<任意名>` 返回全表是 prefix 路由的正常形态，不读文件；
- `/chat/completions` 的 `[情绪] ||| 日文 ||| 中文` 三元格式是**设计**，`server.smoke.mjs` 就在断言它
  （现成 AIChat 插件靠 `|||` 拆两行字幕）；要结构化内容用 `response_format: json_object`。

### 修复：第二轮审查

- **长期事实整条落盘**：以前只序列化 7 个字段，`invalidAt` / `pinned` / `links` 全丢——
  重启后已被推翻或已闭环的事实又回到 prompt 里，pinned 的免删保护也失效。附回归测试
- **声线表不再被截断覆盖**：`index.json` 解析失败会先把坏文件改名留证，写入改 tmp + rename。
  以前一次 BOM 或半写就让用户自定义的全部声线元数据永久消失
- **内置声线顺序稳定**：`unshift` 会让顺序每 load 一次整体翻转，现在按 `DEFAULT_VOICES` 重建；
  `activeVoice()` 的兜底项也会剥掉 `ref/` 前缀（以前路径会变成 `voices/ref/xxx.wav`）
- **知识库索引失败可重试**：`building` 以前只在成功路径清空，失败一次就把知识库整页锁死到重启
- **JSON 读取统一剥 BOM**：6 个模块、10 处 `JSON.parse`。本机用 PowerShell 写过的 json
  会被当成损坏（角色卡消失、配置回默认、记忆首行丢失）
- **/chat/completions 走串行链**：以前直调 `runTurn`，与游戏端 `/act` 并发时两边同时改记忆和状态
- **/observe 不再插话**：有真人回合在跑时直接返回 `{speak:false,reason:"busy"}`
- **/ambient 的 GET 补鉴权**：里面是他那边的活动概况
- **观察重试耗尽不再泄漏定时器**：`watcher = null` 漏掉 60 秒抬眼定时器，而 `stopWatch()`
  因 watcher 已空早退；改走 `stopWatch()` + `holdWatch` 挡住自动重连
- **语音引擎 spawn 补 `error` 监听**：`ENOENT`/`EACCES` 是异步事件，外层 try/catch 抓不到
- **预热不再无限递归**：失败后十分钟一次、最多三次
- **角色卡以文件名为准**：卡内 id 与文件名不一致时不再写坏 `_active.json`
- **`llm.mjs` 与 `config.mjs` 的凭据路径回落对齐**（都认 `DSH_HOME` → `~/.dsh`）
- **prune 走注入的 log**，侧车日志里不再出现无前缀的 `console.warn` 行
- 新增 `test/regressions.test.mjs`：把上面三条 severe 钉成用例

### 发布准备

- 生成脚本里写死的本机 Steam 库与个人目录路径全部移除（--GameDir / CHILL_GAME_DIR 参数化）
- tools/check-publish.mjs 的本机路径正则只认反斜杠，三处泄漏全被放过（假绿灯）。
  现在同时认正反斜杠，补 Steam 库与家目录，命中算问题
- package.json 补 license / engines / files / keywords；test 改为遍历 test/*.mjs
  （以前只跑 2/5 个，本地绿 CI 红）
- CI 语法检查补上 lib/*.js（core.js、assets.js、client.js 从来没被检查过）
- lib/config.mjs 的 tts.promptText 默认值里带着游戏原声台词，改为空串
- lib/client.js 去掉早期本地包名分支，模块 ID 固定为包名
- 分发口径明确「模型权重与 API 凭据属于私人内容」：`.gitignore` 补权重扩展名与模型目录，
  `check-publish` 加硬门（`git add -f` 也会被拦）
- 文档数字按实际重算：389 动作 / 146 椅子、30 条路由、16 个模块、61 个文件、
  配置表默认值（maxTokens 600、assetBudget 3200、assetPerSlot 80、maxCues 3）

## [0.8.0] - 2026-11-14

### 结构：把游戏端收进仓库

- 新增 `game/`：`ChillPerformer.dll`（预编译）+ `src/`（C# 源码）+ `assets.seed.json`（389 动作 / 146 椅子静态清单）
- 分发口径定为「有下载渠道的不带，没有下载渠道的全带」。此前游戏端不在仓库里，
  装完插件后游戏里不会动，且没有任何文档指向这个缺口
- `ChillPerformer.csproj` 的游戏目录改为优先读环境变量 `CHILL_GAME_DIR`，不再写死本机盘符
- `PerformerPlugin` 的 `audio/Dir` 默认值从本机绝对路径改为空（留空走 `/chill/v1/audio`）
- `assets.seed.json` 从仓库根移到 `game/`，`tools/` 下两个生成脚本的默认输出路径同步

### 结构：私人数据与源码分离

- `dataDir` 改为可配：**配置 > 环境变量 `CHILL_DATA_DIR` > 插件目录下的 `data/`**，
  目录不存在时启动自动创建。聊天记录、TTS 缓存、知识库、用户人设卡、状态日志
  可以整体落在源码树之外，仓库里只剩代码与随包资产
- 内置角色卡不再作为文件随包：它由 `persona.md` 在首次启动时播种生成
  （`brain.mjs` 的 `seedPersona`）。`lib/check-publish` 的硬门随之从「satone.json 必须在」
  改为「`persona.md` + `lib/characters.mjs` 必须在」
- `.gitignore` 收成一条 `data/`，删掉失效的 `!data/characters/satone.json` 例外
- 语音引擎日志跟随 `dataDir`，不再固定写 `<插件>/data/gsv-server.log`

### 文档

- 新增 `AGENTS.md`：写给执行安装的 agent 的全流程说明。开头第一件事是**确认游戏本体在不在**，
  没装就停下让宿主去装；之后依次是下载清单、装插件、装游戏端、配 key、端到端验收（5 条判据）、
  故障对照表。§9 起补充「数据目录」一节：优先级、自动创建、三种用法、搬家方式
- README 的「仓库里没有的东西」重写为「带了什么、没带什么」，按下载渠道分三组
- `PUBLISHING.md` 更新文件清单到 61 个

### 修复

- `lib/client.js` 的模块注册 ID 改为按 `__DSH_BOOT__` 自适应。改包名后旧进程与新进程认的 ID
  不同，写死任何一个都会让面板静默消失
- `brain.mjs` 的 `VERSION` 与 `package.json` 对齐（0.6.0 → 0.8.0）
- 参考音频三个名字不一致：`lib/config.mjs` 默认值改为 `Voice_MainScenario_18_001.wav`，
  `ref/ref-index.json` 重写为实际存在的四个文件并带 `required` 标记
- `tools/check-publish.mjs`：`.csproj` 计入文本扩展名；`game/*.dll` 加入自有二进制白名单

### 观察

- 新增 `releaseAll()` / `POST /chill/host/work/release`：**一次性解除所有正在观察的对话**——
  中止在跑的投递、收掉事件流与抬眼定时器、清空攒了一半的进度快照与流水状态、
  清空并落盘绑定。返回被解除的会话 id 列表。`unbind-all` 是别名
- `unbind()` / `POST /chill/host/work/unbind` 恢复为**只解除当前选定的这一条**：
  清掉绑定、收掉它的事件流，不碰在跑的投递，也不清流水
- 修复「解除后自己又活过来」：`state()` 每次轮询都会拿持久化的 `binder` 把 watcher 重新拉起，
  于是解除只生效到下一次轮询。新增 `holdWatch` 闸门，用户显式解除后不再自动接上，
  只有重新「观察」才解除该状态
- 观察条按钮定为 **观察 / 停止观察 / 全部解除**，`全部解除` 排在最右。
  `全部解除` 不再只认 `bound`——只要还有事件流在跟或那边在跑就可点，
  不会出现“绑定丢了、观察还在、按钮却是灰的”
- 原「停止」（中止对面正在跑的那一轮）从面板移除，`POST /chill/host/work/cancel` 接口保留
- 流水记录带上 `sessionIds`，一次解除多条时能看到到底放了谁

## [0.7.0] - 2026-11-14

首个公开版本。

### 对话与记忆

- 由 DeepSeek 驱动，游戏端只负责表演，不参与决策
- 三层记忆：短期轮次、滚动摘要、长期事实
- 情绪与好感度随对话累积，影响后续语气与动作
- 旁观模式：你在写代码时可以让她只在旁边看，不打断你

### 语音

- GPT-SoVITS 日文音色，中文台词配中文字幕
- 语音缓存，重复台词不重复合成

### 演出

- 从游戏资源里选动作与表情，不新增美术资源
- 台词与动作、口型、表情同步下发

### 知识库

- 可导入任意主题资料，检索后进入上下文
- 检索带评分，低分不进 prompt

### 界面

- 控制台面板：对话、模型、角色、语音、知识库、资源、状态、测试
- 桌面快捷框：一个没有地址栏的小窗口，可以拖到任何地方

### 插件

- 随插件分发两个技能：`chill-with-you-testing`（测试隔离与日志安全）、`kb-authoring`（知识库制作）

[未发布]: https://github.com/OWNER/REPO/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/OWNER/REPO/releases/tag/v0.7.0