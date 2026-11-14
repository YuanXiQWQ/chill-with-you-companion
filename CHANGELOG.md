# 变更记录

本文件记录每个版本的可见变化。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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