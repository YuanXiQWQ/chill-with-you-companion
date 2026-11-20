// 主谓判定：一句话里的动作到底是谁要做。
//
// 这三类错以前都会发生，而且都表现为"她莫名其妙演了不该演的东西"：
//   「我去沙发上躺一会儿」→ 她离开椅子，他坐在那儿；
//   「我有点渴了」        → 她去喝水；
//   「你困了吧」          → 这个是对的，主语是她。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { subjectOf, isHisOwn } from '../lib/subject.js'
import { decideTrip } from '../lib/seat-trip.js'
import { decideCore } from '../lib/director.js'

const at = (text, needle) => text.indexOf(needle)

test('主语：第一人称 = 我', () => {
  for (const [text, verb] of [
    ['我去沙发上躺一会儿', '躺'],
    ['我要睡了', '睡'],
    ['我有点渴了', '渴'],
    ['我先去倒杯水', '倒'],
  ]) {
    assert.equal(subjectOf(text, at(text, verb)), 'me', text)
    assert.equal(isHisOwn(text, at(text, verb)), true, text)
  }
})

test('主语：第二人称 = 你', () => {
  for (const [text, verb] of [
    ['你去沙发上躺一会儿', '躺'],
    ['你困了吧', '困'],
    ['你要不要喝口水', '喝'],
  ]) {
    assert.equal(subjectOf(text, at(text, verb)), 'you', text)
  }
})

test('主语：省了就是没指定，按她处理', () => {
  assert.equal(subjectOf('去沙发上躺一会儿', at('去沙发上躺一会儿', '躺')), 'none')
  assert.equal(subjectOf('有点困', at('有点困', '困')), 'none')
})

test('主语：派活句式翻过来 —— 让我/帮我 是她做', () => {
  assert.equal(subjectOf('让我歇会儿', at('让我歇会儿', '歇')), 'you')
  assert.equal(subjectOf('帮我倒杯水', at('帮我倒杯水', '倒')), 'you')
  assert.equal(subjectOf('给我拿条毯子', at('给我拿条毯子', '拿')), 'you')
})

test('主语：我们 = 一起，不算把他自己的事推给她', () => {
  assert.equal(subjectOf('我们喝点东西吧', at('我们喝点东西吧', '喝')), 'we')
  assert.equal(subjectOf('咱们看会儿电影', at('咱们看会儿电影', '看')), 'we')
})

test('主语：谁离动词近谁当主语', () => {
  // 「你别管我，我要睡」——最近的是"我"
  assert.equal(subjectOf('你别管我，我要睡了', at('你别管我，我要睡了', '睡')), 'me')
  // 「我没事，你睡吧」——最近的是"你"
  assert.equal(subjectOf('我没事，你睡吧', at('我没事，你睡吧', '睡')), 'you')
})

test('离座：他说自己去躺，不触发她离座', () => {
  assert.equal(decideTrip('我去沙发上躺一会儿'), null)
  assert.equal(decideTrip('我先去躺一下'), null)
  assert.equal(decideTrip('我去倒杯水'), null)
})

test('离座：让她去才触发', () => {
  assert.equal(decideTrip('你去沙发上躺一会儿')?.plan, 'Sofa')
  assert.equal(decideTrip('去沙发上躺一会儿吧')?.plan, 'Sofa')
  assert.equal(decideTrip('帮我去倒杯水')?.plan, 'Far')
  assert.equal(decideTrip('躺一会儿吧')?.plan, 'Sofa')
})

test('主戏：他说自己渴了，不锁成她的喝水', () => {
  const r = decideCore('我有点渴了', [])
  assert.ok(!r.core || r.core.verb !== 'drink', '不该判成她喝水')
})

test('主戏：说她的状态就锁成她的动作', () => {
  assert.equal(decideCore('你渴了吧', []).core?.verb, 'drink')
  assert.equal(decideCore('有点渴', []).core?.verb, 'drink')
  assert.equal(decideCore('你去喝口水吧', []).core?.verb, 'drink')
})

test('主戏：他要睡了，不让她趴下', () => {
  const r = decideCore('我要睡一会儿了', [])
  assert.ok(!r.core || r.core.verb !== 'sleep', '不该判成她趴下')
  assert.equal(decideCore('你眯一会儿吧', []).core?.verb, 'sleep')
})

test('主戏：手势不受主语限制 —— 他说"我同意"她可以点头', () => {
  assert.equal(decideCore('我同意', []).core?.verb, 'nod')
})
