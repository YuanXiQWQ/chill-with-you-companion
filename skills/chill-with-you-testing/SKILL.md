---
name: chill-with-you-testing
description: dsh-chill-with-you-companion 插件的测试隔离规矩。调 /chill/v1/act、/chill/v1/play 做联调、冒烟、脚本测试时必须带 sandbox:true，否则测试对白会写进她的长期记忆（turns.jsonl）、测试演出会淹没 cue.log。含三道闸门（请求级 / 写入级 / 自动判定）、测试脚本模板、污染后如何清理 turns.jsonl 与 cue.log、自检清单。当要调 dsh-chill-with-you-companion 接口、写测试脚本、翻演出日志、或发现对话里出现不该有的句子时加载。
whenToUse: 需要调用 /chill/v1/act 或 /play、写联调脚本、排查「测试信息进了对话 / 记忆」、清理 cue.log 或 turns.jsonl 时加载。凡是打算向 dsh-chill-with-you-companion 发请求的自动化行为，动手前先看这里。
---

# dsh-chill-with-you-companion 测试隔离

测试和真实演出走**同一个接口**。没有区分标记的时候，一句测试输入和一句真心话在系统里长得一模一样——她会把它当成共同经历记住。

## 两个真实事故

1. **`data/cue.log` 被淹没**：98 条演出记录里 78 条是测试。想看「她最近说了什么」，翻出来前几条全是「测试台词」「要换一口气」「要喝口茶吗」，真实演出被埋到看不见。
2. **测试对白进了长期记忆**：`data/memory/turns.jsonl` 里混进一组

   ```
   user      这条该进日志
   assistant 日志啊。……那里你打算怎么写。
   ```

   调 `/act` 时漏了 `sandbox: true`，这句测试输入被当成真实对话写了进去。之后她会把这句当共同经历引用。

两次都是同一个原因。下面三道闸门就是为这个加的。

## 三道闸门

### 1. 请求级——`sandbox: true`

`/chill/v1/act` 和 `/chill/v1/play` 都认这个字段。

| 调用 | 带 `sandbox: true` 的效果 |
| --- | --- |
| `/act` | 不写 `turns.jsonl`、不更新 `summary.json`、不写 facts / moments / open，`promptMemory` 默认给空数组（只有显式传 `withHistory:true` 才会读历史） |
| `/play` | `item.sandbox = true`，`logCue()` 分流到 `cue.test.log`（不进 `cue.log`） |

**只要这次调用是自动化行为，就必须带 `sandbox: true`。** 例外只有一种：你就是要验证记忆写入链路本身，并且用完立刻清理。

### 2. 写入级——`pushCue` 硬闸

```js
function pushCue(item) {
  const seq = feed.push(item)
  // sandbox 的请求不该进 cue.log，否则翻日志时真实演出会被测试台词埋掉
  if (!item?.sandbox) logCue(item, seq)
  ...
}
```

`/act` 里负责把标记带进 item，**位置和取值都有坑**：

```js
if (debugInfo?.sandbox) item.sandbox = true   // ← 对
// if (act.sandbox) ...                       // ← 错：act 顶层的 sandbox 是 undefined
// if (act.debugInfo?.sandbox) ...            // ← 也错：act 里没有 debugInfo
```

`sandbox` 在 `serializedTurn()` 返回值的 `debugInfo.sandbox` 里，**不在顶层**。`/act` 靠解构拿它：

```js
const { parsed, model, audio, cues, dropped, mouth, debugInfo, timings, ttsError } = await serializedTurn(...)
```

**这种错不会报错。** 写成 `act.sandbox` 时闸门静默失效，测试照样进日志，隔离看起来做了其实没做。改完必须实打实跑一遍文末的自检清单。

### 3. 自动判定——兜住「忘了传」

只靠人记着传 `sandbox: true` 是不可靠的。再加一道自动判定：

```js
function isAutomation(req, json) {
  if (json?.sandbox === false) return false      // 显式要求当真，留给验证真实链路
  if (json?.sandbox === true) return true
  const origin = String(req?.headers?.origin || '')
  const referer = String(req?.headers?.referer || '')
  const PANEL = new RegExp('^https?://(127\\.0\\.0\\.1|localhost):' + panelPort + '$')
  if (PANEL.test(origin)) return false
  if (referer.includes(':' + panelPort)) return false
  return true                                    // 裸 fetch / curl / 脚本一律当测试
}
```

**原理**：控制台面板和侧车跑在**不同端口**，真人操作必然是跨源请求，浏览器一定带 `Origin`。脚本、`curl`、`node -e fetch` 都不带。

`/act` 和 `/play` 都用它：

```js
// /act
const auto = isAutomation(req, json)
const { ... } = await serializedTurn(userText, { skipMemory: json?.remember === false, sandbox: auto })

// /play
if (isAutomation(req, json)) item.sandbox = true
```

**验证时要两种都测**。只测「不写」很容易得到一个把什么都拦掉的假隔离：

```bash
# 裸调用 → 两个文件都不变
curl -s -X POST http://127.0.0.1:10723/chill/v1/act \
  -H 'content-type: application/json' \
  -d '{"text":"ZZZ 验证"}'

# 伪造面板 Origin → cue.log +1、turns.jsonl +2（真人路径仍然照写）
curl -s -X POST http://127.0.0.1:10723/chill/v1/act \
  -H 'content-type: application/json' \
  -H 'origin: http://127.0.0.1:10722' \
  -d '{"text":"ZZZ 验证"}'
```

带 `Origin` 那条会**真的写进记忆**。验证完立刻清掉（见「污染了怎么清」）。用 `ZZZ` 开头就是为了事后好搜。

## 写测试脚本

**放在插件目录之外**，例如

```
<任意工作目录>/_test-*.mjs
```

放进插件根目录或 `lib/` 下会触发侧车热重载（400ms 防抖）——每写一个测试就重启一次，日志里刷满 `reason=source change`，还会把你正在调的东西重置掉。

模板（`node <文件>` 直接跑）：

```js
const B = 'http://127.0.0.1:10723/chill/v1'

const act = await (await fetch(B + '/act', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text: '联调内容', sandbox: true }),   // ← 必须
})).json()

const play = await (await fetch(B + '/play', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ subtitle: '…', performance: [...], sandbox: true }),
})).json()
```

自带的 `test/server.smoke.mjs` 里 `/play` 的 body 已经带了 `sandbox: true`，新写的照抄。

## 想验证真实链路怎么办

要确认「真实对话会不会正常写进记忆」，**不要拿真实记忆当试验田**。

- **看代码**：`serializedTurn` 里 `if (!sandbox) { ...写记忆... }` 那段，比对传进去的参数
- **要跑就造一个一眼能认出的假句子**（`ZZZ 隔离验证请忽略`），测完立刻清掉

**绝不**用「这条该进日志」这种看起来像人话的句子——它会被当真，写进去以后翻日志也认不出是测试。

## 第三类：系统自己伪造的「用户发言」

不是测试造成的，但性质一样——**记忆里出现了用户没说过的话**。

`/observe` 每轮旁观都会写一句「（看了一眼他的进度）」。早期它落到 `role: 'user'`，`promptMemory` 里就反复出现 `user: （看了一眼他的进度）`，模型会当真，甚至反过来用它当上下文。

**判据**：`role === 'user'` 且 `content` 整句就是一个括号动作描写（`/^（[^（）]{2,12}）$/`）→ 一定是系统写的。

**修法**：别替用户发言。旁观轮次只记她说的那一句：

```js
await appendTurn('', parsed, { skipUser: true })
```

`appendTurn(userText, result, opts)` 的 `opts.skipUser` 就是干这个的。

**排查**：

```bash
node -e "const l=require('fs').readFileSync('data/memory/turns.jsonl','utf8').trim().split('\n');let n=0;for(const x of l){const o=JSON.parse(x);if(o.role==='user'&&/^（.*）$/.test(String(o.content||'').trim())){n++;console.log(o.at,o.content)}}console.log('共',n)"
```

**共性**：凡是系统自己造的动作 / 提示，都不要落到 `user` 角色上。宁可那条记录没有上文，也不要伪造一个。

## 污染了怎么清

### `cue.log`

先备份再过滤：

```bash
cp data/cue.log "data/cue.log.bak-$(date +%Y%m%d-%H%M%S)"
```

过滤口径：

- `src === 'console'` → 走 `/play` 的，日常只有测试会调
- 字幕命中 `测试台词|测试一句|要喝口茶吗|太好了，写完了|欢迎回来|去重测试`
- `audio` 尾部含 `/b/ /x/ /y/ /z/`（自造测试音）

真实演出的 `src` 是 `reply`（面板）/ `observe`（旁观）/ `pomodoro`（番茄钟）/ `spark`（她自己开口）。

**用 node 处理内容，别用 shell 的文本工具**——这些文件是 JSONL，一行一条，按行操作就够了，正则硬切容易破坏引号。

### `turns.jsonl`

1. **先备份** `turns.jsonl.bak-<时间>`
2. **用 node 按行处理**：

   ```js
   import { readFileSync, writeFileSync } from 'node:fs'
   const rows = readFileSync(F, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
   ```

3. 删测试行时**连同它引出的那条 assistant 回复一起删**，否则留下一句没有问题的回答
4. **改完必须让侧车重新读盘**。`turns.jsonl` 的改动不会自动生效（只有 `.mjs` / `.js` 触发重载）。碰一下任意被监视的文件即可：

   ```bash
   touch brain.mjs
   ```

   等十秒，再确认行数**没有被内存回写**。

### 其他记忆文件

`turns.jsonl`、`facts.jsonl`、`summary.json` 三个文件都查一遍关键词。
（`moments` / `open` 不是独立文件，它们是 `facts.jsonl` 里记录条目的 `kind` 字段。）

`sandbox: true` 正常工作时它们一个都不会被写。**如果有命中，说明闸门某处失效了——先修闸门再清理**，否则清完还会再脏。

## 自检清单

改完任何跟隔离相关的代码，三条都要过。

```bash
# 记录基线
wc -l data/cue.log data/memory/turns.jsonl

# 1) 沙箱 /act：两个文件都不该变
curl -s -X POST http://127.0.0.1:10723/chill/v1/act \
  -H 'content-type: application/json' -d '{"text":"隔离自检","sandbox":true}'
wc -l data/cue.log data/memory/turns.jsonl      # 与基线相同

# 2) 沙箱 /play：cue.log 不该变
curl -s -X POST http://127.0.0.1:10723/chill/v1/play \
  -H 'content-type: application/json' \
  -d '{"subtitle":"隔离自检","performance":[],"sandbox":true}'
wc -l data/cue.log                              # 与基线相同

# 3) 不带 sandbox 打一次：行数 +1，字幕能在文件里搜到
curl -s -X POST http://127.0.0.1:10723/chill/v1/act \
  -H 'content-type: application/json' -d '{"text":"隔离自检正向"}'
grep -c '隔离自检正向' data/cue.log data/memory/turns.jsonl
```

**三条都过，隔离才算做好。**

第 3 条尤其不能省——只验证「不写」很容易得到一个把什么都拦掉的假隔离，而假隔离比没有隔离更危险：它让你以为安全了。

## 路径与端口速查

路径都相对**插件根目录**。

| 东西 | 位置 |
| --- | --- |
| 侧车源码 | `brain.mjs` |
| 测试脚本 | 插件目录之外，`<工作目录>/_test-*.mjs` |
| 演出日志（真实） | `data/cue.log` |
| 演出日志（测试） | `data/cue.test.log` |
| 对话记忆 | `data/memory/turns.jsonl` |
| 进程日志 | `data/sidecar.log`（只有重启记录，**不含表演内容**） |
| 侧车端口 | `127.0.0.1:10723` |
| 控制台面板 | `127.0.0.1:10722` |

端口可以在配置里改。改过之后上面所有命令的端口跟着换，`isAutomation` 里的 `panelPort` 也要一起改。

## 附录：Windows / PowerShell

上面所有命令在 Windows 上都能直接用（`curl.exe` 是系统自带的）。只有两处值得单独说：

**统计行数**用 `[IO.File]::ReadAllLines()` 而不是 `Get-Content`：

```powershell
([IO.File]::ReadAllLines('data/cue.log')).Count
```

**别用 `Get-Content` / `ConvertFrom-Json` 处理 `turns.jsonl`**。Windows PowerShell 5.1 默认按系统 ANSI 代码页解码 UTF-8，中文和引号会被破坏，直接抛 `Invalid object passed in, ':' or '}' expected`。一定要用 node 处理。

`touch` 的等价写法：

```powershell
(Get-Item 'brain.mjs').LastWriteTime = Get-Date
```
