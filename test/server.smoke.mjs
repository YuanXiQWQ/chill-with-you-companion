/**
 * 离线端到端烟测：不装进 profile、不碰真网络。
 * 用假 ctx 收路由 → 真实 http server 派发 → 假 fetch 顶掉 DeepSeek。
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { table as nativeGestures } from '../lib/gestures.mjs'

const routes = []
const ctx = {
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  effect: (fn) => {
    const disposer = fn()
    return typeof disposer === 'function' ? disposer : () => {}
  },
  webServer: {
    register: (route) => {
      routes.push(route)
      return () => {}
    },
  },
}

const calls = []
const realFetch = globalThis.fetch
let modelReply = {
  emotion: 'Drink',
  voice_text: 'お茶でも飲む？少し休もう。',
  subtitle_text: '要喝口茶吗？歇一会儿吧。',
}
// 需要制造"一轮正在进行"的窗口时，把这个调大（模拟模型慢）
let fetchDelayMs = 0
globalThis.fetch = async (url, init = {}) => {
  if (fetchDelayMs) await new Promise((r) => setTimeout(r, fetchDelayMs))
  const body = init.body ? String(init.body) : ''
  calls.push({ url: String(url), body: body ? JSON.parse(body) : null })
  const payload = {
    id: 'stub',
    model: 'deepseek-flash',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: JSON.stringify(modelReply),
        },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 },
  }
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
}

const { apply } = await import('../brain.mjs') // 侧车化后：逻辑在 brain.mjs，index.js 只剩反代
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as joinPath } from 'node:path'
const sandboxData = mkdtempSync(joinPath(tmpdir(), 'chill-smoke-'))
// 人设照抄真件，但记忆/清单/状态都在沙箱里（否则会读到真实对话历史）
{
  const { copyFileSync } = await import('node:fs')
  copyFileSync(new URL('../persona.md', import.meta.url), joinPath(sandboxData, 'persona.md'))
}
// health.hasApiKey 来自 llm.resolve()，而它只认 <DSH_HOME>/.credentials.yaml，
// 不看 apply() 传进来的 apiKey。这里造一个临时 DSH_HOME，让断言不再依赖本机是否配了 key
// （CI 上没有凭据文件，之前这条必然 false —— 是本机绿、干净机器红的那种测试）。
{
  // 空 DSH_HOME + 只有环境变量：既让断言与运行机器无关，
  // 也顺带锁住 lib/llm.mjs 的环境变量回落（以前只读凭据文件，只设 env 的机器会显示没有 key）。
  const fakeHome = mkdtempSync(joinPath(tmpdir(), 'chill-dshhome-'))
  process.env.DSH_HOME = fakeHome
  process.env.DEEPSEEK_API_KEY = 'sk-test-not-a-real-key'
  // 2026-11-14 起 token 不许为空：冒烟用例固定一个，别让它去写数据目录里的 token 文件。
  process.env.CHILL_TOKEN = 'test-token-chill-smoke-0123456789abcdef'
}

apply(ctx, {
  apiKey: 'sk-test',
  model: 'deepseek-flash',
  thinking: 'disabled',
  tts: { enabled: false },
  facialFromEmotion: false, // 白名单用例只检查模型给出的资源指令。
  dataDir: sandboxData,        // 隔离：不碰真实记忆 / 清单 / 状态
  personaPath: joinPath(sandboxData, 'persona.md'),
})

assert.ok(routes.length >= 5, 'routes registered: ' + routes.length)

const server = http.createServer((req, res) => {
  const pathname = String(req.url || '').split('?')[0]
  const route =
    routes.find((r) => r.kind === 'exact' && r.path === pathname) ??
    routes.find((r) => r.kind === 'prefix' && pathname.startsWith(r.path))
  if (!route) {
    res.statusCode = 404
    res.end('no route')
    return
  }
  void route.handler(req, res)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

const call = async (path, init = {}) => {
  // 鉴权头统一在这里贴：路由层已经不允许空 token 放行
  const headers = { ...(init.headers || {}), 'x-chill-token': process.env.CHILL_TOKEN }
  const response = await realFetch(base + path, { ...init, headers })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { status: response.status, json, text }
}

let passed = 0
const check = async (label, fn) => {
  await fn()
  passed += 1
  console.log('  ok  ' + label)
}

console.log('# 路由与健康检查')
await check('health 返回 ok 且带人设长度', async () => {
  const r = await call('/chill/v1/health')
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.hasApiKey, true)
  assert.ok(r.json.personaChars > 100)
  assert.equal(r.json.thinking, 'disabled')
})

console.log('# 原生表演指令 /chill/v1/act')
await check('返回完整 PerformanceScript', async () => {
  const r = await call('/chill/v1/act', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '我开始了，25 分钟' }),
  })
  assert.equal(r.status, 200)
  assert.equal(r.json.emotion, 'Drink')
  assert.equal(r.json.subtitle.text, '要喝口茶吗？歇一会儿吧。')
  assert.equal(r.json.voice.lang, 'ja')
  // 契约：有 audioUrl 就必须朗读；合成失败时必须明确 skipTts，别让表演端干等声音
  assert.equal(r.json.voice.skipTts, !r.json.voice.audioUrl)
  // 动作 id 可能来自内置情绪映射（数字）或游戏清单兜底（clip 名），这里只验结构
  assert.ok(r.json.actions.length >= 1 && r.json.actions[0].kind === 'animation')
  assert.equal(r.json.meta.mode, 'json')
  assert.equal(r.json.meta.usage.total_tokens, 940)
  assert.ok(r.json.turnId.startsWith('t-'))
})

const lastTurnCall = () => [...calls].reverse().find((c) => String(c.body?.messages?.[0]?.content || '').includes('当前处境'))

await check('发给 DeepSeek 的请求体符合后端口径', async () => {
  const last = lastTurnCall() ?? calls.at(-1)
  assert.equal(last.url, 'https://api.deepseek.com/v1/chat/completions')
  assert.equal(last.body.model, 'deepseek-flash')
  assert.deepEqual(last.body.thinking, { type: 'disabled' })
  assert.deepEqual(last.body.response_format, { type: 'json_object' })
  assert.equal(last.body.stream, false)
  const system = last.body.messages[0]
  assert.equal(system.role, 'system')
  assert.ok(system.content.includes('json'))
  assert.ok(system.content.includes('当前处境'))
})

await check('第二轮带上记忆（历史进 messages）', async () => {
  // 原来断言「比上一轮长」——那依赖「本轮写记忆、下轮读回来」，而 sandbox
  // 请求不写记忆，长度永远不变。真正要验证的是「历史被喂进了 messages」，
  // 所以 sandbox + withHistory：读历史、不写记忆，测完零污染。
  await call('/chill/v1/act', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '有点困', sandbox: true, withHistory: true }),
  })
  const msgs = lastTurnCall().body.messages
  assert.ok(msgs.length > 1, 'messages 除了 system 还该带上历史对话')
  assert.ok(msgs.some((m) => m.role === 'user' || m.role === 'assistant'), '历史里该有 user/assistant 轮次')
})

console.log('# OpenAI 兼容入口（给现成 AIChat 用）')
await check('三段式（不请求 json_object）', async () => {
  const r = await call('/chill/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'whatever', messages: [{ role: 'user', content: '在吗' }] }),
  })
  assert.equal(r.status, 200)
  assert.match(r.json.choices[0].message.content, /^\[Drink\] \|\|\| .+ \|\|\| .+$/s)
})
await check('json_object 模式返回结构化 content', async () => {
  const r = await call('/chill/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: '在吗' }],
      response_format: { type: 'json_object' },
    }),
  })
  const content = JSON.parse(r.json.choices[0].message.content)
  assert.equal(content.emotion, 'Drink')
  assert.ok(content.subtitle_text.length > 0)
})

console.log('# 人设写入的破坏性边界')
await check('POST /persona 传空对象不会覆盖人设', async () => {
  // 回归：曾经把整段 body 当人设落盘，POST {} 会把人设覆盖成 2 个字符，
  // 之后 /context 里「你是谁」下面只剩一个空对象。人设是最不可逆的东西。
  const before = (await call('/chill/v1/persona')).json.chars
  const bad = await call('/chill/v1/persona', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(bad.status, 400)
  const after = (await call('/chill/v1/persona')).json.chars
  assert.equal(after, before, '人设长度不该变')
})
await check('POST /persona 正常文本仍然可写', async () => {
  const text = '你是聪音。这是一段用于回归测试的人设文本，长度足够，写进去以后读回来应该一致。'
  const r = await call('/chill/v1/persona', {
    method: 'POST',
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    body: text,
  })
  assert.equal(r.status, 200)
  assert.equal(r.json.chars, text.length)
  const back = await call('/chill/v1/persona')
  assert.equal(back.json.text, text)
})

console.log('# 事件与状态机')
await check('focus_start 改变 phase', async () => {
  const r = await call('/chill/v1/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'focus_start' }),
  })
  assert.equal(r.status, 200)
  assert.equal(r.json.state.phase, 'focus')
})
await check('状态进入下一轮 system prompt', async () => {
  await call('/chill/v1/act', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '继续' }),
  })
  // focus_start 只改 phase，没有心跳时 pomo.running 还是 false，
  // 所以这里出的是「番茄钟开着，但计时没在走」；别写死措辞，匹配"番茄钟"即可。
  assert.ok(calls.at(-1).body.messages[0].content.includes('番茄钟'))
  // 时间感：每轮 system 里都得有今天的日期，不然她永远活在"此刻"
  assert.ok(/今天是 \d+ 月 \d+ 日周[一二三四五六日]/.test(calls.at(-1).body.messages[0].content))
})

console.log('# 人设热更新与音频路由')
await check('GET persona 返回正文', async () => {
  const r = await call('/chill/v1/persona')
  assert.equal(r.status, 200)
  assert.ok(r.json.text.includes('聪音'))
})
await check('非法音频 id 被拒', async () => {
  const r = await call('/chill/v1/audio/..%2f..%2fetc%2fpasswd.wav')
  assert.equal(r.status, 400)
})
await check('不存在的音频 404', async () => {
  const r = await call('/chill/v1/audio/deadbeefdeadbeef.wav')
  assert.equal(r.status, 404)
})

console.log('# 推送队列：/play → /pull（长轮询）')
const baseSeq = (await call('/chill/v1/pull?wait=0')).json.seq
await check('推送一条表演', async () => {
  const r = await call('/chill/v1/play', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      subtitle: '测试台词',
      performance: [{ slot: 'animations', id: '1001', at: 0 }],
      mouthFps: 30,
      mouthFlat: [0.1, 0.2],
      motionScope: 'upper',
      source: 'console',
      sandbox: true,   // 冒烟数据不入 cue.log，也别碰记忆
    }),
  })
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.ok(r.json.seq > baseSeq)
})
await check('seq 之后能拉到，字段齐全', async () => {
  const r = await call('/chill/v1/pull?since=' + baseSeq + '&wait=0')
  assert.equal(r.status, 200)
  assert.equal(r.json.items.length, 1)
  const item = r.json.items[0]
  assert.equal(item.subtitle, '测试台词')
  assert.equal(item.performance[0].id, '1001')
  assert.equal(item.motionScope, 'upper')
  assert.equal(item.mouthFlat.length, 2)
})
await check('没有新 cue 时 wait=0 立刻回空（不挂起）', async () => {
  const startedAt = Date.now()
  const r = await call('/chill/v1/pull?since=' + (baseSeq + 1) + '&wait=0')
  assert.equal(r.status, 200)
  assert.equal(r.json.items.length, 0)
  assert.ok(Date.now() - startedAt < 1500)
})
await check('空推送被拒', async () => {
  const r = await call('/chill/v1/play', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(r.status, 400)
})
await check('meta 自描述带能力与路由', async () => {
  const r = await call('/chill/v1/meta')
  assert.equal(r.status, 200)
  assert.ok(r.json.features.length >= 5)
  assert.ok(r.json.routes.some((x) => x.path === '/chill/v1/pull'))
})

console.log('# 鉴权')
await check('公开探活无需令牌，模型接口必须认证', async () => {
  assert.equal((await realFetch(base + '/chill/v1/health')).status, 200)
  assert.equal((await realFetch(base + '/chill/v1/act', { method: 'POST' })).status, 401)
})

console.log('# 资源白名单：只用游戏自身资源')
const focusEnded = await call('/chill/v1/event', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'idle' }),
})
assert.equal(focusEnded.status, 200)
await check('上传游戏资源清单并被规整', async () => {
  const r = await call('/chill/v1/assets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: 'game',
      animations: [
        { id: 1001, name: 'Joy', semantic: ['happy'], durationMs: 2000 },
        { id: 852, name: 'Typing', semantic: ['working'], loop: true },
        { name: 'dirty-no-id' },
      ],
      scenes: [{ id: 'room_day', name: '房间-白天' }],
      sfx: [{ id: 'cup_clink', name: '杯子碰碟' }],
      voiceClips: [{ id: 'Voice_MainScenario_27_016', text: '君が集中した時…', lang: 'ja' }],
      bgm: [],
    }),
  })
  assert.equal(r.status, 200)
  assert.equal(r.json.counts.animations, 2)
  assert.equal(r.json.counts.total, 5)
})
await check('空清单被拒（不能出现"什么都能演"）', async () => {
  const r = await call('/chill/v1/assets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ animations: [{ name: 'no-id' }] }),
  })
  assert.equal(r.status, 400)
})
await check('清单进入 system prompt', async () => {
  await call('/chill/v1/act', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '继续' }),
  })
  const system = calls.at(-1).body.messages[0].content
  assert.ok(system.includes('可用的游戏自带资源'))
  assert.ok(system.includes('1001'))
  assert.ok(system.includes('cup_clink'))
})
await check('越界 id / 未知槽位被剪，合法指令保留', async () => {
  modelReply = {
    emotion: 'Happy',
    voice_text: 'やった、終わった！',
    subtitle_text: '太好了，写完了！',
    performance: [
      { slot: 'anim', id: 1001, at: 0 },
      { slot: 'anim', id: 999999, at: 100 },
      { slot: 'scene', id: 'moon_base', at: 0 },
      { slot: 'sfx', id: 'cup_clink', at: 800 },
      { slot: 'hologram', id: 'x', at: 0 },
    ],
  }
  const r = await call('/chill/v1/act', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '我写完了' }),
  })
  assert.equal(r.status, 200)
  assert.deepEqual(r.json.performance.map((c) => c.slot), ['animations', 'sfx'])
  assert.equal(r.json.actions[0].id, 1001)
  assert.ok(r.json.meta.droppedCues >= 2)
  modelReply = { emotion: 'Drink', voice_text: 'お茶でも飲む？', subtitle_text: '要喝口茶吗？' }
})
await check('模型不给 performance 时只输出游戏支持的兜底动作', async () => {
  modelReply = { emotion: 'Wave', voice_text: 'おかえりなさい。', subtitle_text: '欢迎回来。' }
  const r = await call('/chill/v1/act', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '我回来了' }),
  })
  assert.equal(r.status, 200)
  // 白名单中没有旧 Wave 动作；编排器仍可使用游戏公开的原生手势。
  const nativeNames = new Set(Object.values(nativeGestures().families).flat())
  for (const cue of r.json.performance) {
    assert.equal(cue.slot, 'animations')
    assert.ok(nativeNames.has(cue.nativeName), cue.nativeName)
  }
  assert.ok(!r.json.actions.some((action) => String(action.id) === '5001'))
  modelReply = { emotion: 'Drink', voice_text: 'お茶でも飲む？', subtitle_text: '要喝口茶吗？' }
})
await check('GET assets 回读一致', async () => {
  const r = await call('/chill/v1/assets')
  assert.equal(r.status, 200)
  assert.equal(r.json.counts.total, 5)
  assert.equal(r.json.manifest.animations[0].id, '1001')
})

console.log('# 一轮进行中的旁白请求')
await check('/observe 在轮次进行中直接回 busy，不插队、不排队', async () => {
  fetchDelayMs = 500
  const turn = call('/chill/v1/act', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '这条会占住轮次' }),
  })
  await new Promise((r) => setTimeout(r, 120))
  const obs = await call('/chill/v1/observe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'vscode', rounds: 3 }),
  })
  // 不排队、不插队：忙就直说忙，否则两句话会挤进同一轮，记忆也跟着乱
  assert.equal(obs.json.ok, true)
  assert.equal(obs.json.speak, false)
  assert.equal(obs.json.reason, 'busy')
  await turn
  fetchDelayMs = 0
})

console.log('# 状态与记忆的落盘边界')
await check('focus_start 之后 state.json 真的写了 phase', async () => {
  await call('/chill/v1/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'focus_start', minutes: 25 }),
  })
  const saved = JSON.parse(readFileSync(joinPath(sandboxData, 'state.json'), 'utf8'))
  // 回归：saveState 写过但 loadState 漏过——只测内存不测磁盘抓不到
  assert.equal(saved.phase, 'focus')
  assert.ok(saved.savedAt, 'state.json 该带 savedAt')
  await call('/chill/v1/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'focus_end' }),
  })
})
await check('外部改过 state.json，下一次保存不许盖回去', async () => {
  // 2026-11-14 清理记忆时被这一下坑过：盘上清干净了，进程下一次保存把内存里的旧值
  // 整份写回去，删了等于没删。规则：盘上被外部改过就以盘上为准。
  const p = joinPath(sandboxData, 'state.json')
  const edited = JSON.parse(readFileSync(p, 'utf8'))
  edited.lastTopic = '外部改成这样'
  edited.recentSubs = ['外部写入']
  writeFileSync(p, JSON.stringify(edited, null, 2), 'utf8')
  await call('/chill/v1/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'focus_start', minutes: 25 }),
  })
  const after = JSON.parse(readFileSync(p, 'utf8'))
  assert.equal(after.lastTopic, '外部改成这样', '外部改过的 lastTopic 必须活下来')
  assert.deepEqual(after.recentSubs, ['外部写入'], '外部改过的 recentSubs 也必须活下来')
  await call('/chill/v1/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'focus_end' }),
  })
})
await check('sandbox:true 不写长期记忆', async () => {
  const before = await call('/chill/v1/chat?limit=50')
  const n0 = (before.json.turns || []).length
  await call('/chill/v1/act', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '这句只该出现在测试日志里', sandbox: true }),
  })
  const after = await call('/chill/v1/chat?limit=50')
  assert.equal((after.json.turns || []).length, n0, 'sandbox 轮次不该进 turns')
  assert.ok(!JSON.stringify(after.json).includes('这句只该出现在测试日志里'))
})

server.close()
console.log(`\nPASS ${passed} smoke checks`)
