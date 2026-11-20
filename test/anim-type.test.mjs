// 动作表的守卫。
//
// 这一层最容易出的不是崩溃，是"静默失效"：
//   - 枚举名拼错一个字 → 状态机拒收 → 那一刻什么都没演
//   - 动词只在 actions.js 里加了、别的层没跟上 → 永远匹配不到
//   - 白名单和 native 字段脱节 → 配了却不生效
// 三种都不会报错，所以只能靠断言挡。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { NATIVE_VERBS, toNative } from '../lib/anim-type.js'
import { ACTIONS, ACTION_ORDER, ORDERED_ACTIONS, nativeOf } from '../lib/actions.js'
import { ORDERED_ACTIONS as FROM_DIRECTOR } from '../lib/director.js'

const here = dirname(fileURLToPath(import.meta.url))
const tableDoc = readFileSync(join(here, '..', 'docs', '游戏动作全表.md'), 'utf8')
const knownTypes = new Set(
  [...tableDoc.matchAll(/^- `\d+` (\S+)$/gm)].map((m) => m[1]),
)

test('原生动作名必须在游戏全表里，拼错一个字会静默失效', () => {
  assert.ok(knownTypes.size > 100, '游戏动作全表没读到，检查 docs 路径')
  for (const verb of ACTION_ORDER) {
    const nat = ACTIONS[verb].native
    if (!nat) continue
    // 两种写法都合法：
    //   name —— 写死全名（站着的动作没有基底变体，比如 Wild001_Motion1_StretchFllBody）
    //   sub  —— 只写后缀，全名由游戏端按她此刻的基底拼（DrinkTea -> BreakBase004_DrinkTea …）
    // 至少要有一个，否则这个 verb 配了 native 却什么也发不出去。
    assert.ok(nat.name || nat.sub, `${verb} 配了 native 但既没有 name 也没有 sub`)
    if (nat.name) {
      assert.ok(knownTypes.has(nat.name), `${verb} -> ${nat.name} 不在游戏动作全表里`)
    }
    if (nat.id !== undefined) {
      assert.ok(Number.isInteger(nat.id) && nat.id >= 0, `${verb} 的 native id 不对`)
    }
    // sub 必须在某个基底下真有对应全名，否则运行时一定退回采样——
    // 而且退回是静默的，只在游戏日志里留一行，测试不盯就会一直以为它生效。
    if (nat.sub) {
      const hit = [...knownTypes].some((t) => t.endsWith('_' + nat.sub))
      assert.ok(hit, `${verb} 的 sub="${nat.sub}" 在游戏全表里找不到任何 <基底>_${nat.sub}`)
    }
  }
})

test('每个动作的四列齐全，不写就是 false 没有隐含默认', () => {
  for (const verb of ACTION_ORDER) {
    const a = ACTIONS[verb]
    assert.ok(a, `${verb} 不在 ACTIONS 里`)
    assert.ok(a.family && /^anim_/.test(a.family), `${verb} 的 family 不对：${a.family}`)
    assert.ok(a.re instanceof RegExp, `${verb} 缺匹配正则`)
    assert.ok(a.label, `${verb} 缺 label`)
    assert.ok(a.kind === 'activity' || a.kind === 'gesture', `${verb} 的 kind 只能是 activity/gesture`)
    for (const flag of ['hisBody', 'contagious', 'companion']) {
      assert.equal(typeof a[flag], 'boolean', `${verb} 的 ${flag} 必须显式写 true/false`)
    }
  }
})

test('族名不重复，一族只能对应一个动作', () => {
  const seen = new Map()
  for (const verb of ACTION_ORDER) {
    const fam = ACTIONS[verb].family
    assert.ok(!seen.has(fam), `${fam} 被 ${seen.get(fam)} 和 ${verb} 同时占用`)
    seen.set(fam, verb)
  }
})

test('顺序表与动作表一致，漏一个就永远匹配不到', () => {
  assert.deepEqual([...ACTION_ORDER].sort(), Object.keys(ACTIONS).sort())
  assert.deepEqual(FROM_DIRECTOR.map((c) => c.verb), ACTION_ORDER)
  assert.deepEqual(FROM_DIRECTOR.map((c) => c.verb), ACTION_ORDER)
})

test('白名单 = 表里配了 native 的动词，配了却不生效的情况不存在', () => {
  const expected = ACTION_ORDER.filter((v) => ACTIONS[v].native).sort()
  assert.deepEqual([...NATIVE_VERBS].sort(), expected)
})

test('toNative 只返回 native 前缀的键，不覆盖 cue 自己的 id', () => {
  const r = toNative('yawn')
  assert.equal(r.nativeName, 'Wild001_Motion23_Yawn_1')
  assert.equal(r.nativeId, 72)
  assert.ok(!('id' in r), '返回对象里带 id 会把 cue 的 clip 族名覆盖成枚举数字')
})

test('没有 native 的动词返回 null，交给采样兜底', () => {
  // 持续状态不是采样兜底：有 state 的 verb 返回"去切状态"，不是 null。
  assert.equal(toNative('work_pc').stateName, 'WorkPC')
  assert.equal(toNative('read_book').stateName, 'WorkBook')
  assert.equal(toNative('movie').stateName, 'BreakMovie')
  // nativeOf 仍然只看 native：这些 verb 的 native 是 null，它就该是 null。
  assert.equal(nativeOf('movie'), null)
  assert.equal(toNative('压根没有这个动词'), null)
})

test('传染的族一定是他的身体，反过来不成立', () => {
  for (const verb of ACTION_ORDER) {
    const a = ACTIONS[verb]
    if (a.contagious) assert.ok(a.hisBody, `${verb} 会传染，但没标成他的身体`)
  }
})
