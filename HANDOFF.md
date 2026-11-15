# 交接文档 · 聪音 AI 大脑（chill-brain）

> 写给下一个接手的人（或下一个对话里的我）。看完这一篇就能接着干，不用翻聊天记录。
> 最后更新：2026-11-15 22:00

---

## 0. 一句话现状

三层都装好了、能跑、能演：**对话 → 编排 → 游戏里的身体动作**这条链路是通的，
核心动作机制（一句话决定一整套动作）和"离座长途"（离开椅子接管一段时间）都实现并测过。

**唯一没解决的是"离座"的视觉效果**：她播了离座动画，但人不会真的走到沙发那儿坐下。
原因已经查到底了（见 §5），下一步要做的事已经在 §9 排好序。

---

## 1. 这是什么

《放松时光：与你共享 Lo-Fi Story》（Steam appid `3548580`）的伴侣 AI。用户（YG）的原始口径：

- 「插件化的形式来制作，后端控制在 deepseek，前端游戏负责表演」
- 「只使用游戏本身的资源」
- 「尽量不要改动游戏，因为游戏官方会更新」
- 「游戏本体不进仓库」「别反编译改动游戏」「宣传我自己来，你别管」

所以这套东西的边界是：**游戏一个字节都不改**（只往 `BepInEx/plugins` 放我们的 DLL），
所有动作都用游戏自己的 clip 演。

## 2. 三层结构

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 宿主插件 | `index.js`（仓库根） | 监护侧车进程、把 `/chill/v1/*` 反代到侧车、热换代 |
| 侧车 | `serve.mjs` + `brain.mjs` + `lib/` + `routes/` | 对话、记忆、编排、TTS。默认 `127.0.0.1:10723` |
| 游戏端 | `game/src/*.cs` → `game/ChillPerformer.dll` | BepInEx 5.4 插件，把指令变成骨骼动作 |

宿主端口 `10722`（外部只认这个），侧车 `10723`（内部）。

### 本轮改动集中在这几个文件

| 文件 | 作用 |
| --- | --- |
| `lib/core-action.js` | 核心动作层：一句话 → 动作族 → `pre/core/after` 三拍编排 |
| `lib/seat-trip.js` | 离座层：行程表、`tripItems()`、`tripWindow()`、冷却 3~5 分钟、待着 3~5 分钟 |
| `lib/motion-class.js` | 动作分类（gesture/prop/posture/locomotion/idle），`isOffChair`、`seatGuard` |
| `brain.mjs` | 编排主流程。离座块在 `decideTrip` 之后，`tripLocked` 期间屏蔽核心动作与内容闸 |
| `game/src/PerformerPlugin.cs` | DLL 全部逻辑：采样、编排、队列、按住（hold）、道具、走位、房间相机 |
| `tools/patch-*.mjs` | 逐个功能的小补丁脚本（见 §8 的坑） |
| `test/*.test.mjs` | 24 个测试文件，`node tools/run-tests.mjs` 全跑 |

## 3. 提交历史（本轮）

```
1c2bb89 feat: 照游戏自己的做法换房间镜头（Camera_Desk/Sofa/Bed）
f37220e fix: 椅子不再被甩到镜头前（离座族不驱动道具）
56a5f98 fix: 她真的走到沙发上（sofa 动画是原地动画，位移得我们自己给）
33f463f feat: 真的在沙发上待 3~5 分钟 + 道具跟着动
d0414b3 feat(trip): 离座冷却 12 分钟 → 3~5 分钟（每次随机）
f17cad6 feat: 离座长途 —— 需要离开椅子的事，接管一整个时间段
53914ba feat: 核心动作机制（一句话决定一套动作）
```

**工作区还有一笔没提交**：位置写回移除 + 髋骨诊断 + 旁观记录器（`patch-posfree.mjs`、
`patch-recorder*.mjs`、`patch-watchtick*.mjs`）。DLL 已构建并部署（158,208 B），但没 commit。
下一件事就是先 commit 它（或者先看 §9 决定要不要保留）。

## 4. 已验证 / 未验证

| 项 | 状态 | 证据 |
| --- | --- | --- |
| 一句话出核心动作套（`喝水`→拿杯子→喝→放回） | ✅ | `eval-motion` 18/18，`verify-motion` 37/37 |
| 同一件事只演一次、不重复起手 | ✅ | `test-live` 14/14（偶发 13/1，见 §9） |
| 离座行程接管一个时间窗，窗口内对话零动作 | ✅ | `trip.log` + `/game` 里 `active=""` |
| 沙发上"按住"3~5 分钟（`holdMs`） | ✅ | 游戏日志 `sequence: ... total=199~273`，`queue.expired=0` |
| 按住结束回来（comeback） | ✅ | `/game` `active=..._sofa_comeback`，随后回坐姿 |
| 道具（椅子）跟着同名 clip 动 | ❌ 已回退 | 会把椅子甩到镜头前（用的是重复实例，见 §5） |
| 她真的走到沙发并坐下 | ❌ | `rootΔ`/`hipsΔ` 实测见 §5；镜头/站位仍在试 |
| 视觉观感（朝向、距离、坐姿） | ❌ 未验证 | 只有用户截图能判断 |

## 5. 关键实测数据（别再重复测了）

### 5.1 离座 clip 全是原地动画

```
anim_wild_leavechair_sofa_go        10233ms  rootΔ=0.00m  hipsΔ=0.12m
anim_wild_leavechair_sofa_comeback   8667ms
anim_wild_leavechair_sofa_deepthink_start 3000ms   ← 进入
anim_wild_leavechair_sofa_deepthink_loop  5667ms loop=true
anim_wild_leavechair_sofa_deepthink_end   3000ms   ← 结束
anim_wild_leavechair_sofa_lookoutside_start/loop(8667)/end(2667)
anim_wild_leavechair_sofa_loop       3767ms loop
anim_wild_leavechair_sofa_headphone  6333ms
```

**结论：这套 clip 里没有位移键**（根 0.00m、髋 0.12m）。游戏里"她走到沙发坐下"的位移
一定来自别处（脚本摆位或场景摆放），不是 clip 自身。

游戏自己的完整弧线（按名字推出来的，也是我们该照抄的）：

```
go → (deepthink_start → deepthink_loop×n → deepthink_end | lookoutside_* | sofa_loop | headphone) → comeback
```

我们现在**只用了 `deepthink_loop` + hold**，跳过了 `start/end`——这是要补的。

### 5.2 房间里有三台相机（游戏靠切换它们换视角）

```
MainCamera          (1.88, 1.07,  2.69)  goActive=True
Camera_Desk         (1.88, 1.09,  2.69)  goActive=False   ← 书桌，与 MainCamera 同位
Camera_Sofa         (0.88, 0.51,  0.24)  goActive=False   ← 沙发
Camera_Bed          (0.86, 1.73, -2.63)  goActive=False   ← 床
RoomCameraManager 组件里有：StartCameraAnimHash / StartCameraMobileAnimHash / isPlayingStory
```

⚠️ 但 YG 明确说过：**游戏里视野不变，人自己走到沙发坐下**。所以切相机不是正解，
`acting.RoomView` 默认 false 就是为此。相机信息留着备用（万一以后要拍特写）。

### 5.3 世界坐标

```
Character 根       (2.74, 0.00, 1.70)   parent=None（根就是场景里的对象）
m_couch_mobile     (0.00, -0.03, -0.24) parent=Platform_PC   ← 沙发
m_bed              (0.47, 0.00, -0.45)  parent=m_bed
Sofaside           (2.32, 1.04, 1.65)   ← 沙发边几，不是沙发，别当锚点
```

`m_couch_mobile` 在 `Platform_PC` 和 `Platform_mobile` 下**各有一份**（同名重复实例）。
椅子 `m_Chair_mobile` 同理存在多个副本——这就是道具跟随会把椅子甩到镜头前的原因：
`clipExtraOwners` 拿到了不是当前场景那份。

### 5.4 同名 clip 分布

```
Character_Animator_ForScript  704 条（日志里能 dump 出 341 条）
ChairAnimationCtr（m_Chair_mobile）144 条，其中 136 条与角色同名
```

椅子那份是按**另一套锚点**摆的，把角色版 clip 采样到椅子上 = 椅子飞到镜头前。
所以 `acting.Props` 默认关。

## 6. 构建 / 部署 / 观测

```powershell
# 构建 + 部署（build.ps1 会直接拷进游戏目录）
$env:CHILL_GAME_DIR='E:\SteamLibrary\steamapps\common\Chill With You Lo-Fi Story'
Get-Process 'Chill With You' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 6                     # 不杀游戏构建会 IOException 占文件
powershell -NoProfile -ExecutionPolicy Bypass -File game\src\build.ps1
# 期望：OK <bytes> -> ...\BepInEx\plugins\ChillPerformer.dll

# 仓库里那份也要同步（分发用）
Copy-Item 'game\src\bin\ChillPerformer.dll' 'game\ChillPerformer.dll' -Force

# 启动游戏
Start-Process 'steam://rungameid/3548580'
# 在线判据：/chill/v1/game 的 clips > 300
```

```powershell
# 侧车重载（改 JS 不用重建 DLL）
$pl = Get-NetTCPConnection -LocalPort 10723 -State Listen | Select-Object -First 1
Stop-Process -Id $pl.OwningProcess -Force
# 宿主桥会自己拉起来，等 /chill/v1/health 的 ok=true
```

```powershell
# 跑一次演出（必须 sandbox:true，别写进真实记忆）
curl.exe -s -X POST http://127.0.0.1:10722/chill/v1/act -H "content-type: application/json" `
  -d '{\"text\":\"我去沙发上躺一会儿\",\"sandbox\":true}'

# 看当前在演什么
curl.exe -s http://127.0.0.1:10722/chill/v1/game
#   motion.active = 我们插进去的动作族（观测用这个）
#   motion.live   = 游戏自己的 animator 在播什么（不可靠，别用它判断我们的插入）
```

```powershell
# 回归
node tools/run-tests.mjs        # 24 个测试文件，期望「全部通过」
node tools/verify-motion.mjs    # 37/37
node tools/eval-motion.mjs 3    # 18 例，类别/内容 18/18
node tools/test-live.mjs        # 14/14（偶发 13/1，见 §9）
```

日志位置（都在 `data/`，也就是 `<插件目录>/data` 或 `$env:CHILL_DATA_DIR`）：

| 文件 | 内容 |
| --- | --- |
| `sidecar.log` | 侧车生命周期、崩溃栈 |
| `cue.test.log` | 每次 sandbox 演出的动作决策（JSON 一行一条） |
| `trip.log` | 离座决策：`start` / `drop`（含 cooling、idleNow）/ `away`（剩多少毫秒） |
| `live-watch.log` | 外部轮询记录的 `motion.live/active` 变化 |
| 游戏侧 | `<GAME>\BepInEx\LogOutput.log`，`Select-String -Encoding UTF8` 才能搜中文 |

## 7. 配置项（`BepInEx/config/local.chill.performer.cfg`）

已有（口径以实际文件为准）：`Speed=0.62`、`Weight=1`、`HeadWeight=2.2`、`BodyDegBudget=26`、
`HeadDegBudget=15`、`SwitchBlendMs=340`、`ReleaseMs=300`、`HeadFadeMs=320`、`MaxClipSec=8`、
`RepeatWindowMs=1500`、`FamilyGraceMs=1500`、`VerboseCues=true`、`IdleSwap=false`、
`queue.Max=8`、`queue.TtlMs=45000`。

本轮新增（都默认关，因为都被实测证明有害）：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `acting.Props` | `false` | 让椅子/窗户跟着同名 clip 动。会甩到镜头前，别开 |
| `acting.TripWalk` | `false` | 离座时手动搬角色根位移 |
| `acting.RoomView` | `false` | 离座时切 `Camera_Sofa`/`Camera_Bed`。视野本该不变 |

游戏目录里只许改两个文件：`BepInEx/plugins/ChillPerformer.dll`（+`.prev`）和
`BepInEx/config/local.chill.performer.cfg`（+`.bak-*`）。`_Data/`、exe、别的插件一律不碰。

## 8. 已知的坑（按踩到的顺序）

1. **改 `.cs` 前先杀游戏**，否则 `build.ps1` 拷 DLL 时 IOException。
2. **补丁脚本的锚点会被缩进/换行坑**。这个文件里混着 CRLF 和 LF（早期补丁留下的），
   而且缩进深浅不一。写 `tools/patch-*.mjs` 时：用**正则**匹配（`/( *).../`），
   并且每个补丁开头判断「已打过就退出」，避免重复插入。已经出过 6 次锚点未命中。
3. **PowerShell 5.1 里别在双引号字符串里写中文引号**（`“”`）——解析直接报错。
   写文件统一用 `[IO.File]::WriteAllText($p,$t,(New-Object System.Text.UTF8Encoding($false)))`。
4. **`state.away` 会跨重启存活**。测试前必须清：
   ```powershell
   node -e "const fs=require('fs');const p='data/state.json';const s=JSON.parse(fs.readFileSync(p,'utf8'));s.lastTripAt=0;s.nextTripAt=0;s.away=null;fs.writeFileSync(p,JSON.stringify(s,null,2),'utf8')"
   ```
   不清就会看到"离座窗口里对话零动作"，误以为坏了。
5. **队列在游戏重启后丢失**：重启游戏前排队中的 comeback 就没了，测试要重新起一轮。
6. **`motion.live` ≠ 我们的插入**。`live` 是游戏自己的 animator；观测我们的插入用 `motion.active`。
7. **`/game` 没有 `online` 字段**（有 `ok/scene/busy/clip/clips/motion/queue/mouth/audio/...`）。
   判断游戏在线用 `clips > 300`。
8. **同名 clip 会在多个 animator / 多个场景副本上出现**。`Resources.FindObjectsOfTypeAll`
   能拿到所有副本，注意筛 `activeInHierarchy` 和 parent，否则驱动到错的实例。
9. **`_base` 结尾的族是游戏的环境待机**（`anim_work_pc_base`、`tea_base`…），
   分类会判成 `idle`，插进去等于没演。核心动作表只能用 `_sub_*` 真动作族。
10. **按住（hold）必须配条目级 `ttlMs`**。全局 `queue.TtlMs=45000` 会把预排的
    "回来"那条当过期扔掉。`CueDto.ttlMs` 既要在类里声明，也要在 `ActDto` 的 JSON
    解析里赋值——只声明不解析等于没加（这次就踩过）。
11. **`test-live` 偶发 13/1**：时间敏感的队列检查，连跑两次会变 14/14。不是回归。
12. **profile 里的组合行不能带 `?rev=N`**（本机 AGENTS.md 的硬规矩），改插件代码要重启宿主进程。

## 9. 下一步（按优先级）

### P0 · 把"游戏怎么做离座"这件事看清楚（不要再猜）

代码里已经装好了一个**纯旁观记录器**（`Plugin.WatchTick()`，由 `PerformerUI.Update` 驱动，
每 0.4s 一次，只在变化时打印）：

```
watch: clip=anim_story_base001_base cam=MainCamera root=(2.74, 0.00, 1.70)
```

要做的：

1. 让游戏自己跑，等它自己触发野事件（趴一会儿 / 走到沙发 / 喝水）。
2. 在游戏日志里找 `watch: clip=anim_wild_leavechair_*` 那几行，看同一时刻的 `cam=` 和 `root=`。
3. 三种可能，对应三种做法：
   - `root` 变了 → 游戏用脚本摆位。我们照抄：在 go 的某一时刻把根瞬移/推进到目标点，
     不需要自己算插值。
   - `root` 没变、`cam` 变了 → 游戏其实切了镜头（与 YG 的记忆不一致，以实测为准）。
   - `root` 没变、`cam` 也没变 → 那就是**别的角色实例**在演，去查场景里还有没有第二个
     `Character_Animator_ForScript`（多平台副本）。
4. 顺手把 `data/live-watch.log`（外部轮询）与游戏日志的 `watch:` 对齐看，时间轴能互相印证。

### P1 · 补齐游戏自己的弧线

现在按住段只播 `sofa_deepthink_loop`。按游戏的设计应该是：

```
go → deepthink_start(3.0s) → deepthink_loop×n(5.667s，按住 3~5 分钟) → deepthink_end(3.0s) → comeback
```

`lib/seat-trip.js` 的 `TRIPS.sofa.steps` 改成五段即可；`tripItems()` 里 hold 应挂在
loop 那一段，start/end 不按住。同理还有 `lookoutside_*`、`sofa_loop`、`headphone`
——可以做成"待着的时候随机挑一种"，比一直 deepthink 自然。

### P2 · 视觉参数（只有 YG 能判断）

需要他截图确认三件事，对应三个可调参数（都在 `PerformerPlugin.cs` 的走位段）：

| 现象 | 参数 | 现在 |
| --- | --- | --- |
| 离镜头太近/太远 | `anchor + towardCam * 0.35f` 的 0.35 | 沙发往相机方向 0.35m |
| 背对沙发/侧着坐 | 需要按锚点朝向补 yaw，现在完全没转 | 无 |
| 高度不对（浮空/穿模） | `tripToWorld.y = tripFromWorld.y` | 沿用她站立时的 y |

### P3 · 收尾

- `test/seat-trip.test.mjs` 已有 10 条（含 hold 3~5 分钟边界、只有 sofa 有 holdMs、
  出去/待着/回来的顺序）。补 `tripWindow` 的 ttl 覆盖。
- 把本轮未提交的改动（`patch-posfree` 移除位置写回 + `WatchTick` 记录器）整理成一次 commit；
  如果 §9-P0 证明需要保留位移逻辑，就在那次 commit 里连 DLL 一起提交。
- `git push` 只在他明确说"要推"之后做（当前只在本地）。

## 10. 红线（别越）

- 不改游戏本体：`_Data/`、exe、别人的插件都不碰；`Assembly-CSharp.dll` 不反编译、不改。
- 不提交游戏本体、`*.wav`、`<数据目录>/memory/`、任何 key。
- 调演出只用 `sandbox:true`，别在 `sandbox:false` 下试错。
- 写 `package.json` / `.json` / `.yml` 一律 `[IO.File]::WriteAllText(..., UTF8Encoding($false))`，
  带 BOM 会让本机所有会话的请求失败。
- 改 profile 走 `tools/install.mjs` / `uninstall.mjs`，别手改 `package.json`。

## 11. 上手第一步（照抄就行）

```powershell
cd 'D:\dsh\日志\chill-brain'
git log --oneline -6
node tools/run-tests.mjs                       # 应该全绿
node tools/doctor.mjs                          # 人看：12 项检查
$env:CHILL_GAME_DIR='E:\SteamLibrary\steamapps\common\Chill With You Lo-Fi Story'
Start-Process 'steam://rungameid/3548580'      # 游戏开着才能验端到端
# 等 clips > 300，然后按 §9 的 P0 开始观察
```
