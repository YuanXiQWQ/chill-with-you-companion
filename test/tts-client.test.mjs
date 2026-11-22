/**
 * 验证 VOICEVOX 合成协议、WAV 校验以及本机服务地址限制。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { requestSpeech } from '../lib/tts-client.mjs'

const config = { provider: 'voicevox', speaker: 10005, url: 'http://127.0.0.1:50121' }
const voice = { speedFactor: 0.95 }

/**
 * 构造用于验证接口的 16-bit 单声道 PCM WAV。
 *
 * @return {Buffer} 带标准 WAV 头和 2048 字节 PCM 的音频。
 */
function fixtureWave() {
  const wav = Buffer.alloc(44 + 2048)
  wav.write('RIFF')
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(24000, 24)
  wav.writeUInt32LE(48000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(2048, 40)
  return wav
}

test('Nemo 使用固定音色与声线语速合成，不传参考音频', async (t) => {
  const wave = fixtureWave()
  const signal = AbortSignal.timeout(1000)
  const fetchStub = t.mock.method(globalThis, 'fetch', async (url) => (
    url.includes('/audio_query?') ? Response.json({ speedScale: 1 }) : new Response(wave)
  ))
  const result = await requestSpeech(config, 'こんにちは。', voice, 'ja', signal)
  assert.deepEqual(result, wave)
  const [[queryUrl, first], [ttsUrl, second]] = fetchStub.mock.calls.map((c) => c.arguments)
  assert.equal(new URL(queryUrl).searchParams.get('text'), 'こんにちは。')
  assert.equal(new URL(queryUrl).searchParams.get('speaker'), '10005')
  assert.equal(new URL(queryUrl).searchParams.has('ref_audio_path'), false)
  assert.equal(ttsUrl, 'http://127.0.0.1:50121/synthesis?speaker=10005')
  assert.equal(first.method, 'POST')
  assert.equal(first.redirect, 'error')
  assert.equal(second.redirect, 'error')
  assert.equal(second.signal, signal)
  assert.equal(JSON.parse(second.body).speedScale, 0.95)
})

test('拒绝将台词交给非本机或带凭据的 VOICEVOX URL', async (t) => {
  const fetchStub = t.mock.method(globalThis, 'fetch')
  for (const url of ['https://engine.invalid:50121', 'http://127.0.0.1@engine.invalid:50121', 'http://who@127.0.0.1:50121']) {
    await assert.rejects(requestSpeech({ ...config, url }, 'こんにちは。', voice, 'ja'), /127\.0\.0\.1/)
  }
  assert.equal(fetchStub.mock.calls.length, 0)
})

test('拒绝将非 WAV 响应作为游戏音频', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => (
    url.includes('/audio_query?') ? Response.json({}) : new Response(Buffer.alloc(2048))
  ))
  await assert.rejects(requestSpeech(config, 'こんにちは。', voice, 'ja'), /WAV/)
})

