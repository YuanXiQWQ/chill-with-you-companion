/**
 * 向配置的语音服务请求 WAV。VOICEVOX 只在本机运行，使用原生合成接口。
 */
import { wavDuration } from './lipsync.mjs'

/**
 * 请求一段语音。
 *
 * @param {object} tts 语音后端的配置。
 * @param {string} text 要朗读的台词。
 * @param {object} voice 声线、参考音频和语速。
 * @param {string} language 台词语言。
 * @param {AbortSignal} signal 单次合成的取消信号。
 * @return {Promise<Buffer>} WAV 音频。
 */
export async function requestSpeech(tts, text, voice, language, signal) {
  const origin = tts.url.replace(/\/$/, '')
  let response
  if (tts.provider === 'voicevox') {
    const engine = new URL(origin)
    if (engine.protocol !== 'http:' || engine.hostname !== '127.0.0.1' || !engine.port
        || engine.username || engine.password || engine.pathname !== '/' || engine.search || engine.hash) {
      throw new Error('VOICEVOX 需要显式指定本机 127.0.0.1 的端口')
    }
    const speaker = String(tts.speaker)
    if (!/^\d+$/.test(speaker)) throw new Error('VOICEVOX 声音编号无效')
    const options = { method: 'POST', redirect: 'error', signal }
    const query = new URLSearchParams({ text, speaker })
    const prepared = await fetch(engine.origin + '/audio_query?' + query, options)
    if (!prepared.ok) throw new Error('VOICEVOX audio_query HTTP ' + prepared.status)
    const audioQuery = await prepared.json()
    audioQuery.speedScale = Number(voice.speedFactor) || 1
    response = await fetch(engine.origin + '/synthesis?speaker=' + speaker, {
      ...options, headers: { 'content-type': 'application/json' }, body: JSON.stringify(audioQuery),
    })
  } else {
    const query = new URLSearchParams({
      text, text_lang: language, ref_audio_path: voice.path || voice.file,
      prompt_text: voice.promptText, prompt_lang: voice.promptLang, speed_factor: String(voice.speedFactor),
    })
    response = await fetch(origin + '/tts?' + query, { signal })
  }
  if (!response.ok) throw new Error('tts HTTP ' + response.status)
  const data = Buffer.from(await response.arrayBuffer())
  if (data.length < 1024) throw new Error('tts returned ' + data.length + ' bytes')
  if (tts.provider === 'voicevox'
      && (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE' || !wavDuration(data))) {
    throw new Error('VOICEVOX 未返回有效 WAV 音频')
  }
  return data
}

