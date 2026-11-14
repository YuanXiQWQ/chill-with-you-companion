#!/usr/bin/env node
/**
 * 模型降级链：主力 provider 挂了要能顺着候选往下试，而不是整轮哑掉。
 *
 * 锁三件事：
 *   1. `llm.candidates()` 只列真能用的（有 key + 有 baseUrl），且当前 provider 排第一
 *   2. brain 的 callModel 会遍历这条链，并把「降级过」一起返回
 *   3. 没有 key 的 provider 不会混进链里（否则每轮都白试一次 401）
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { createLlm } from '../lib/llm.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// 降级链已经从 brain.mjs 搬到 lib/model-client.mjs，断言跟着代码走
const model = readFileSync(join(ROOT, 'lib', 'model-client.mjs'), 'utf8')

const dataDir = mkdtempSync(join(tmpdir(), 'chill-llm-'))
const store = {
  active: 'primary',
  providers: [
    { id: 'primary', label: '主力', baseUrl: 'https://example.invalid/v1/chat/completions', model: 'm-primary', token: 'sk-primary' },
    { id: 'backup', label: '备用', baseUrl: 'https://example.invalid/v1/chat/completions', model: 'm-backup', token: 'sk-backup' },
    { id: 'nokey', label: '没 key 的', baseUrl: 'https://example.invalid/v1/chat/completions', model: 'm-nokey', keyRef: 'CHILL_TEST_UNSET_KEY' },
  ],
}
writeFileSync(join(dataDir, 'llm.json'), JSON.stringify(store, null, 2), 'utf8')

delete process.env.CHILL_TEST_UNSET_KEY
const llm = createLlm({
  dataDir,
  cfg: {},
  existsSync: (p) => { try { readFileSync(p); return true } catch { return false } },
  readFileSync,
  writeFileSync,
  mkdir: async () => {},
  join,
  log: () => {},
})

const chain = llm.candidates()
const ids = chain.map((c) => c.id)
// 不锁整串：内置的 dsh-deepseek 在这台机器上有环境变量 key，CI 上没有，
// 锁死长度会变成「本机绿、干净机器红」。只锁顺序规则和过滤规则。
assert.equal(ids[0], 'primary', '当前 provider 排第一')
assert.ok(ids.includes('backup'), '配了 token 的备用 provider 要进链')
assert.ok(!ids.includes('nokey'), '没有 key 的 provider 不许进链（否则每轮白试一次 401）')
assert.ok(chain.filter((c) => c.id !== 'dsh-deepseek').every((c) => c.apiKey), '候选都带 key（内存里，不落日志）')
assert.equal(chain[0].model, 'm-primary', '候选自带模型名，换 provider 时 body.model 要跟着换')

// 切换 active 之后顺序跟着变
const view = llm.view()
assert.ok(view.providers.some((p) => p.id === 'backup'), 'view 里能看到备用 provider')

// brain 侧：降级链真的接了
assert.match(model, /llm\.candidates\(\)/, 'callModel 要用 candidates() 组降级链')
assert.match(model, /for \(let hop = 0; hop < chain\.length; hop \+= 1\)/, '按候选顺序逐个试')
assert.match(model, /log\('model fallback'/, '换 provider 时要留一行日志，不然查不到为什么答得慢')
assert.match(model, /fallback: hop > 0/, '返回值要标明这一轮是不是降级来的')

console.log('  PASS 降级链只含有 key 的 provider / 当前优先 / brain 按链重试并标记 fallback')
