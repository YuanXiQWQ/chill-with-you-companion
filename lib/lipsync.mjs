// 日语口型：假名 → 母音 → 六通道权重帧（あいうえお + ん）
// 只依赖文本与音频时长，不需要音素对齐；输出给表演端按音频播放时间采样。
// 通道顺序固定为 [a, i, u, e, o, n]，与 Face 网格里的 Mouth_a/i/u/e/o/n blendshape 一一对应。

export const CHANNELS = ['a', 'i', 'u', 'e', 'o', 'n']

// 假名 → 母音。浊音/半浊音/拗音全部归到母音，ん 单独一档。
const KANA = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'a', き: 'i', く: 'u', け: 'e', こ: 'o',
  が: 'a', ぎ: 'i', ぐ: 'u', げ: 'e', ご: 'o',
  さ: 'a', し: 'i', す: 'u', せ: 'e', そ: 'o',
  ざ: 'a', じ: 'i', ず: 'u', ぜ: 'e', ぞ: 'o',
  た: 'a', ち: 'i', つ: 'u', て: 'e', と: 'o',
  だ: 'a', ぢ: 'i', づ: 'u', で: 'e', ど: 'o',
  な: 'a', に: 'i', ぬ: 'u', ね: 'e', の: 'o',
  は: 'a', ひ: 'i', ふ: 'u', へ: 'e', ほ: 'o',
  ば: 'a', び: 'i', ぶ: 'u', べ: 'e', ぼ: 'o',
  ぱ: 'a', ぴ: 'i', ぷ: 'u', ぺ: 'e', ぽ: 'o',
  ま: 'a', み: 'i', む: 'u', め: 'e', も: 'o',
  や: 'a', ゆ: 'u', よ: 'o',
  ら: 'a', り: 'i', る: 'u', れ: 'e', ろ: 'o',
  わ: 'a', ゐ: 'i', ゑ: 'e', を: 'o',
  ん: 'n', っ: 'q', ゃ: 'a', ゅ: 'u', ょ: 'o', ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
  ゔ: 'u', ゎ: 'a',
}

const KATAKANA = (() => {
  const map = {}
  const hira = Object.keys(KANA)
  // 片假名区段与平假名一一对应，偏移 0x60
  for (const k of hira) {
    const code = k.charCodeAt(0)
    if (code >= 0x3041 && code <= 0x3096) map[String.fromCharCode(code + 0x60)] = KANA[k]
  }
  map['ー'] = '-'
  map['・'] = 'q'
  map['ヴ'] = 'u'
  return map
})()

const PAUSE = { '、': 0.45, '，': 0.45, ',': 0.45, '。': 0.85, '．': 0.85, '.': 0.85, '？': 0.85, '?': 0.85, '！': 0.85, '!': 0.85, '…': 0.7, '—': 0.4, '　': 0.3, ' ': 0.2, '　': 0.3 }

const VOWEL_OF_LATIN = (word) => {
  // 拉丁词按元音字母粗切，a/e/i/o/u 直接给母音
  const out = []
  for (const ch of word.toLowerCase()) {
    if (ch === 'a' || ch === 'e' || ch === 'i' || ch === 'o' || ch === 'u') out.push({ v: ch, w: 1 })
  }
  return out.length ? out : [{ v: 'a', w: 1 }]
}

/**
 * 假名串 → 母音序列（morae）。
 * 每个元素 { v: 'a'|'i'|'u'|'e'|'o'|'n'|'q', w: 相对权重 }
 */
export function morae(text) {
  const s = String(text || '')
  const out = []
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]
    const mapped = KANA[ch] || KATAKANA[ch]
    if (mapped === '-') {
      // 长音：延长上一个母音
      const last = out[out.length - 1]
      if (last && last.v !== 'q') last.w += 1
      else out.push({ v: 'a', w: 1 })
      continue
    }
    if (mapped === 'q') { out.push({ v: 'q', w: 0.55 }); continue }
    if (mapped) { out.push({ v: mapped, w: 1 }); continue }
    if (PAUSE[ch] != null) { out.push({ v: 'q', w: PAUSE[ch] * 1.2 }); continue }
    if (/[0-9]/.test(ch)) { out.push({ v: 'o', w: 0.8 }); continue }
    if (/[A-Za-z]/.test(ch)) {
      let word = ch
      while (i + 1 < s.length && /[A-Za-z]/.test(s[i + 1])) { word += s[i + 1]; i += 1 }
      for (const m of VOWEL_OF_LATIN(word)) out.push(m)
      continue
    }
    // 汉字等未知字符：按一拍半的开口度处理，避免整句嘴不动
    if (/[\u4e00-\u9fff]/.test(ch)) { out.push({ v: 'a', w: 1.4 }); continue }
    // 其余符号忽略
  }
  return out
}

const ZERO = () => [0, 0, 0, 0, 0, 0]
const idxOf = (v) => CHANNELS.indexOf(v)

// 单个母音的目标权重：开口大 → 权重高；ん 走闭嘴鼻音通道
const AMP = { a: 1, i: 0.72, u: 0.6, e: 0.82, o: 0.9, n: 0.55, q: 0 }

function target(v) {
  const w = ZERO()
  const i = idxOf(v)
  if (i >= 0) w[i] = AMP[v] != null ? AMP[v] : 0.8
  return w
}

/**
 * 生成逐帧口型。
 * @param {string} text 日语台词（假名最佳，汉字按默认开口处理）
 * @param {{duration?: number, fps?: number, tau?: number, gain?: number}} opts
 * @returns {{fps:number, duration:number, morae:number, frames:number[][]}}
 */
export function mouthFrames(text, opts = {}) {
  const fps = opts.fps || 30
  const duration = Number(opts.duration) > 0 ? Number(opts.duration) : Math.max(0.4, morae(text).length * 0.16)
  const tau = opts.tau == null ? 0.045 : opts.tau
  const gain = opts.gain == null ? 1 : opts.gain
  const list = morae(text)

  if (!list.length) {
    return { fps, duration, morae: 0, frames: Array.from({ length: Math.max(1, Math.round(duration * fps)) }, () => ZERO()) }
  }

  const total = list.reduce((sum, m) => sum + m.w, 0)
  const scale = duration / total
  // 每拍中段是稳定母音，两端 25% 做过渡
  const marks = []
  let cursor = 0
  for (const m of list) {
    const d = m.w * scale
    marks.push({ start: cursor, end: cursor + d, v: m.v })
    cursor += d
  }

  const at = (t) => {
    // 找到当前时刻所属的拍，并按相邻拍线性过渡
    let k = 0
    while (k < marks.length - 1 && t > marks[k].end) k += 1
    const cur = marks[k]
    const prev = k > 0 ? marks[k - 1] : null
    const hold = (cur.end - cur.start) * 0.5
    const mid = (cur.start + cur.end) / 2
    const a = target(cur.v)
    if (!prev) {
      const lead = cur.start + Math.max(0.05, (cur.end - cur.start) * 0.2)
      if (t <= lead) {
        const r = Math.max(0, Math.min(1, (t - cur.start) / Math.max(0.05, lead - cur.start)))
        return a.map((x) => x * r)
      }
      return a
    }
    const b = target(prev.v)
    const from = cur.start - hold * 0.5
    const to = cur.start + hold * 0.5
    if (t >= to) return a
    if (t <= from) return b
    const r = (t - from) / Math.max(1e-4, to - from)
    return a.map((x, i) => b[i] + (x - b[i]) * r)
  }

  const count = Math.max(2, Math.round(duration * fps))
  const dt = duration / (count - 1)
  const alpha = 1 - Math.exp(-dt / tau)
  let smooth = ZERO()
  const frames = []
  for (let i = 0; i < count; i += 1) {
    const t = i * dt
    const raw = at(t)
    smooth = smooth.map((prev, c) => prev + (raw[c] - prev) * alpha)
    let row = smooth.map((x) => Math.max(0, Math.min(1, x * gain)))
    // 收尾 120ms 闭口
    const tail = duration - t
    if (tail < 0.12) {
      const k = Math.max(0, tail / 0.12)
      row = row.map((x) => x * k)
    }
    frames.push(row.map((x) => Math.round(x * 1000) / 1000))
  }
  frames[0] = ZERO()
  frames[frames.length - 1] = ZERO()
  return { fps, duration, morae: list.length, frames }
}

/** 从 wav 头算时长（秒），拿不到就返回 0 */
export function wavDuration(buffer) {
  try {
    if (!buffer || buffer.length < 44) return 0
    const dv = new DataView(buffer.buffer ? buffer.buffer : buffer, buffer.byteOffset || 0, buffer.byteLength || buffer.length)
    let byteRate = dv.getUint32(28, true)
    let offset = 12
    while (offset + 8 <= dv.byteLength) {
      const id = String.fromCharCode(dv.getUint8(offset), dv.getUint8(offset + 1), dv.getUint8(offset + 2), dv.getUint8(offset + 3))
      const size = dv.getUint32(offset + 4, true)
      if (id === 'fmt ') byteRate = dv.getUint32(offset + 16, true) || byteRate
      if (id === 'data') {
        if (!byteRate) return 0
        return Math.round((size / byteRate) * 1000) / 1000
      }
      offset += 8 + size + (size % 2)
    }
    return 0
  } catch {
    return 0
  }
}

/** 给自测/预览用：把帧转成人看的字符 */
export function previewFrames(frames, fps = 30, step = 3) {
  const order = ['a', 'i', 'u', 'e', 'o', 'n']
  const rows = []
  for (let i = 0; i < frames.length; i += step) {
    const f = frames[i]
    let best = -1
    let bi = 0
    f.forEach((x, k) => { if (x > best) { best = x; bi = k } })
    const bar = order.map((c, k) => c + ':' + String(Math.round(f[k] * 9))).join(' ')
    rows.push((i / fps).toFixed(2).padStart(5) + 's ' + (best > 0.08 ? order[bi] : '-') + '  ' + bar)
  }
  return rows.join('\n')
}
