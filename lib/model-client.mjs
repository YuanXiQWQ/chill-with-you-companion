/**
 * 模型调用：JSON 模式 + 关思考 + 重试 + 跨 provider 降级。
 *
 * 从 brain.mjs 拆出来的原因：这段是"外部世界"边界（超时、限流、换家、记账），
 * 和业务编排混在一起时，改重试策略要翻整轮对话的逻辑。
 * 依赖全部注入：cfg / llm / log / recordUsage（写 usage.log 的那一处还在 brain）。
 */
export function createModelClient(opts) {
  const { cfg, llm } = opts
  const log = typeof opts.log === 'function' ? opts.log : () => {}
  const recordUsage = typeof opts.recordUsage === 'function' ? opts.recordUsage : () => {}

  const call = async (messages, opts = {}) => {
    const live = llm.resolve()
    if (!live.apiKey) throw new Error('没有可用的 key：在控制台「模型」里选一个 provider，或给它的 keyRef / token 补上密钥')
    const body = {
      model: live.model,
      messages,
      temperature: cfg.temperature,
      // 反重复：同一个词说过了就压分，别让"嗯""好像"这种词反复出现。
      // 论据：Galetzka et al. 2023 §5.2，repetition 与 genericity 是闲聊的两大问题，
      // 解码期惩罚是代价最小的一档干预。默认轻推，压太狠会让句子变别扭。
      frequency_penalty: Number(cfg.frequencyPenalty) || 0,
      presence_penalty: Number(cfg.presencePenalty) || 0,
      max_tokens: cfg.maxTokens,
      ...(opts.jsonMode === false ? {} : { response_format: { type: 'json_object' } }),
      stream: false,
    }
    if (cfg.thinking === 'disabled') body.thinking = { type: 'disabled' }
    if (cfg.reasoningEffort) body.reasoning_effort = cfg.reasoningEffort

    let lastError = null
    // 降级链：先用当前 provider 重试够了，再顺着候选列表换一家（只换有 key 的）。
    // DeepSeek 抖动/限流时她不会整轮哑掉，也避免面板只显示一条红条让人以为插件坏了。
    const chain = [live, ...llm.candidates().filter((c) => c.id !== live.id)]
    for (let hop = 0; hop < chain.length; hop += 1) {
      const cand = chain[hop]
      if (hop > 0) log('model fallback', { from: live.id, to: cand.id })
      body.model = cand.model || body.model
      for (let attempt = 0; attempt <= cfg.retries; attempt += 1) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), cfg.requestTimeoutMs)
        const startedAt = Date.now()
        try {
          const response = await fetch(cand.baseUrl, {
            method: 'POST',
            headers: Object.assign(
              { 'content-type': 'application/json', authorization: `Bearer ${cand.apiKey}` },
              cand.headers || {},
            ),
            body: JSON.stringify(body),
            signal: controller.signal,
          })
          const text = await response.text()
          if (!response.ok) throw new Error(`${cand.id} ${response.status}: ${text.slice(0, 300)}`)
          const payload = JSON.parse(text)
          const content = payload?.choices?.[0]?.message?.content ?? ''
          const usage = payload?.usage ?? null
          recordUsage(usage, Date.now() - startedAt, cand.model)
          return {
            content,
            latencyMs: Date.now() - startedAt,
            usage,
            model: payload?.model ?? cand.model,
            // 面板/health 只报「这一轮是谁答的」，不涉及密钥
            providerId: cand.id,
            fallback: hop > 0,
          }
        } catch (error) {
          lastError = error
          log('model call failed', { provider: cand.id, attempt, error: String(error?.message || error) })
        } finally {
          clearTimeout(timer)
        }
      }
    }
    throw lastError || new Error('model call failed')
  }


  return { call }
}
