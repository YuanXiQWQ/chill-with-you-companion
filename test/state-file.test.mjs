#!/usr/bin/env node
/**
 * state.json 的读写规则（lib/state-file.mjs）。
 *
 * 这些规则以前埋在 brain.mjs 里，只能靠端到端冒烟间接测；拆出来之后可以直测：
 *   1. 文件不在 → 用默认值，不抛
 *   2. 白名单合并：旧版本残留字段不许带进来；数字字段坏值回落默认
 *   3. 写是原子的（tmp + rename），不留 .tmp 残骸
 *   4. 盘上被外部改过 → 下一次 save() 以盘上为准，不覆盖外部编辑
 *   5. 坏 JSON → 改名 .bad-* 留证，并按默认值继续跑
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { createStateFile } from '../lib/state-file.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
void ROOT

const defaults = {
  phase: 'idle', since: 0, focusCount: 0, breakCount: 0,
  energy: 70, affection: 20, mood: 60, moodVel: 0, turnCount: 0,
  lastTopic: '', recentSubs: [], pomo: { running: false, remainMs: 0 },
}
const make = (dir, extra = {}) => createStateFile({
  path: join(dir, 'state.json'),
  defaults,
  log: () => {},
  ...extra,
})

// 1) 文件不存在：默认值，不抛
{
  const dir = mkdtempSync(join(tmpdir(), 'chill-sf-'))
  const sf = make(dir)
  await sf.load()
  assert.equal(sf.state.phase, 'idle')
  assert.equal(sf.state.affection, 20)
  assert.deepEqual(sf.state.pomo, defaults.pomo)
}

// 2) 白名单 + 数字兜底
{
  const dir = mkdtempSync(join(tmpdir(), 'chill-sf-'))
  writeFileSync(join(dir, 'state.json'), JSON.stringify({
    affection: 42, mood: 'NaN 一样的东西', turnCount: null,
    legacyField: '旧版本残留', recentSubs: ['外部写入'],
  }), 'utf8')
  const sf = make(dir)
  await sf.load()
  assert.equal(sf.state.affection, 42, '合法数字照收')
  assert.equal(sf.state.mood, 60, '坏值回落默认')
  assert.equal(sf.state.turnCount, 0, 'null 也回落默认')
  assert.equal(sf.state.legacyField, undefined, '白名单外的字段不许带进来')
  assert.deepEqual(sf.state.recentSubs, ['外部写入'], '普通字段原样保留')
}

// 3) 原子写：写完只剩 state.json，没有 .tmp
{
  const dir = mkdtempSync(join(tmpdir(), 'chill-sf-'))
  const sf = make(dir)
  await sf.load()
  sf.state.affection = 31
  await sf.save()
  const files = readdirSync(dir)
  assert.deepEqual(files, ['state.json'], '只该有 state.json：' + files.join(','))
  const saved = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'))
  assert.equal(saved.affection, 31, '真写进去了')
  assert.ok(saved.savedAt, '带 savedAt')
}

// 4) 外部改过就认盘上的（这条是 2026-11-14 清理记忆被覆盖的回归）
{
  const dir = mkdtempSync(join(tmpdir(), 'chill-sf-'))
  const sf = make(dir)
  await sf.load()
  sf.state.lastTopic = '进程里的旧值'
  sf.state.recentSubs = ['进程里的旧摘要']
  await sf.save()

  const p = join(dir, 'state.json')
  const edited = JSON.parse(readFileSync(p, 'utf8'))
  edited.lastTopic = ''
  edited.recentSubs = []
  writeFileSync(p, JSON.stringify(edited, null, 2), 'utf8')

  await sf.save()   // 触发对账
  const after = JSON.parse(readFileSync(p, 'utf8'))
  assert.equal(after.lastTopic, '', '外部清掉的 lastTopic 不许被内存里的旧值写回')
  assert.deepEqual(after.recentSubs, [], '外部清掉的 recentSubs 同样不许写回')
  assert.equal(sf.state.lastTopic, '', '内存也跟着认盘上的值')
}

// 5) 坏 JSON：改名留证 + 按默认值继续
{
  const dir = mkdtempSync(join(tmpdir(), 'chill-sf-'))
  writeFileSync(join(dir, 'state.json'), '{"phase": "idle", 坏掉了', 'utf8')
  const sf = make(dir, { settleMs: 1 })
  await sf.load()
  assert.equal(sf.state.phase, 'idle', '坏了也按默认值起来，不挡启动')
  const bad = readdirSync(dir).filter((n) => n.startsWith('state.json.bad-'))
  assert.equal(bad.length, 1, '坏文件改名留证：' + readdirSync(dir).join(','))
  assert.ok(existsSync(join(dir, 'state.json.bad-' + bad[0].split('state.json.bad-')[1])), '留证文件真的在')
}

console.log('  PASS 默认值 / 白名单 / 原子写 / 外部编辑优先 / 坏文件隔离')
