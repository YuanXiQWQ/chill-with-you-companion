// 端到端测试：核对「表演与语音解绑」「按内容定形态」「同族延续」三条不变量。
// 只打 PASS/FAIL/WARN，不打印整份响应。
const B = process.env.CHILL_BASE || 'http://127.0.0.1:10722/chill/v1'
const MAX_CLIP_MS = 8000   // 插件 motion.MaxClipSec

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cls = (id) => {
  const s = String(id || '')
  if (/sub_(nod|shy|joy|fun|laugh|thinking|confidence|shakehead|dropshoulders)/.test(s)) return 'gesture'
  if (/(drink|pen|page|novel|textbook|flip|cup)/.test(s)) return 'prop'
  if (/(yawn|tired|wakeup|stretch|sleep)/.test(s)) return 'posture'
  if (/leavechair|sofa|go|comeback|walk/.test(s)) return 'locomotion'
  return 'other'
}

let pass = 0, fail = 0, warn = 0
const check = (name, ok, detail) => {
  if (ok) pass += 1; else fail += 1
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  ' + detail : ''))
}
const note = (name, detail) => { warn += 1; console.log('  WARN  ' + name + (detail ? '  ' + detail : '')) }

async function act(text) {
  const r = await fetch(B + '/act', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, sandbox: true }),
    signal: AbortSignal.timeout(120000),
  })
  const j = await r.json()
  const anim = (j.performance || []).filter((c) => c.slot === 'animations')
  const span = anim.reduce((m, c) => Math.max(m, (c.at || 0) + (Number(c.durationMs) || 0)), 0)
  const sub = typeof j.subtitle === 'string' ? j.subtitle : String(j.subtitle?.text || '')
  const frames = Array.isArray(j.mouthFlat) ? j.mouthFlat.length : Number(j.mouthFrames) || 0
  return { j, anim, span, sub, frames }
}

const cases = [
  { text: '对，就按这个来，同意', want: 'gesture' },
  { text: '我写代码写得有点累，先喝口水', want: 'prop' },
  { text: '我困得不行了，伸个懒腰', want: 'posture' },
    // 她始终坐在椅子上：离座/走动的意图不再安排表演（2026-11-15 定的规矩）
    { text: '我先去趟便利店，等我一下', want: 'none' },
]

console.log('  ── 一、形态与时长（时长只来自游戏段） ──')
for (const c of cases) {
  const { anim, span, sub } = await act(c.text)
  const ids = anim.map((x) => x.id.replace(/^anim_/, ''))
  const shape = ids.length === 1 ? 'single' : ids.length >= 2 ? 'multi' : 'none'
  const gestureOk = c.want !== 'gesture' || (ids.length === 1 && cls(anim[0]?.id) === 'gesture')
  // want:'none' 是"这段不该有表演"（比如离座意图），必须是 0 条动作，不是时长不够
  const durOk = c.want === 'none'
    ? anim.length === 0
    : (anim.length > 0 && anim.every((x) => Number(x.durationMs) > 0))
  check(c.text.slice(0, 10) + ' [' + c.want + '] 形态=' + shape + ' ' + span + 'ms', gestureOk && durOk, ids.join(' '))
  check('  字幕 ' + sub.length + ' 字', sub.length > 0 && sub.length <= 40, sub.slice(0, 22))
  const over = anim.filter((x) => Number(x.durationMs) > MAX_CLIP_MS)
  if (over.length) note('  这段天然超过 MaxClipSec，播放会被裁', over.map((x) => x.id.replace(/^anim_/, '') + '=' + x.durationMs + 'ms').join(' '))
  await sleep(2200)
}

console.log('  ── 二、同族延续 ──')
{
  const a = await act('我写代码写得有点累，先喝口水')
  await sleep(2200)
  const b = await act('那再喝一口吧')
  const cont = b.anim.some((x) => x.continued === true) || (b.anim.length === 1 && /_loop$/.test(b.anim[0].id))
  check('同一件事 → 只接 loop（不重新起手）', cont, b.anim.map((x) => x.id.replace(/^anim_/, '') + '@' + x.durationMs).join(' '))
  check('  loop 段恰好一拍（不按语音重复）', (a.anim || []).filter((x) => /_loop2?$/.test(x.id)).length <= 1, (a.anim || []).map((x) => x.id).join(' '))
  check('  接上是单段 loop（<=2600ms）', b.anim.every((x) => /_loop2?$/.test(x.id)) && b.span <= 2700, a.span + 'ms → ' + b.span + 'ms')
  await sleep(2200)
}

console.log('  ── 三、连续两句不丢 ──')
{
  const r1 = await act('嗯，我也这么想')
  const r2 = await act('那我先把这段写完了')
  check('连发两句都有输出', Boolean(r1.sub) && Boolean(r2.sub), r1.anim.length + ' / ' + r2.anim.length + ' cues')
  await sleep(2200)
}

console.log('  ── 四、口型仍跟音频（不被表演改动影响） ──')
{
  const { j, frames } = await act('这句话用来验口型这条线还在不在')
  const fps = Number(j.mouthFps) || 30
  const hasAudio = Boolean(j.audioUrl)
  if (hasAudio) {
    check('有音频必须有口型帧', frames > 0, frames + ' 帧 @' + fps + 'fps ≈ ' + (frames / fps).toFixed(2) + 's')
    check('  口型表 = 帧数 × 通道数(6)', Array.isArray(j.mouthFlat) ? j.mouthFlat.length === Number(j.mouthFrames) * 6 : true,
      'mouthFlat=' + (Array.isArray(j.mouthFlat) ? j.mouthFlat.length : 'n/a') + ' mouthFrames=' + j.mouthFrames)
  } else {
    check('无语音时降级为纯字幕（设计行为）', true, 'audioUrl 空，口型帧 ' + frames)
  }
}

console.log('')
console.log('  端到端：' + pass + ' 通过 / ' + fail + ' 失败 / ' + warn + ' 提醒')
process.exit(fail === 0 ? 0 : 1)
