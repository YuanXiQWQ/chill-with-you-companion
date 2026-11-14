import assert from 'node:assert/strict'
import {
  BASE_EMOTIONS,
  DEFAULT_STATE,
  applyEvent,
  buildAct,
  buildMessages,
  cacheKey,
  describeState,
  encodeForJsonClient,
  encodeForLegacyClient,
  extractJsonObject,
  extractLegacy,
  parseModelOutput,
  trimSentence,
} from '../lib/core.js'

let passed = 0
const check = (label, fn) => {
  fn()
  passed += 1
  console.log('  ok  ' + label)
}

console.log('# extractJsonObject')
check('纯 JSON', () => {
  const o = extractJsonObject('{"emotion":"Happy","voice_text":"やあ","subtitle_text":"嗨"}')
  assert.equal(o.emotion, 'Happy')
})
check('```json 围栏 + 前后废话', () => {
  const o = extractJsonObject('好的：\n```json\n{"emotion":"Think","voice_text":"a","subtitle_text":"b"}\n```\n完毕')
  assert.equal(o.emotion, 'Think')
})
check('字符串里带花括号不误判', () => {
  const o = extractJsonObject('{"emotion":"Fun","voice_text":"像这样 { 的公式","subtitle_text":"x"}')
  assert.equal(o.voice_text, '像这样 { 的公式')
})
check('残破 JSON 返回 null', () => {
  assert.equal(extractJsonObject('{"emotion":"Happy",'), null)
})

console.log('# extractLegacy')
check('三段式', () => {
  const o = extractLegacy('[Agree] ||| うん、がんばろう。 ||| 嗯，一起加油。')
  assert.equal(o.emotion, 'Agree')
  assert.equal(o.subtitle_text, '嗯，一起加油。')
})

console.log('# parseModelOutput')
check('正常 JSON', () => {
  const r = parseModelOutput('{"emotion":"Drink","voice_text":"お茶でも飲む？","subtitle_text":"要喝口茶吗？"}', { textLang: 'ja' })
  assert.equal(r.emotion, 'Drink')
  assert.equal(r.mode, 'json')
  assert.equal(r.ttsSkip, false)
  assert.deepEqual(r.warnings, [])
})
check('情绪不在白名单 → 回落', () => {
  const r = parseModelOutput('{"emotion":"Ecstatic","voice_text":"やった","subtitle_text":"太好了"}', { textLang: 'ja' })
  assert.equal(r.emotion, 'Agree')
  assert.ok(r.warnings.some((w) => w.startsWith('emotion-not-in-whitelist')))
})
check('扩展集合能通过 Shy', () => {
  const r = parseModelOutput('{"emotion":"Shy","voice_text":"あ、ありがとう","subtitle_text":"谢、谢谢"}', { emotionSet: 'extended', textLang: 'ja' })
  assert.equal(r.emotion, 'Shy')
})
check('日语台词无假名 → ttsSkip', () => {
  const r = parseModelOutput('{"emotion":"Happy","voice_text":"今天也加油","subtitle_text":"今天也加油"}', { textLang: 'ja' })
  assert.equal(r.ttsSkip, true)
  assert.ok(r.warnings.includes('voice-has-no-kana'))
})
check('纯文本输出 → 兜底不再抛错', () => {
  const r = parseModelOutput('嗯，我在的。', { textLang: 'zh' })
  assert.equal(r.mode, 'text')
  assert.equal(r.subtitle_text, '嗯，我在的。')
  assert.equal(r.voice_text, '嗯，我在的。')
  assert.ok(r.warnings.includes('model-output-not-structured'))
})
check('三段式被识别为 legacy', () => {
  const r = parseModelOutput('[Fun] ||| ふふっ、変なの。 ||| 噗，好怪。', { textLang: 'ja' })
  assert.equal(r.mode, 'legacy')
  assert.equal(r.emotion, 'Fun')
})
check('超长台词被截断', () => {
  const long = 'あ'.repeat(200)
  const r = parseModelOutput(JSON.stringify({ emotion: 'Happy', voice_text: long, subtitle_text: long }), { textLang: 'ja' })
  assert.ok(r.voice_text.length <= 61)
  assert.ok(r.warnings.includes('truncated'))
})
check('空内容被标记', () => {
  const r = parseModelOutput('{"emotion":"Happy","voice_text":"","subtitle_text":""}', { textLang: 'ja' })
  assert.ok(r.warnings.includes('empty-say'))
})

console.log('# trimSentence')
check('按句号截断', () => {
  assert.equal(trimSentence('あ'.repeat(20) + '。' + 'い'.repeat(20), 25), 'あ'.repeat(20) + '。')
})
check('无句读时硬截', () => {
  assert.equal(trimSentence('あ'.repeat(80), 10).length, 10)
})

console.log('# 状态机')
check('focus_start → focus', () => {
  const s = applyEvent(DEFAULT_STATE, { type: 'focus_start' }, 1000)
  assert.equal(s.phase, 'focus')
  assert.equal(s.since, 1000)
})
check('focus_end 记一次番茄并扣精力', () => {
  const started = applyEvent(DEFAULT_STATE, { type: 'focus_start' }, 0)
  const done = applyEvent(started, { type: 'focus_end' }, 25 * 60000)
  assert.equal(done.focusCount, 1)
  assert.equal(done.phase, 'idle')
  assert.ok(done.energy < DEFAULT_STATE.energy)
})
check('break 回血', () => {
  const s = applyEvent({ ...DEFAULT_STATE, energy: 40 }, { type: 'break' }, 0)
  assert.equal(s.energy, 48)
  assert.equal(s.phase, 'break')
})
check('describeState 能说出处境', () => {
  const text = describeState(applyEvent(DEFAULT_STATE, { type: 'focus_start' }, 0), 10 * 60000)
  assert.ok(text.includes('10 分钟'))
})

console.log('# buildMessages')
check('契约里必须出现 json 与情绪白名单', () => {
  const messages = buildMessages({
    persona: '你是聪音。',
    memory: [{ role: 'user', content: '在吗' }, { role: 'assistant', content: '在的' }],
    state: DEFAULT_STATE,
    userText: '开始了',
  })
  assert.equal(messages[0].role, 'system')
  assert.ok(messages[0].content.includes('json'))
  for (const emotion of BASE_EMOTIONS) assert.ok(messages[0].content.includes(emotion))
  assert.equal(messages.at(-1).content, '开始了')
  assert.equal(messages.length, 4)
})
check('空输入不产生空消息', () => {
  const messages = buildMessages({ persona: 'p', memory: [], state: DEFAULT_STATE, userText: '   ' })
  assert.equal(messages.at(-1).content, '……')
})

console.log('# 编码与指令')
check('两种编码可被对应客户端吃下', () => {
  const result = { emotion: 'Wave', voice_text: 'おかえり', subtitle_text: '欢迎回来' }
  assert.equal(encodeForLegacyClient(result), '[Wave] ||| おかえり ||| 欢迎回来')
  const parsed = JSON.parse(encodeForJsonClient(result))
  assert.equal(parsed.emotion, 'Wave')
})
check('buildAct 带上动作与状态', () => {
  const act = buildAct(
    { emotion: 'Drink', voice_text: 'お茶でも飲む？', subtitle_text: '要喝口茶吗？', mode: 'json', warnings: [], ttsSkip: false },
    { turnId: 't-1', textLang: 'ja', audioUrl: '/chill/v1/audio/abc.wav', state: DEFAULT_STATE, model: 'deepseek-flash' },
  )
  // 动作 id 现在是游戏资源清单里的字符串 id（数字 id 是旧协议的残留）
  assert.equal(typeof act.actions[0].id, 'string')
  assert.ok(act.actions[0].id.length > 0)
  assert.equal(act.actions[0].kind, 'animation')
  assert.equal(act.actions[0].from, 'emotion')
  assert.equal(act.voice.audioUrl, '/chill/v1/audio/abc.wav')
  assert.equal(act.subtitle.text, '要喝口茶吗？')
  assert.equal(act.meta.model, 'deepseek-flash')
})
check('未知情绪没有动作也不崩', () => {
  const act = buildAct({ emotion: 'Agree', voice_text: 'a', subtitle_text: 'b', mode: 'json', warnings: [], ttsSkip: false }, { actionMap: {} })
  assert.deepEqual(act.actions, [])
})

console.log('# cacheKey')
check('同参数同键，异参数异键', () => {
  const a = cacheKey({ text: 'やあ', lang: 'ja', ref: 'r.wav', prompt: 'p', speed: 1 })
  const b = cacheKey({ text: 'やあ', lang: 'ja', ref: 'r.wav', prompt: 'p', speed: 1 })
  const c = cacheKey({ text: 'やあ', lang: 'zh', ref: 'r.wav', prompt: 'p', speed: 1 })
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.equal(a.length, 20)
})

console.log(`\nPASS ${passed} checks`)
