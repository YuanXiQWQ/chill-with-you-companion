# 扩展 dsh-chill-with-you-companion

所有扩展都走 `lib/capabilities.mjs` 登记的扩展点，**不要**往 `brain.mjs` 的路由里塞业务，
也不要改游戏端的 DLL（Steam 更新会覆盖；插件目录虽然保留，但重建 DLL 是最后手段）。

## 1. 加一条 HTTP 路由

```js
// brain.mjs，在 caps 定义之后
ctx.effect(() => ctx.webServer.register(caps.route({
  kind: 'exact',              // 'exact' | 'prefix'
  path: '/chill/v1/my-thing',
  note: '一句话说明，会出现在 /chill/v1/meta',
  handler: async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
    if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
    const { json } = await readBody(req)
    return sendJson(res, 200, { ok: true, got: json })
  },
})), 'dsh-chill-with-you-companion: POST /chill/v1/my-thing')
```

约定：

- `caps.route()` 只做登记（`/meta` 自描述）；`ctx.effect()` 保证卸载时自动注销。
- 同名 `(kind, path)` 重复注册会被忽略并记一行 `route 重复登记` 日志——保留先登记的那条，因为匹配顺序永远是先登记的先命中。
- 返回结构统一 `{ ok: true/false, ... }`，错误用 4xx/5xx + `{ ok: false, error }`。

## 2. 挂在已有流程上（钩子）

| 事件 | 何时触发 | payload |
| --- | --- | --- |
| `cue` | 每次 `/play` 入队后 | 完整 item（performance/subtitle/voice/…） |
| `turn` | 每轮对话写入记忆后 | `{ userText, result, memory }` |
| `assets` | 资源清单被更新后 | 新 manifest |

```js
const off = caps.hook('cue', (item) => {
  // 同步、隔离：抛错只记日志，不影响推送
  console.log('cue', item.subtitle)
})
// off() 取消
```

钩子是**同步**的。要发网络请求就 `void fetch(...)`，别 `await`——它会拖慢这一轮的响应。

## 3. 加一个配置项

1. 在 `lib/config.mjs` 的 `makeDefaults()` 里加默认值（嵌套对象同理）。
2. 在 `cordis.patch.yml` 的 `config:` 里写本机覆盖值。
3. 业务代码只读 `cfg.xxx`。

## 4. 换 TTS 实现

`lib/voice.mjs` 最常用的三个方法：`probe()` / `runTask()` / `warmUp()`。
换成别的引擎（比如 HTTP 常驻服务）：

```js
const voice = {
  port: 9880,
  want: () => true,
  setWant: () => {},
  probe: async () => await pingMyEngine(),
  taskStatus: async () => 'Running',
  killByPort: async () => [],
  runTask: async () => await startMyEngine(),
  heal: () => false,
  warmUp: () => false,
  error: () => '',
}
```

`brain.mjs` 里解构出来的名字（`voiceProbe` / `runVoiceTask` / `warmUpVoice` …）保持不变，
`/admin/voice/*` 与面板都不用动。

## 5. 接入新的表演端（不只 Unity）

表演端只需要两个动词：

```
GET  /chill/v1/pull?since=N[&wait=ms]   -> { ok, seq, epoch, resync, gap, items[] }
POST /chill/v1/game                     <- { scene, … }   （可选，心跳，让面板显示在线）
```

- `seq` 是 int32 安全的正整数（基线取秒），客户端保存最后看到的 seq。
- `wait` 默认 8000（服务端上限）；传 `wait=0` 就是纯轮询。
- `resync=true` 表示服务端 seq 回退（重启过），客户端应该直接把本地游标清成返回的 `seq`。
- `items[]` 字段：`seq, subtitle, performance[{slot,id,at,durationMs,text}], voice{audioUrl}, audioUrl, source, mouthFps, mouthFrames, mouthFlat[], motionScope`。
- `audioUrl` 是站点相对路径，可直接 `GET`（`/chill/v1/audio?name=xxx.wav`）。

## 6. 加资源槽位（新的可演对象）

1. `lib/assets.js` 的 `EMPTY_MANIFEST` 加字段（数组）。
2. `SLOT_ALIAS` 加别名映射（模型可能说 `desk` / `deskObject` / `deskObjects`）。
3. `PERFORMANCE_SLOTS` 加槽位名。
4. 游戏端上报时带同名字段即可；`/assets` 会规整、`/act` 会按白名单剪枝。

## 7. 自检清单（改完必跑）

```powershell
node --check brain.mjs
node test/core.test.mjs
node test/assets.test.mjs
node test/server.smoke.mjs     # 含 /play → /pull、长轮询、/meta、资源白名单
curl http://127.0.0.1:10722/chill/v1/meta   # 看能力与路由是否都登记上了
```

面板改动（`lib/client.js`）还要在浏览器里 F5 看一次：语音条、状态页、推送按钮。
