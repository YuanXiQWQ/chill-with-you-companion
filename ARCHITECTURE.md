# dsh-chill-with-you-companion 架构

> 目标：**DeepSeek 想，前端演，插件当胶水**。所有能力都通过 `apply()` 里装配的服务对象暴露，
> 路由只做"翻译 HTTP"，不写业务。加功能的正确姿势见 [EXTENDING.md](./EXTENDING.md)。

## 进程模型

```
dsh web（Host 进程）
└── dsh-chill-with-you-companion/index.js          监护 + 代理 + 热换代
    └── serve.mjs（子进程，:10723 或随机端口）
        └── brain.mjs（apply()）        业务编排 + 路由注册
            ├── lib/core.js               纯函数：解析 / 规范化 / 状态机 / cacheKey
            ├── lib/assets.js             资源清单规整与校验（白名单）
            ├── lib/memory-store.mjs      分层记忆：turns / facts / summary
            ├── lib/lipsync.mjs           口型帧 + wav 时长
            ├── lib/config.mjs            默认值 / 合并 / 凭据回落 / token
            ├── lib/http.mjs              sendJson / readBody / 鉴权（常数时间比较）
            ├── lib/feed.mjs              推送队列 + 长轮询
            ├── lib/llm.mjs               provider 清单 / 凭据解析 / 候选链
            ├── lib/model-client.mjs      模型调用：重试 + 跨 provider 降级  ← 2026-11-14 拆出
            ├── lib/state-file.mjs        state.json：加载 / 对账 / 原子落盘  ← 2026-11-14 拆出
            ├── lib/characters.mjs        角色卡读写与内置卡播种
            ├── lib/voices.mjs            音色列表与微调
            ├── lib/kb.mjs                知识库检索与同步
            ├── lib/work.mjs              观察别的会话（只读，不注入）
            ├── lib/voice.mjs             语音引擎生命周期
            ├── lib/game.mjs              游戏进程探测与拉起
            ├── lib/capabilities.mjs      扩展点登记 / 自描述
            ├── lib/client.js             控制台面板（Client 半边）
            └── routes/                   从 brain 搬出去的路由组
                ├── panel.mjs             /chill/v1/llm（模型页）
                ├── avatar.mjs            /chill/v1/avatar（含 readBinary 上传）
                ├── characters.mjs        /chill/v1/characters（激活时经 setPersona 写回 brain）
                ├── assets.mjs            /chill/v1/assets（经 getManifest / setManifest 动 brain 那份）
                ├── voices.mjs            /chill/v1/voices（声线库 + 试听，落盘目录注入）
                ├── kb.mjs                /chill/v1/kb（检索 / 导入 / 同步，只管 HTTP 形状）
                ├── audio.mjs             /chill/v1/audio 与 /chill/v1/audio/*
                ├── mood.mjs              /chill/v1/spark · /chill/v1/ambient
                ├── persona.mjs           /chill/v1/persona（读走 readPersona，写走 setPersona）
                ├── admin.mjs             /chill/v1/admin/game（状态 · 拉起）
                └── admin-voice.mjs       /chill/v1/admin/voice（并把 voiceAction 交回 brain）
```

### 拆分边界（2026-11-14 起）

`brain.mjs` 从 3,072 行降到 2,267 行（−26.2%）。搬走 11 组外围路由（845 行），留下的是真正"跑一轮"的部分：

| 模块 | 搬走了什么 | 为什么先搬它 |
| --- | --- | --- |
| `lib/state-file.mjs` | `state.json` 的加载、白名单合并、写前对账、原子落盘 | 全是"和磁盘打交道"的规则，和业务无关；以前只能靠端到端冒烟间接测 |
| `lib/model-client.mjs` | 请求体拼装、重试、跨 provider 降级、用量记账回调 | 这是外部世界边界（超时 / 限流 / 换家），混在对话编排里时改重试策略要翻整轮逻辑 |
| `routes/panel.mjs` | `/chill/v1/llm` 整条路由 | handler 只碰注入进来的 `llm`，不读也不写 brain 内部状态——所以能整块搬，不用先立 owner |
| `routes/avatar.mjs` | `/chill/v1/avatar` 整条路由 + `readBinary`（后者进了 `lib/http.mjs`，声线上传也用） | 同上：只依赖 `dataDir` 与文件系统 |
| `routes/characters.mjs` | `/chill/v1/characters` 整条路由 | 会改"当前人设"，但人设本体归 brain（提示词里到处直接读）。所以注入 `setPersona` 写回一处，模块不存副本 |
| `routes/assets.mjs` | `/chill/v1/assets` 整条路由 + `assetReport` | 清单本体归 brain（提示词与演出校验都要读）。注入 `getManifest` / `setManifest`，不做第二份 |
| `routes/voices.mjs` | `/chill/v1/voices` 整条路由（含试听：合成 → 落盘 → 返回 audioUrl） | 声线仓储与引擎探活都是注入的，模块不推导路径，避免和 brain 的 dataDir 口径打架 |
| `routes/kb.mjs` | `/chill/v1/kb` 整条路由（230 行，最大的一块） | 检索与存储都在 `lib/kb.mjs`，这段只是 HTTP 形状（分页、limit 上限、错误码） |
| `routes/audio.mjs` | `/chill/v1/audio` 两种形态（`?name=` 与路径） | handler 只有两行，真正的合成缓存在 brain 的 `serveAudio` 里，注入即可 |
| `routes/mood.mjs` | `/chill/v1/spark` · `/chill/v1/ambient` | `spark` 要读状态机、旁白要读写 brain 的两个变量，用 `getAmbient` / `setAmbient` 注入 |
| `routes/persona.mjs` | `/chill/v1/persona` | 人设归 brain（提示词到处读它），读走 `readPersona`、写走 `setPersona`，且写前仍留 `.bak-` |
| `routes/admin.mjs` | `/chill/v1/admin/game` · `/admin/game/launch` | 只调注入的 `game` / `gameRunning`，不碰状态 |
| `routes/admin-voice.mjs` | `/chill/v1/admin/voice` | start / stop / restart 三个动词仍由 brain 注册，模块把 `voiceAction` 作为返回值交回去，调用点不用改 |

「会改 brain 内部状态」那两组是这样处理的：**不搬状态，只搬代码**。模块不持有 `persona` /
`manifest`，而是接收写入函数（`setPersona` / `setManifest`）或读取函数（`getManifest`），
改动一律落回 brain 那一份。比立 `personaStore` 省事，也避免了最难查的双份状态——代价是
brain 里必须留一个显式的写入口，`test/route-groups.test.mjs` 会检查它还在。

### 哪些故意没搬

`/act`、`/chat`、`/chat/completions`、`/turn`、`/event`、`/game`、`/memory`、`/play`、`/pull`、
`/health`、`/meta`、`/quickbox`，以及 `/observe` + `/context` —— **这些就是"大脑"本身**。

实测过一次：`/observe` 那段 185 行要注入 25 个 brain 内部件（`turnActive`、`callModel`、
`parseModelOutput`、`manifest`、`gateCues`、`scopeFor`、`synthesize` …）。搬出去等于把闭包摊成一张
25 项的参数表，架构没变好、出错面变大，还会让"一轮到底怎么走"更难读——所以那一段我又原样塞回去了。

**判据**：一个路由区块，如果它读写的 brain 内部件超过 6 个，说明它就是编排本身，留在 brain；
少于 6 个基本都能按"读注入、写回落"搬走。

搬完六组后的守门测试：`test/route-registry.test.mjs` 用最小依赖把六组都注册一遍（漏注入在注册期就炸），
并检查路径不重复、不回 brain；业务语义另由 `test/routes.test.mjs` / `test/route-groups.test.mjs` 覆盖。

为什么要子进程：`brain.mjs` / `lib/*` 改动只需子进程重启（~0.4 s），不必重启整个 harness；
子进程崩了由 `index.js` 按退避（1–5 s，60 秒内 5 次崩溃后退到 10 s）拉起。

## 数据流

```
[面板] --POST /act--> brain --DeepSeek--> 规范化 --> TTS 合成 wav
                                  |                       |
                                  |                       └--> data/audio/<key>.wav
                                  └--> /chat 历史 + 记忆
[面板] --POST /play--> feed.push(item) ──唤醒──> 挂起的 [游戏] GET /pull?since=N
                                                      └--> 播动画 / 字幕 / 语音
[游戏] --POST /game(每 5 s)--> game.touch() --> /health 的 gameOnline
[游戏] --POST /assets--------> normalizeManifest --> data/assets.json --> 提示词白名单
```

关键点：**游戏端只会 GET `/pull`**（Unity 协程），所以推送队列用长轮询（挂 8 秒，有 cue 立即回），
把 0.6 秒一次的空转降到 8 秒一次，且推送延迟≈0。

## 职责边界（改动前先看这张表）

| 文件 | 负责 | 不负责 |
| --- | --- | --- |
| `index.js` | 起停子进程、端口探测、把 `/chill/v1/*` 反代到子进程、热换代 | 任何业务 |
| `serve.mjs` | HTTP 监听、诊断页、端口重试、`CHILL_SIDECAR_READY` | 任何业务 |
| `brain.mjs` | `apply()` 装配：配置、状态、路由注册 | 具体算法（在 lib） |
| `lib/core.js` | 纯函数：输出解析、动作映射、状态机、缓存键 | IO |
| `lib/voice.mjs` | 探活、起停、自愈、预热 | 合成（由 brain 注入 `synthesize`） |
| `lib/feed.mjs` | 队列、seq、长轮询挂起/唤醒 | 条目长什么样（由 brain 构造） |
| `lib/game.mjs` | 进程探测、拉起、心跳 | 表演内容 |
| `lib/capabilities.mjs` | 扩展点、`/meta` 自描述 | 业务 |
| `lib/client.js` | 面板 UI（React，DSH Client 半边） | 任何决策 |

## 状态存在哪

| 路径 | 内容 | 谁来写 |
| --- | --- | --- |
| `data/state.json` | 状态机（phase / energy / turnCount …） | brain |
| `data/memory/turns.jsonl` | 逐轮原文 | memory-store |
| `data/memory/facts.jsonl` | 长期事实 | memory-store |
| `data/memory/summary.json` | 滚动摘要 | memory-store |
| `data/assets.json` | 游戏上报的资源清单 | `/assets` POST |
| `data/audio/*.wav` | 合成缓存 | synthesize |
| `data/voice.want` | 用户是否希望语音引擎开着（看门狗据此复活） | `/admin/voice/*` |
| `data/tts.log` / `data/warm.log` | 合成失败 / 预热记录 | voice, synthesize |
| `data/sidecar.log` | 子进程生命周期 | index.js |

## 陪伴上下文：一个被裁剪的可观测状态机

这一节写的是「她每轮看到什么」。**上下文不是"聊过的全部"，而是每轮重新裁剪出来的一个窗口。**
这是全项目最容易被后来者顺手改坏的一处：加一句"把最近 50 轮都带上"很自然，系统当场回到又贵又啰嗦的原点。

### 四层结构（顺序不能动）

| 层 | 内容 | 每轮变吗 | 位置 |
| --- | --- | --- | --- |
| **稳定前缀** | `persona.md` 人设与说话纪律、输出契约、动作/表情白名单、视角约定（`PERSPECTIVE`） | 不变 | **最前** |
| **易变状态** | `energy` / `timeFeel` / `phase`（番茄阶段）/ 关系深度 / 母题窗口 | 每轮 | 中段 |
| **记忆窗口** | 最近若干轮原文 + `summary.json` 滚动摘要 + `facts.jsonl` 长期事实 | 每轮 | 中段 |
| **本轮输入** | 用户这句话、知识库命中片段、环境读数（`ambient`） | 每轮 | **最后** |

**缓存只认前缀。** 把会变的东西写进最前面，等于每轮全量重算，省下的 token 与首字延迟一次还回去。
所以新增任何字段，先问一句「它多久变一次」，再决定放哪层——而不是按语义顺序摆。

### 为什么要裁剪，而不是全量喂

三个代价里任何一个都足以否决全量历史：

1. **钱与延迟**：上下文长度 × 请求次数。全量历史是唯一会随使用时长线性变贵的写法。
2. **复读**：把说过的话全摆回去，模型会照着最近的措辞再说一遍。母题窗口（滑动窗口记录用过的意象）存在的意义就是压这个。
3. **角色漂移**：历史越长，最近几轮的措辞越容易盖过人设。稳定前缀放最前、且永不变，才有东西压得住。

### 新增一个「状态量」的判据

四条全过才加进上下文：

- [ ] 它能**改变行为**（不是只用来展示；写完不参与任何判断的就别加）
- [ ] 它**有来源**（游戏上报 / 真实计时 / 用户输入），不是凭手感编的常数
- [ ] 它**变化频率已知**，且按频率放进了正确的层
- [ ] 它**可回落**：读不到时有一个明确默认值，而不是让整轮失败

反例（真实发生过）：`SPARK_GAP` 的专注间隔 20–32 分钟是凭手感定的，没有真实信号支撑。
它不算"错误的状态量"，但**它是缺输入的**——这类量应该被标出来，而不是假装它是观测值。

### 不许做的事

| 别做 | 后果 |
| --- | --- |
| 把最近几十轮原文整段塞进 prompt | 成本线性涨、复读率上升、人设被最近措辞带跑 |
| 把 `turns.jsonl` / 原始日志直接当上下文 | 里面有一半是系统标注与失败重试，模型会学着重试 |
| 把每轮都会变的字段写进稳定前缀 | 原生前缀缓存全部失效，白花一倍钱 |
| 在 prompt 里放"该不该说话"的判断 | 沉默与否由 `gapFor()` 按阶段决定，交给模型就会话密到烦人 |

### 怎么验

`GET /chill/v1/context` 返回本轮真实拼装的上下文：`chars` 是总字数，`parts` 是逐段来源。
调参或改裁剪逻辑后，先看这个接口，确认「稳定前缀没变、易变段没有膨胀」，
再去看 `/act` 的台词——**别看结果猜输入**。

## 配置来源（优先级从高到低）

1. `cordis.patch.yml` 的 `config:` 段（覆盖默认值）
2. `lib/config.mjs` 的 `makeDefaults()`
3. API key 额外的回落链：`config.apiKey` → `$env:DEEPSEEK_API_KEY` → `~/.dsh/.credentials.yaml` 的 `refs.DEEPSEEK_API_KEY`

新增配置项：只改 `lib/config.mjs` 的 `makeDefaults()`，再在 `cordis.patch.yml` 里写覆盖值。
业务代码里不许出现裸的魔法数字（超时、阈值、间隔都进配置或模块默认参数）。

## 版本

- `VERSION`（`brain.mjs` 顶部）随 `/meta` 暴露，表演端/面板可据此做能力协商。
- `package.json` 的 `version` 与 `VERSION` 同步维护。
