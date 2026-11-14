# dsh-chill-with-you-companion 架构

> 目标：**DeepSeek 想，前端演，插件当胶水**。所有能力都通过 `apply()` 里装配的服务对象暴露，
> 路由只做"翻译 HTTP"，不写业务。加功能的正确姿势见 [EXTENDING.md](./EXTENDING.md)。

## 进程模型

```
dsh web（Host 进程）
└── dsh-chill-with-you-companion/index.js          监护 + 代理 + 热换代
    └── serve.mjs（子进程，:10723 或随机端口）
        └── brain.mjs（apply()）          全部业务
            ├── lib/core.js               纯函数：解析 / 规范化 / 状态机 / cacheKey
            ├── lib/assets.js             资源清单规整与校验（白名单）
            ├── lib/memory-store.mjs      分层记忆：turns / facts / summary
            ├── lib/lipsync.mjs           口型帧 + wav 时长
            ├── lib/config.mjs            默认值 / 合并 / 凭据回落   ← 新增
            ├── lib/http.mjs              sendJson / readBody / 鉴权  ← 新增
            ├── lib/feed.mjs              推送队列 + 长轮询           ← 新增
              ├── lib/llm.mjs                provider / 模型调用 / 重试
              ├── lib/characters.mjs         角色卡读写与内置卡播种
              ├── lib/voices.mjs             音色列表与微调
              ├── lib/kb.mjs                 知识库检索与同步
              ├── lib/work.mjs               观察别的会话（只读，不注入）
            ├── lib/voice.mjs             语音引擎生命周期           ← 新增
            ├── lib/game.mjs              游戏进程探测与拉起         ← 新增
            └── lib/capabilities.mjs      扩展点登记 / 自描述        ← 新增
            └── lib/client.js             控制台面板（Client 半边）
```

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

## 配置来源（优先级从高到低）

1. `cordis.patch.yml` 的 `config:` 段（覆盖默认值）
2. `lib/config.mjs` 的 `makeDefaults()`
3. API key 额外的回落链：`config.apiKey` → `$env:DEEPSEEK_API_KEY` → `~/.dsh/.credentials.yaml` 的 `refs.DEEPSEEK_API_KEY`

新增配置项：只改 `lib/config.mjs` 的 `makeDefaults()`，再在 `cordis.patch.yml` 里写覆盖值。
业务代码里不许出现裸的魔法数字（超时、阈值、间隔都进配置或模块默认参数）。

## 版本

- `VERSION`（`brain.mjs` 顶部）随 `/meta` 暴露，表演端/面板可据此做能力协商。
- `package.json` 的 `version` 与 `VERSION` 同步维护。
