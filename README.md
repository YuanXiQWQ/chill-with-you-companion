# dsh-chill-with-you-companion —— DSH 插件

## 输出侧压缩

缓存重排之后，输出成了最贵的一块——输出单价 4 元/M，是缓存命中输入（0.02 元/M）的 **200 倍**。
97 token 的输出比 5144 token 的输入还贵。

### 1. 不输出空的键

模型每轮都在写：

```json
"voice_kana":"","remember":[],"moments":[],"open":[]
```

这四段约 46 字符，全是「没有内容」的占位。解析器对缺键完全容忍
（`String(obj.x ?? '')` 和 `Array.isArray(obj?.x)`），所以契约改成：

```
remember / moments / open 是三个可选数组，没有内容就整个省略这个键，不要写 []。
```

### 2. 不输出 slot 和 why

```json
{"slot":"animations","id":"anim_story_base001_sub_touch_glasses_start","at":0,"why":"移开视线"}
```

`slot` 几乎永远是 animations，`why` 只是给人看的备注，两条都用不上。
解析器默认值：`String(c?.slot || 'animations')`。契约改成只写 `{"id":"...","at":0}`。

### 3. 末尾复述压成一句

原来 `contract` 在中间，末尾还有五行「输出格式再确认」。五行复述和契约只隔了三行，
却全部按全价（未命中缓存）计费，是这轮里最贵的一段重复。压成一句：

```
只输出 json 对象，不要 markdown 或解释。
```

### 实测

| | 改前 | 改后 |
| --- | --- | --- |
| 输出 | 97 tok | **60 tok** |
| 未命中 | 280 tok | **250 tok** |
| 等效计费 | 765 tok | **585 tok** |

### 三轮累计（空闲时段）

| 阶段 | 元/句 | 句/元 |
| --- | --- | --- |
| 最初 | 0.00693 | 144 |
| 缓存重排后 | 0.00077 | 1307 |
| 压输出后 | **0.00059** | **1709** |

约 **12 倍**。余额 4.5 元从 650 句涨到 7700 句（空闲时段）。

### 还能压但收益很小

- **动作 id 换短编号**：`anim_story_base001_sub_touch_glasses_start` 一条约 7 token。
  改成 `#12` 能省 5 token/条，但要在 assetBrief 里建索引表、还要让截断逻辑同步，
  收益约每句 0.00005 元。不值得动。
- **subtitle 从 10-25 字压到 8-18 字**：省约 5 token/句。
- **maxTokens 600 → 200**：实际只用到 60，对成本无影响，只是防跑飞。

## 用量记账

`callModel` 每次调用都往 `<数据目录>/usage.log` 记一行：

```json
{"t":"2026-11-14T07:00:26.123Z","model":"deepseek-flash","ms":1361,
 "prompt":5144,"hit":4864,"miss":280,"out":97}
```

`hit` 是 `prompt_cache_hit_tokens`，`miss` 是 `prompt_cache_miss_tokens`。
DeepSeek 的 prefix cache 命中价是全价的一成，所以两者必须分开记——
只看 `prompt` 总量会以为很贵，实际上大头被缓存吃掉了。

查报表：

```
node tools/usage-report.mjs
```

按天汇总，输出等效计费（命中×0.1 + 失效 + 输出）和平均每次成本。

### 实测基线

2026-11-14 缓存重排之后：

| 项 | 值 |
| --- | --- |
| prompt_tokens | 5144 |
| 缓存命中 | 4864（**95%**） |
| 缓存失效 | 280 |
| 输出 | 97 |
| 等效计费 | **863 tok / 次** |

重排之前命中率约 22%，等效计费约 4100 tok / 次，差 **4.7 倍**。

## Token 消耗：缓存前缀重排

2026-11-14。每轮输入原来约 3917 token，其中 `assetBrief` 3200 字符独占 51%。

但真正的浪费不在大小，在**顺序**。DeepSeek 的 prefix cache 从前缀往后逐字匹配，
而 `buildMessages` 原来的排列是：

```
persona            ← 稳定
loreText           ← 稳定
skills / mode      ← 稳定
describeState      ← 每轮都变
nearbyText         ← 每轮都变
factsText          ← 稳定
kbText / summary   ← 稳定
assetBrief         ← 稳定，3200 字符
actionMap          ← 稳定
contract           ← 稳定，1900 字符
```

`describeState`（时间、能量、心情）排在第五位，只要它一变——基本每轮都变——
**后面 4388 字符全部失效**，包括那块 3200 字符的动作清单。等于每轮只命中
`persona` 的 1879 字符，命中率约 30%。

### 改法

稳定块提到前面，动态块压到最后：

```
persona / lore / skills / mode
factsText / kbText / summaryText
assetBrief / actionMap
contract 全量
--- 以上稳定，8429 字符 ---
describeState      ← 动态
---
输出格式再确认（六行摘要，约 150 字符）
```

契约本身每轮一模一样，跟着动态块失效太浪费。完整契约留在稳定区，
末尾只放六行摘要——既保住「末尾强化」的效果，又不破坏缓存。

### 实测

| | 改前 | 改后 |
| --- | --- | --- |
| system 总长 | 8590 字 | 8804 字 |
| 公共前缀 | 1879 字（22%） | **8429 字（96%）** |
| 每轮失效 | 4388 字 ≈ 2743 tok | **375 字 ≈ 234 tok** |
| 每轮等效计费 | 2860 tok | **761 tok** |

省 **73%**。按一天 100 轮算，286k → 76k 等效 token。

### 其余可调项

`lib/config.mjs` 的 `DEFAULTS`：

| 项 | 现值 | 说明 |
| --- | --- | --- |
| `assetBudget` | 3200 | 动作清单预算。已进缓存区，调小收益有限 |
| `assetPerSlot` | 80 | 每 slot 条数上限，animations 389 条里挑 80 |
| `memoryTurns` | 12 | 历史轮数，实测只占 318 字，不是瓶颈 |
| `maxTokens` | 600 | 输出上限 |

spark 间隔在 `SPARK_GAP`：focus 20–32 分钟、break 8–14 分钟、idle 13–18 分钟。
连续开口没人理会按 1.7× / 2.6× 拉长。

## 回复重复：五个源头

2026-11-14 排查。40 轮真实回复里，母题分布是：

| 母题 | 占比 |
| --- | --- |
| 眼睛/累 | 20% |
| 小说/稿子 | 20% |
| 报告/进度 | 13% |
| 考试/教授 | 13% |

整句重复是 0 条，问题是**同一件事换着说法反复讲**。五处推手：

### 1. `energy: 70` 卡在阈值线上

```js
s.energy > 70 ? '我精神还不错' : s.energy > 40 ? '我有点累了' : ...
```

默认值 70，`70 > 70` 是 false，**每一轮都判成"我有点累了"**。
改成 `energy: 78` + `>=` 比较。

### 2. `timeFeel` 九个时段里有四个在说累

```
< 5    这个点我早就该睡了，眼睛发涩，脑子转得慢。   ← 眼睛
< 15   午饭后容易犯困，撑一撑就过去了。            ← 困
< 18   下午，还能写，但注意力开始散了。            ← 散
else   已经挺晚了，我该去睡了。                    ← 睡
```

每轮都拼进 prompt，等于一直在提示"你现在很累"。具象词换掉，保留时段感：

```
< 5    这个点我早就该睡了。
< 15   午后这段时间过得慢。
< 18   下午过半，光线开始变斜。
else   夜已经很深了。
```

### 3. `SPARKS.break` 直接教她说"眼睛干了"

原本写着 `眼睛干了、肩膀僵、想站起来走两步`，改成 `肩膀僵、想站起来走两步、或者纯粹觉得这屋里有点静`。

### 4. 母题疲劳（滑动窗口）

`lib/core.js` 的 `MOTIFS` 定义五个母题，每轮记进 `state.motifWindow`（留最近 6 轮）。
同一母题占到 3 轮就在 prompt 里点名：

```
「眼睛累」「小说进度」最近几轮你说得太多了，这轮一定换件事，别再提。
```

用窗口不用连续计数——她往往隔一轮就绕回来，连续阈值永远碰不到。

| 母题 | 正则 |
| --- | --- |
| eyes | `眼睛\|撑不住\|发干\|糊了\|干了\|看屏幕` |
| report | `报告\|第二页\|第二节` |
| novel | `第三章\|小说\|稿子\|下一章\|写不下去` |
| exam | `考试\|实训\|教授\|老师\|父母` |
| coffee | `咖啡\|喝茶\|倒了一杯` |

### 5. 她看不到自己说过什么

模型没有对话历史时必然重复。把最近 4 句原话列进 prompt：

```
你刚才说过 「……我眼睛有点干了。」「我还卡在第二节。」，别再说类似的，换个说法或换件事。
```

顺带解决了小说第三章那个问题——`lore` 的 `novel` 条目从"卡在第三章过好几次"改成长期背景，
`persona` 去掉"主动抱怨自己的稿子写不动"，摘要提示词加了"设定不是进展"。

## 安装

```powershell
node "<本仓库>\tools\install.mjs" --game "$GAME"
```

或走插件管理：

```
plugin_manager  action=install_bundle  target=<插件目录>
```

> **以 [AGENTS.md §3](./AGENTS.md) 为准。** 这里只是速查：目录联接挂进 profile → 声明依赖 →
> **重启 `dsh web`**。`install_bundle` 走的是同一套落盘，但不会替你重启进程，
> 也不会检查 `node_modules` 里的联接名是否与包名一致——那条是最常见的 404 来源。

装完重启 `dsh web`，然后：

```powershell
curl.exe http://127.0.0.1:10722/chill/v1/health
```

`ok:true` 且 `hasApiKey:true` 即就绪（key 来自 `config.apiKey` 或 `$env:DEEPSEEK_API_KEY`）。

## 模型与 API key：默认与对话共用

面板「模型」页默认就是 **DeepSeek · 与对话共用**：用的是你在 dsh 里配的那把 key，
不需要再填一遍，页面上也没有"密钥来源"这类选项要你选。

要换别家（自建中转、通义、OpenRouter、本地 ollama / llama.cpp，或者任何 OpenAI 兼容服务）就点「再加一条」，
填四样：名称、`baseUrl`、模型名、key。

- **key 填了** → 完全用你自己那套，与对话那把无关。
- **key 留空** → 跟着对话那把走（同一个 `DEEPSEEK_API_KEY`）。

`baseUrl` / 模型名 / 请求头一律按你填的发出去，插件不覆盖。
分辨率上的细节：真解析时按「provider 自己的 token → 环境变量 → dsh 凭据文件 → 宿主借来的」四档取，
面板不暴露这个顺序，只在你选中的那条上生效。

`/chill/v1/health` 的 `hasApiKey` 为 `false` 表示四档全空。值是永远不会回显的。

## 卸载

```powershell
node tools/uninstall.mjs                                          # 先看要做什么，不动手
node tools/uninstall.mjs --apply                                  # 摘联接 + 撤 profile 声明
node tools/uninstall.mjs --apply --game "<游戏目录>" --remove-dll  # 连游戏端 DLL 一起清
```

**记忆不会被删**：`data/`（对话记忆、好感度、`llm.json`、语音缓存）原样留着，
脚本只打印它在哪、怎么手动删。三条硬规矩：只摘 `realpath` 指回本仓库的联接、绝不递归删目录、
数据目录一个字节不碰。回归在 `test/uninstall.test.mjs`。

## 装完之后还要补什么

插件本体是轻的，装上去就能用。真正的大件**不随包分发**——语音引擎的模型和 python 环境加起来几个 G，打进包里没人愿意装。

**模型权重和 API key 也算私人内容，同样不进仓库。** 权重多数有自己的许可（GPT-SoVITS / HuggingFace 上的模型不少禁止再分发），
体积又是几百 MB 到几 GB；key 是明文凭据。两者都由用到的人自己准备，仓库里只留下载地址和配置位置。

第一次打开面板的「语音」页，会看到还缺哪几项，按提示补齐，点「刷新」，插件自己去把引擎拉起来：

| 缺件 | 从哪来 |
|---|---|
| python 运行时 | GPT-SoVITS 的 venv，或任意 3.10 环境装一遍 `requirements.txt` |
| GPT-SoVITS 仓库 | 官方仓库解压到任意目录 |
| 推理配置 | 仓库里的 `GPT_SoVITS/configs/tts_infer.yaml` |
| 参考音频 | 插件 `ref/` 下放一段她的原声，3–10 秒 wav 最稳 |

路径写在 `cordis.patch.yml` 的 `tts.engine` 里；写相对路径时按**插件根**解析（`config` 例外，它相对 `repo`），换机器不用改配置。

**不再需要**计划任务 `ChillGSVServer`、`gsv-serve.ps1`、`gsv-serve.vbs`：拉起、探活、预热、自愈全在插件里。引擎用 `spawn` 直接拉 python，`detached + unref` 让它脱离 Harness 的作业树，重启 DSH 不会顺手把它带走。

`tts.launcher` 三档：`spawn`（只走插件自己拉）、`task`（老路，schtasks）、`auto`（默认，先自己拉，拉不起来才退计划任务）。

## 仓库里带了什么、没带什么

分发口径只有一条：**有下载渠道的不带，没有下载渠道的全带。**

> 装的时候怎么用这些，见 [AGENTS.md](./AGENTS.md)——那份是写给执行安装的 agent 的。

### 带了（装的时候不用另找）

| 东西 | 为什么必须随包 |
|---|---|
| `game/ChillPerformer.dll` | 游戏端 BepInEx 插件。**全世界只有这里有**，没有第二个下载源 |
| `game/src/` | 上面那个 DLL 的 C# 源码，装不上时可以自己编 |
| `game/assets.seed.json` | 389 个动作 / 146 把椅子的静态清单，只能从游戏里导，没有下载渠道 |
| `persona.md` | 聪音的默认人格与说话纪律。内置角色卡由它播种，不单独发 `satone.json` |
| `skills/` `persona.md` `locale/` | 设定与文案 |

### 没带（有官方下载渠道，装的时候自己下）

| 缺的东西 | 从哪来 |
|---|---|
| BepInEx 5.4.x | <https://github.com/BepInEx/BepInEx/releases>，解压到游戏根目录 |
| Node.js ≥ 22 | <https://nodejs.org> |
| GPT-SoVITS v2 + 模型 + Python | 可选，见 AGENTS.md §7。不装则降级为纯字幕 |

### 没带（版权原因，只能自己从游戏里取）

| 缺的东西 | 为什么 | 怎么补 |
|---|---|---|
| `<数据目录>/assets.json` | 游戏自报的资源清单 | **不用管**。首次启动时游戏端报到 `/chill/v1/assets`，插件写进这个文件 |
| `<数据目录>/audio/` | 你和她的对话产生的 TTS 缓存 | **不用管**。会自动重新合成 |
| `ref/*.wav` | 游戏原声，版权不在本仓库 | 从自己的游戏目录取 3–10 秒人声放进 `ref/`；不取也行，走纯字幕 |

### 想重新生成 `assets.seed.json`

`tools/` 下两个脚本读的是游戏导出的 dump：

```powershell
# 程序集枚举 dump，格式见脚本头部注释
node tools/build-manifest.mjs path/to/game-enums.txt

# BepInEx 运行时 clip dump，由 game/ 里的 ChillPerformer 产出
$env:CHILL_GAME_DIR = 'X:/SteamLibrary/steamapps/common/Chill With You Lo-Fi Story'
node tools/gen-anim-manifest.mjs
```

输出默认写 `game/assets.seed.json`。**日常使用不需要跑**——运行时清单走游戏上报那条路。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/chill/v1/health` | 一行排障：模型、思考开关、人设字数、记忆轮数、TTS、状态机 |
| POST | `/chill/v1/chat/completions` | OpenAI 兼容，**现成 AIChat 改这一行 URL 就能用** |
| POST | `/chill/v1/act` | 原生 `PerformanceScript`（emotion / voice / subtitle / **performance[]** / state / meta） |
| POST | `/chill/v1/event` | 游戏上报 `focus_start` / `focus_end` / `break` / `idle` |
| GET / POST | `/chill/v1/assets` | **游戏自报资源清单**（animations/scenes/sfx/voiceClips/bgm）；DS 只能从清单里挑 id，越界指令被剪 |
| GET / POST | `/chill/v1/characters` | 角色卡列表（含 `active`）/ 新建 `{id,name}` |
| GET / POST | `/chill/v1/characters/<id>` | 读一张卡（人设+lore+voice）/ 保存 |
| POST | `/chill/v1/characters/<id>/activate` | 切换当前角色，下一轮生效 |
| GET / POST | `/chill/v1/persona` | 兼容接口：读写**当前角色卡**的 `persona` 字段 |
| GET | `/chill/v1/audio/<hash>.wav` | TTS 缓存文件（内容哈希命名） |
| GET / POST | `/chill/v1/avatar/<id>` | 头像：GET 取当前图；POST 上传自定义 PNG（≤2 MB，原子替换） |
| POST | `/chill/v1/avatar/<id>/reset` | 删掉自定义图，回落内置默认 |

示例：

```powershell
curl.exe -X POST http://127.0.0.1:10722/chill/v1/act `
  -H "content-type: application/json" `
  -d '{\"text\":\"我开始了，25 分钟\"}'
```

## 配置（`cordis.patch.yml` 的 `config`）

| 键 | 默认 | 说明 |
|---|---|---|
| `apiKey` | `''` | 空则读 `$env:DEEPSEEK_API_KEY` |
| `baseUrl` | `https://api.deepseek.com/v1/chat/completions` | OpenAI 格式端点 |
| `model` | `deepseek-flash` | 换 `deepseek-v4-pro` 更聪明但更贵 |
| `thinking` | `disabled` | **必须关**，开了首字 8–15 s |
| `maxTokens` / `temperature` | `600` / `0.9` | JSON 截断就抬 `maxTokens` |
| `emotionSet` | `base8` | `extended` 开 19 标签（需表演端支持） |
| `memoryTurns` | `12` | 记忆轮数（唯一会让成本失控的项） |
| `forgetAfterDays` | `180` | 记忆保质期：超过这个岁数、又不特别重要的，载入时清掉 |
| `token` | `''` | 非空则要求 `Authorization: Bearer <token>` |
| `personaPath` | 包内 `persona.md` | 人设唯一真相 |
| `dataDir` | 空（= 包内 `data`） | `state.json` / `memory/` / `audio/` / 各类日志 |
| `actionMap` | 内置 8 组（`EXTENDED_ACTION_MAP` 29 个情绪键） | 情绪 → `AnimationType` id，可覆盖 |
| `assetBudget` / `assetPerSlot` | `3200` / `80` | 白名单塞进 prompt 的字数预算与每槽位条数 |
| `maxCues` / `maxAtMs` | `3` / `60000` | 单次表演指令上限、时序上限（`cordis.patch.yml` 里默认 4，以配置为准） |
| `frequencyPenalty` / `presencePenalty` | `0.35` / `0.25` | 解码期反重复，压口头禅与整句复读 |
| `tts.*` | 见下 | 代理本地 GPT-SoVITS，按内容哈希缓存 |

### 记忆分级

记忆不是一直原样存着。**离现在越近越完整，越远越只剩骨架**——过期不是删掉，是先变短、再变模糊、最后才消失。

| 年龄 | 提示词里最多留 | 她看到的 |
| --- | --- | --- |
| 2 天内 | 原样 | 「他今天说想学冲手冲咖啡，喜欢浅烘的豆子，怕苦。」 |
| 2–7 天 | 80 字 | 同上，长句开始收 |
| 7–30 天 | 50 字 | 只留主干 |
| 30–90 天 | 32 字 | 「（印象）……」 |
| 90–180 天 | 20 字 | 「（模糊的印象）他提到过小时候在海边住，…」 |
| 180 天以上 | 清掉 | — |

截断优先落在句末（`。？！，、；`），所以剩下的仍然是一句读得通的话，不是硬砍的半截。

**特别重要的能活下来**：`importance ≥ 0.8` 或 `pinned` 或 `hits ≥ 5`（被反复用到说明它真的有用）→ 超过半年也不删，但同样压到 40 字以内。生日、失去的人、反复提起的执念，属于这一类。

清理在 `open()` 时跑一次，删掉的条数写进 `sidecar.log`。单条也能 `forget(id)` 手动扔。

**顺带修的一处**：分词原来只建 bigram，查「猫」永远撞不上「橘猫」「猫叫」，会退回兜底、把不相干的全捞出来。现在单字也进索引。

### 时间感

她原本只活在"此刻"——知道番茄钟还剩几分钟，不知道今天是几号。现在每轮 state 里带三样：

- **今天几号、星期几、大概什么时段**（`todayLine`）
- **上次真说话是多久以前**（`humanGap`）
- **那次在聊什么**（`lastTopic`，取你上一句前 40 字）

`humanGap` 把人话说回来：2 分钟内「刚刚」、1 小时内「`N` 分钟前」、6 小时内「`N` 个小时前」、当天「今天早些时候」、第二天「昨天」、第三天「前天」、一周内「`N` 天前」、两周内「上周」、40 天内「`N` 周前」、半年内「`N` 个月前」，再远「很久以前」。**72 小时前不是人话，三天前才是。**

两个刻意的取舍：

- **隔不到 8 小时就不提**。十分钟前刚聊完还来一句"你十分钟前来过"，比不说更假。
- **`lastTalkAt` 在 `appendTurn` 里更新，不是在轮次开头**。放开头的话本轮组装 prompt 时读到的就是"刚刚"，gap 永远是 0，「上次说话是三天前」这句话永远说不出来。

`sandbox: true` 的轮次整条不落地，时间戳也不动。

### 联想（A-MEM 的轻量版）

[Agentic Memory (A-MEM)](https://neurips.cc/virtual/2025/loc/san-diego/poster/119020) 那套 Zettelkasten 思路：每条记忆是一张卡，写卡时自动和相关的卡连边，检索命中一张就顺着边带出邻居。这里没有 embedding，用两条路替代：

**1. 同轮互连。** 同一轮里一起说出来的事，本来就相关。这条治的是词面不像但实际连着的情况——「在做 dsh-chill-with-you-companion 插件」和「把长轮询从 8 秒改到 10 秒」词面重合度只有 0.059，纯相似度连不上，但它们是同一次对话产出的。一轮超过三件事只连前两条，否则整片串成一张网。

**2. 跨轮词面相似 ≥ 0.09。** 阈值是量出来的，不是猜的：

| 一对事实 | jaccard |
| --- | --- |
| 咖啡 × 怕苦（**相关**） | 0.098 |
| 插件 × 长轮询（**相关**，词面不像） | 0.059 |
| 开会 × 长轮询（不相关） | 0.048 |
| 猫 × 生日（不相关） | 0.036 |

相关和相关的下界卡在 0.098，不相关的上界 0.048——**中文短句的词袋区分度就这么窄**，0.09 是这条缝。再高的阈值一条都连不上（试过 0.18，全空）。

**检索时扩散一跳**：`search` 真命中后，从命中项的 `links` 里补最多两条。只在真命中时扩散——走兜底说明本来就没有相关记忆，这时还扩散就是胡说。扩散出来的**不计 hits**，免得自己把自己越喂越重（那条命中路径本来就会 `hits += 1`，不加这条约束会形成自增强回路）。

实测两个方向都通：

```
查「咖啡」→ 他很怕苦，喝咖啡要加很多糖
查「插件」→ 插件里把长轮询从 8 秒改到 10 秒
猫、开会      links=0（不相关的不乱连）
```

**没做的**：A-MEM 里"新信息到了回头改写旧卡"那一步。要改就得让模型重写已有记忆，成本和风险都比收益大，现在只连不改。

### 记忆翻案（不删，只失效）

用户会改主意。三个月前说不喝咖啡，今天说胃不行戒了——如果两条都还在库里，她就会同时相信两个相反的结论。

做法抄 [Graphiti](https://help.getzep.com/v4/graphiti/getting-started/overview) 的双时态：**旧的打一个 `invalidAt`，不删**。历史还在（能查、能追溯），只是不再进 prompt、不再参与检索、也不许顺着链接爬回来。这比删掉安全——判错了还能恢复。

判定 `contradicts(a, b)` 很短：

1. 两条**共享至少一个 bigram**（说明是同一件事）
2. 且**一条带否定/转变词**（`不|没|别|戒了|改成|换成|以前|现在没|不再|算了`），另一条不带

不用 jaccard 判"是不是同一件事"——中文短句里，同一件事的两句话相似度也才 0.1 上下，任何像样的阈值都够不着（试过 0.45，一条都判不出来）。改成数共享 bigram，单字不算（"他""的"到处都是，会把不相干的也算成同一条）。

**这是个保守判定**：宁可漏判（两条并存放着），也不误杀（正常记忆被标失效）。代价是偶尔会有两条矛盾的记忆同时存在——比错删好。

### 反重复

[Galetzka et al. 2023](https://arxiv.org/html/2308.06095v1) 把闲聊的质量问题归到 Grice 准则上，其中 **Quantity** 一档拆成两个可量化的毛病：**genericity**（这句话放在哪个上下文里都成立，等于没说）和 **repetitiveness**（重复了上下文里已有的信息）。

能用的最便宜一档干预在**解码期**，DeepSeek 原生支持：

| 参数 | 值 | 作用 |
| --- | --- | --- |
| `frequency_penalty` | `0.35` | 同一个词出现越多分越低，压"嗯""好像"这类口头禅 |
| `presence_penalty` | `0.25` | 出现过就抑制再提，压整句复读 |

默认轻推，压太狠句子会变得别扭、像在刻意回避词。

**还没做的**：把这一档升级成"和她自己最近 N 句比 n-gram"。现在只防**词级**复读，不防**意思级**——同一个观点换个说法讲三遍，惩罚参数管不到。那需要拿她说过的句子做集合比对，成本不高，但得先有足够的对话样本才能定阈值。

### 情绪惯性

原来每轮独立采样情绪，等于没有心情。论文 [Subaharan 2026](https://arxiv.org/abs/2601.16087) 的结论很直接：**stateless 的 agent 在多轮对话里既没有连贯轨迹，也不会恢复**；给外部状态加上一阶/二阶动力学才有"状态持续"，二阶还会带来**惯性 + 迟滞**——代价是响应变慢。

这里把 VAD 三维砍成一维 `mood`（-100 ~ 100），二阶更新：

```
target = 休息 76 / 专注 52 / 空闲 62
vel    = 0.62 × vel + 0.38 × (target − mood) × 0.3
mood  += vel
```

实测轨迹（从 60 起，切到休息）：

```
休息第 1 次 → 61.8     转专注第 1 次 → 66.4
休息第 3 次 → 64.9     转专注第 2 次 → 64.8
休息第 6 次 → 68.3     转专注第 4 次 → 62.0
```

**不是一步到位，是要爬几轮**。这就是想要的：她今天闷了一天，你夸她一句也还是闷，只是没那么闷了。

`energy`（体力）和 `mood`（心情）分开说——累但心情好、闲但闷得慌，都是常见状态，合成一个数就没了。

### 共同经历（moments）

前面的记忆都是**关于他的资料**：他喜欢浅烘、他养过猫、他生日十一月十七。这些能让她「认识」你，但撑不起「我们之间」。

所以多一类 `kind: 'moment'`——**一起发生过的事**，不是属性，是时刻。区别在抽取口径（见 `core.js` 的 prompt）：

> moments 是**你们之间真正发生过的事**。判断标准：三个月后想起来还有感觉的，写进来；只是查到的信息，不算。

模型给它一个 `weight`（1–10），存成 `importance`。三条规则让它和普通事实不一样：

1. **不受时效衰减**。`tierOf` 对 moment 直接返回原文长度，永远不压缩。
2. **不受 180 天清理**。`prune` 遇到 moment 直接放行。
3. **检索权重 ×1.8**。

第 3 条的量级参考了 Generative Agents：那边 importance 权重 2.0、recency 只有 0.5，importance 是 recency 的四倍。这里方向一致但没那么极端——陪伴场景下「最近」仍然重要，只是不该让三天前的寒暄压过三个月前那次熬夜。

实测（把全部时间推到 200 天前再重新载入）：

```
[moment] 他熬到三点改那段代码，我说去睡，他说再改完这段   ← 活着
[fact]   他喜欢喝手冲咖啡                              ← 被清掉
```

### 悬着的话题（open loops）

她原本只会问当下的事。真人不是这样——真人记得**你提过但没说下去**的话。

第三类 `kind: 'loop'`：他提过、还没结果的事。抽取时单独一个字段，prompt 里明确「已经解决的事不要放进来；不确定就 `[]`」。

**主动搭话时优先。** `spark` 里多一条分支：存在 open loop 时，60% 的概率不问模板，改问这个——

> 你忽然想起他之前提过一件事，还没下文：「他说想学手冲，还没买滤杯」。想问一句后来怎么样了——语气轻一点，别像在查进度，也别连着问第二遍。

**自动退场**：被问过三次还没结果的（`hits >= 3`），说明他不打算聊，不再提。

**关闭**：真有结论了就 `closeLoop(id)` 标失效，走的是和记忆翻案同一条路——不删，只标记。

和 moments 一样不受 180 天清理——它要等一个结果，不能因为放了三个月就忘掉。

### 检索权重总表

四类记忆进 prompt 时的差异：

| kind | 时效衰减 | 180 天清理 | 检索权重 |
| --- | --- | --- | --- |
| `fact` | 按年龄压缩 | 会 | ×1 |
| `moment` | 不压缩 | 不会 | ×1.8 |
| `loop` | 不压缩 | 不会 | ×1（另有搭话优先权） |

`importance ≥ 0.8`、`pinned`、`hits ≥ 5` 的普通事实也能豁免清理，但会被压到 40 字内——它们是「重要资料」，moments 是「你们的事」，两种豁免不一样。

### 动作编排（2026-11-14 修）

原来最不自然的一环：**她说完话，身体过一秒才开始动**。

实测三例，动作排在 `at` = 4386 / 3740 / 3842 毫秒，而字幕只有 10–16 字，念完也就 2–3 秒——动作落在语音结束之后。三个原因叠在一起：

1. **prompt 自己打架**。格式示例写 `"at":<毫秒偏移>`，下一行又要求「用 0 到 1 的小数，不要写毫秒」。模型先看到格式模板，就照着毫秒给了。
2. **没有音频时长时完全不夹**。`cueCap` 只在 `durationMs > 0` 时生效，而这条路径拿不到 TTS 时长，动作就自由落体到语音结束之后。
3. **一句话配两个动作，中间隔一两秒**。真人说话不会这样换姿势，看起来像抽搐。

修法三处，一起上：

**prompt 端**——格式示例改成 `"at":<0 到 1 之间的小数>`，并明说「不要写毫秒，你没法知道这句话念出来有多长」。默认只给**一条**（`at: 0`，开口那一下的姿态），只有念出来超过 20 字才追加第二条在 0.55。

**代码兜底 `normalizeCueTiming()`**——模型不听话时硬兜：

```
真实音频时长优先；没有就按字幕估：max(1200ms, 字数 × 180ms)
窗口 = 时长 × 0.9            ← 收在语音结束前
若整批都是毫秒写法：
    assumed = max(估时长, max(at) / 0.65)   ← 它心里那句有多长
    pos = at / assumed
at = pos × 窗口
```

`0.65` 这个系数是猜的：模型通常把最后一个动作排在整句六七成的样子。换算出来 4386 → 1685，落在语音中段，对上了。

**再叠两条约束**：

- **相邻同 id 合并**——「点头、点头」只会显得呆。
- **最小间隔 1000ms**，太近的往后错开。错开之后若顶出窗口，整体按比例压回来。
- **短句（< 12 字）只留一个 `animations`**。只卡动画槽，`sfx` / `scene` 照留——音效跟姿势密度没关系。

实测（`/play` → `/pull` 整条链路）：

| 字幕 | 模型给的 | 下发 |
| --- | --- | --- |
| 6 字「嗯，知道了。」 | nod@0 + thinking@4386 | `nod@0`（只留一条） |
| 40 字长句 | fun@0 + nod@0.55 | `fun@0` + `nod@3564` |

**`/act` 也走同一套**。调试时看到 `at=4386`、游戏里实际在 1685，两边差一截，排起来没完——所以 `/act` 和 `/play` 必须同形。

### 模型不给动作（few-shot 示例把自己教坏了）

2026-11-14 排查「演出割裂」时顺手翻 `<数据目录>/memory/turns.jsonl`，发现更要命的事：

```
17:27:01 [21字] 糊弄不太好…        perf=0
17:27:30 [18字] 那种人真的有…      perf=0
17:34:15 [19字] 我懂。要求定得高…   perf=1
17:34:33 [20字] 摆烂啊…            perf=0
17:34:58 [20字] 及格线还能这么用…   perf=0
```

**六轮里四轮 `performance` 是空数组。**

根因在 prompt 的示例行：

```js
'示例：{"emotion":"Agree",...,"performance":[]}'
```

模型照着示例学，学会了「这一项可以空」。前面那句「默认只给一条」它读成了「建议」，而示例是**它真正照抄的东西**。

空数组之后走兜底 `emotionFallbackCues()`，补的是 `anim_story_base001_sub_nod`——一个 2167ms 的**单段**动画，播完硬回静态。于是每一句都变成同一个点头，每一次点头都是一次跳变。割裂感的一大半来自这里，不是时间点。

**三处一起改**：

| 位置 | 原来 | 现在 |
| --- | --- | --- |
| 示例行 | `"performance":[]` | 一条真的 `sub_joy`，带 `at` 和 `why` |
| 短句豁免 | 「一两个词也可以写 []」 | 「就算只是附和也要给，禁止 []」 |
| 硬规则 | 「至少给一条，只有附和才能 []」 | 「至少给一条，永远不要空数组」 |

改完实测三句，三句都给了完整三段式：

```
[22字] 哈哈，那我也在同一边…      laugh_start@0(1500) → loop@1500 → end@3896
[12字] 我懂……我也卡在第三章。      frustration2_start@0(1333) → loop@1333 → end@2545
[15字] 那种老师最麻烦…            frustration2_start@0(1333) → loop@1333 → end@3283
```

**排查手法记一下**：`turns.jsonl` 里存的是**模型原始输出**（`raw` 字段），不带任何兜底和过滤。想判断「是模型没给」还是「被代码丢了」，只能看这里；看下发出去的 cue 判断不了。

### 排查演出问题看哪里：`<数据目录>/cue.log`

2026-11-14 加。之前只有两个可看的地方，都不够用：

| 位置 | 有什么 | 缺什么 |
| --- | --- | --- |
| `<数据目录>/memory/turns.jsonl` | 模型原始输出（`raw` 字段） | 兜底、`gateCues`、情绪替换、三段展开都在它**之后**，看不到最终演了什么 |
| `<数据目录>/sidecar.log` | 进程重启记录 | 完全没有表演内容 |

现在每次真正下发一条 cue，`pushCue()` 会往 `<数据目录>/cue.log` 追加一行 JSONL：

```json
{"t":"17:37:30.337","seq":1794591435,"src":"reply","scope":"upper","chars":19,
 "sub":"诶，日志那边？……抱歉，那个我还没动",
 "cues":[{"s":"animations","id":"story_subbase001_sub_fun","at":0,"d":2000,"w":""}]}
```

| 字段 | 意思 |
| --- | --- |
| `t` / `seq` | 下发时刻、队列序号 |
| `src` | 哪条路推的：`reply`（面板）/ `console`（`/play`）/ `observe`（旁观）/ `pomodoro` / `spark` |
| `scope` | `motionScope`，`upper` 不动 base、`full` 会重摆全身 |
| `chars` / `sub` | 字幕长度与前 40 字 |
| `cues` | **最终送出去的动作**，`d` 是清单里的真实时长，`w` 是模型给的理由 |

`id` 去掉了 `anim_` 前缀，看的时候短一点。动作时长 `d` 一律是查清单来的，不是模型给的——这一栏能直接看出「`_start` 是不是被写成了 50ms」这类错误。

日志到 200KB 自动砍掉旧的一半（保留最后 200 行），每 50 次下发检查一次。

**排查顺序**：

1. `cue.log` 最后几行 → 看到底演了什么、`scope` 对不对、三段齐不齐
2. 动作是空的或者全是同一支 → 翻 `turns.jsonl` 的 `raw.performance`，看是不是模型没给（示例污染，见上一节）
3. `src=console` 的可疑条目 → 多半是 `server.smoke.mjs` 跑测试留下的，有 3 分钟 TTL

### 时间感：她自己知道现在几点

`describeState` 拼进 prompt 的「当前处境」第一句就是：

```
今天是 11 月 14 日周六，下午 13:42。午饭后容易犯困，撑一撑就过去了。
上次说话是 今天早些时候。那次在聊：第三章。
我们都没在计时；我精神还不错，心情平平；我们算熟人了；今天已完成 2 个番茄钟。
```

两段来源：

- **`todayLine(now)`** — 日期 + 星期 + `HH:mm`。原来只有「下午」这种粗粒度，模型知道是下午但不会主动提，因为没东西可说。
- **`timeFeel(now)`** — 这个点身体什么感觉，九段：凌晨发涩 / 刚醒 / 上午最清醒 / 到饭点饿 / 午饭后犯困 / 下午注意力散 / 天黑想收工 / 晚上写得最顺 / 太晚该睡了。

**只给客观时间不够**。模型的默认行为是"礼貌地回避"，问它几点它会答，但不会自己说「都一点半了你还没吃饭」。把身体感受一起给，她才有反应：

```
问「现在几点了？」     答「一点四十四。午饭后有点犯困。」
问「我还没吃午饭呢。」  答「还没吃？你现在知道几点了吗。」
问「今天几号来着？」    答「十一月十四号，周六。都过一点了。」
```

时段分界：凌晨 <5 / 早上 <9 / 上午 <12 / 中午 <13 / 下午 <18 / 晚上 <23 / 深夜。**13:42 是下午不是中午**，这个边界踩过一次。

### 两份演出日志

```
<数据目录>/cue.log        真实演出（reply / observe / pomodoro / spark）
<数据目录>/cue.test.log   测试面板和联调脚本（sandbox 轮次）
```

原来是同一份，结果 98 条里 78 条是测试，翻「最近一次演出」根本找不到真的。现在 `logCue` 按 `item.sandbox` 分流，两个文件各自独立裁剪（200KB / 留 200 行）。

每行都带问题：

```json
{"t":"18:04:50.843","q":"嗯……这个我想一下。","sub":"在想什么，说一点给我听。","cues":[{"id":"story_base001_sub_thinking1_start","at":0,"d":833}]}
```

`q` 是触发这一轮的输入（`/observe` 那种主动开口的没有）。**只看她答的话，看不出是哪句输入触发的**——查「为什么演成这个动作」必须有 `q`。

查看最近几条：

```powershell
node -e "const l=require('fs').readFileSync('<数据目录>/cue.test.log','utf8').trim().split('\n');for(const x of l.slice(-3)){const o=JSON.parse(x);console.log(o.t+' 问「'+(o.q||'-')+'」 答「'+o.sub+'」 '+o.cues.map(c=>c.id+'@'+c.at+'/'+c.d).join(' → '))}"
```

**别把测试写进 `cue.log`**——那正是这套隔离要防的事。

### 别替用户发言

`/observe` 每轮旁观都会往记忆里写一句「（看了一眼他的进度）」。原来这句是当成 **user 发言**存的，于是 `promptMemory` 里反复出现：

```
user       （看了一眼他的进度）
assistant  表格重做了啊。我的报告还卡在第二页。
```

2026-11-14 用户看到这条说「最新一条信息不是我发的」。翻出来历史上一共有 **16 条**这种伪发言，既让模型误以为他说过这些，又占掉 `memoryTurns: 12` 里的位置。

改成旁观轮次只记她说的那一句：

```js
await appendTurn('', parsed, { skipUser: true })
```

记忆里只剩 `assistant: 表格重做了啊。……`——没有上文，因为她当时确实是对着屏幕自言自语。历史里那 16 条已清掉（`turns.jsonl` 57 → 41 行）。

**共性**：凡是系统自己造的「用户动作」，都不要落到 user 角色上。宁可没有上文，也不要伪造一个。

### 测试与真实演出必须分开

2026-11-14 一天内踩了两次：`cue.log` 98 条里 78 条是测试，翻「最近一次演出」全是「测试台词」；`turns.jsonl` 里混进一组 `user: 这条该进日志` / `assistant: 日志啊。……那里你打算怎么写。`——测试输入被当成真实对话写进了聪音的长期记忆，她之后会把它当共同经历引用。

配套的四道闸门、污染清理办法、自检清单都写在 **`skills/dsh-chill-with-you-companion-test-isolation/SKILL.md`**（插件内置技能）。这里只记结论：

- **裸调用（不带 `Origin`）一律当测试**：面板在 `127.0.0.1:10722`、侧车在 `10723`，真人操作必然跨源带 `Origin`；脚本、`curl`、`node -e fetch` 都不带。所以「忘了传 `sandbox:true`」不再会造成污染。
- **`sandbox` 只挡写，不挡读**：`withHistory: true` 让冒烟用例能验证「历史进 prompt」，又不用写记忆。
- smoke 的固定台词全部带 `sandbox: true`，跑完整套测试 `cue.log` 和 `turns.jsonl` 行数纹丝不动。

### 三段式：动作不是一条，是 start → loop → end

动作割裂的真正原因不在时间点，在**我们只下了三分之一**。

游戏里每个动作是一组三段式的动画，清单里明明白白：

| 段 | 作用 | 时长样本（`thinking1`） |
| --- | --- | --- |
| `xxx_start` | 过渡进入 | 833ms |
| `xxx_loop` | 保持（`loop: true`，会一直循环） | 50ms/圈 |
| `xxx_end` | 过渡退出 | 833ms |

`_start` 本身就是美术做好的**进入过渡**。只播 `_start`，过渡播完就**硬弹回静态姿势**——「动一下然后跳回去」，割裂感就是这么来的。`_loop` 会一直循环到下一个动作强切，没有 `_end` 收尾，她就僵在循环里或者被生硬盖掉。

模型基本只会给一段（它觉得那就是「做这个动作」），所以 `chainStartToLoop()` 统一按**组**展开：

```
输入 anim_x_loop / anim_x_end / anim_x_start
  ↓ 一律认出 base = anim_x
  ↓ 时长全部查清单，不用模型给的
  ↓
at+0          → anim_x_start   (进入过渡)
at+startDur   → anim_x_loop    (保持)
window-endDur → anim_x_end     (退出过渡，window = 语音时长 × 0.9)
```

**时长必须查清单，不能用模型给的。** 模型给 `_loop` 时带的是 `durationMs: 50`，拿它当 `_start` 的时长，过渡就变成一闪而过——比不接还难看。

实测（同一句话，模型只给了 `_loop`）：

```
旧：story_base001_sub_thinking1_start@0    dur=50     ← 过渡 50ms，等于没有
新：story_base001_sub_thinking1_start@0    dur=833
    story_base001_sub_thinking1_loop@833   dur=50
    story_base001_sub_thinking1_end@4567   dur=833
```

**多组时只有最后一组给 `_end`。** 前面几组的 `_loop` 会被下一组的 `_start` 接手，那条 `_start` 本身就是过渡，再插一个 `end` 反而把人家顶掉。

### 动作要撑得住整句话

三段式接好了，还有一层：**动作本身的时长够不够**。

清单里 227 个动作组，只有 47 组带进入过渡，其余 140 个是纯单段。单段里的 `_sub` 表情大多 1.5–2 秒：

```
story_subbase001_sub_joy   1500ms
story_subbase001_sub_fun   2000ms
story_subbase001_sub_sad   1900ms
story_base001_sub_nod      2167ms
```

而 20 个字念出来四五秒。**动作 2 秒演完，剩下两三秒她完全静止**——体感上就是「动一下然后死了」，跟起手时的硬切是两回事，但看起来一样难受。

2026-11-14 查到的真实一次：

```
17:38:08  reply  upper  [23字]「嗯。热情真的会被磨掉。我最近也难和父母聊研究。」
          → story_subbase001_sub_sad @0  dur=1900
```

23 个字配 1.9 秒的动作。

**两处一起改**：

1. **清单排序**：带 `_start` 的排最前，标 `full`；提示词里说明「标 full 的能撑满整句，优先选；标 1.5s/2.0s 的只适合短句」。场景类（`work_pc_*` 用电脑、`break_movie_*` 看电影）仍然排在最后——她平时在工位说话，选到「看电影时笑」会跟场景打架。
2. **情绪映射表**：状态性情绪换成撑得住的动作。

| 情绪 | 原来 | 现在 | 原因 |
| --- | --- | --- | --- |
| Sad | `sub_sad` 1900ms | `dropshoulders_start`（1000+2000+1000） | 沮丧是状态，要跟着整句撑住 |
| Happy / Fun | `sub_joy` / `sub_fun` | `break_movie_sub_laugh_start` | story 组没有「笑」的三段式，只有这组带完整过渡 |
| Agree | `sub_nod` | 不变 | 点头本来就该短促，说完就完 |

改完实测：

```
[20字] 那种感觉我懂一点…    dropshoulders_start@0 → loop@1000 → end@4382   撑到 5382ms
[14字] 不是摆烂，只是大家都累了…  shakehead@0  dur=2167                       够用
```

**判断标准**：`动作总时长 > 语音时长 × 0.7` 就算撑住了。撑不住的不是「割裂」，是「演完就静止」，两种都得治。

### loop 的时长是「一个周期」，不是「该播多久」

清单里循环段的 `durationMs` 记录的是**循环周期长度**，不是这段该持续多久：

```
story_base001_sub_thinking1_loop    dur=50   loop=true
story_base001_sub_confidence_loop   dur=50   loop=true
story_base001_sub_jump_loop         dur=17   loop=true
break_movie_sub_laugh_loop          dur=2500 loop=true
```

74 个循环段里有 3 个短到 50ms 甚至 17ms——那是微动/呼吸的循环节拍。直接把这个数写进 `durationMs`，游戏端循环刚起就结束，**剩下的两三秒她又静止着**，比根本没有 loop 还糟。

2026-11-14 查到的真实一次：

```
17:46:24 「咦，会留在日志里？那有点麻烦。」  语音 4760ms
  thinking1_start @0    dur=833
  thinking1_loop  @833  dur=50     ← 循环只跑了 50ms
  thinking1_end   @3451 dur=833
```

中间 2518ms 完全没人动。

**改法**：loop 段的真实时长是「从 `loopAt` 一直撑到 `end` 开始」：

```js
const endAt = hasEnd ? Math.max(loopAt, windowMs - endDur) : 0
const rawLoop = has(loopId) ? (animDurationMs(loopId) || 600) : 0
const loopDur = rawLoop ? Math.max(rawLoop, endAt - loopAt) : 0
```

`Math.max` 保底：清单给的真长（`laugh_loop` 2500ms）照用，给的是周期（50ms）就拉到 end 之前。

改完同一句：

```
thinking1_start @0   dur=833
thinking1_loop  @833 dur=1862    ← 撑住了
thinking1_end   @2695 dur=833
```

### 裸名也能是组头

`break_tea_sub_drink` 自己没有 `_start`，但后面跟着 `_tea_sub_drink_loop` 和 `_end`。原来的展开逻辑只认 `xxx_start`，裸名被当成自包含单段直接放过去——一次「喝茶」只演 1833ms，剩下 2.4 秒静止。

现在裸名如果存在 `_loop` 或 `_end` 兄弟，就按组头处理，裸名本身当进入段。改完：

```
break_tea_sub_drink      @0    dur=1833
break_tea_sub_drink_loop @1833 dur=1167
break_tea_sub_drink_end  @2613 dur=1167     覆盖 90%
```

**`cue.log` 只记真实演出**：`/act` 和 `/play` 带 `sandbox:true` 的请求（面板测试页、`server.smoke.mjs`、联调用例）不入档，否则翻日志时真实演出会被一堆「测试台词」埋掉。

### motionScope：别为了「演得完整」把 base 切了

`full` 会连全身 base 姿势一起切，换 base 的瞬间整个人重新摆一次——动作**起手时**的跳变多半来自这里。

清单里 `_sub` 是挂在上半身的叠加动作，`_base` 才是全身姿势。所以：

```js
function scopeFor(cues, phase) {
  // 只有真正换全身姿势的才 full：`_base` 是基础站/坐姿，`wild_*` 是起身那类完整动作。
  // 其余（打哈欠、垂肩、点头、摸眼镜）都是叠在上半身的。
  const fullBody = anims.some((c) => /(?:^|_)base(?:_|$)/.test(c.id) || /^anim_wild_/.test(c.id))
  if (!fullBody) return 'upper'
  if (phase === 'focus' || phase === 'break') return 'upper'
  return 'full'
}
```

**正则别写 `/_base/`。** 第一版就是这么写的，结果 `story_base001_sub_nod` 里的 `base001` 被命中，所有动作都判成全身，`scope` 永远是 `full`——这个 bug 让上一轮的修复等于没做。`_base` 必须是独立的一段：`/(?:^|_)base(?:_|$)/`。

以前空闲时一律给 `full`，等于每说一句都要把她整个人重新摆一遍。

### 动作不能互相打断

上一轮修完时机的遗留问题：两个动作排得再准，如果**前一个自己还没播完**就切下一个，看起来就是一串动作连着播。

`normalizeCueTiming` 现在会查前一个动作在游戏里的真实时长（manifest 的 `durationMs`），间隔取 `max(1000ms, 前一个的时长 + 250ms)`。`loop` 类动作的 `durationMs` 是一圈的长度、不代表要播这么久，按 1200ms 封顶。

| 前一个动作 | 需要的间隔 | 实际 |
| --- | --- | --- |
| 1500ms（`laugh_start`） | 1450ms（封顶 1200 + 250） | 1450 |
| 300ms（眨眼类） | 1000ms（下限） | 1000 |
| 8000ms（`*_loop`） | 1450ms（封顶） | 1450 |

`buildCueItem` 里顺带把 manifest 的时长补进每一条 cue——模型不给的时候，靠这个才知道动作多长。

### 推送去重（2026-11-14 修）

游戏端看到的「一句话演两遍」，根因不在动作编排，在队列本身。

`feed.payload()` 原来两条逻辑都是错的：

```js
const pending = feed.items.filter((it) => it.seq > since)   // 按客户端游标
const items = pending.slice(-limit)                          // 取最后 N 条
```

1. **`slice(-limit)` 取最后 N 条**。`since` 之后积压 20 条、`limit=8`，它给的是**最新 8 条**，中间 12 条直接跳过；游戏端把 `since` 跳到最新之后，那 12 条永远演不到。改成 `slice(0, limit)`——队列要的是**顺序消费**，不是「只看最新的」。
2. **完全信任客户端游标**。游戏端超时重发、协程重入、进程重启后 `since` 从 0 开始，这几种情况都会拿到**已经播过的那批**，于是同一句话再演一遍。一句话演两遍比丢一句难看得多。

现在服务端自己记一个 `delivered`（已交出去的最高 seq），取数从 `max(since, delivered)` 开始：

```js
const from = Math.max(Number(since) || 0, delivered)
const pending = feed.items.filter((it) => it.seq > from && it.at >= cut)
const items = pending.slice(0, limit)
```

**水位只在真正发出去之后才推**（`markDelivered` 放在 `sendJson` 之后）。写在前面的话，连接已断、对方根本没收到，这条就永久丢了。

实测（10 条依次推入）：

```
首拉 4 条            → 一二三四
重发同 since          → 五六七八        （不含前 4 条）
since=0（模拟重启）    → 五六七八九十    （不含已投递的）
```

**调试提示**：`server.smoke.mjs` 会直接 `POST /play`，跑完测试后 feed 里会留两三条测试数据（`source=console`）。它们有 3 分钟 TTL 会自己过期，但如果正在对着游戏看效果，会分不清是谁推的——先看一眼 `source` 字段。

### 语音（已按「游戏音色 + 日语」配好）

参考音是从游戏自己的语音包里抠出来的女主真声，48 kHz 单声道、约 4 秒：

```
ref\Voice_MainScenario_18_001.wav   4.24s   ← 当前 refAudio
ref\Voice_MainScenario_18_003.wav   4.21s
ref\Voice_MainScenario_18_004.wav   4.03s
ref\ref-index.json                  导出记录
```

`promptText` 故意留空：它必须与参考音**实际说的那句话**一致，填错反而掉质量。想更好，就听一遍那段 4 秒音频、把日文打进去填到 `promptText`，相似度会明显上来（1 分钟的事）。

GPT-SoVITS 没起（`127.0.0.1:9880` 不通）时**不报错**：自动降级成"纯字幕 + 不播语音"，游戏照常演。

## 模块地图（0.4.0 起）

| 文件 | 职责 |
| --- | --- |
| `index.js` | 监护子进程、反代 `/chill/v1/*`、源码改动自动换代 |
| `serve.mjs` | 子进程 HTTP 监听、诊断页、`CHILL_SIDECAR_READY` |
| `brain.mjs` | `apply()` 装配：配置、状态、路由（只做翻译，不写业务） |
| `lib/config.mjs` | 默认值 / 合并 / 凭据回落 |
| `lib/characters.mjs` | 角色卡：播种 / 列表 / 保存 / 激活 / lore 注入 |
| `lib/http.mjs` | `sendJson` / `readBody` / 鉴权 |
| `lib/feed.mjs` | 推送队列 + 长轮询（空转 8 秒一次，有 cue 立即回） |
| `lib/voice.mjs` | 语音引擎探活 / 起停 / 自愈 / 预热 |
| `lib/game.mjs` | 游戏进程探测、Steam 拉起、心跳 |
| `lib/capabilities.mjs` | 扩展点登记、`/meta` 自描述 |
| `lib/core.js` `lib/assets.js` `lib/memory-store.mjs` `lib/lipsync.mjs` | 纯函数 / 清单 / 记忆 / 口型 |
| `lib/client.js` | 控制台面板（React，DSH Client 半边） |

- 架构与数据流：[ARCHITECTURE.md](./ARCHITECTURE.md)
- 加功能 / 换 TTS / 接新表演端：[EXTENDING.md](./EXTENDING.md)
- 自描述：`GET /chill/v1/meta` 返回能力、钩子与全部路由

## 角色卡（0.6.0 起）

一个人 = 一张卡，装在 `<数据目录>/characters/<id>.json`，当前生效的角色记在 `<数据目录>/characters/_active.json`：

```json
{
  "id": "satone",
  "name": "聪音", "nameJa": "さとね",
  "tagline": "理工科三年级，在写科幻小说，偶尔抬头看你一眼。",
  "accent": "#e05a5a",
  "voice": { "refAudio": "…/Voice_MainScenario_18_001.wav", "promptLang": "ja", "textLang": "ja" },
  "emotionSet": "extended",
  "actionMap": null,
  "persona": "……人设正文（prompt 的第一段）……",
  "lore": [
    { "id": "world", "title": "这是怎样的关系", "always": true, "text": "……" },
    { "id": "ep-13", "title": "第13话 协作通话的距离感", "always": false, "text": "……" }
  ]
}
```

- **人设 + 剧情设定 + 声音装在同一张卡里**：`persona` 是每轮必带的正文；`lore` 是剧情与设定。
- **lore 两种**：`always: true` 每轮都进提示词（世界观硬设定，总量控制在 1200 字内）；其余按当轮话题做中文 2-gram 匹配，命中才注入（避免把 20 条剧情全塞进每次请求）。
- 卡片可以覆盖 `actionMap` / `emotionSet` / `voice`：换角色不用改配置。
- **默认载入聪音**：内置角色卡由 `persona.md` 在首次启动时播种到 `<数据目录>/characters/satone.json`。**lore 默认是空的**——主线设定要自己在面板「角色」tab 里加，或喂给 `skills/kb-authoring` 建知识库。
- **加第二个角色**：面板点「新建角色」，或 `POST /chill/v1/characters {"id":"xxx","name":"…"}`，填完人设点「设为当前」。
- 老接口 `/persona` 保留，读写的是当前卡的 `persona` 字段。

### 头像与名字都挂在角色卡上

换角色卡，头像和名字一起跟着变：

| 东西 | 存哪 | 说明 |
|---|---|---|
| 角色头像 | `<数据目录>/characters/avatars/<id>.png` | 属于这张卡；新建的卡在这里放图 |
| 角色名字 | 卡片 `name` 字段 | 面板标题、头像区标签都用它 |
| 玩家头像 | `<数据目录>/avatar/user.png` | 不是角色，跟卡无关 |

- 回落顺序：卡片头像 → 旧路径 `<数据目录>/avatar/<id>.png` → 占位 `<数据目录>/avatar/defaults/character.png`（新建角色的默认）。
- 面板「角色」tab 顶部「聊天头像」：左边是当前角色的头像 + 它的名字，右边是「我」。`选择图片` 会走 canvas 居中裁方 + 压到 256×256 + PNG 上传，写到对应位置；`默认` 删掉自定义图回落。
- 面板标题也读激活卡：`<名字> 控制台`，右边小标签是卡片 id。
- `/chill/v1/health` 增加 `characterId` / `characterName`。
- 游戏端不参与头像：不抓帧、不扫 UI 贴图。

### 声线库（「语音」tab）

一条声线 = 一段参考 wav + 它对应的原文本/语言 + 语速。GPT-SoVITS 拿它做 zero-shot 参考音。

| 位置 | 说明 |
| --- | --- |
| `<数据目录>/voices/index.json` | `{ active, items: [...] }`，当前声线与全部条目 |
| `<数据目录>/voices/audio/<id>.wav` | 用户上传的参考音频 |
| `ref/*.wav` | 游戏原始语音，内置声线直接引用，不复制 |

内置 4 条（只读，删不掉）：聪音 · 日常（默认）/ 轻声 / 认真 / 午间，都是游戏里的原声。

接口：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/chill/v1/voices` | 列表 + 当前 + 引擎是否在线 |
| POST | `/chill/v1/voices` | 新建条目（`{id,name,promptText,promptLang,textLang,speedFactor}`） |
| POST | `/chill/v1/voices/<id>/audio` | 上传参考音频（raw WAV，≤12 MB，RIFF 校验） |
| POST | `/chill/v1/voices/<id>/activate` | 设为当前声线 |
| POST | `/chill/v1/voices/<id>/preview` | 用这条声线合成「ねえ、聞こえてる？」试听 |
| DELETE | `/chill/v1/voices/<id>` | 删除（内置不可删；删当前会回落默认） |

合成语音时（`synthesize()`）用的 ref 音频、prompt、语言、语速全部来自当前声线，缓存 key 也把声线算进去，换声线不会读旧音频。

面板「语音」tab：上面是引擎状态和列表（用这个 / 试听 / 删除），下面是「加一条声线」——填名字、选语言和语速、选一个 WAV、可填原文本，点添加即可。

### 能力包 / 知识库（「知识库」tab）

这个插件要做的是"陪伴 + 干活"，但用户干什么活各不相同。所以把"她会什么"拆成能力包：
一个包 = 一段**能力说明**（role，每轮都进 system）+ 一堆**资料**（按需检索）。
换一个用户就换一套包：装「前端」她像做过前端，装「咖啡」她懂冲煮，什么都不装就只是本来的聪音。

```
<数据目录>/kb/<packId>/library.json      { id, name, note, role, enabled, docs:[...] }
<数据目录>/kb/<packId>/docs/<docId>.txt  资料原文（Markdown / 纯文本）
<数据目录>/kb/settings.json              { mode: 'work' | 'chat' }
```

**两层生效方式**

| 层 | 内容 | 什么时候用 |
| --- | --- | --- |
| 能力层（role） | 「她因为装上这个包而学会什么」 | 每轮都进 system，决定她**像不像**这个领域的人 |
| 资料层（docs） | 具体笔记、手册、规范 | 按当轮那句话检索，命中才进上下文 |

首启动会自动装一个 `assistant`（工作助手）包，role 写的是"先给结论和能执行的步骤，再补半句自己的口气；需求含糊时先按最合理假设做一版再问"。删掉它也可以，删了就回到纯陪伴。

**一套对话**：工作和闲聊已合并，只有一份聊天记录、一个输入框。观察只在旁边看一条 DSH 会话，让她知道你正在忙什么——不往里发话、不改那边的状态，停止观察后那条对话恢复原样。

**切块与检索**（同前）：按 Markdown 标题分节 → 短节并下一节 → 节内超 320 字再切 → 块间 40 字重叠；中文 bigram + 英文整词倒排索引，BM25（k1=1.2 / b=0.75），虚词在分词阶段剔除，命中分低于 `max(0.25, top×0.12)` 丢弃。索引懒加载、变更即失效。

**整包迁移**：`GET /kb/<id>/export` 出一份 `chill-kb-pack/1` json（含 role 与全部资料），`POST /kb/import` 装回去——换机器、分发、给不同用户各配一套都靠它。

接口：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/chill/v1/kb` | 包列表（文档数/字数/片段数）+ 当前 mode + inUse |
| GET | `/chill/v1/kb/search?q=&k=` | 检索测试 |
| GET | `/chill/v1/kb/<id>/export` | 导出整包 |
| GET | `/chill/v1/kb/<id>/docs/<doc>` | 读一篇资料 |
| POST | `/chill/v1/kb` | 建包 `{id,name,note,role}` |
| POST | `/chill/v1/kb/<id>` | 改包 `{name,note,role,enabled}` |
| POST | `/chill/v1/kb/import` | 导入整包 |
| POST | `/chill/v1/kb/mode` | `{mode:'work'|'chat'}` |
| POST | `/chill/v1/kb/<id>/toggle` | 装/卸（卸下就不参与索引与能力层） |
| POST | `/chill/v1/kb/<id>/docs` | 收资料 `{name,text}` |
| DELETE | `/chill/v1/kb/<id>` / `…/docs/<doc>` | 删包 / 删资料 |

上限：40 个包、每包 500 篇、单篇 40 万字。

### 观察：在旁边看着（「对话」tab）

观察条常驻在对话页顶部，从下拉里挑一条**你自己的 DSH 对话**。

**观察是「在旁边看着」，一个字都不往那边写**。早先试过把聪音的人设块贴到投递消息前面，结论是行不通：那条对话一旦要维持人设，干活的判断力就跟着下降。所以反过来——

- 那边照原样干活，插件只读它的事件流（`sessionController.follow()`），不改它的系统提示、不改 profile、不碰历史。
- 每读完一轮只**更新一份进度快照**（轮数 / 动过哪些工具 / 出没出错 / 最后一句在做什么），零成本。
- 攒够一批（≥8 次工具调用、或 ≥4 轮、或 ≥5 分钟、或出错）才请她开口，而且**只说一句概况**：关心、提醒、或者她自己的反应。她说的话在「对话」tab 里，同时推给游戏演（字幕 + 语音 + 情绪动作）。
- 冷却 5 分钟，避免刷屏。小步碎步在本地就掐掉，不花一次模型调用。

**她也可以主动抬眼**（冷读，不激活对方的 Agent，所以看多少眼都不干扰）：

- 那边静默超过 15 分钟 → 每 60 秒的静默心跳里 `inspect()` 一次，把实况校准进快照，再决定要不要开口。
- 面板上的「看一眼」按钮 → 强制看一次，回来显示「X 轮 / Y 次工具 / 动了什么」。

**知道 ≠ 汇报**。快照以 `## 你旁边的近况` 的形式进**她自己的**上下文（`POST /chill/v1/ambient`，Host 每 60 秒推一次，内容没变就不重推，半小时不更新即过期）。所以她跟你闲聊时带着「他刚才在改那个 bat」的记忆——但他没提，她也犯不上主动报。**问起来得答得上**，这是这条链路的验收标准。

### 主动搭话

跟观察无关，你自己不说话她也会开口。

- 间隔跟着番茄钟阶段走：空闲 **13–18 分钟**、休息 **8–14 分钟**、专注 **20–32 分钟**。计时从你最后一次真的说话算起（她自己说过话不算）。
- **静默满 30 分钟**，性质就变了：换成关心型提示（问你在忙什么、具体的身体小事），不再是随口搭一句。
- 她连着说了几次你都没回，间隔按次数拉长（2 次 ×1.7、4 次 ×2.6）——不刷屏，也不消失。
- **有悬着的话题时优先问那个**（见「悬着的话题」一节），比任何模板都更像认识一个人。
- 顺带知道你在干嘛的话，就顺着那件具体的事说，不问「在忙吗」这种等于没看的话。
- 走完整人设链路：写进聊天历史、推给游戏演（字幕 + 语音 + 情绪动作），不是系统播报。
- 手动触发：面板「让她说句话」→ `POST /chill/v1/spark`。

### 为什么一半在 Host、一半在侧车

侧车是独立子进程，访问不到 Host 的会话服务；列表 / 跟流 / 冷读都在 `index.js`（Host）里，侧车只负责两件事：看她那一批概况要不要出声（`POST /chill/v1/observe`），以及存取「旁边的近况」（`POST /chill/v1/ambient`）。

数据：`<数据目录>/work/settings.json`（观察的是哪条）、`<数据目录>/work/turns.json`（最近 400 条工作流水）。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/chill/host/work` | 状态 + 流水 + 会话列表（Host） |
| GET | `/chill/host/work/sessions` | 只列普通会话（子代理会话已过滤） |
| GET | `/chill/host/work/diag` | 诊断：Host 有没有交出会话服务 |
| POST | `/chill/host/work/bind` | `{sessionId,title}` 开始观察 → 自动跟流 |
| POST | `/chill/host/work/unbind` | 解除（停掉观察） |
| POST | `/chill/host/work/look` | 让她现在冷读一眼，并判断要不要开口 |
| POST | `/chill/host/work/send` | `{text}` 原样投递（保留给控制台派活，日常聊天不走这里） |
| POST | `/chill/host/work/cancel` | 停掉那条对话当前这一轮 |
| POST | `/chill/v1/observe` | 侧车：给一批概况，决定说不说、说什么、合成语音、推游戏 |
| POST/GET | `/chill/v1/ambient` | 侧车：存取「旁边的近况」，进她自己的上下文 |
| GET | `/chill/v1/context?q=&maxChars=` | 旧的身份块接口（已不用于注入，保留备用） |

## 情绪系统（0.5.0 起）

以前只给模型 8 个标签（`base8`），其中一半还是"状态"（Working/Idle），所以每句话看起来都在同一个表情上。现在：

- **29 个情绪键**，全部来自游戏里真实存在的子动作：Joy / Fun / Guts / Shy / Frustration / Laugh / Tired / Surprise / Cheer / Excited / Relaxed / Curious / Sleepy / Angry / Disagree / Deep / Fidget / Confused / Sad / Agree / Drink / Wave / Happy。
- **每个情绪都有真 clip**（`EXTENDED_ACTION_MAP`，29 个键，逐一在 `<数据目录>/assets.json` 的 389 条动画里校验过）。
- **三档门控**（`EMOTION_TIERS`）决定要不要动手：
  - `strong`（害羞/笑/欢呼/沮丧/惊讶…）**无视冷却，几乎必动手**——这是"灵动"的主要来源；
  - `soft`（思考/疲惫/好奇…）按 `gestureChance`（默认 0.7）+ `gestureCooldownTurns`（默认 1）轻带一下；
  - `still`（低落/喝水）**不动手**，只留字幕和语气，避免"难过还在挥手"。
- **没动作就补一个**：模型只给了 sfx/scene、或者干脆给了空数组时，后端按情绪补一条真实动作，再按档位放行。光有字幕没人动，看起来就是死的。
- `still` 档只砍动作，不再连带把 sfx/scene 一起砍掉（0.5.0 前的 bug）。

提示词里给每个情绪配了中文注解（`EMOTION_HINTS`），并要求"按这一句真正的心情选、别每轮都用 Happy"。角色卡的 `persona` 里按"什么情况用哪个情绪"写成了行为清单——改人设不用改代码，面板里保存即生效。

## 开发

```powershell
cd <插件目录>
node --check brain.mjs
node tools/run-tests.mjs     # 一次跑完 test/ 下全部 6 个文件，任一失败 exit 1

node test/core.test.mjs         # 纯逻辑：解析 / 状态机 / 截断
node test/assets.test.mjs       # 清单规整与剪枝
node test/server.smoke.mjs      # HTTP 端到端（假 fetch，不联网）
node test/characters.test.mjs   # 角色卡播种、lore、激活
node test/work-watch.verify.mjs # 观察者的判定与节流
node test/regressions.test.mjs  # 三条 severe 的回归（事实字段 / BOM / 卡 id）
```

改了 `brain.mjs` / `lib/*` 会自动换代（子进程重启，~0.4 s）；**只有 `index.js` 改动需要重启 `dsh web`**。
`persona.md` 不需要重启（按 mtime 热加载）。

## API key 从哪来

按这个顺序取第一个非空的：

1. 插件 config 的 `apiKey`（写死在 `cordis.patch.yml`，不建议）
2. 环境变量 `DEEPSEEK_API_KEY`（dsh web 进程的环境）
3. **DSH 自己的凭据库** `<DSH_HOME>/.credentials.yaml` 里 `refs.DEEPSEEK_API_KEY`

第 3 条是默认路子 —— 只要 dsh 本身能登录 DeepSeek，插件就能用，不用另配 key。
`/chill/v1/health` 的 `hasApiKey` 会告诉你当前有没有取到。

**注意**：改了 `index.js` 之后必须重启 `dsh web` 才生效（ESM 模块缓存按进程走）。

## 控制台（DSH 页面）

包里带一个客户端面板 `lib/client.js`，在 DSH 左侧栏出现「聪音控制台」图标，点开是整页控制台（和 ComfyUI 绘图台同级的主面板，不是设置页）。

四个页签：

- **状态**：阶段 / 能量 / 好感 / 轮次，引擎（模型、thinking、情绪档、API key、TTS），资源索引计数，以及四个场景事件按钮（开始专注 / 结束专注 / 休息 / 空闲）
- **试演**：输入一句话 → 走真实链路 `POST /chill/v1/act` → 显示情绪、中文字幕、日语台词、表演 cue 列表、延迟，并直接播放合成出来的 wav
- **人设**：直接读写 `persona.md`（GET/PUT `/chill/v1/persona`），保存后下一轮生效
- **资源**：浏览 389 条白名单，按组筛选 + 搜索，点卡片复制 id

样式只用 `--dsw-alias-*` 主题令牌，亮/暗主题跟随宿主；渲染包了错误边界，面板出错不会连累整个页面。

**改完 client.js 要让页面重新加载**：客户端模块在页面启动时加载，刷新浏览器标签即可；若改的是 profile 组合（bundle 增删），则要重启 `dsh web`。


## 侧车化（2026-11-13）

大脑逻辑跑在独立子进程里，DSH 侧只留一个薄壳。目的：**改代码不用重启 dsh web**。

| 文件 | 角色 |
| --- | --- |
| `brain.mjs` | 全部逻辑（30 条路由、DeepSeek、记忆、TTS）。侧车化前的 `index.js` 原样搬过来，未改一行 |
| `serve.mjs` | 侧车入口：用真实 `http.Server` 顶替 `ctx.webServer`，默认 10723；端口被占自动退到临时端口并上报真实端口 |
| `index.js` | DSH 插件壳：拉起子进程、反代 `/chill/v1/*`、监护重启、源码改动热换代；面板照旧 |

**为什么由 DSH 看护侧车**：DSH 已经在跑、已经能读凭据、已经管生命周期；多一个系统级守护进程只是多一处要维护。代价是 dsh web 挂了大脑也跟着停——但它重启时会把侧车一起拉起来，数据全在磁盘上，不丢。

**运维**：

```
GET  /chill/v1/admin/sidecar    看 ready/pid/真实端口/重启次数
POST /chill/v1/admin/sidecar    立即换代（等价于改代码后的热重启）
```

改 `brain.mjs` / `serve.mjs` / `lib/*` 后**等 0.4 秒自动换代**，不需要手动操作，更不需要重启 dsh web。改 `index.js`（壳）本身才需要重启 dsh web。

独立运行（不装 DSH 也能用）：

```
set CHILL_BRAIN_PORT=10723
node serve.mjs          # 浏览器开 http://127.0.0.1:10723/ 看诊断页
```


## 语音引擎开关（控制台按钮）

控制台「状态」页最上面是**语音引擎**卡片：在线/未启动、端口、计划任务状态、朗读语言，以及 **启动 / 停止 / 重启** 三个按钮。什么时候烧 GPU 由你决定，不再自动拉起。

接口（都在大脑侧，走 10722 反代）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/chill/v1/admin/voice` | `{online, port, task, taskStatus, ttsEnabled, textLang, lastError}` |
| POST | `/chill/v1/admin/voice/start` | 未在线时 `schtasks /run /tn ChillGSVServer`；已在线则什么都不做 |
| POST | `/chill/v1/admin/voice/stop` | 先按端口找监听者 `taskkill`，再 `schtasks /end` 清任务实例 |
| POST | `/chill/v1/admin/voice/restart` | 杀干净 → 重新 `/run` |

**三条踩过的坑**（都已在代码里绕开）：

1. **不能用 `.cmd` 当启动器**：脚本里有中文路径，用 ASCII 写会把「日志」写成 `??`，用 UTF-8 写则 cmd 按 GBK 解析乱码。改成 `gsv-serve.ps1`（UTF-8 带 BOM），PowerShell 原生吃 Unicode 路径。
2. **必须让"任务本身"前台等 python**：脚本里用 `&` 直接跑 python 而不是 `Start-Process`，否则脚本一退出任务实例就结束，python 被任务作业对象带走。现在任务 `State=Running` 就等于"语音真的在跑"，状态可直接信。
3. **`schtasks` 的输出是本地化的**：中文系统里那一行是「状态:」不是 `Status:`，正则匹配不到。改用 `(Get-ScheduledTask).State` 枚举名（`Ready` / `Running`），与语言无关。

**停止后不会失语**：没语音时她照常出字幕和动作，只是没声音；`ttsError` 也不会挂旧错误（成功后会清空）。


## 拉起游戏按钮

控制条上「重启」右边隔一条竖线，就是 **游戏** 段：`游戏运行中 / 游戏未运行` 徽标 + **拉起游戏** 按钮。跑起来之后按钮自动禁用，避免重复请求 Steam。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/chill/v1/admin/game` | `{running, pid, image, uri, inScene, heartbeatAgeMs}` |
| POST | `/chill/v1/admin/game/launch` | 已在跑就直接返回；否则交给 Steam 拉起，最多等 9 秒回报 PID |

**为什么走 `steam://rungameid/3548580` 而不是直接 exec exe**：Steam 要记游戏时长、要注入 overlay；直接起 `Chill With You.exe` 会被当成非 Steam 会话，成就和云存档都可能不认。命令是 `cmd /c start "" "steam://..."`——`start` 是 cmd 内建命令，空标题参数不能省，否则 URI 会被当成窗口标题。

**判定"在跑"用 `tasklist /fi "imagename eq Chill With You.exe" /fo csv /nh`**，解析 PID；不看端口也不看心跳，因为游戏在标题界面时还没有心跳。

## 快捷框：从独立 exe 换成插件自带页面

原来 `tools/ChillQuickBox.exe` 是一个 521 行的 C# WinForms 小窗，要手工用 `csc` 编译，
还得带着 `ChillQuickBox.cs` / `启动快捷框.vbs` / `app.manifest` / `quickbox.pos` 一起走。
插件包里躺着一个二进制，改一行文案都要重新编译，换台机器就编译不出来。

现在换成插件自己吐的一张网页：

| 原来 | 现在 |
| --- | --- |
| `ChillQuickBox.exe`（18 KB 二进制） | `tools/quick.html`（8 KB 纯文本，改完刷新即生效） |
| `csc.exe` 手动编译 | 无构建 |
| `quickbox.pos` 存窗口坐标 | `localStorage` 存对话，窗口位置交给浏览器 |
| `HttpWebRequest` 打 `127.0.0.1:10722` | 同源相对路径 `/chill/v1/act`，端口不用管 |
| 单实例 `Mutex` | 同一 URL 再点只会聚焦已开的窗口 |

### 路由

```
GET  /chill/quick        返回 quick.html（text/html, no-store）
POST /chill/v1/quickbox  用浏览器 --app 开成独立窗口
```

拉起时按 Chrome → Edge 的顺序找 `--app` 可用的浏览器，窗口尺寸 `--window-size=430,560`；
一个都没有就退回 `explorer.exe <url>`，用系统默认浏览器。端口从 `req.headers.host` 取，
不写死 10723。

### 顺带修掉的一个行为差异

老 exe 用裸 `HttpWebRequest`，**不带 `Origin` 头**，而 `isAutomation()` 正是拿这个头
判断「这是不是真人」。也就是说快捷框里说的话以前全被当成沙箱输入，不进记忆。
网页版是同源 `fetch`，浏览器会带 `Origin`，现在这些话会正常落进记忆——这才是该有的行为。

### 配置里的绝对路径

`cordis.patch.yml` 的 `tts.engine` 原本写死本机的绝对路径。
现在三样留空，由 `lib/config.mjs` 的 `discoverEngine()` 按
「插件内 `tools/` → 插件同级的 `tools/`」自动找：python 找 `gsv-venv/Scripts/python.exe`，
repo 找 `gsv-src/GPT-SoVITS-main`，日志固定落在插件自己的 `<数据目录>/gsv-server.log`。
显式填了路径但那个路径不存在时，也会回落到找到的位置，不让一处笔误把语音整段哑掉。

## License

MIT，见 [LICENSE](./LICENSE)。

**仓库里没有游戏本体。** 《放松时光：与你共享 Lo-Fi Story》的美术、音频、模型、可执行文件
与 Unity 资源包（`*.bundle` / `*.assets` / `*_Data/`）都不在本仓库，也不随 Release 分发——
`.gitignore` 里有对应的硬规则。仓库里只有三类东西：插件代码、我们自己编译的
`ChillPerformer.dll` 及其源码、一张**只有动作名**的清单 `game/assets.seed.json`。
DLL 与清单的来源、边界、以及"删掉 game/ 就退回纯代码"的做法见 [NOTICE.md](./NOTICE.md)。