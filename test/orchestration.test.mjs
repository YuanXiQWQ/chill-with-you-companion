// 编排层的稳定性约束。每一条都对应一个真实踩过的坑，不是设想。
//
// 编排是三层串联：director（判主戏、编整套）→ motion-class.planSequence（排序/串行化）
// → needs + arrange（需求 → 最终时间轴）。三层各自能算时长、各自能排序，
// 一旦口径不一致，症状都是"动作演到一半跳走"或"顺序和话反着来"。
// 这里把口径钉死，任何一层改坏了都会红。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spanOf, buildSuite } from '../lib/director.js'
import { ACTIONS, ACTION_ORDER, FOCUS_ALT } from '../lib/actions.js'
import { classifyClip, MOTION_CLASS } from '../lib/motion-class.js'
import { extractNeeds } from '../lib/needs.js'
import { arrange } from '../lib/arrange.js'

function plan(text, speechMs = 9000, cues = []) {
  const nd = extractNeeds({ text, cues, phase: 'chat' })
  return arrange(nd.needs, { speechMs, ambient: [] })
}

// 每条 cue 实际占住 L0 的区间：[at, at + duration + hold)
function endOf(c) {
  return (Number(c.at) || 0) + (Number(c.durationMs) || 0) + (Number(c.holdMs) || 0)
}

test('时间轴上没有两条动作抢占同一段', () => {
  // 历史 bug：arrange 里 cursor 只推进 span、没加 hold，于是"按住循环段等语音说完"
  // 的那段被下一拍从中间切断。「先喝口水，然后接着写代码」语音 8 秒时，
  // 喝水要按到 8 秒，但写代码被排在 2.3 秒——喝水只演了四分之一。
  const cases = [
    '先喝口水，然后接着写代码',
    '我想看会儿书，然后伸个懒腰',
    '一起看电影吧，看累了就睡',
    '我写会儿代码，再陪我聊会儿',
  ]
  for (const text of cases) {
    for (const speechMs of [2000, 6000, 15000]) {
      const cues = plan(text, speechMs).cues
      let prevEnd = 0
      for (const c of cues) {
        const at = Number(c.at) || 0
        assert.ok(at >= prevEnd - 1,
          `「${text}」speech=${speechMs}: ${c.verb || c.id} 排在 ${at}ms，但上一拍要到 ${prevEnd}ms 才让出 L0`)
        prevEnd = Math.max(prevEnd, endOf(c))
      }
    }
  }
})

test('每个已注册的动词都有真实时长，没人靠 1200ms 兜底', () => {
  // 单段族（137 个）的 segs 是 ['single']，时长记在族自己身上。
  // spanOf 早先一律拼 family_single，键不存在，于是这些族算出 0，
  // arrange 退回 1200ms——半边动作表的时间轴全是错的。
  const zero = ACTION_ORDER.filter((v) => !(spanOf(ACTIONS[v].family) > 0))
  assert.deepEqual(zero, [], '这些动词的 spanOf 是 0：' + zero.join(', '))
  for (const v of ACTION_ORDER) {
    const ms = spanOf(ACTIONS[v].family)
    assert.ok(ms >= 600 && ms <= 12000, `${v} 的 spanOf=${ms} 超出合理区间`)
  }
})

test('陪伴类主戏排在收尾之前，和句子的先后一致', () => {
  // 历史 bug：need() 只把 kind==='core' 当主戏，陪伴类（companion）落到 tail + prio 10，
  // 而 arrange 又按 anchor/prio 排序、并把 companion 当 core 演。
  // 「我想看会儿书，然后伸个懒腰」因此被排成先伸懒腰再看书——和话正好反着。
  const cues = plan('我想看会儿书，然后伸个懒腰').cues
  assert.equal(cues[0].verb, 'read_book', '先说的那件事要排在前面')
  assert.equal(cues[1] && cues[1].verb, 'stretch', '「然后」之后的排在后面')

  const drink = plan('先喝口水，然后接着写代码').cues
  assert.equal(drink[0].verb, 'drink')
  assert.equal(drink[1] && drink[1].verb, 'work_pc')
})

test('主戏至少按住到语音说完，不会留一段空场', () => {
  // 「我写会儿代码」这种单拍句，动作 4 秒、语音 6 秒；
  // 不按住的话后 2 秒她一动不动。按住的是循环段，不是把动作拉慢
  // （拉慢会撞上游戏端的 MaxSlowdown，看起来像慢镜头）。
  const speechMs = 9000
  const cues = plan('我写会儿代码', speechMs).cues
  assert.equal(cues.length, 1)
  assert.equal(endOf(cues[0]), speechMs, '主戏应该正好填满语音窗口')
})

test('起手动作只由内容决定，和模型给的顺序无关', () => {
  // buildSuite 早先用 list.find 取第一条手势，取到的是"模型这次把哪条排前面"。
  // 同一句话换个请求就换个起手——演出不稳定的一大来源，而且在模型侧改不掉。
  const a = { slot: 'animations', id: 'anim_story_base001_sub_nod', at: 0 }
  const b = { slot: 'animations', id: 'anim_story_base001_sub_shy', at: 0 }
  const text = '好耶，那太好了'
  const forward = buildSuite([a, b], text)
  const reverse = buildSuite([b, a], text)
  const preOf = (r) => {
    const s = r.suite.find((c) => c.role === 'pre')
    return s ? s.id : null
  }
  assert.equal(preOf(forward), preOf(reverse), '两种顺序下的起手必须一致')
})

test('专注态只动头颈：演不了的换成头颈替代，不是留空', () => {
  // 专注时她正对着屏幕干活，站起来伸懒腰、抬手喝水、切去写代码都会把节奏打断。
  // 但**不能只是不演**：早先是"排完再丢"，预算全花在不能演的素材上，
  // 十条里空六条，她像掉线一样坐在那儿。现在是换成头颈能做的那个。
  const head = ['nod', 'shy', 'think', 'laugh', 'suspense']
  for (const text of ['我困得不行了', '伸个懒腰吧', '喝口水', '我写会儿代码',
    '我想看会儿书', '一起看电影吧', '听会儿音乐']) {
    const nd = extractNeeds({ text, cues: [], phase: 'focus' })
    assert.ok(nd.needs.length > 0, `专注态「${text}」不该什么都不做`)
    for (const n of nd.needs) {
      assert.ok(head.includes(n.verb), `专注态「${text}」给了 ${n.verb}，不是头颈动作`)
      assert.equal(ACTIONS[n.verb].state, undefined, `专注态「${text}」不能切状态`)
    }
  }
  // 手势本来就能演，不该被替换掉
  for (const text of ['好耶，修好了', '别夸我了', '让我想想']) {
    const nd = extractNeeds({ text, cues: [], phase: 'focus' })
    assert.ok(nd.needs.length > 0, `专注态「${text}」的手势应该保留`)
  }
  // 他说自己累，本来就该没有动作——和专注无关，别借专注态把它救回来
  assert.deepEqual(extractNeeds({ text: '我累了', cues: [], phase: 'focus' }).needs, [])
})

test('替代品自己也得是头颈动作，不能换出个更夸张的', () => {
  // 这条是防以后往 FOCUS_ALT 里塞个全身动作（比如把 stretch 换成 shoulder）。
  for (const [verb, alt] of Object.entries(FOCUS_ALT)) {
    assert.ok(ACTIONS[alt], `${verb} 的替代 ${alt} 不存在`)
    assert.equal(ACTIONS[alt].state, undefined, `${verb} 的替代 ${alt} 带 state`)
    assert.equal(classifyClip(ACTIONS[alt].family), MOTION_CLASS.GESTURE,
      `${verb} 的替代 ${alt} 不是手势类`)
  }
  // 没有替代的动词，要么本来就演不了（有 state 或要身体），要么本身就是头颈动作（不用替）。
  for (const verb of Object.keys(ACTIONS)) {
    if (FOCUS_ALT[verb]) continue
    const a = ACTIONS[verb]
    const headOnly = !a.state && classifyClip(a.family) === MOTION_CLASS.GESTURE
    assert.ok(headOnly || a.state || classifyClip(a.family) !== MOTION_CLASS.GESTURE,
      `${verb} 能头颈演，但既没进替代表也没问题`)
  }
})

test('睡觉这件事认得出来，但绝不替游戏决定她累不累', () => {
  // 两件事要同时成立：
  // ① 认得出——sleep 早先只认 睡一会/睡一下/睡…觉/睡…会儿，
  //    「睡吧」「该睡了」「你也早点睡」全部命中不了（不报错、不动作）。
  // ② 但不产生动作——她的睡意是游戏按"连续专注时长"自己累积的，到点了游戏自己送她进
  //    BreakSleep。我们去切这个状态不但多余，还得先强行置 ActivateSleepFlg，
  //    那是在改游戏自己的状态位。所以这个动词只表示"我听懂你在说睡觉"。
  for (const text of ['睡觉吧', '睡吧', '该睡了', '你也早点睡', '趴一会儿', '眯一下']) {
    const nd = extractNeeds({ text, cues: [], phase: 'chat' })
    assert.equal(nd.core && nd.core.verb, 'sleep', `「${text}」没认成 sleep`)
    assert.deepEqual(nd.needs.map((n) => n.verb), [], `「${text}」不该产生动作`)
    assert.ok(nd.dropped.some((d) => d.why && d.why.includes('游戏按连续专注时长')),
      `「${text}」丢弃理由要说清楚是交给游戏`)
  }
  // 两句合成一拍时，sleep 也只能当"听懂"，不能混进第二拍去演
  const mixed = extractNeeds({ text: '你困了就睡吧', cues: [], phase: 'chat' })
  assert.deepEqual(mixed.needs.map((n) => n.verb), ['yawn'], '打哈欠可以有，躺下不行')
  // 他说他自己睡，仍然不传染
  const his = extractNeeds({ text: '我睡一会儿', cues: [], phase: 'chat' })
  assert.deepEqual(his.needs.map((n) => n.verb), [], '他说自己睡，她不该跟着睡')
})

test('导演层和编排层对"主戏是什么"给出同一个答案', () => {
  // 三层串联里最危险的是两层的判断分歧：director 说主戏是 A、
  // needs+arrange 最后排出来是 B，中间的锁定就白做了。
  // 「先喝口水」曾被闸门换成"笑"，就是这类分歧的后果。
  const corpus = [
    '先喝口水，然后接着写代码',
    '我想看会儿书',
    '有点渴了',
    '我写会儿代码',
    '一起看电影吧',
    '让我想想',
    '好耶，这个 bug 终于修好了',
    '伸个懒腰吧',
    '我想看小说',
  ]
  for (const text of corpus) {
    const decided = buildSuite([], text)
    const planned = plan(text)
    if (!decided.core) {
      assert.equal(planned.cues.length, 0, `「${text}」导演层没判出主戏，编排层却排了动作`)
      continue
    }
    assert.ok(planned.cues.length > 0, `「${text}」导演层判出 ${decided.core.verb}，编排层却什么都没排`)
    assert.equal(planned.cues[0].verb, decided.core.verb,
      `「${text}」导演层判 ${decided.core.verb}，编排层排的是 ${planned.cues[0].verb}`)
  }
})
