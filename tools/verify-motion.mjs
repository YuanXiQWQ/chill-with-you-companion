// 编排层的离线验证：不联网、不调模型，只验规则本身对不对。
// 任何一条 FAIL 都说明"她演错"有结构性原因，不是模型运气问题。
import { classifyClip, contentClasses, planSequence, transitionMs, enforceContentClass } from '../lib/motion-class.js'
import { layerOf, segsOf, durationOf, tripleOf, familyOf, grammar } from '../lib/game-grammar.js'

const results = []
const check = (name, cond, detail = '') => results.push({ name, ok: Boolean(cond), detail })

// ── ① 分类器：token 匹配，不许被名字里的子串骗 ──
const cls = {
  'anim_story_base001_sub_nod': 'gesture',
  'anim_story_base001_sub_lookpenguin': 'gesture',      // 曾被 pen 命中成 prop
  'anim_story_base001_sub_fun': 'gesture',
  'anim_break_tea_sub_drink': 'prop',
  'anim_break_tea_base_loop': 'idle',   // base 循环是场景待机，不是道具动作（道具动作是 break_tea_sub_drink）
  'anim_break_yawn_1_start': 'posture',
  'anim_wild_leavechair_sofa_go': 'locomotion',
  'anim_work_pc_sub_thinking_start': 'prop',            // pc = 道具
  'anim_story_base001_sub_27_1': 'gesture'              // 名字无关键词 → _sub 兜底
}
for (const [id, expect] of Object.entries(cls)) {
  const got = classifyClip(id)
  check('classify ' + id.replace('anim_', ''), got === expect, 'got=' + got + ' expect=' + expect)
}

// ── ② 语法层：层 / 段 / 时长必须来自游戏数据 ──
check('layer 喝茶=休息', layerOf('anim_break_tea_sub_drink') === '休息', layerOf('anim_break_tea_sub_drink'))
check('layer 离座=站立动作', layerOf('anim_wild_leavechair_sofa_go') === '站立动作', layerOf('anim_wild_leavechair_sofa_go'))
check('segs nod 单段', JSON.stringify(segsOf('anim_story_base001_sub_nod')) === '["single"]', JSON.stringify(segsOf('anim_story_base001_sub_nod')))
check('segs drink 含 loop/end', segsOf('anim_break_tea_sub_drink').includes('loop') && segsOf('anim_break_tea_sub_drink').includes('end'), JSON.stringify(segsOf('anim_break_tea_sub_drink')))
check('duration 单段段值', durationOf('anim_break_tea_sub_drink') === 1833, String(durationOf('anim_break_tea_sub_drink')))
check('duration 按段区分', durationOf('anim_break_tea_sub_drink_end') === 1167 && durationOf('anim_break_tea_sub_drink_loop') === 1167, durationOf('anim_break_tea_sub_drink_end') + '/' + durationOf('anim_break_tea_sub_drink_loop'))
check('家族规模 243（游戏全量）', Object.keys(grammar.byFamily).length === 243, String(Object.keys(grammar.byFamily).length))
check('三段式家族 48', Object.values(grammar.byFamily).filter((f) => f.segs.includes('start') && (f.segs.includes('loop') || f.segs.includes('loop2')) && f.segs.includes('end')).length === 48, String(Object.values(grammar.byFamily).filter((f) => f.segs.includes('start') && (f.segs.includes('loop') || f.segs.includes('loop2')) && f.segs.includes('end')).length))

// ── ③ 编排：三段展开按游戏自己的节奏，与语音时长解绑 ──
{
  const FAM = 'anim_story_subbase001_base'
  const r = planSequence([{ slot: 'animations', id: FAM + '_start', at: 0 }], { text: '喝口水', speechMs: 6000 })
  const ids = r.cues.filter((c) => c.slot === 'animations').map((c) => c.id)
  const total = r.cues.filter((c) => c.slot === 'animations').reduce((a, c) => Math.max(a, c.at + c.durationMs), 0)
  check('planSequence 只排不展开（展开唯一在 chain）', ids.length === 1 && ids[0] === FAM + '_start', ids.join(' '))
  // 表演与语音解绑：同一句话，语音 1.5s 与 12s 必须得到同一条表演时间线
  const a = planSequence([{ slot: 'animations', id: FAM + '_start', at: 0 }], { text: '喝口水', speechMs: 1500 })
  const b = planSequence([{ slot: 'animations', id: FAM + '_start', at: 0 }], { text: '喝口水', speechMs: 12000 })
  const tl = (r) => r.cues.filter((c) => c.slot === 'animations').map((c) => c.id + '@' + c.at + '+' + c.durationMs).join('|')
  check('表演时间线与语音时长无关', tl(a) === tl(b), tl(a) + '  vs  ' + tl(b))
  check('planSequence 不产出 loop 段（语音无关已由上一条覆盖）', a.cues.filter((c) => /_loop2?$/.test(c.id)).length === 0, String(a.cues.filter((c) => /_loop2?$/.test(c.id)).length))
  check('段时长逐个取自游戏', r.cues[0].durationMs === durationOf(FAM + '_start'), 'start=' + r.cues[0].durationMs + ' 表=' + durationOf(FAM + '_start'))
  // 没有 start 段的家族（drink）只能单段演，不许凭空造 _start
  const r2 = planSequence([{ slot: 'animations', id: 'anim_break_tea_sub_drink', at: 0 }], { text: '喝口水', speechMs: 6000 })
  const ids2 = r2.cues.filter((c) => c.slot === 'animations').map((c) => c.id)
  check('无 start 的家族不造段', ids2.every((id) => !id.endsWith('_start')), ids2.join(' '))
}

// ── ④ 编排：层切换要被标记，且换层后按姿态类留过渡 ──
{
  // 离座类已不排（她始终坐在椅子上），跨层用坐姿里的手势→道具来验：
  // 手势走上半身、喝茶切全身，两条不同层，切换必须被标记。
  const r = planSequence([
    { slot: 'animations', id: 'anim_story_base001_sub_nod', at: 0 },
    { slot: 'animations', id: 'anim_break_tea_sub_drink_start', at: 0 }
  ], { text: '嗯，喝口茶', currentLayer: '剧情动作', speechMs: 3000 })
  check('跨层被记录', r.notes.some((n) => n.why === 'layer-switch'), JSON.stringify(r.notes))
  }
  // 离座类必须被编排直接剔除
  {
  const r2 = planSequence([{ slot: 'animations', id: 'anim_wild_leavechair_sofa_go', at: 0 }], { text: '我去一下' })
  check('离座不排', r2.cues.filter((c) => c.slot === 'animations').length === 0, JSON.stringify(r2.cues))
}

// ── ⑤ 编排：独占类之间必须留过渡，不能排到同一时刻 ──
{
  const r = planSequence([
    { slot: 'animations', id: 'anim_wild_leavechair_sofa_go', at: 0 },
    { slot: 'animations', id: 'anim_story_base001_sub_nod', at: 0 },
  ], { text: '我去一下然后点头', speechMs: 4000 })
  const anims = r.cues.filter((c) => c.slot === 'animations')
  const starts = anims.map((c) => c.at)
  check('两个动作不同时起', new Set(starts).size === starts.length, starts.join(','))
  const after = anims.filter((c) => c.at > 0)
  check('后一个让开了前一个的时长', after.every((c) => c.at >= 1000), JSON.stringify(anims.map((c) => c.id + '@' + c.at)))
}

// ── ⑥ 过渡矩阵：合理区间，且不返回 undefined ──
{
  const kinds = ['gesture', 'prop', 'posture', 'locomotion', 'idle']
  let bad = []
  for (const a of kinds) for (const b of kinds) {
    const v = transitionMs(a, b)
    if (!Number.isFinite(v) || v < 80 || v > 1200) bad.push(a + '>' + b + '=' + v)
  }
  check('过渡矩阵完整且区间合理', bad.length === 0, bad.join(' '))
  check('手势之间最快', transitionMs('gesture', 'gesture') <= transitionMs('gesture', 'posture'), String(transitionMs('gesture', 'gesture')))
}

// ── ⑦ 内容类别：首要类别要选对（决定闸门方向） ──
const wantCases = {
  '我写代码写得有点累，先喝口水': 'prop',
  '我困得不行了，伸个懒腰': 'posture',
  '我先去趟便利店，等我一下': 'locomotion',
  '对，就按这个来，同意': 'gesture'
}
for (const [t, expect] of Object.entries(wantCases)) {
  const got = contentClasses(t)[0]
  check('首要类别 ' + t.slice(0, 8), got === expect, 'got=' + got + ' expect=' + expect)
}
check('无关内容不误判', contentClasses('今天礼拜二').length === 0, JSON.stringify(contentClasses('今天礼拜二')))

// ── ⑧ 闸门：类别不符必须换；类别与话题都对必须不动 ──
{
  const manifest = {
    animations: [
      { id: 'anim_break_yawn_1_start', semantic: ['休息', '子动作', '哈欠', '进入'], durationMs: 2333 },
      { id: 'anim_story_base001_sub_fun', semantic: ['剧情动作', '基本1', '子动作'], durationMs: 2000 },
      { id: 'anim_wild_fidget', semantic: ['站立动作', '小动作'], durationMs: 1500 }
    ]
  }
  const g1 = enforceContentClass([{ slot: 'animations', id: 'anim_story_base001_sub_fun', at: 0 }], { text: '我困得不行了，伸个懒腰', emotion: 'Tired', manifest, currentLayer: '' })
  check('类别不符 → 换', g1.changed.length === 1 && g1.picked === 'anim_break_yawn_1_start', JSON.stringify(g1.changed))

  const g2 = enforceContentClass([{ slot: 'animations', id: 'anim_break_yawn_1_start', at: 0 }], { text: '我困得不行了，伸个懒腰', emotion: 'Tired', manifest, currentLayer: '' })
  check('已经对 → 不动', g2.changed.length === 0, JSON.stringify(g2.changed))

  const g3 = enforceContentClass([{ slot: 'animations', id: 'anim_wild_fidget', at: 0 }], { text: '我困得不行了，伸个懒腰', emotion: 'Tired', manifest, currentLayer: '' })
  check('同类别但话题不符 → 换', g3.changed.length === 1 && g3.picked === 'anim_break_yawn_1_start', JSON.stringify(g3.changed))

  const g4 = enforceContentClass([{ slot: 'animations', id: 'anim_story_base001_sub_fun', at: 0 }], { text: '今天礼拜二', emotion: 'Happy', manifest, currentLayer: '' })
  check('内容无指向 → 不动', g4.changed.length === 0, JSON.stringify(g4.changed))
}

const pass = results.filter((r) => r.ok).length
const fail = results.filter((r) => !r.ok)
for (const r of results) if (!r.ok) console.log('  FAIL  ' + r.name + '  ' + r.detail)
console.log(`\n  ${pass}/${results.length} 通过` + (fail.length ? `，${fail.length} 条失败` : '，全部通过'))
process.exit(fail.length ? 1 : 0)
