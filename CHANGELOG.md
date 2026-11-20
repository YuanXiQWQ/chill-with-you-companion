## [0.11.0] - 2026-11-20

专注期她不再是一具只说台词的躯壳：表情通道打通了，身体动作不再被"换成点头"，
闸门也不再挑她这个姿势族演不出来的动作。另外补了两个工具——部署游戏端 DLL、
实机观察对账。

### 新增

- **专注期的表情通道**：DLL 里 `ChangeHeroineFacialAnimation` 落在 L2（Facial）层，不碰身体，
  是专注期唯一合法的表达方式。侧车现在按情绪下发表情（开心→Shy_Joy、笑→Shy_Fun、
  惊讶→Shy_Surprise、累/难过→Shy_Sad、生气→Shy_Anger、害羞→Shy_Rest、好奇/认真→Open_Eye），
  没把握的不下发。开关 `facialFromEmotion`（默认开）
- `tools/deploy-dll.mjs`：一条命令完成「等番茄钟结束 → 关游戏 → 拷 DLL → 用 steam 拉起」。
  不带参数只体检；`--apply` 才拷；游戏在跑时要 `--restart`；`--wait-idle <秒>` 会连采两次确认空闲才动手
- `tools/observe.mjs` + `tools/observe-report.mjs`：实机观察。按 `seq` 把「侧车下发的」和
  「游戏端真的播了的」对上账，出报告（端到端耗时、零动作轮次、兜底次数、最长连续重复、表情分布、逐轮明细）
- `/health` 增加 `gameStale`：游戏快照超过阈值就标出来，面板心跳会显示「心跳过期 Ns」而不是继续当真

### 修复

- **她只会点头**：侧车在 focus/break 期会把"没有情绪签名"的动作一律改成 `anim_story_base001_sub_nod`。
  这条老逻辑已经被族过滤取代，而且有害——点头属于 `Base001`，她此刻在 `WorkBase001`/`BreakBase002` 时
  拼不出同族等价动作，整条丢掉，那一轮 0 条 cue。已移除
- **专注期连表情一起被跳过**：DLL 的 `focus: 跳过动作 … continue` 排在换脸之前，专注时她既不演也不换脸。
  换脸已提到所有分支之前；`stateName` 分支里的重复调用也删了
- **表情字段在 `/play` 路径丢过一次**：`buildCueItem` 逐字段重建对象时没搬 `facial`，
  游戏端 `cue.facial` 为空、`ChangeFacial` 静默返回。已补透传
- **闸门挑跨族动作**：她在沙发看书（`BreakBase002`）时被挑成 `anim_wild_leavechair_*`（起身走开），
  随后被族过滤丢掉。闸门现在按她此刻的姿势族预筛候选；本族没有这个类别的动作时宁可不改写
- **连续 3 轮同一个动作**：本轮动作与上一轮完全相同时换成本族手势池里的下一个，决定写入 `data/repeat.log`
- **游戏快照过期被当真**：`liveSnap()` 在快照过期时返回空对象，七处决策点不再拿旧值当现场
- 观察报告把"窗口尾还没播"误算成漏播；最后 90 秒内下发的 cue 单列一行
- 随包脚本里 11 处字面量盘符改成现算（`CHILL_REPO` 可覆盖，`.ps1` 用 `$PSScriptRoot`）
- `game/test/bin/` 的编译产物不再进仓库

### 兼容性

- 对应游戏版本不变，`assets.seed.json` 与动作清单未改动
- 游戏端 `ChillPerformer.dll` 需要更新（本版重建）：旧 DLL 不认识表情字段，专注期仍然只有嘴形
- 新配置项都有默认值，老配置不用改
### 修：闸门挑跨族动作 / 重复打散 / 报告的误报

15 分钟 break 期观察（`data/observe/observe-2026-11-20T14-24-39.ndjson`）暴露三条，
都修了，并且每一条都有对应的验收方式。

**1. 内容闸门从整张清单里挑跨族动作**（`lib/motion-class.js` + `brain.mjs`）

```
[gate] `眼睛有点干，等我揉一下` want=locomotion
       anim_break_tea_sub_drink → anim_wild_leavechair_cupcake_comeback_start
```

她坐在沙发上看书（`BreakBase002`），闸门却挑了个"起身走开"的三段式。跨族动作随后在
`applyFamily` 里被整条丢掉，那一轮就退化成"兜底动作"——日志看起来像改对了，实际什么都没演。
现在 `pickCandidate` 接 `family` 参数，按 `familyOfClip` 预筛；**族已知但本族没这个类别的动作
时宁可不改写**（写一个必然被丢的 id 没有意义）。`brain.mjs` 把 `liveSnap().family` 传进去。

新增 `test/gate-family.test.mjs`（4 条）：不挑跨族、本族没有就不硬塞、不传 family 行为不变、
同族有对应动作时优先同族。

**2. 连续 3 轮同一个动作**（`brain.mjs`）

即使删掉 head-only 改写，模型的"点头"倾向 + 族兜底固定取 `turnCount % pool.length`
仍会压出连续重复。新增打散：本轮第一个动作如果和上一轮**完全相同**（按 `id || nativeName`
比），换成本族手势池里的下一个（`gestureCursor` 按族轮换），专注期不参与（本来就没有身体 cue）。
决定落 `data/repeat.log`：

```json
{"at":"…","key":"anim_story_base001_sub_thinking1","alt":"BreakBase002_NextPage","fam":"BreakBase002"}
```

实测连发 10 次同一句，相邻重复 **0 次**，`repeat.log` 记到 2 次真实打散。

**3. 观察报告把"窗口尾还没播"算成"发了但没播"**（`tools/observe-report.mjs`）

`seq 1795184503` 被报成漏播，翻游戏日志它其实播了——只是 play 行落在最后一次采样之后。
现在最后 90 秒内下发的 cue 单列一行「窗口尾未等到（正常）」，不算漏播。

验收：`127 pass / 0 fail`、`doctor` 11 通过（剩一条是语音引擎没起，属正常降级）。

### 修：表情通道闭环（部署 + 一处字段没搬）

上一节说"等游戏关掉再建"。现在闭环了，过程中又抓到一处：

**1. `buildCueItem` 没搬 `facial` 字段**（`brain.mjs`）

`/act` 那条路是 `act.cuesJson = performance.map(c => JSON.stringify(c))`——整条原样序列化，
所以表情能带过去。`/play` 那条路走 `buildCueItem`，它是**逐字段重建对象**的（slot/id/at/
durationMs/holdMs/native*/text/why），没搬 `facial`，于是从面板或 /play 进来的表情 cue
到了游戏端 `cue.facial` 是空的，`ChangeFacial` 静默返回（日志只有 `cue in` 和 `cue skipped`，
看不出被丢）。现在补上 `facial` 的透传。这也是为什么第一次验的时候 `facial ->` 一直不出现。

**2. 新 DLL 已部署并验证**（`game/ChillPerformer.dll` 213,504 字节）

```
[Info] cue in: slot=facial id=Shy_Joy sub=[] name=[]
[Info] facial -> Shy_Joy(5)          ← 脸真的换了
```

`/play` 与 `/act` 两条路都验过：`facial -> Shy_Joy(5)`、`facial -> Shy_Surprise(6)`。

**3. 新增 `tools/deploy-dll.mjs`：把"关游戏 → 拷 DLL → 拉起来"变成一条命令**

以前构建完拷不进 plugins（`user-mapped section open`），于是仓库里的 DLL 和游戏里跑的那份
悄悄分叉，doctor 的 `versions` 项常年 warn。现在：

```powershell
node tools/deploy-dll.mjs                              # 只看：两份是否一致、游戏在不在跑
node tools/deploy-dll.mjs --apply                      # 一致就拷；游戏在跑则报错退出（不杀）
node tools/deploy-dll.mjs --apply --restart --wait-idle 1200
                                                       # 等番茄钟结束（最多 20 分钟）再关、拷、拉起
```

`--wait-idle` 会连采两次确认空闲才动手，动手前再查一次——不会把正在跑的番茄钟直接砍掉。
这次就是它等的：番茄钟走到 0 分钟 → 空闲 2 次 → 关游戏 → 拷 213,504 字节 → steam 拉起。

**4. 观察报告加两栏：单调性与表情分布**

```diff
+ - 最长连续重复：anim_story_base001_sub_nod × 2 轮
+ - 表情分布：Shy_Joy×3、Shy_Surprise×1
```

"8 次演出 5 次同一个 nod"这种事以前要人事后数日志，现在报告里直接一行。
旧数据回放已经能抓到：`最长连续重复：anim_story_base001_sub_nod × 2 轮`。

验收：`doctor` 12 项全过（`versions` 的 warn 消失）、`deploy-dll` 报"两份一致"、
游戏端日志出现 `facial -> Shy_Joy(5)` / `facial -> Shy_Surprise(6)`、JS `123 pass / 0 fail`。

### 修：她只会点头（观察期那条"没修的"）

30 分钟观察里 8 次演出、5 次是同一个 `anim_story_base001_sub_nod`，连「那要重新泡一杯吗」
（句子有「茶」）也落到点头。查到三处叠加，现在全部拆掉。

**1. 侧车自己在 focus / break 期把动作改写成点头**（`brain.mjs`）

那是一段 2026-11-13 的老逻辑：「专注时只该做头部动作」，于是把每一条没有情绪签名的动作
替换成 `anim_story_base001_sub_nod` / `thinking1_start`。它已经被后来两层取代，而且**有害**：

- 姿势族：点头属于 `Base001`，她此刻在 `WorkBase001` / `BreakBase002` 时 `applyFamily`
  拼不出同族等价动作，整条丢掉 —— 那一轮 0 条 cue；
- 游戏端：DLL 的 `FocusMode` 本来就把身体动作整条跳过。

整段删掉（留注释说明来历），把"演什么"交回模型 + 族过滤 + 族内兜底。

**2. 表情通道在游戏端被 focus 判断截胡**（`game/src/PerformerPlugin.cs`）

`if (GameBusy.FocusMode) { log("focus: 跳过动作 …"); continue; }` 在 `animations` 分支里，
而换表情那段写在它**后面**，于是专注期连表情一起被 `continue` 跳掉——专注时她既不演动作、
也不换脸，只剩嘴形。「表情独立于动作」本来是对的（L2 层，不碰 L0 姿态），现在把换脸那段
提到 `wait` 之后、所有分支之前；`stateName` 分支里那份重复调用也删掉了（同一张脸连设两次）。

**3. 上一轮加的 `facialForEmotion()` 因此也验不了**（`lib/core.js`）

侧车已经在下发 `{"slot":"facial","id":"Shy_Joy","facial":"Shy_Joy","at":0}`，但部署的 DLL
先 `continue` 了。**仓库里的 DLL 已重建**（213,504 字节，22:11），`BepInEx/plugins` 里那份
还是旧的——游戏正在跑（番茄钟剩 8 分钟）。等游戏关掉后：

```powershell
# 一条命令：等番茄钟结束 → 关游戏 → 拷 DLL → 用 steam 重新拉起
node tools/deploy-dll.mjs --apply --restart --wait-idle 1200
```

重启游戏后在 `LogOutput.log` 里搜 `facial ->`，能出现 `facial -> Shy_Joy(5)` 就说明通了。

验收（侧车侧，专注期连发四句）：

```
我先开始这一轮   Guts      → facial:Shy_Joy
那要重新泡一杯吗 Think     → facial:Open_Eye
有点走神，拉回来 Guts      → facial:Shy_Joy
外面好像在下雨   Surprise  → facial:Shy_Surprise
```

四句四种表情，不再全是点头。JS `123 pass / 0 fail`。

### 观察期（30 分钟实机）查出来的四条

工具：`tools/observe.mjs`（每 30s 采样，按 seq 对账"发出去 vs 真的播了"）+ `tools/observe-report.mjs`
（出 markdown 报告）。第一次跑，8 次主动演出全成功、8 条 cue 全部在游戏端播出、无掉线、无故障级日志。
但抓到四条静态审计看不见的问题。

**1. 兜底动作挑到了游戏里没有的 clip**（`brain.mjs` / DLL 日志）

```
[Warning:ChillPerformer] clip missing: anim_break_movie_sub_trash
```

`familyWantedCue()` 是从 `assets.json`（清单）里按族挑 id。清单里有条目、游戏里没有对应 clip，
于是"兜底"变成一条查不到的动作（DLL 最后按名字在 Character 上兜住了，但这是运气，不是保证）。

**2. 有族却没有 clip 时，兜底只能返回 null**（`brain.mjs`）

专注期她的族是 `WorkBase001`——可游戏的 `ClipFamily()` 把 `work_pc` / `work_book` 判给
`WorkBase002`，**根本不存在 `work_base001_*` 这样的 clip**。于是 `mine.length === 0`，
兜底返回 null，那一轮 0 条。现在再退一层：直接给她这一族的**原生手势**
（`WorkBase001_Thinking` 这种），让 DLL 调游戏自己的状态机，不经过 clip 名查找。

**3. `mapGesture` 换算不出来就返回空 → 整条丢**（`lib/gestures.mjs`）

实测专注期 6 轮里有 2 轮是 0 条 cue：模型给的是 Story 族的 `sub_nod` / `sub_fun`，
而 `WorkBase001` 只有 Stop / Thinking / DrinkTea / Break / Break2——词一个都对不上，全被丢掉。
现在：同义词表补 `nod → Thinking/Stop`、`shakehead → Stop/Thinking`，并且**最终兜底到这一族的
第一个手势**（宁可动作差点，也不要她一动不动）。族本身不存在时才返回空。

**4. 专注期侧车下发的身体动作，游戏端一条都不会演**（`brain.mjs` / `lib/config.mjs`）

DLL 的 `FocusMode` 一开就整条跳过：

```
[Info] cue in: slot=animations id=anim_story_base001_sub_nod
[Info] focus: 跳过动作 anim_story_base001_sub_nod，只走原生表情/嘴形
```

本次会话一共跳了 6 次。侧车却把这条算进 `cuesJson`，面板于是画出一条她本来就没做的动作——
和第三批修的"派生字段和实际下发不是同一份"是同一类，只是这次的真相在游戏端。
现在专注期干脆不下发身体动作（表情 / 嘴形 / 音效照旧），并记一行
`[focus] 专注期不下发身体动作：拦下 N 条`；要恢复旧行为把新配置 `focusMovesBody` 设 `true`。

另外：`buildCueItem` 的 `.filter((c) => c.id)` 会把"只给 nativeName"的 cue 当空条目丢掉
（原生路径本来就允许没有 id），改成 `c.id || c.nativeName`。实测
`{"slot":"animations","id":"","nativeName":"BreakBase004_DrinkTea"}` 现在能通过 `/play` 下发
（游戏端 `cue in: ... name=[BreakBase004_DrinkTea]`）。

验收：JS `123 pass / 0 fail`（`mapGesture` 那条断言按新语义改写：换算不出来时退到本族第一个手势，
族不存在才返回空）。

**5. 专注期她"听见了但没反应"：表情通道本来能用，但没人下发**（`brain.mjs` / `lib/core.js`）

DLL 里 `ChangeHeroineFacialAnimation` 认 7 张脸（None / Shy_Rest / Shy_Fun / Shy_Anger /
Shy_Sad / Shy_Joy / Shy_Surprise / Open_Eye），落在 L2 层，**不碰身体**——正好是专注期唯一
合法的表达通道。侧车从来没下发过 facial（`cuesJson` 里一条都没有），于是专注轮次她只剩嘴形：

```
cue in: slot=facial id=Open_Eye      ← 现在会下发
```

新增 `facialForEmotion()`（开心→Shy_Joy、笑→Shy_Fun、惊讶→Shy_Surprise、难过/累→Shy_Sad、
生气→Shy_Anger、害羞→Shy_Rest、好奇/认真→Open_Eye），没有把握的一律不下发（不改脸比改错脸好）。
下发时必须写成 **cue 的 `facial` 字段**（DLL 只读 `cue.facial`，不认 `slot=facial`+`id`），
所以两个都填上：字段给游戏用，`id` 给面板和日志看。开关 `facialFromEmotion`（默认开）。

> **还有一半没验完**：当前部署的 DLL 在处理 `slot=facial` 的 cue 时没有走到 `ChangeFacial`
> （日志只有 `cue in` 与 `cue skipped`，没有 `facial -> Name(id)`；同一份源码里那个分支在
> `animations` 分支**之前**，说明部署的 DLL 这一段是旧版）。要等下次游戏关掉时重建 DLL 才能确认，
> 期间这个 cue 是无害的（DLL 忽略它）。另外 `focus: 跳过动作 … continue` 会连表情一起跳过，
> 重建时把表情块提到 `focus` 判断之前。

**6. 观察期还暴露一条没修的：身体动作塌缩成"点头"**

8 次演出里 5 次是 `anim_story_base001_sub_nod`，`why` 全是「句子里有「点头」，判成一个反应」，
连「那要重新泡一杯吗」（句子有「茶」）也落到点头。需求层的文本启发式对 nod 过触发，
再叠上专注期的头部微动兜底，她的身体语言基本只有一个动作。下一轮从这里开始：
把「茶」→ DrinkTea、「走神」→ Stop/Thinking 这类换掉，并给同一轮加去重（连续两轮不许同一个 id）。

### 修：审计第四批（快照年龄 + 三处误报核实）

**1. 过期快照仍参与判断**（`brain.mjs`）

`game.snapshot()` 会把最后一次心跳原样返回。游戏关掉之后 `motion` / `queue` / `windowView`
都是几小时前的值，而它们直接决定编排：

| 读的地方 | 过期值的后果 |
| --- | --- |
| `queueAheadNow()` | 队列深度虚高 → 每轮都按"她要接上一个动作"来起手 |
| `seatGuard(cues, snap)` | 按旧的离座状态判 → 整轮不编排（她一动不动） |
| `enforceContentClass({ currentLayer })` | 按旧层判 → 动作全被降级成点头 |
| `away` 提前结束判定 | 旧的 `motion.live` 让离座窗口迟迟不结束 |

现在统一走 `liveSnap()`：`stale` 时返回空对象，需要现场的地方一律读它；
要展示"最后心跳长什么样"的地方（`/health`、`debug`）仍读原始快照。

**2. 窗外景按过期值说**（`brain.mjs`）

`windowViewNow` 直接读快照：游戏关掉两小时后仍是"窗外正黄昏"，模型会照着说一句
和真实时间对不上的话。现在 `stale` 时不注入这一句。

**3. `/health` 加 `gameStale`**（`brain.mjs` / `lib/client.js`）

`gameOnline` 只看"最近有没有心跳"，分不出"从没连上"和"连过又断了"。新增 `gameStale`，
面板的心跳 chip 在过期时变色并写"心跳过期 128.4s"，`title` 说明侧车已不再采信那些状态。
排查时这两句话指的完全是两件事。

**核实为误报的三条**（记下来，免得下次又去改）：

- `watchSources()` 不是死代码：`index.js:458` 通过 `sup.watchSources()` 注册，侧车热换就靠它。
- `admin` 路由不重叠：`/chill/v1/admin/game`、`/admin/game/launch`、`/admin/voice/*` 分开注册，
  `/admin/restart` 只属于侧车（`serve.mjs`），宿主反代时注入 token，所以那条 `restartAuth` 是有效的。
- 裸 `catch {}` 实测只有 3 处，其中两处本来就有注释说明"记不上不影响演出"；第三条补了注释。
  审计里写的"26 处空 catch"是把带注释的 best-effort 捕获也算进去了，那些不该加日志
  （日志本身失败不能反过来影响演出）。

验收：`/health` 返回 `gameStale=False gameAgeMs=2485`、三句连发每句都有族内动作、
游戏端日志确认真的演了（`play anim_break_tea_sub d=8667 on Character`）、JS `123 pass / 0 fail`。

### 修：审计第三批（7 条，结构性，含"她一动不动"的真因）

**1. 派生字段与真正下发的动作不是同一份**（`brain.mjs`）

`buildAct` 用改写**前**的 performance 算 `actions`，`motionScope` 用改写前的 `actCues`，
`notePerf` 记的也是改写前的动作。于是响应里 `actions` / `motionScope` 和 `cuesJson`
各说一套：面板显示的动作游戏里没有，`motionScope=full` 而实际全是半身动作。

现在三段改写（工作态 / 姿势族 / 机位）之后重算 `actions`，`motionScope` 用最终 performance，
`notePerf` 记**最终下发**的那一条（下一轮 prompt 才不会建议一个刚被换掉的姿势）。

实测：`actions=anim_story_base001_sub_nod` 与 `cuesJson` 里的动作一致。

**2. `gateCues` 对空输入直接返回空 → 她站着把台词说完**（`brain.mjs`）

模型没给动作、情绪又没有签名动作（Tired / Agree / Relaxed 都不在 actionMap 里）时，
`gateCues([])` 原样返回空：这一轮 0 条 cue。实测连发三句，两句是 0 条。

现在空输入时补一条头部微动；still 档（Sad / Drink / Idle）保持完全不动，那是刻意的。

**3. 补的兜底动作跨族，被下一段整条丢掉**（`brain.mjs`）

上一条的兜底用的是 Story 族的点头。她在读纸书族（`BreakBase002`，全族只有
NextPage / PreviousPage / Interest 三条）时，`applyFamily` 会把这条件整条丢掉——
兜底等于没兜。现在兜底按族挑：用 `familyOfClip` 从清单里筛出她这一族真有的动作。

**4. 真正的原因：内容类闸门挑的动作跨族**（`brain.mjs`）

`enforceContentClass` 是按"需要什么类别（locomotion/posture）"从整张清单挑的，不看族。
`gate.log` 里抓到的现场：

```
emotion=Agree  want=[posture]  picked=anim_break_yawn_1_start  from=anim_story_base001_sub_nod
emotion=Agree  want=[locomotion,posture]  picked=anim_wild_leavechair_cupcake_comeback_start
```

这两条都不是 `BreakBase002` 的，`applyFamily` 一律丢掉 → 0 条 cue。现在族过滤之后
如果一条动作都不剩，补一条本族动作（且写日志说明），保证每轮都有可见反应。

实测（三句连发，全部 1 条且都在族内）：
```
Tired    -> anim_break_tea_sub
Agree    -> anim_break_tea_sub
Curious  -> anim_story_base001_sub_thinking1
```

**5. 姿势族信息没有时间戳，重启后永远是旧族**（`core.js` / `brain.mjs`）

`gameFamily` / `gameState` / `gameAnim` 只在 `applyHeartbeat` 里临时写进 state，**不在
`DEFAULT_STATE` 里**——写盘后读不回来，重启第一轮又变成"族未知"。而且游戏关掉几小时后
它们仍然有效，按旧族挑动作只会被丢掉。

现在三个字段进 `DEFAULT_STATE`，并加 `gameFamilyAt`；超过 30 秒的族信息在 prompt 与族过滤里
都不再采信。

**6. `clipExtraOwners` 永不清理**（`PerformerPlugin.cs`）

`DiscoverHeroine()` 清 `clipOwners` / `clipNames`，漏了 `clipExtraOwners`：每次重新发现
（换场景、重进剧情）都把同一个 Animator 往按 clip 名索引的列表里再记一遍，列表里还留着
已销毁的旧对象。现在一起清。

**7. 整场景 `FindObjectsOfType` 每帧扫描 / 缓存对象销毁后永不重扫**（`PerformerPlugin.cs`）

扫不到时以前每帧重扫（几十上百个对象 × GetType + GetField 反射）；缓存对象被销毁（换场景）
后 `NativeCurrentName(null)` 一直返回空（"族未知"），直到重启游戏。现在 5 秒扫一次、
扫到即缓存，缓存对象失效立刻清空并要求重扫。

**8. `GET /kb/<lib>/refresh` 有副作用**（`routes/kb.mjs`）

这是 GET，但会在 `kb-sync/` 里写一个带时间戳的任务文件：浏览器预取、代理、链接预览
都会留下没人要的文件。现在整块提到方法分支之前：**GET 只算不落盘，POST 才写**，
`hint` 也随之区分。

**9. 面板会去播非同源音频**（`lib/client.js`）

`new Audio(audioUrl)` 直接播：`audioUrl` 来自侧车，而侧车上游是可换的模型与可写的状态文件，
一旦其中某处夹了 `https://外域/…`，播放等于把面板的 Referer 与访问记录送给第三方。
现在统一走 `playAudio()`：只放行同源路径与同 host 的绝对地址，其余打一行 warning 跳过。

验收：JS `123 pass / 0 fail`、C# `45 passed`、`doctor 12 通过`、DLL 已加载（214,016 字节）、
三句连发每句都有族内动作。

### 修：审计第二批（12 条，全是"坏了看不见"的类型）

**1. `feed` 投递水位在写响应之前推进**（`lib/feed.mjs`）

`markDelivered(...)` 在 `sendJson` 之前跑，而 `alive()` 只是写前快照 —— 连接在这两步之间断掉，
这条就记成"已投递"，`from = max(since, delivered)` 让它永不重发：她这句话静默消失，
stats 里 delivered 已经前进，看不出丢过。现在改成 `res.once('finish')` 里推进。

探针验证：死连接 → `delivered` 不动；活连接 → 推进到新 seq。

**2. `/play` 去重指纹太窄**（`brain.mjs`）

`audioUrl + 字幕前 40 字`，且只跟"最后一次 push"比。两个方向都错：
TTS 关掉时 `audioUrl` 恒空 → 两句不同台词前 40 字相同就被判重复；
`lastCue` 被 spark/observe/pomoSay 一律更新 → 真正重复的 `/play` 反而拦不住。
现在指纹带 `source + 动作摘要(id@at)`，用 3 秒 / 12 条的 ring 查。

**3. 番茄钟把离线时间算成专注**（`lib/core.js`）

`elapsed = now - startedAt`，而 `startedAt` 是从 `state.json` 读回来的。关掉游戏几小时后
第一条 `focus:false` 会把整段离线算成这一轮（一次假的 `stoppedEarly minutes:180`、精力 -22）。
现在用 `totalMs - remainMs`（游戏自己倒计时走过多少，与墙钟无关），并加断档判定：
`now - lastBeatAt > 60s` 就按"游戏不在了"结算，标 `stale`，不播报、不扣精力。

顺带把完成判定从"最后一拍恰好采到 ≤90 秒"放宽到"读到 0:00 或倒计时走完全程"——
以前正常跑完会被判成提前停，`remainMin` 还被 `Math.max(1,…)` 抬成 1。

探针验证：
```
中途停（剩 5 分钟，心跳正常）：focus_end minutes=20 stoppedEarly=true stale=false
跑到 0:00：break minutes=25 phase=break
断档 3 小时后：focus_end minutes=20 stale=true（不播报、不倒扣）
```

**4. `phase` 与 `pomo` 两套真源**（`lib/core.js:applyEvent`）

面板点「休息 / 结束」只改 `phase`，`pomo.running` 还是 true —— prompt 说"番茄钟在跑还剩 18 分钟"，
业务层按 break/idle 行事。现在 `applyEvent` 改 phase 时同步 `pomo`。

**5. `pushCue` 失败仍然回 200**（`brain.mjs`）

入队失败只打一行日志，面板按 `result.seq ? … : '已在游戏里演出（服务端下发）'` 显示成功。
现在 `act.pushError` + `act.error` + 502，前端会看到"已生成但没能下发：…"。

**6. `/chat/completions` 会武装离座但发不出去**（`brain.mjs`）

这条路径走完整 `runTurn`（设 `state.away`、塞 `pendingTripCues`），但从不 `pushCue`：
游戏端永远收不到 `slot=trip`，而 `tripLocked` 把窗口里所有动作过滤掉——她一动不动几分钟。
把 trip 下发抽成 `flushTripCues()`，`pushCue` 与这条路径都调它。

**7. 畸形 JSON 被当成空 body**（`lib/http.mjs`）

`JSON.parse` 失败吞成 `json:null`，调用方一律 `json?.x`：`/act` 收到截断 body 会照常花一次
模型调用并推一句莫名的话，`/event` 直接 200。现在 `readBody` 返回 `parseError`，
写操作统一走 `readJsonStrict`（8 个入口），畸形即 400。

实测：`POST /play` 带 `{bad json` → `400 Bad Request`。

**8. `state.json` 写失败只 log**（`lib/state-file.mjs`）

磁盘满 / 只读 / 占锁时，`/act` 与面板都显示成功，重启后好感度与最近对话一起消失。
`save()` 现在返回 `{ok, error}`。

**9. 四份日志无上限追加**（`brain.mjs`）

`gate.log` / `tts.log` / `trip.log` / `usage.log` 都是裸 `appendFileSync`（实测 gate.log 已 375 KB、
gsv-server.log 1.7 MB）。统一走 `appendRotating`：超过 512 KB 就挪成 `.1`，只留一份。
`pruneCueLog` 也改成先用 `statSync` 看大小（以前每次整份读两遍只为比一个长度）。

**10. 游戏快照没有年龄门槛**（`lib/game.mjs`）

`snapshot()` 直接返回最后一次 touch 的对象：游戏关掉几小时后，prompt 里的"窗外已经黑了"、
队列判断、选族仍按那时候的值。现在带 `age` 与 `stale`，超过 2× 心跳间隔当空。

**11. `buildCueItem` 静默截断 8 条**（`brain.mjs`）

编排里 sfx + 多族 start/loop/end 很容易超过 8 条，多出来的直接丢。上限改成
`maxCues + 3`（至少 8），并在 cue 上带 `truncated: n`。

**12. 五处 C# 静默失败**（`PerformerPlugin.cs`）

- 心跳的 `UnityWebRequest` 不是 `using`：`SendWebRequest` 抛异常时 req + 两个 handler + native
  句柄一起漏，每 2 秒一个。改成 `using` 块，错误在 Dispose 前取出来。
- `EnumNames()` 一次失败就把 `new string[0]` 永久缓存（入口是 `if (cache != null) return`），
  之后所有原生动作静默降级。改成空表 60 秒重试 + 只报一次 error。
- `CurrentNativeName()` 的裸 `catch { }` 返回空串，下游当成"族未知"直接放行跨族。
  改成 20 次限速一行 warning。
- 默认机位的 `camDefaultApplied` 在 `ChangeCameraTransform` **之前**置位，整块又被外层
  `catch` 吞掉 → 反射失败一次就"永不重试"。现在只有真的切成功才置位，失败会重试并计数。
- `holdSec` 默认 300 秒 → `Clamp(5,60)` 或 30 秒。

**13. 面板：操作失败不再冒充"连不上大脑"**（`lib/client.js`）

`healthErr` 一份被 `/health`、推演、机位、`/event` 共用：一次推送失败就把顶栏刷成"未连接"。
现在拆成 `actErr`（操作类，单独一行黄色提示）。
顺带：`setMemStats` 只在统计真的变了才 setState（以前 3 秒一次新对象、整块重排）；
API key 输入框改 `type=password`；`outBuf` 加 256 KB 上限。

验收：JS `123 pass / 0 fail`、C# `45 passed`、`doctor 12 通过`、
`/act` 正常出演出、畸形 JSON `400`、机位沿用。

### 修：审计出来的第一批（5 条 P0 + 3 条 P1）

四路只读审计（游戏端 / 侧车 / 路由与宿主 / 面板）出 5 P0 + 24 P1 + 28 P2，
这一批只动"改一处就能收口、且不改变语义"的八条。备份在 `data/_backup_fix_20261120/`。

**P0-1 `/chill/v1/quickbox` 免鉴权且回显 token**（`brain.mjs:2441`）

实测过一个：
```
POST http://127.0.0.1:10723/chill/v1/quickbox   （不带任何头）
→ {"ok":true,...,"url":"http://127.0.0.1:10723/chill/quick?t=<token>"}
```
同一端口的 `/game` 不带 token 是会被拒的——所以不是漏了分支，是压根没写。
拿到 token 等于能读全部记忆、改人设。现在首行 `if (!authorized(req)) return 401`。

顺带把 `Host` 固定成 `127.0.0.1:<req.socket.localPort>`：以前原样拼 `req.headers.host`，
伪造 Host 就能把带 token 的 URL 指向任意主机（浮窗脚本还会照这个 URL 去请求）。

**P0-2 `/chill/host/work/*` 免鉴权，能往在跑的会话里塞文本**（`index.js:262`）

`GET /sessions` 直接返回真实 `sessionId`，`POST /send` 走 `work.send(body.text)`——
本机任何进程、或任意网页发一个 `text/plain` 的 simple POST，就构成对 agent 的提示词注入。
现在两道门：`hostAuth`（与侧车同一套 token，sha256 + `timingSafeEqual`）+
`hostOriginOk`（带 Origin 的请求只放行本机面板端口）。

**P0-3 `/chill/v1/admin/restart` 实际免鉴权**（`serve.mjs:92`）

它只看 `process.env.CHILL_API_TOKEN`，而全仓没有第二处设置这个变量名（宿主注入的是
`CHILL_TOKEN` / token 文件）。改成 `createAuth({ token: resolveToken(...) })`，
与其余路由同一个口径。

**P0-4 `performing` 卡住 = 队列永久停摆**（`PerformerPlugin.cs:4425`）

`performing` 全文件只有两个赋值点（`= true` / `= false`），没有 `try/finally`，
`Forever()` 捕获异常后 2 秒重建迭代器但**不复位**这个标志——`Perform` 里任何一次
（20 多处未保护的 `.Value` / 下标 / `Array.Range` 比较器）抛异常，队列就永远卡在
`if (performing) continue`，而心跳照报在线。现在加 `performingSince` + 90 秒兜底复位（带 error 日志）。

**P0-5 `at` 契约错位：「说到一半换个反应」从来没生效过**（`brain.mjs:1984` / `:2011` / `:1288`）

提示词（`lib/core.js:479/481/484`）要模型给 `at` 为 0~1 的小数（"0.55 说到一半"），
而消费端一路按毫秒读：`Math.round(0.55)` = 1 ms；非 locked 路径更是
`cues.forEach((c,i)=>{ c.at = i*360 })` 整段覆盖。

现在 `normalizeCueTiming`、`buildCueItem`、turn 出口三处统一做 `at <= 1 ? at * estMs : at`
（幂等：毫秒值原样保留），固定节拍只在完全没有有效 `at` 时兜底。

实测（`/play` 两条 cue，`at: 0.55` / `0.9`，`durationMs: 3000`）：
```
cue.test.log → {"id":"story_base001_sub_nod","at":1650,...}
```

**P1-6 语音缓存无上限**（`brain.mjs:128`）

实测 `data/audio` 已 558 MB / 1,843 个文件。启动时按最久未用裁到 512 MB（`audioCacheMaxMB` 可调），
删掉的只是下次重新合成。

**P1-7 面板 `api()` 没有超时，轮询会堆请求**（`lib/client.js`）

`fetch` 一直挂着，`busy` 永远 true；`/act` 本来就要几十秒，直接套短超时会误杀。
所以默认 60 秒、轮询自己传 8 秒，并加 `chatBusy` 守卫：上一发没回来就不再发。

**P1-8 机位按钮失败不回滚**（`lib/client.js:2244`）

乐观更新后失败只写一行错误，按钮还是高亮的——看起来像"切了没生效"。现在回滚选中态。

验收：JS `123 pass / 0 fail`、C# `45 passed`、`doctor 12 通过`、
`/quickbox` 与 `/admin/restart` 无 token 均 401（带 token 正常）。

### 修：机位切了又弹回去

现象：面板点「沙发 / 床」没反应，画面还是书桌。

根因不在按钮，也不在 `ChangeCameraTransform`——它确实切了：

```
camera: ChangeCameraTransform(1) cam=(1.88,1.07,2.69) -> cam=(0.88,0.51,0.24)
```

**但下一帧就被游戏自己的相机逻辑拉回去了。** 切完立刻查，位置是对的；隔 1 秒再查：

```
camera 一览: cam=(1.88,1.07,2.69)   ← 已经回到书桌
```

之前只验了"切完当下"的位姿，没验"过几秒还在不在"，所以一直是坏的却以为好的。

修法：手动机位**每帧续上**。

```cs
if (!camManual || camSeatTr == null) return;
if (camStory) return;                 // 剧情里让位给游戏自己的镜头
var t = Camera.main.transform;
if (t.position != camSeatPos) t.position = camSeatPos;
if (t.rotation != camSeatRot) t.rotation = camSeatRot;
```

两处讲究：

1. **挂在 `Camera.onPreCull`，不是 `LateUpdate`。** MonoBehaviour 之间 LateUpdate 的顺序不由我们定，
   游戏那套排在后面就每帧覆盖我们。`onPreCull` 在所有 LateUpdate 之后、渲染之前回调，
   是这个帧最后一次写入镜头位姿的机会。（先试过放 LateUpdate 开头，实测仍然被覆盖。）
2. **写完要能撤。** `off:all` 与 `home` 会把 `camSeatTr` 置空，镜头立刻还给游戏。

切机位时把该机位的 `Transform` 与位姿一起缓存：

```cs
camSeatTr = (Transform)seatArr.GetValue(idx);
camSeatPos = camSeatTr.position;
camSeatRot = camSeatTr.rotation;
```

实测三个机位都能钉住（隔 1s / 4s / 9s 复查）：

```
ChangeCameraTransform(1) -> cam=(0.88,0.51,0.24)  … 9s 后仍是 (0.88,0.51,0.24)
ChangeCameraTransform(2) -> cam=(0.86,1.73,-2.63) … 8s 后仍是 (0.86,1.73,-2.63)
ChangeCameraTransform(0) -> cam=(1.88,1.09,2.69)  … 仍稳
off:all                  -> cam=(1.88,1.07,2.69)   ← 游戏自己的位姿，锁定已解除
```

### 选动作按姿势族前置：心跳带族、提示词列族、动作换族

上一版只在游戏端拦（跨族就丢），代价是她休息时只剩表情。这一版把族信息往前送，
让她**从这一族里真有的动作里挑**，而不是挑完再被丢。

**① 心跳带上她的真实状态与族**

```cs
string nativeAnim = CurrentNativeName();
sb.Append(",\"state\":\"").Append(Js(AiStateName())).Append('"');
sb.Append(",\"nativeAnim\":\"").Append(Js(nativeAnim)).Append('"');
sb.Append(",\"family\":\"").Append(Js(NativeBasePrefix(nativeAnim))).Append('"');
```

`/chill/v1/game` 现在能看到：`state=BreakMovie family=BreakBase001 nativeAnim=BreakBase001`。

**② 提示词里直接列她这一族能做什么**（`describeState`）

```
我现在这一族（BreakBase001）能做的身体动作只有这些：BreakBase001_Laugh /
BreakBase001_Suspenseful / BreakBase001_OutTrash / BreakBase001_Loop2。
要动就从这里挑；这里没有的动作不要写，写了也演不出来，只会剩下表情。
```

实测这一句就把问题解决了——模型自己挑了同族动作，游戏端一次都没拦：

```
她此刻: state=BreakMovie family=BreakBase001
「我回来啦，想我没」→ nativeNames=BreakBase001_Laugh
game: native name BreakBase001_Laugh 族=BreakBase001 -> BreakBase001_Laugh
game: native play BreakBase001_Laugh
```

**③ 侧车前置换族**（`lib/gestures.mjs` + `applyFamily`），四步：同族原名 → 同族同尾关键词 →
近义（`shy→Laugh/Interest`、`think→Interest`、`drink→DrinkTea`）→ 都没有就丢掉动作。
纯采样的 cue 按 clip 名判族，跨族同样去掉。开关 `cfg.crossFamilyNative`。

日志一行说清这一轮发生了什么：

```
[族] 她这一族 BreakBase001：换掉 1 条、丢掉 2 条、原样 0 条
```

**④ 表本身**：`game/native-gestures.json`（19 族 / 180 条 / `stateToFamily` 10 条），
`lib/gestures.mjs` 读它，读不到就自动退回"不挑，交给游戏端闸门"。

新增 9 条单测（`test/gestures.test.mjs`）：状态归族、clip 归族、同族原样、跨族换同义、
换不出来返回空、整段按族改写、宽松开关不动手。JS 123/123。

### 按姿势族选动作：180 条动作导表 + 同族查表

之前的病根：游戏那 180 条原生动作是**按姿势族命名**的，族与族之间姿势基准不同。
跨族播不是"换个动作"，是"换一套姿势基准"——她会从当前姿势被搬走再搬回来。

先把表导出来（`game/native-gestures.json`，19 族 / 180 条 / 16 KB）：

```
Base001        25      Story  45      Wild  45      Event  7
BreakBase001    5      BreakBase002  4      BreakBase003  2
BreakBase004    6      BreakBase005  5      BreakBase006  5
WorkBase001     6      WorkBase002   7      WorkBase003   6
Desk 3   GameStart 3   WantTalk 3   Enable 1   NotChange 1   GameEnd 1
```

休息族里到底有什么，一眼能看见：

```
BreakBase001(电影)  Laugh  Suspenseful  OutTrash  Loop2
BreakBase002(看书)  NextPage  PreviousPage  Interest
BreakBase003(听歌)  ListenMusicLow  ListenMusicHigh
BreakBase004(喝茶)  DrinkTea  Stretch  DrinkHot  UseCoffeeMaker  CoolingDrinkTea
BreakBase005(睡)    Sleep  GetUpSlowly  JumpUp
BreakBase006         Keyboard  PlayPen  Interest  DropPen
```

同时把 30 个状态对应到族（`stateToFamily`，10 条有据可查的）：

```
BreakMovie→BreakBase001  BreakReadBook→BreakBase002  BreakListenMusic→BreakBase003
BreakTeaTime→BreakBase004  BreakSleep→BreakBase005  BreakForward→BreakBase006
WorkPC/WorkBook→WorkBase002  WorkReport→WorkBase003  ClickHeroine→Base001
```

**选动作改成同族查表**（`SameFamilyNative`），三级：

1. 同族同名 → 直接用
2. 同族带同一尾关键词（`Shy` / `Drink` …）
3. 近义（`shy→Laugh/Interest/Smile`、`think→Interest`、`drink→DrinkTea/DrinkHot`）
4. 都没有 → **不做这条动作**，只留表情与嘴形

实测：

```
native name Base001_Motion5_Shy 族=BreakBase002 -> BreakBase002_Interest
native play BreakBase002_Interest            ← 她在看书，用书族的"感兴趣"

native name Base001_Motion5_Shy 族=BreakBase004 -> (无同族等价)
只留表情和嘴形                                ← 她在喝茶，茶族没有害羞这个动作

native sub DrinkTea -> BreakBase004_DrinkTea  ← 同族有就用，正常播
```

采样那条路也一起堵了（没有原生名的 cue 靠 clip 名判族）：

```
采样 anim_wild_fidget 属于 Wild，她此刻在 BreakBase004，跳过这一条动作
```

宽松开关：`acting/CrossFamilyNative`（默认 `false`）。打开就回到"照播，接管两秒"。

### 三个把这道闸弄哑的 bug

1. `NativeService()` 按类名找 `Bulbul.HeroineService`，找不到就返回 null → 族变成"未知"，
   判定悄悄放行。日志里 `族=(未知)` 就是这个。
2. 兜底按 `DeclaringType` 查找同样拿不到对象。
3. 改成全场景扫字段后又抓错了人：`HeroineUseObjectController` 也有个 `_currentAnimationType`，
   但类型是 `DeskObjectAnimationType`，于是族被读成 `FromBookToPc`。
   根因是扫描前没调 `ResolveNative()`，`nativeEnumType` 还是 null，类型过滤没生效。

最终实现：先 `ResolveNative()`，再扫 `MonoBehaviour`，**只认字段类型 === 那个 180 条枚举**的对象，
扫到就缓存。

### 非专注表演体检：修掉两处，剩一处等你拍

先说结论：**大方向正常**（不切工作态、不打字、演完回她自己的动作），但抓到两个真 bug，修完还剩一个口径问题。

**① 每个动作演了两遍（已修）**

```
queue: play seq=… cues=2      ← 实际只有 1 条 cue
cue in: slot=animations id=anim_break_tea_sub_drink   ← 同一行打了两次
```

`cuesJson` 与老的平行数组 `performance` 是同一批 cue 的两种形态，两段解析**都在加**。
以前两段都跑，等于每句话的每个动作播两次。改成：`cuesJson` 解析出东西就不再解析 `performance`
（老版本 DLL 的兜底仍然有效）。

```
queue: play seq=… cues=1
```

**② 跨基底硬搬（已修）**

她当时在看电影（`BreakMovie` / `BreakBase001`），演出给的子动作是 `DrinkTea`。
`ResolveNativeSub` 在"当前基底找不到"时会去别的基底找，于是：

```
native sub: 她在 BreakBase001，改用 BreakBase004_DrinkTea
native play BreakBase004_DrinkTea
```

她从看电影被整个搬到喝茶的姿势族里，再回电影——一次明显的打断。
游戏在每个基底下各实现一遍同名子动作，正是因为**换基底不是换个动作，是换一套姿势基准**。

现在只用她此刻的基底；找不到就跳过这一条：

```
native sub DrinkTea 不在当前基底（…），跳过这一条动作
```

跨基底采样也不行（实测两只手摆交叉），所以是跳过而不是回落采样。

**③ 还剩一处：`nativeName` 是全身体动作**

她此刻在看书（`BreakReadBook` / `BreakBase002`），演出给的是 `Base001_Motion5_Shy`：

```
native play Base001_Motion5_Shy
… 演完 ↓
watch: clip=anim_break_novel_base_start
watch: clip=anim_break_novel_base_loop     ← 自己回到看书
```

她停一下看书、做个害羞动作、回到看书循环。这一次台词正好是"手会停下来的"，所以是对的。
但同类动作换个场合就会显得突兀——它确实短暂接管了她的身体（约 2 秒），跟"不打断"是两回事。

另外日志上 `motion scope: upper (head/neck only)` 与"动了全身"对不上：scope 只约束采样层，
原生动作用的是游戏自己的状态机，不受这一层管。

两条路，按你的取舍：

- **宽松（现状）**：允许原生全身体动作，当作"她对你的一句话做了反应"，演完自动回原动作。
- **严格**：基底对不上就不演，只保留表情与嘴形——和专注时同一种做法。

### 修：非专注也敲键盘

现象：没开专注，说一句"我写会儿代码"，她就坐到桌前敲起键盘来。

根因不在动画，在**状态**：演出里带的 `stateName`（`WorkPC`）会被当原生状态切过去
（`DebugChangeState`），一进 `WorkPC` 她的身体就是敲键盘循环。而"她在敲键盘"本身是游戏的
**番茄钟语义**——非专注时把她按进去，等于偷走了"开始专注"这个动作的效果，玩家看到的是
"我没开始，她自己打字"。

两道闸，一前一后：

**① 游戏端（硬规矩）** `SwitchState` 在真正下发前判一次：

```csharp
if (!GameBusy.FocusMode && IsWorkState(stateName))
{
    Plugin.Log.LogInfo("state: 非专注，不切工作态 " + stateName + "（她此刻是 " + before + "）");
    yield break;
}
```

`IsWorkState` = `WorkPC` / `WorkBook` / `WorkReport`。非专注时她的**身体状态归游戏**，
我们只做表情、嘴形和手边的小动作。跟 `BreakSleep` 那条同样处理——不替游戏决定她的身体在干什么。

**② 侧车（显示一致）** `buildAct` 之后、拼扁平字段之前，非专注时把工作态清掉：

```js
if (state.phase !== 'focus') { … c.stateName = '' … }
```

不这么做的话面板与 `/act` 返回里会写着 `stateNames:[WorkPC]`，实际却没切——显示和现场对不上，
下次排查会被自己骗。

实测（强制推一条带 `WorkPC` 的 cue，绕过模型）：

```
motion scope: upper (head/neck only) dto=upper focus=False
state: 非专注，不切工作态 WorkPC（她此刻是 BreakTeaTime）
state: 非专注，不切工作态 WorkPC（她此刻是 BreakMovie）
```

她留在自己的休息状态，没有起身去敲键盘。

### 机位定案：三个固定机位，不是那 15 台 vcam

「切到别的视角什么也没有」的根因查清了：**那 15 台 vcam 不是用来日常看的。**

`dump RoomCameraManager` 把现场摆出来了：

```
F Camera _cam = MainCamera          ← 真正渲染的相机
F CinemachineBrain _brain = MainCamera
F Transform[] _camTransform = Array[3]    ← 三台固定机位
F GameObject[] _virtualCameras = Array[15] ← 剧情/装饰模式做混合用
F VirtualCameraType currentVirtualCameraType = Initial
F GameObject currentCam = null
methods: ChangeCameraTransform(Int32)  SetActiveDecorationCam(Boolean,Action=?)
         SetActiveDecorationChairCam/DeskCam/WallPaperLandScapeCam/LandScapeStoryCam
         OnStartStory() OnEndStory() SkipCameraBlend() SetEnableCameraBlend(Boolean)
```

`_brain` 确实在 `MainCamera` 上，所以强开一台 vcam 时 Cinemachine 会接管——但那几台是为
剧情/装饰编辑准备的机位，单独打开没有配套的场景状态，画面就落到空处。**不是没切成功，是切过去了没东西可看。**

游戏平时真正在用的，是 `_camTransform[3]` 这三台：

```
camera seat[0] Camera_Desk pos=(1.88,1.09,2.69) 朝向=(0.77,-0.04,-0.64)
camera seat[1] Camera_Sofa pos=(0.88,0.51,0.24) 朝向=(0.98,0.21,0.00)
camera seat[2] Camera_Bed  pos=(0.86,1.73,-2.63) 朝向=(0.80,-0.24,0.55)
```

而"静止姿势"捕获到的就是 `(1.88,1.07,2.69)` —— 正是 `Camera_Desk`。也就是说游戏默认视角就是这台。

切它用自己的方法 `ChangeCameraTransform(Int32)`，走它自己的 Animator 过渡：

```
camera: ChangeCameraTransform(2) cam=(0.88,0.51,0.24) -> cam=(0.86,1.73,-2.63)
camera: ChangeCameraTransform(0) cam=(0.86,1.73,-2.63) -> cam=(1.88,1.09,2.69)
```

位姿真的跟着变，而且落的是场景里的真实角度。

面板因此收敛成四个：**自动 / 书桌 / 沙发 / 床**。

- `seat:0` → `Camera_Desk`，`seat:1` → `Camera_Sofa`，`seat:2` → `Camera_Bed`
- `off:all`「自动」：关掉全部 vcam 并把主相机摆回静止姿势（Cinemachine 无活动 vcam 时不会自己回去）

15 台 vcam 的名字 DLL 仍认（cue 直传即可），只是不摆在日常面板上了——它们不是给人看的视角。

### 修：切了机位「啥也看不到」

不是机位没切成功，是**切完退不回来**。

Cinemachine 在没有活动 vcam 时**不会把相机放回原处**——它停在最后一次混合到的位置。
我上一版「自动」只做了 `SetActive(false)` 关掉全部 vcam，于是主相机永远留在那台强制机位的
姿势上：可能贴着一面墙，也可能在房间外。玩家看到的就是黑/空。

修法两步：

**① 记住游戏自己的静止姿势。** `RefreshCamera` 每 0.5 秒跑一次，在没有强制机位、
且 Cinemachine 报「无活动 vcam」时，把 `Camera.main` 的 pos/rot 存下来（`camHomePos/camHomeRot`）。

**② 「自动」除了关 vcam，还要把主相机拎回去。**

```
camera: vcam DeskCamera 开（独占） -> active=True | brain=DeskCamera pos=(1.63, 1.10, 2.90)
camera: 主相机归位 pos=(1.88, 1.07, 2.69)
camera: 全部 vcam 关闭 (0 台) | brain=(无活动 vcam)
```

切到书桌是 (1.63, 1.10, 2.90)，点「自动」回到 (1.88, 1.07, 2.69) —— 这才是她正常坐着时你看的那个角度。

另外那台 `pid=9312` 是杀不掉的残影（`Access is denied`，没有窗口）：上一轮切换把游戏弄黑之后
它就没退干净。任务管理器里以管理员结束掉即可，它不占显示、也不再发心跳。

### 机位：全手动，只留日常能切的那几台

面板上多了一排「机位」按钮，切不切完全由人决定——**模型和演出编排永远不碰镜头**。

先摸清现场（`camera` cue 传 `?` 会打一份清单）：

```
camera 一览: current=Initial story=False currentCam=(空) prevCam=(空) | brain=(无活动 vcam)
camera vcams: InitialCamera=off MobileInitialCamera=off BaseCamera=off ChairCamera=off
              DeskCamera=off CoffeemakerCamera=off WindowCamera=off StoryChairFaceToFaceCamera=off
              StoryIntroduceBookCamera=off SofaCamera=off DecorationCamera=off
              DecorationChairCamera=off DecorationDeskCamera=off WallPaperLandscapeCamera=off
              StoryLandscapeCamera=off
```

**15 台 vcam 平时全是 off，`currentCam` 为空。** 所以之前直接调 `VirtualCameraSwitch(Desk)`
毫无反应——没有活动 vcam 可供 Cinemachine 混合，那方法本身在这状态下是空转。
真正在渲染的是普通 `MainCamera`。

于是切换改成两步：先叫游戏切（它自己知道过渡曲线），再把目标那台 `SetActive(true)`。
判据用 Cinemachine 的 `brain.ActiveVirtualCamera.Name`——这是"镜头到底有没有换"的硬证据，
不是靠 `currentVirtualCameraType` 那种会骗人的字段。

```
camera: vcam WindowCamera 开（独占） -> active=True | brain=WindowCamera
camera: 全部 vcam 关闭 (1 台) | brain=WindowCamera
camera: 全部 vcam 关闭 (0 台) | brain=(无活动 vcam)
```

**独占**：开一台之前先把其它 14 台全部关掉。不这么做，游戏自己切活动时会把它那台也打开，
两台同时 active，Cinemachine 按优先级挑一台——你看的是哪台就成了运气。

面板上只放 **自动 / 基座 / 椅背 / 书桌 / 咖啡机 / 窗外 / 沙发**。剧情（面对面、递书、风景）、
装饰编辑三台、壁纸风景、手机这九台没上按钮：它们是游戏各模式专用的，强行打开等于把游戏
按在一个人造状态里。DLL 仍然认这些名字（`camera` cue 直传即可），只是不摆在日常面板上。

「自动」= `off:all`，关掉全部 vcam，把镜头还给游戏自己的逻辑。这是从任何强制机位退出来的
唯一保证。

**手动是结构性保证，不是约定**：`brain.mjs` 的 `buildAct` 之后直接过滤掉 `slot === 'camera'` 的
cue，并记一行 `[camera] 丢弃 N 条机位 cue`。那是唯一会把模型输出变成 cue 的地方——
换模型、改 persona、加技能都绕不过去；而面板走的是 `/play`，不经过 `buildAct`，所以不受影响。

### 修：关掉游戏以后再也拉不起来

现象：控制台拉起一次，玩完关掉，第二次点拉起没反应。

根因不在拉起本身，在**状态口径**。面板上的「游戏运行中」来自带缓存的探针：

```
probe(非 fresh) → ① 8 秒内有心跳就直接认"在跑"
                ② 否则看 45 秒缓存
```

游戏关掉后这两条都还在说"在跑"，于是：

- 按钮 `disabled: gRunning` —— **点不动**；
- 就算点到了，`launch()` 里那次非 fresh 检测也会提前 `return "已经在跑了"`。

两条路一起把重启锁死。而且这不是"拉不起来"，是"根本没发请求"。

改成三步：

**① 检测用 fresh。** `GET /admin/game` 在没有心跳时强制走一次 `tasklist`，
不再拿 45 秒缓存糊弄面板；新增 `stale` 字段（进程在、但游戏没在上报）。

**② 按钮只在她真的在场景里时置灰。**

```js
const gLive = gRunning && gameRun.inScene   // 进程在 ≠ 她在场景里
```

进程在但没有心跳时，按钮变成「重新拉起」且可点。状态胶囊也从「游戏运行中」
分出一档「游戏未响应」——否则玩家看到的永远是"明明关掉了却显示在运行"。

**③ stale 时照样发一次 URI。** 进程在、没心跳，可能是停在标题界面，也可能是关掉时的残影，
**从进程表上分不开**。所以不擅自判定、也不杀进程（那是玩家的游戏），
而是让 Steam 自己处理：对已在运行的 app 它只会把窗口带到前台，对死掉的会话才会真的重开。

顺带把"等它起来"的判据分开——两种起点不能用同一个判据：

| 起点 | 启动成功的信号 |
|---|---|
| 本来没进程 | 进程出现（刚起来的游戏当然还没有心跳） |
| 本来有进程但没心跳 | **心跳回来**（进程表一直会说在跑，看不出它卡死） |

另外失败重试一轮：游戏刚退出的十几秒里 Steam 认为该 app 仍在运行，
会把 `steam://rungameid/` 直接吞掉，隔 2.5 秒再发一次就好。

`test/game-launch.test.mjs` 五条用假进程表锁住以上全部路径，不需要真的开关游戏。

### 专注时的"打断"不是我们写的骨骼，是游戏自己的 `sub_stop`

专注中对话，她会先停手不敲了，演完再回去敲。日志把链路摆得很清楚：

```
voice gate: 演出开始，游戏自言自语/语音已关
watch: clip=anim_work_pc_sub_stop_start     ← 她停手
watch: clip=anim_work_pc_sub_stop_loop      ← 停住不动
voice gate: 恢复游戏语音（演出结束）
watch: clip=anim_work_pc_base_loop          ← 才回去敲
```

`anim_work_pc_sub_stop_*` 是**游戏自己的**子动作：它的流程就是"她要说点什么 → 手停一下 → 说完再敲"。
我们这边把游戏语音源静音了（`voice gate`），但游戏照样播"停手"的动画——
于是画面上就成了**没声音、手也停了**的哑剧。

同时确认了游戏原生的表演模型是**单槽**的：`ClickHeroine` 这套原生反应也会把 `WorkPC` 顶掉
（实测日志 `WorkPC -> ClickHeroine`，三秒内停在 `ClickHeroine`）。所以"原生地边敲边点头"这件事，
游戏自己也不提供 —— 不存在一个"不打断"的动作状态可以借。

### 于是分两层处理

**第一层：专注态不造动作（原生优先）**

新增配置 `acting/FocusNativeOnly`（默认 `true`）：`GameBusy.FocusMode` 为真时，
动画 cue 一律不下发，只让**原生表情层（L2）**和**嘴形/语音层（L3）**回应。
身体全程是游戏自己的状态机，一行骨骼都不写。

实测（真实番茄钟在跑，`focus=1`）：

```
motion scope: upper (head/neck only) dto=upper focus=True
focus: 跳过动作 anim_story_base001_sub_nod，只走原生表情/嘴形
mouth: frames=190 fps=30 audioLen=6.28 active=True
```

她照样眨眼、换表情、张嘴说话，动作一条不演。

**第二层：非专注的叠加演出，不写"这段 clip 没动的骨头"**

`MeasureAndPlan` 现在量每根骨头的峰值偏移，低于 1.5° 的整段不写（`boneDrive` 掩码）。
叠加式的基底是"开演那一刻冻结的游戏姿势"，以前**所有**骨头都被写，于是手臂被冻在起手那一帧——
这就是"一说话敲字就断"的另一半来源。现在只写真正会动的骨头，手臂交回游戏。

日志会打 `drive: N/M bones, 手臂类 K 根`，用来核对。

### 待办：语音门和她的原生台词

`game busy=true (soft self-talk:Voice_PomodoroStart_Word_013)` 就在 `voice gate` 前后出现——
说明她要说话，我们把声音关了，但"停手"的动画留下来了。下一步要么不抢她的语音，
要么在她说话时整条演出让路。这条没改，因为它涉及"她说什么由谁决定"这个产品判断。

### 机位：游戏有 15 台摄像机，我们一直没看见

`RoomCameraManager` 用 Cinemachine 管一整套机位。枚举是 `VirtualCameraType`：

```
Initial=0   Base=1   Chair=2   Desk=3   CoffeeMaker=4   Window=5
StoryChairFaceToFace=6   StoryIntroduceBook=7   Sofa=8
DecorationEdit=9   DecorationEditChair=10   DecorationEditDesk=11
WallPaperLandscape=12   StoryLandscape=13   MobileInitial=14
```

15 台 vcam 都挂在 `RoomCameraManager/Cameras/VirtualCameras/` 下，另有五台**单独开关的隐藏摄像机**
（`_decorationCam` / `_decorationChairCam` / `_decorationDeskCam` / `_wallPaperLandscapeCam` /
`_storyLandscapeCam`）。对外方法：`VirtualCameraSwitch(VirtualCameraType)`、`SetActiveDecorationCam`、
`SetActiveDecorationChairCam/DeskCam`、`SetActiveWallPaperLandScapeCam`、`SetActiveLandScapeStoryCam`、
`OnStartStory` / `OnEndStory`。

对我们有用的两点：

1. **构图**。`Desk` / `Chair` / `Sofa` 是近距离，一个全身动作可能根本不在镜头里；`Window` /
   `StoryLandscape` 更是把人放到画面外。以前编排层完全不知道玩家在看哪。
2. **`isPlayingStory`**。这是游戏**自己**的剧情标志，比我们从文本/语音 token 猜出来的
   `Reason` 权威。先只观察，不拿它接管 `busy`——没有证据说它何时翻转、会不会卡住。

接法：DLL 每 0.5 秒反射读一次 `currentVirtualCameraType` 与 `isPlayingStory`（本地读字段，不走网络），
快照多两个字段 `cam` / `camStory`，监测器的 `FIELDS` 也认它们——换机位是玩家的动作，算一次上报。

**顺带补了签名的一个洞**：`MonitorSignature()` 原来只拼了 `heroState|focus|Reason|scene|heroineReady`，
`busy` 和 `hard` 根本没进签名。也就是说 `hard` 翻转时，如果 `Reason` 恰好没变，事件会整个丢掉。
现在签名覆盖监测器看的**全部**字段，两边口径一致。

验证：

```
真实心跳          cam=Initial  camStory=False  mode=idle  heroState=BreakTeaTime
灌入 cam=Desk     changes 1 → 2，/game 回报 cam=Desk
2 秒后真实心跳    cam 自己拨回 Initial
```

还没验证的是**自然发生的机位切换**：现在 `currentCam=null`、15 台 vcam 全部 inactive、
`currentVirtualCameraType=Initial`，控制台 `VirtualCameraSwitch(Desk)` 返回 OK 但什么都没变——
说明这套机位只在特定状态（剧情、装饰编辑、坐下等）才真的启用。等下次进剧情时看日志里的
`monitor: ... @RoomScene` 后面会不会带上 `cam`。

### 监测器字段表：一张表管三件事

`FIELDS` 现在同时驱动归一化、比对、取值，`WATCHED` / `keyOf` 那两份重复清单删掉了。
新增机位字段只改一处。

### 审计精简：同一件事只说一遍

审计对象是这三轮新增的东西，找的是"同一规则写成两份"的地方——那才是后面会漂移的地方。

| 问题 | 原来 | 现在 |
|---|---|---|
| 监测字段表写了三遍 | `norm()` 七个字段、`WATCHED` 七个名字、`keyOf()` 又列一遍 | 一张 `FIELDS`（名字+类型）同时驱动归一化、比对、取值 |
| "她睡着"判了两次 | `monitor.asleep()` 与 `modeOf()` 各判一次 `BreakSleep` | 只剩 `modeOf()` 一处，`asleep` 整个删掉 |
| 模式判定写了两份 | `brain.mjs` 的 `monitorMode()` 与导演层 `modeOf()` 各一套 | `/game` 的 `mode` 直接取 `modeOf(gameCtx()).name` |
| 两处 `extractNeeds` 各贴一遍游戏语境 | 同一个长表达式复制两遍 | 一个 `gameCtx()` 供两处展开 |
| DLL 日志解析签名 | `ShortSig()` 把签名字符串切开取前两段 | `MonitorLabel()` 直接给一句人话，签名只给差分用 |
| 只有测试在用的导出 | `HEAD_VERBS`、`MODE_NAMES` | 删掉；测试自己从 `ACTIONS` / `MODES` 算 |

顺带修掉一个没有测试覆盖的小 bug：`lastKey` 去重会让"变回上一次报过的状态"被静默吞掉
（抖动窗口内 `cur` 已经动过，`lastKey` 还停在旧值）。去掉它，只保留 `changes` 判空 + 250ms 窗口。

简化后：`game-monitor.js` 120 → 115 行，`director-mode.js` 186 → 179 行，模式判定入口从 3 处变 1 处，
字段表从 3 份变 1 份。生产代码里 `BreakSleep` 现在只出现一次。

### 整体检测（2026-11-19 21:56）

```
doctor       12 通过（runtime/repo/dataDir/game/bepinex/tokenSync/sidecar/host/routes/versions/key/voice）
JS           107/107（并行跑会因 hygiene 那次 219 文件扫描抢 IO 超时，串行 29s 全过）
C#           45/45
活体          mode=idle  heroState=BreakTeaTime  changes=2
标签日志      monitor: GameStartDirection focus=0 剧情中 @RoomScene -> GameStartDirection focus=0 @RoomScene
              monitor: GameStartDirection focus=0 @RoomScene -> BreakTeaTime focus=0 @RoomScene
```

`/game` 的 `asleep` 字段已删（它就是 `mode === 'sleep'`），`mode` 现在是唯一口径。

### 修：番茄钟倒计时被截断，专注中途会误判"跑完了"

`GameBusy.PomodoroRunning()` 读游戏面板的倒计时文本时，正则只取前两段：
`00:27:23` → `00:27`。这个字段原本只用来判"文本在不在变"（判断有没有真的在专注），
没人拿它量剩余时间，所以截断一直没暴露。

侧车 `parseClock('00:27')` = **27 秒**，而真实剩余是 27 分 23 秒。`POMO_DONE_WITHIN_MS`
是 90 秒，于是只要倒计时跳动一次，`applyHeartbeat` 就会走"剩余落到 90 秒内 → 判定跑完了"
那条分支，**把人从专注里踢进休息**。这也解释了之前回归里那几次来路不明的 `phase=break`。

改成三段可选匹配，有秒就带上：

```
00:27:23 -> 00:27:23     parseClock = 1643s  ✓
27:23    -> 27:23        parseClock = 1643s  ✓
30:00    -> 30:00        （只有两段时行为不变）
```

判"在不在变"的逻辑没动，只是字符串变长了。

### 验证：专注计时跑着的时候，监测确实不发声

真专注进行中（`focus=True`，面板 `PomodoroTypeText=创作中`，`TimeText` 从 `00:27:23`
走到 `00:27:12`），15 秒内 `monitorSeq` 保持 7 不动；再观察 8 秒仍是 7。
倒计时在走、切换计数不动，正是要的结果。

侧车这一半另做了带计数的接线测试（`/game` 现在多暴露 `changes`）：

- 基线 `changes=0`，灌 10 次**只有 timer 在变**的心跳 → 仍是 **0**
- 正向对照：一次 `focus` 翻转 + 一次 `hard` 翻转 → **2**，真实心跳覆盖后 → **3**

`monitor.seq` 是观测计数（收到多少份快照），`changes` / `changeSeq` 是切换计数，
两者分开，免得"每次心跳都涨"看起来像在频繁上报。

### 导演层多一个模式：busy（游戏自己在演剧情）

监测器把 `hard` 也带上来了——`GameBusy.IsHard`，即 story 场景 / 剧情文本 / 剧情语音。
这个状态下 DLL **连 pull 都不做**（`RespectGame`），可侧车照样规划整套表演，排出来的条目
只能在 feed 里等到过期。和专注态是同一类病：约束没进到规划里。

现在 `hard` → 模式 `busy`，一拍都不排：

| 模式 | 只动上半身 | 拍数 | 触发 |
|---|---|---|---|
| `idle` | 否 | 2 | 默认 |
| `focus` | 是 | 1 | `focus` 心跳 |
| `break` | 是 | 2 | 番茄钟走完 |
| `busy` | 是 | 0 | `hard`（游戏占着舞台） |
| `sleep` | 是 | 0 | `heroState === 'BreakSleep'` |

优先级：`sleep` > `busy` > phase。两个都是"不演"，但日志口径要能分清是"她睡着了"
还是"游戏在走剧情"——排查时这两件事的处置完全不同。

面板的 `mode` 字段改由同一个判定给出，避免"显示的模式"和"实际编排用的模式"打架。

### 状态监测器：把"定时轮询"换成"切换即报"

之前侧车对游戏状态的认知只有一条 2 秒一次的固定心跳：快照里 `focus` 变了就推番茄钟，
没变就什么都不知道。于是她刚睡着/切状态，最坏要 2 秒侧车才反应过来，这期间还在往她身上
推动作；侧车也**不知道她当前在演哪个状态**，只能靠上一次是什么猜。

两端各补一半：

- **游戏端**（`PerformerPlugin.cs`）：快照里加 `heroState`（当前 `ActionStateType` 名）和
  `monitorSeq`（切换计数器）。心跳循环从"每 200ms 比对一次签名"改成**1 秒一次纯本地字段比对**
  ——不发请求；只有**签名变了那一刻**才 POST，或到 `HeartbeatMs` 发一次存活性心跳。
  `monitorSeq` 只在切换时涨，静默期不动，所以它数的是切换次数，不是发包次数。
  场景切换用 Unity 自己的 `SceneManager.sceneLoaded` 事件（真事件，当场上报），
  而不是挂 Harmony 补丁——全插件不打补丁这条原则没动。
- **侧车**（`lib/game-monitor.js`）：收到快照先做差分，只把**会改变编排口径**的字段
  （focus / timer / heroState / busy / busyReason / scene / heroineReady）挑出来。
  fps、队列深度这类每拍都在变的字段**不算变化**，否则等于没做差分。
  同一组变化 250ms 内重复出现只报一次（游戏偶尔会抖）；`heroState` 读空不算"她切走了"
  ——那多半是 `HeroineAI` 还没就绪。

差分出来的信号是给导演层换模式用的，不是给日志看的。

### 导演层有了真正的模式：idle / focus / break / sleep

`lib/director-mode.js` 把"专注"从 `extractNeeds` 末端一个硬编码的 `if` 抬成一等概念：
一个模式说明**这一段时间允许演什么**，导演层拿到的就是这份约束。

| 模式 | 只动上半身 | 拍数 | 演不了时 |
|---|---|---|---|
| `idle` | 否 | 2 | — |
| `focus` | 是 | 1 | 换成头颈替代，换不了才丢 |
| `break` | 是 | 2 | 同上，替代更放松 |
| `sleep` | 是 | 0 | 什么都不排 |

两条关键判定：

1. **`sleep` 压过一切**。它不是 phase，是**她已经在睡**（游戏按连续专注时长自己送她进去的）。
   那时游戏可能仍是 `idle`，但我们一拍都不能排——否则等于隔几秒把她从梦里拽出来。
   判据是监测器给的 `heroState === 'BreakSleep'`。
2. **`state` 动词在受限模式下一律不放**。`movie` / `music` 的采样族被分到 gesture，
   光看分类会放行，但它们带 `state`，演起来是 `DebugChangeState(BreakMovie)`——
   她直接离开工位去看电影。所以判据是"带不带 `state`"，不是"像不像手势"。

`break` 也走只动上半身：`scopeFor` 那边本来对 break 就返回 `upper`，
两侧口径现在是一致的（以前侧车会给她排全身动作，游戏只给上半身权重，动作做一半像抽搐）。

头颈能演的动词集合（`HEAD_VERBS`）是**算出来的**，不是手写的，加动词时不会漏。
## [Unreleased]

### 导演层适配专注模式：从"排完再删"改成"换一个能演的"

上一版对专注态的处理是**排完之后再过滤**：导演层照常规划整套全身表演，
直到 `extractNeeds` 末端才判掉要身体的那些。后果不是"她只动头颈"，
而是**十条里空六条**——编排预算全花在不能演的素材上，她像掉线一样坐在那儿。

根子是约束没进到规划里。游戏端的 `GameBusy.FocusMode` 是对的
（`motion scope: upper focus=True`），问题在侧车这边只知道"不让演"，
不知道"那让她演什么"。

改法：给每个演不了的动词指定一个**头颈替代**（`FOCUS_ALT`），过滤时替换而不是删除。

| 原意图 | 专注态演 | 为什么 |
| --- | --- | --- |
| 喝水 / 茶 / 伸懒腰 / 揉肩 / 哈欠 / 累 / 深呼吸 / 听音乐 | `nod` | 轻轻点一下，不打断手上的事 |
| 写代码 / 写报告 / 看书 / 小说 / 翻页 | `think` | 抬头想一想，正好是专注的样子 |
| 看电影 | `suspense` | 本来就是电影族的子动作，只是不切状态 |

`nod` / `shy` / `think` / `laugh` / `suspense` 这五个本身就能头颈演，不进替代表。

顺带处理了替换带来的重复：不同意图会被压到同一个动作上
（「困了 + 伸懒腰」都变成 `nod`），同族只留优先级最高的一条，
否则同一个点头会被排两遍。

实机（游戏 FocusMode=true，全部 `scope=upper`）：

```
我困得不行了 -> anim_story_base001_sub_nod          （原：空）
我写会儿代码 -> anim_story_base001_sub_thinking1    （原：空）
我想看会儿书 -> anim_story_base001_sub_thinking1    （原：空）
伸个懒腰吧   -> anim_story_base001_sub_nod          （原：空）
喝口水      -> anim_story_base001_sub_nod          （原：空）
一起看电影吧 -> anim_break_movie_sub_suspense_loop  （原：空）
听会儿音乐   -> anim_story_base001_sub_nod          （原：空）
好耶，修好了 -> anim_story_base001_sub_nod
游戏端：native play Base001_Motion12_Start_Nod / WorkBase001_Thinking
```

回归（专注态）：`native 10 / nothing 0 / skip 0`——之前是 `native 4 / nothing 6`。

### 回归脚本：专注态下要能自己识别，不要硬闯

`live-performance.ps1` 原来不看 phase。游戏一开专注，身体类用例必然为空，
报告里显示成 `nothing 5`，看着像坏了。中途试过"跑之前强制 idle"——**无效**：
`/act` 会从游戏心跳同步番茄钟状态，每调一次就把 phase 推回 focus。

现在改成**记录**每条实际跑在什么 phase 下，专注态的空结果计入 `skip` 而不是 `nothing`，
报告开头直接写明这一次有几条跑在专注态。

### 专注模式：切状态的动词漏了一个口子

专注态的原则是"只动头颈"。原来的过滤只看采样族的分类：

```js
if (classifyClip(n.name || n.family) !== MOTION_CLASS.GESTURE) 丢弃
```

但 `movie` 的族是 `anim_break_movie_sub_suspense`，分类器把它判成 **gesture**——
因为它是挂在上半身的子动作。于是专注时长按「一起看电影吧」，她会在工作途中
把游戏状态切到 `BreakMovie`，也就是**直接离开工作去看电影**。`music` 同理
（`anim_break_music_low` 也是 gesture）。

根子在"分类看的是采样族，但这类动词真正要做的是切状态"——切状态是
`DebugChangeState`，换的是整段行为，跟采样族被分到哪一类没有关系。

修法：带 `state` 的动词在专注态一律拦下，理由单独写成「专注模式不切状态」，
和「只动头颈」区分开，排查时能一眼看出是哪条规则拦的。

```
专注态实测
  一起看电影吧  scope=upper cues=0
  听会儿音乐    scope=upper cues=0
  我想看会儿书  scope=upper cues=0
  伸个懒腰吧    scope=upper cues=0
  好耶，修好了  scope=upper cues=1   （点头放行）
```

### 纠正：睡觉不该由我们触发

上一版把 `sleep` 接成了 `state: 'BreakSleep'`，还实测「切过去了」当成通过——**这是错的**。

她的睡意是游戏按**连续专注时长**自己累积出来的，到点了游戏自己送她进 `BreakSleep`。
我们去切这个状态不但多余，而且 `DebugChangeState(BreakSleep)` 有前置：不先置
`ActivateSleepFlg` 就会被静默吞掉。DLL 里为此专门挂了个反射钩子去强行置这个标志位——
那已经是在改游戏自己的状态位，不属于"不侵入"的范畴。

改动：

- `actions.js`：`sleep` 去掉 `state`，加 `noMotion: true`
- `needs.js`：`noMotion` 的动词照常参与识别（「睡吧」不会被误判成别的），
  但不产生任何动作，丢弃理由写明"交给游戏"。第二拍同样不放行。
- `PerformerPlugin.cs`：移除 `ActivateSleepFlg` 钩子（`aiActivateSleep` 字段、
  反射绑定、以及置标志的那段）。DLL 194,560 字节。

实机确认：

```
先「我想看会儿书」→ state: WorkBook
再说「睡吧」      → stateName 为空、cue 0 条
游戏端            → 没有任何 state 切换，没有 cue in
```

她继续看书，完全不被打断。

**再加一道反方向的闸**：她已经被游戏送进 `BreakSleep` 时，`SwitchState` 直接跳过，
不再拿指令把她吵醒。游戏送她睡是长时间专注的结果、是它自己的节奏；
我们每来一句话就切一次状态，等于每隔几秒把她从睡梦里拽出来。DLL 195,072 字节。

顺带补了 `sleep` 的触发词——原正则只认 `睡一会|睡一下|睡…觉|睡…会儿`，
所以「睡吧」「该睡了」「你也早点睡」**一个都命中不了**（不报错、不动作）。
现在都能认出来，但认出来只用于"听懂"，不产生动作。

### 动作表体检：族名全部有效，但睡觉只认一种说法

拿 20 个动词逐个对游戏清单核了一遍：`family` 是否真的存在于 352 条动画里、
`facial` 是否在 FacialType 的 8 个值里、`stateName` 是否真的能切过去。

- **族名**：20 个全部有效（清单存的是分段名 `_start/_loop/_end`，族基名靠剥后缀得到，
  所以第一次审计把族名当键查，报了 14 个假阳性）。
- **表情**：6 个带表情的动词全在 FacialType 里。
- **状态名**：7 个 `stateName` 走的是 `HeroineAI.ActionStateType`，和 AnimationType 是两套命名空间。
  逐条实测：`WorkPC` / `WorkBook` / `BreakReadBook` / `BreakMovie` 早前验过，
  这轮补验 `WorkReport`、`BreakListenMusic`、`BreakSleep` —— 全部真的切过去了。

**体检抓到一个真的**：`sleep` 的正则只认 `睡一会|睡一下|睡…觉|睡…会儿`，
于是「睡吧」「该睡了」「你也早点睡」**全部命中不了**——她不睡、不报错、日志里什么都没有。
这几种说法比"睡一会儿"更常用。补齐后：

```
「睡吧」「该睡了」「你也早点睡」「睡觉吧」「趴一会儿」「眯一下」 → sleep
「你困了就睡吧」 → yawn 开场 + sleep 收尾（两拍：先打哈欠再躺下）
「我睡一会儿」   → 仍然不跟着睡（他说他自己，不传染）
实况：state: BreakReadBook -> BreakSleep ✓
```

### 编排层对齐：时间轴不再互相踩，顺序跟着话走

编排是三层串联（director → planSequence → needs + arrange），三层各自都能算时长、能排序。
口径一旦不一致，症状都是「动作演到一半跳走」或「顺序和话反着来」。这轮修了四个：

**① 时间轴重叠**：`arrange` 推进游标只加了 `span`，没加 `hold`。
主戏按住循环段等语音说完的那一段，被下一拍从中间切断——L0 只有一层，后一条进来前一条就被顶掉。

```
「先喝口水，然后接着写代码」语音 8 秒
修前：喝水 0→2334，写代码 at=2334    （喝水只演了四分之一）
修后：喝水 0→8000，写代码 at=8000
```

**② 半边动作表的时长是 0**：`spanOf` 一律拼 `family + '_' + seg`，
但单段族（137 个）的 `segs` 是 `['single']`，时长记在族自己身上——
拼出来的 `anim_..._nod_single` 这个键不存在，于是算出 0，`arrange` 退回 1200ms 兜底。
20 个动词里有 10 个中招：

```
回退后测试报出：tea, stretch, shoulder, tired, breathe, read_book, novel, nod, pageflip, suspense
```

三段族里的 `single` 是"不拆分时的整段"，和三段重复，不能加进去——所以只对单段族走 `durationOf(family)`。

**③ 陪伴类主戏被排到收尾之后**：`need()` 只把 `kind === 'core'` 当主戏，
陪伴类（他在做、她陪着做自己那份）落到 `anchor: 'tail'` + `prio: 10`；
而 `arrange` 又把 `companion` 当 `core` 演、并按 anchor/prio 排序。两层口径不一致：

```
「我想看会儿书，然后伸个懒腰」
修前：伸懒腰 at=0，看书 at=4000     （和句子顺序正好反着）
修后：看书 at=0（按住到 9000），伸懒腰 at=9000
```

**④ 起手动作取决于模型这次怎么排**：`buildSuite` 用 `list.find` 取第一条手势，
拿到的是"模型这一轮把哪条排前面"。同一句话换个请求就可能换个起手，
而且在模型侧改不掉。改成先按 `at`、再按 id 字典序排序，只由内容决定。

### 新增 `test/orchestration.test.mjs`（6 条）

把上面四条钉成约束，外加两条结构性的：主戏必须按住到语音说完（否则后半段空场），
以及**导演层和编排层必须对"主戏是什么"给出同一个答案**——「先喝口水」曾被闸门换成"笑"，
就是两层分歧的后果。

三条关键测试都做过反向验证：把对应的修复回退掉，测试会变红（`spanOf` 那条正好报出上面那 10 个动词）。

### 片段通道铺到三种持续状态：写代码翻页 / 看小说翻页 / 看电影揪心

`pageflip` 前一版只认 `PageFlip` 这个后缀，实际只有 `WorkBase002`（写字）有它。
看小说时基底是 `BreakBase002`，那里的翻页叫 `NextPage`，于是同一条需求在小说场景下解析不出来。

`nativeSub` 支持 `nativeAlso`（逗号分隔的备选后缀），`ResolveNativeSub` 是
**基底外层、后缀内层**遍历：先试 `当前基底_PageFlip`，不中再试 `当前基底_NextPage`。
所以补一个 `also` 就同时覆盖两个基底，不需要在服务端判断「她现在在哪个状态」：

```js
pageflip: { native: { sub: 'PageFlip', also: 'NextPage' } }
```

顺手把 `novel` 的触发词里的「翻页」去掉了——它会把「翻页」这个动作当成「开始看小说」，
而真正的动作入口是 `pageflip`。现在改成 `/小说|故事|章节|长篇小说/`。

新增 `suspense`（看电影揪心处）：

```js
suspense: { re: /紧张|揪心|好悬|捏把汗|不敢看/, native: { sub: 'Suspenseful' } }
```

三种基底的实测解析结果：

| 场景 | 当前基底 | 动词 | 实际播的片段 |
| --- | --- | --- | --- |
| 写代码 | `WorkBase002` | `pageflip` | `WorkBase002_PageFlip` |
| 看小说 | `BreakBase002` | `pageflip` | `BreakBase002_NextPage` |
| 看电影 | `BreakBase001` | `suspense` | `BreakBase001_Suspenseful` |

**已知边界**：`ResolveNativeSub` 在当前基底找不到时会去试 `SubFallbackBases` 里的一串基底。
如果她正在听音乐（`BreakBase003`，没有翻页子动作），`pageflip` 会一路降级到
`WorkBase002_PageFlip` —— 姿势基准是坐着写字，硬播会有点错位。这是 `nativeSub` 通道
本来就有的行为（`laugh` 也一样），不是这次引入的；真要根治得让 DLL 只接受当前基底。

### 持续状态里的「片段」：翻页、走神这类小动作不再靠换状态硬凑

原先一个动词要么是「演一下」（采样/原生单次动作），要么是「她在干什么」（切状态机），
没有中间态。于是「看书时翻一页」这种需求只能整段换成另一个状态——视感是动作被打断重来。

探了游戏自带的模型才发现不用自己叠层：**游戏在每个基底上都实现了一遍同名子动作**
（`WorkBase002_PageFlip=253`、`WorkBase002_Thinking=252`、`WorkBase002_DrinkTea=256`…），
而且这些片段演完会**自己回到 `base_loop`**。实测：

```
play 253 -> L0 切成 anim_work_book_sub_pageflip（2.67s）
       -> 之后自动回到 anim_work_book_base_loop
```

所以正确做法不是叠两层动画，而是**发一条片段名，让游戏自己的状态机负责回落**。

关键机制是 `nativeSub`：它只给后缀（`PageFlip`），全名由 DLL 按她**此刻的基底**拼出来，
因为每个基底下的同名子动作姿势基准不同（拼错会看到两只手交叉）。落地一个动词：

```js
pageflip: {
  kind: 'gesture',
  family: 'anim_work_book_base_loop2_pageflip',  // 基底对不上时的采样兜底
  re: /翻页|翻一页|翻到下一|下一页|翻过去/,
  native: { sub: 'PageFlip' },                   // 全名到游戏端拼
}
```

端到端实测：

```
/act 看会儿书 -> stateName=WorkBook
/act 翻一页吧 -> nativeSub=PageFlip
游戏日志      -> native sub PageFlip -> WorkBase002_PageFlip
动画器        -> currentAnimationType = WorkBase002_PageFlip，L0 随后回到 base_loop
```

`ResolveNativeSub` 会依次试「当前基底」和几个 fallback 基底，对不上就退回采样或跳过——
所以它在她没在写字/读书时不会乱演。

### 表情接上了：FacialType 从「写好了没人用」变成真的会换脸

DLL 侧 `ChangeFacial` / `FacialIds` / `CueDto.facial` 早就铺好了，但服务端一个动词都没带过
`facial`，所以那条路一直是死的。这次接上，并且顺手修了一个结构问题：

**表情原本被关在状态机分支里。** 原来只有「带 `stateName` 的 cue」才会顺带换表情，
于是只有写代码 / 看书这类持续状态能变脸，点头、害羞、打哈欠这些一次性动作永远一张脸。
现在表情提到状态机分支之外独立处理——它落在 L2（Facial），身体动作在 L0（Base），
本来就是两层，`只换脸不改姿势` 是合法的。

数据侧改动：

- `toNative` 里 `facial` 独立于 `state` / `native` 两条路返回，所以「有表情但既不是状态
  也不是原生动作」的动词也能带出去（以前会 `return null` 直接丢掉）
- `describeNative` 补上 `状态:` 与 `表情:` 两段（原先只认 `nativeName` / `nativeSub`，
  走状态机和只带表情的两类 cue 在日志里是隐形的）

首批带表情的动词（映射到 `FacialType`）：

| 动词 | 表情 | 理由 |
| --- | --- | --- |
| `shy`（害羞） | `Shy_Fun` | 害羞带笑，最贴 |
| `laugh`（笑） | `Shy_Joy` | 开心 |
| `tired`（累瘫） | `Shy_Sad` | 累的时候脸是垮的 |
| `yawn`（打哈欠） | `Shy_Sad` | 困 |
| `breathe`（深呼吸） | `Shy_Rest` | 放松 |
| `stretch`（伸懒腰） | `Shy_Joy` | 舒展的舒服 |

**端到端实测**（不是看代码推断）：

```
/act  -> id=anim_story_base001_sub_shy  facial=Shy_Fun
游戏日志 -> facial -> Shy_Fun(2)
```

`(2)` 是 `FacialType.Shy_Fun` 的枚举值，说明 DLL 真的按名字查到了并调进去了。

### 删掉平行数组：cue 只剩一条通道

上一版留了 `slots / ids / ats / holds / nativeNames / nativeSubs / nativeAlsos /
stateNames / facials` 十条平行数组给旧 DLL 过渡。这次两端一起删干净：

- `PerformerPlugin.cs`：`ParseActDict` 里的平行数组解析分支整块移除（约 130 行，
  文件 3829 → 3798 行，DLL 195584 → 195072 字节）
- `brain.mjs`：`buildCueItem` 只发 `cuesJson`，四条平行数组的 `map` 删除

现在加一个 cue 字段只需要动两处：`CueDto` 加字段 + 解析处加一行。

**验证**：删完后重跑端到端，`facial -> Shy_Fun(2)` 照常，说明 `cuesJson` 单通道确实覆盖了
原来的全部能力。

### 修复：模型明确给了动作，她却一动不动

`test/server.smoke.mjs` 一直是红的，症状是 `performance` 里少了 `animations` 那一条。
查下来是个真 bug，影响面比一条测试大：**模型按清单给的动作会被两层逻辑悄悄丢掉**。

两个独立原因，叠在一起：

**① 纯数字 id 分类不出来**

清单里 `1001` 的名字是 `Joy`（语义 `happy`），但 `classifyClip('1001')` 只能返回
`unknown` —— 分类器是按 clip 名的 token 判断部位的。于是专注态那道
「只让头和颈动」的过滤把它当成身体动作删了。

修法是把清单名一路带到需要分类的地方：`sanitizePerformance` 给 cue 补 `name`
（从 manifest 查），`needs.js` 建 `nameByFam` 映射，分类统一用 `n.name || n.family`。
id 仍原样下发给游戏端，只是分类时多一份信息。

**② 主语规则误杀模型直给的动作**

`from === 'cue'` 表示「这个核心动作是模型给的，不是从这句话里判出来的」。
但原来的主语兜底把它也套了进去：整句都在说他（有「我」没「你」）就按「他的身体」处理，
于是「我写完了」+ 模型给的动作 → 判定「他说的是他自己，这类不传染」→ 丢弃。

主语规则是用来否决**文本推断**的（他说自己累、困），模型已经替我们决定了她要演什么，
再拿整句主语否决一次就反了。现在 `from === 'cue'` 时不走主语否决。

**影响**：之前凡是「文本主语是他 + 模型给了动作」的组合，动作都会被吃掉，
表现就是她只说话不动 —— 这恰恰是最常出现的场景。

**验证**：`server.smoke.mjs` 由红转绿，全套 85 条单测通过，
`live-performance.ps1` 回归 `native 7 / sample 0 / nothing 1`。

### 降低维护成本：cue 走单通道 + 游戏端有了单测 + 宿主壳拆出监护模块

三处都是"改一处要动五处"的地方，按风险从高到低处理。

**① cue 传递从 10 条平行数组塌缩成 1 条**

原先每个 cue 加一个字段，要在五个地方同步：`CueDto` 字段、DLL 对象数组分支、
DLL 平行数组分支、`brain.mjs` 赋值、`actions.js/nativeOf`。漏任何一处都是**静默失效**
（字段写了但游戏端收不到），20 小时内实际踩了两次（`nativeSub`、`stateName`）。

改成 `cuesJson: string[]` —— 每项一条 JSON 文本。关键判断是
**`JsonUtility` 不可靠的只是"对象数组"，`string[]` 它认**，而游戏端的 `JsonLite`
本来就是手写解析器、不受这个限制。现在加字段 = `CueDto` 加一行 + 解析处加一行。

老的平行数组保留一版给旧 DLL 过渡，下个版本删。

**② 游戏端 5,883 行 C# 第一次有测试**

`game/test/` 用 Windows 自带的 `csc.exe` 编译（不需要 .NET SDK、不需要 Unity），
覆盖零 Unity 依赖的两个入口：`JsonLite`（所有 cue 的解析器）和 `AnimIdMap`。

45 个用例，重点在**畸形输入不许抛**——`ParseActDict` 外面那层 if/else 一旦被异常穿透，
pull 循环就永久静默。实测 `{"a":`、`[1,2`、`not json at all` 都安全返回空值。

顺手补了 `tools/gen-animmap.mjs`：原先 `AnimIdMap.cs` 是手工生成的，没有生成器，
游戏更新后没法重算。现在从 `enum HeroineService` 的 dump 里按段取
`Bulbul.HeroineService+AnimationType`（180 条，去哨兵 `NotChange=-1` 得 179 条）。

**③ `index.js` 的 `apply` 从 531 行降到 380 行**

侧车监护（spawn / 行缓冲 / 退出退避 / 换代 / 源码热更新）整块搬到
`lib/sidecar-supervisor.js`，对外只暴露 `ready` / `port` / `pid` / `state()` / `recycleSafe`。
`apply` 只留装配。

两条历史教训随代码一起搬进了新模块的注释：任何异步路径都不能抛未处理拒绝
（2026-11-13 两次「dsh 自己关了」）、行缓冲不能假设一行就是一个 chunk
（认不出 READY 就永远 503）。

**验证**：单测 85 条全过（新增 45 条 C# + 5 条 supervisor + 4 条 apply 接线）、
`live-performance.ps1` 回归 `native 7 / sample 0 / nothing 1`（与改前一致）。

**遗留**：`test/server.smoke.mjs` 是红的，但 baseline 也是红的（已用 git stash 验证），
与本次改动无关——症状是 `slots` 少了一条 `animations`，待查。
`index.js` 的改动要重启 `dsh web` 才生效。
### 修复：照游戏自己的做法换镜头（房间相机）

我一直在书桌视角里硬挪她，所以画面永远是"人不见了、镜头还在书桌"。扫出来的真答案是
**房间里本来就有三台相机**，游戏就是靠切换它们换视角的：

| 相机 | 世界坐标 | 用途 |
| --- | --- | --- |
| `MainCamera` | (1.88, 1.07, 2.69) | 常驻 |
| `Camera_Desk` | (1.88, 1.09, 2.69) | 书桌视角（与 MainCamera 同位） |
| `Camera_Sofa` | (0.88, 0.51, 0.24) | 沙发视角 |
| `Camera_Bed` | (0.86, 1.73, -2.63) | 床视角 |

`RoomCameraManager` 里还有 `isPlayingStory` / `StartCameraAnimHash`。
所以离座这件事的正确做法是：**切相机 + 人摆到那台相机拍得到的地方**，两件一起做。

- `CacheRoomCameras()` 按名字缓存三台相机；`SetRoomView("sofa"/"bed"/"desk")` 切换
- 去程：切到对应视角 + 根位移到"沙发往相机方向 0.35m"；回程：切回书桌视角
- 站位以镜头为准，不再以她原来站哪为准（上一版按"沙发往椅子方向 0.55m"算，换到沙发相机看就是怼在镜头上）
- 道具跟随默认关（`acting.Props=false`）：椅子/窗户那套 clip 是按别的锚点摆的，套过来会把物体甩到位
- 手动走位多一个开关 `acting.TripWalk`（默认 false），有对应房间相机时自动生效

实测：`room view: sofa` + `trip walk: go from=(2.74,0,1.70) to=(0.31,0,-0.07)` + `rootΔ=3.00m`。

### 修复：椅子不再被甩到镜头前

截图现场：椅子整块糊在镜头前。原因是我把 `leavechair_*` 这套 clip 也套给椅子——
`m_Chair_mobile` 上确实有同名 clip（136 条同名），但那套椅子动画是按**另一套场景锚点**摆的，
采样过来就把椅子甩到镜头前，还停在那儿。

- 离座 / 回来这两族不再驱动道具（`skipPropForTrip`）；"东西在手上/桌上"那类照旧跟随
- 她起身离开时，椅子就留在书桌前

实测：`rootΔ=2.80m`（去程真的挪了 2.8 米），椅子不动。

### 修复：她真的走到沙发上（不再是原地踏步）

`sofa_go` / `sofa_comeback` 是**原地动画**——实测 `rootΔ=0.00m`，clip 里根本没有位移键。
更糟的是写回那一行每帧把每根骨的局部位置强制写回游戏待机姿势：

```csharp
tr.localPosition = gamePos[i];   // 把她钉在原地
```

所以"离开椅子去沙发"从头到尾只是原地做了套动作，人还在画面里没动。

- 离座 / 行走类 clip 放行根位移；按住段（`sofa_deepthink_loop`）把根冻在走到的位置
- 沙发锚点按名字现找：`m_couch_mobile`（`Sofaside` 是边几，跳过）
- 去程 / 回程按 clip 进度做 smoothstep 位移，和脚步同一节奏；站到沙发前 0.55m，不站进坐垫里
- `clip done` 日志带上 `rootΔ=`，以后一眼能看出"这一条到底有没有位移"

实测：`trip walk: go from=(2.74,0.00,1.70) to=(0.45,0.00,0.08)` —— 走了约 2.5m 到沙发。

### 新增：真的"在沙发上待 3~5 分钟" + 道具跟着动

前一版离座只是一趟 10~30 秒的行程。用户要的是"她真的离开一段时间"，
所以加了**按住（hold）**：一段循环能按住几分钟，按完再接下一段。

- 游戏端（`ChillPerformer.dll`）
  - cue 支持 `holdMs`：把这一族的循环段按住这么久，采样对段取模 → 原地循环
  - 分段形式（`X_loop` + hold）也认；按住段不被 `MaxClipSec` 截断、不被速度缩放
  - 条目级 `ttlMs`：预排的"回来"那条要在队里等几分钟，全局 45s 会把它当过期扔掉
  - **道具跟着动**：同一 clip 名可能同时存在于角色和道具（`m_Chair_mobile` 的
    `ChairAnimationCtr` 就有 136 条同名），以前只采样角色 → 人走了椅子不动。
    现在按同一归一化进度逐个采样；这一条没有同名道具 clip 时，道具冻在上一条最后姿势
    （否则椅子自己的人会接着播 `Chair_Idle`，弹回原位）
- 侧车
  - `tripItems()` / `tripWindow()`：一趟行程拆成出去 / 待着 / 回来三条队列条目
  - 待着时长 `stayMs()` 3~5 分钟随机（`STAY_MIN_MS` / `STAY_MAX_MS`），只有沙发行程有这一段
  - 接管窗口 = 出去 + 待着 + 回来 + 2.5s，期间对话零动作
  - `data/trip.log`：离座决策落盘（`log()` 只进宿主控制台，翻不到）

实测：`我去沙发上躺一会儿` → 这句话 → `sofa_go`（`props follow: 1 个道具`）→
`sofa_deepthink_loop` 按住 3~5 分钟（`sequence: total=199~273s`）→ `sofa_comeback`
（`props follow: 1 个道具`）→ 回到坐姿；窗口内说「嗯，点个头」零动作。

### 新增：离座长途 —— 需要离开椅子的事，接管一整个时间段

坐着做不完的事（去拿杯子、去沙发躺）不能当"插入一个动作"：插入的落点是椅子，
放她离座，归还就没有落点，而且那几秒她不在画面里。所以这类事按**接管一段时间**处理：

- `lib/seat-trip.js`：6 趟行程（拿杯子 16.3s / 零食 19.3s / 面包 18.1s / 蛋糕 19.3s /
  沙发 30.2s / 出去走 10.9s），每趟都是「起身 → 在那做的事 → 回来坐下」，时长取自清单
- 启动门槛：冷却 12 分钟、她手上没活在演、不在专注模式——每次都是十几秒的接管，不能因为
  一句话里出现"沙发"就演
- 接管窗口（行程总长 + 2.5s 余地）内，所有对话**只出字幕与语音、零动作**
- 窗口结束自动解除（`state.away` 落盘，重启后仍认）

共存规则：离座接管期间，核心动作与内容闸门都跳过——不然「我去倒杯水」会先启动行程，
又被核心动作改回坐着喝茶（实测踩过）。

实测：我去倒杯水 → `cup_go@160 → cup_comeback@8000`；接管中「嗯，点个头」→ 零动作；
窗口过后 → 正常点头；冷却中再说"再拿个杯子" → 不启动，坐姿回应。
回归：run-tests 24/24、verify-motion 37/37、test-live 14/14、eval-motion 18/18。

### 新增：核心动作机制 —— 先定"核心行为"，再以它编一整套

起因：「有点渴了」演成了打哈欠——模型把"喝"和"困"都当身体反应，同一句话每次挑的族还不一样。
现在先由语句判核心行为（喝/困/写/点/害羞…17 个），判出来就锁在一个族上：

- `lib/core-action.js`：`decideCore()` 按语句认核心（带"先/让我/给我"标记的那一拍优先）；
  `buildSuite()` 编成 **起手 → 核心 → 收尾** 三拍——小反应只在内容对得上时留
  （「累瘫了」不会先调皮一下），同一族不重复（「嗯…我同意」只点一次头）；
  `spanOf()` 给每族"整套跨度"（start+loop+end 之和）
- 核心族一律用**动作族**（`_sub_*`），不用 `_base`：`_base` 是游戏自己的场景待机，
  分类器把它判成 idle，拿它当动作等于"演她正在做的待机"
- `brain.mjs`：核心判定放在闸门**之前**（模型一条动作都没给时也要生效），闸门之后再
  以核心为准锁一次（闸门按模型 want 挑，曾把"喝水"换成笑）
- `planSequence`：带 `locked` 的一整套不再排序，只串行化，游标按整套跨度推进
  （按循环段长度推进会让收尾插进核心中段——实测伸懒腰被插在写代码中途）
- 结尾那段"按 360ms 打散"对一整套停用：三拍会被挤成一团

实测：渴 → `tea_sub_drink` start/loop/end 一整套；写代码累了先喝水 → 喝水一拍 + 写代码一拍
（@160 / @2714）；困死了想趴一会 → 哈欠 + 趴下；同意 → 只点一次头。
回归：run-tests 23/23、verify-motion 37/37、test-live 14/14、eval-motion 18/18。

### 改动：排队深度 4 → 8、等待有效期 20s → 45s

- `queue.Max` 默认 4 → 8：连发五六句时，第 5 句往后的指令会把最早那句中段挤掉（实测某夜 `queue.dropped=26`）
- `queue.TtlMs` 默认 20000 → 45000：6 句连发跑下来最后一句会因为排队超过 20 秒被判过期（实测 `expired=1`）
- `/game` 的 `queue` 块新增 `maxQueue` / `ttlMs`，配置值可以直接从接口核对（`maxDepth` 是"观察到的最大深度"，不是配置，别拿它验）
- 实测：7 句连发 `played=7 / dropped=0 / expired=0`，峰值深度 3（够不到 8，正常对话到不了上限）

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