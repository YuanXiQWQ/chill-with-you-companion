#!/usr/bin/env node
/**
 * 模型调用（lib/model-client.mjs）：重试、跨 provider 降级、请求体形状。
 *
 * 拆出来之后这段可以拿假 fetch 直测，不必真的打网络：
 *   1. 主力 5xx 两次 → 备用顶上，返回 fallback:true 且 providerId 是备用
 *   2. 主力 4xx（key 错了那种）→ 也降级，不会整轮哑掉
 *   3. 全挂 → 把最后一个错误抛出来（调用方据此决定"这轮不说话"）
 *   4. jsonMode:false 时请求体里没有 response_format
 *   5. 用量记账被调用，且记的是真正答上来的那个模型名
 */
import assert from 'node:assert/strict'

import { createModelClient } from '../lib/model-client.mjs'

const cfg = {
  temperature: 0.8, frequencyPenalty: 0.3, presencePenalty: 0.1, maxTokens: 256,
  thinking: 'disabled', reasoningEffort: '', retries: 1, requestTimeoutMs: 5000,
}
const providers = [
  { id: 'primary', model: 'm-primary', baseUrl: 'https://primary.invalid/v1', apiKey: 'k1', headers: {} },
  { id: 'backup', model: 'm-backup', baseUrl: 'https://backup.invalid/v1', apiKey: 'k2', headers: {} },
]
const fakeLlm = (chain = providers) => ({ resolve: () => chain[0] || {}, candidates: () => chain })

const realFetch = globalThis.fetch
const stub = (handler) => { globalThis.fetch = handler }
const restore = () => { globalThis.fetch = realFetch }

const reply = (content, model) => new Response(JSON.stringify({
  choices: [{ message: { content } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
  model,
}), { status: 200, headers: { 'content-type': 'application/json' } })

// 1) 主力 5xx → 备用顶上
{
  const seen = []
  stub(async (url) => {
    seen.push(String(url))
    if (String(url).includes('primary')) return new Response('boom', { status: 500 })
    return reply('{"say":"嗯"}', 'm-backup')
  })
  const usage = []
  const model = createModelClient({ cfg, llm: fakeLlm(), log: () => {}, recordUsage: (u, ms, name) => usage.push(name) })
  const out = await model.call([{ role: 'user', content: 'hi' }])
  restore()
  assert.equal(out.content, '{"say":"嗯"}')
  assert.equal(out.providerId, 'backup', '这一轮是备用答的')
  assert.equal(out.fallback, true, '要标出降级过')
  assert.equal(seen.filter((u) => u.includes('primary')).length, cfg.retries + 1, '主力按 retries 重试')
  assert.deepEqual(usage, ['m-backup'], '记账记的是真正答上来的模型')
}

// 2) 主力 4xx → 也降级
{
  stub(async (url) => (String(url).includes('primary')
    ? new Response('invalid api key', { status: 401 })
    : reply('ok', 'm-backup')))
  const model = createModelClient({ cfg, llm: fakeLlm(), log: () => {}, recordUsage: () => {} })
  const out = await model.call([{ role: 'user', content: 'hi' }])
  restore()
  assert.equal(out.providerId, 'backup', '4xx 也换家')
}

// 3) 全挂 → 抛错
{
  stub(async () => new Response('down', { status: 503 }))
  const model = createModelClient({ cfg, llm: fakeLlm(), log: () => {}, recordUsage: () => {} })
  let threw = null
  try { await model.call([{ role: 'user', content: 'hi' }]) } catch (error) { threw = error }
  restore()
  assert.ok(threw, '全挂必须抛，不能返回空字符串骗上层')
  assert.match(String(threw.message), /503/, '错误里带状态码，便于排查')
}

// 4) jsonMode:false 不带 response_format；正常带
{
  const bodies = []
  stub(async (_url, init) => { bodies.push(JSON.parse(init.body)); return reply('x', 'm-primary') })
  const model = createModelClient({ cfg, llm: fakeLlm(), log: () => {}, recordUsage: () => {} })
  await model.call([{ role: 'user', content: 'hi' }])
  await model.call([{ role: 'user', content: 'hi' }], { jsonMode: false })
  restore()
  assert.deepEqual(bodies[0].response_format, { type: 'json_object' }, '默认 JSON 模式')
  assert.equal(bodies[1].response_format, undefined, 'jsonMode:false 时不许带')
  assert.deepEqual(bodies[0].thinking, { type: 'disabled' }, '关思考按配置带')
  assert.equal(bodies[0].model, 'm-primary', '请求体用当前 provider 的模型名')
}

// 5) 没有 key 时的报错指向"该去配 key"，不是空指针
{
  const model = createModelClient({ cfg, llm: { resolve: () => ({ id: '', apiKey: '', baseUrl: '' }), candidates: () => [] }, log: () => {}, recordUsage: () => {} })
  let threw = null
  try { await model.call([{ role: 'user', content: 'hi' }]) } catch (error) { threw = error }
  assert.ok(threw, '没有 key 要抛')
  assert.match(String(threw.message), /key/, '错误里要点明 key')
}

console.log('  PASS 重试 / 跨 provider 降级 / 全挂抛错 / 请求体开关 / 无 key 报错可读')
