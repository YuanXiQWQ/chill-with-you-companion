/**
 * 宿主借凭据：pickDshCredential(ctx, keyRef)
 *
 * 契约（面板显示 key，出错时不给用户添乱）：
 *  - ctx.credentials 在 → 解析 keyRef（默认 DEEPSEEK_API_KEY），返回 { keyRef, value, source }
 *  - 服务不在 / resolve 抛错 / 返回空值 → null（侧车随后自行读 .credentials.yaml）
 *  - 空串绝不能当成"已配置"：那会让 health 谎报 true，用户以为配好了
 *  - 值只进内存与环境变量，不进日志
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pickDshCredential } from '../index.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FAKE = 'sk-' + 'test_not_a_real_key'
let passed = 0
const check = async (label, fn) => { await fn(); passed += 1; console.log('  ok  ' + label) }

// 一个只会返回固定值的宿主 ctx
const ctxWith = (resolve) => ({ get: (name) => (name === 'credentials' ? { resolve } : undefined) })

console.log('# 正常路径')
await check('借到值时返回 keyRef / value / source', async () => {
  const got = await pickDshCredential(ctxWith(async (ref) => ({ value: FAKE, source: 'dsh-store', ref })), 'DEEPSEEK_API_KEY')
  assert.deepEqual(got, { keyRef: 'DEEPSEEK_API_KEY', value: FAKE, source: 'dsh-store' })
})

await check('不传 keyRef 时默认 DEEPSEEK_API_KEY', async () => {
  let asked = ''
  const got = await pickDshCredential(ctxWith(async (ref) => { asked = ref; return { value: FAKE, source: 'env' } }))
  assert.equal(asked, 'DEEPSEEK_API_KEY')
  assert.equal(got.keyRef, 'DEEPSEEK_API_KEY')
})

await check('value 两边的空白会被去掉（env 里常带引号换行）', async () => {
  const got = await pickDshCredential(ctxWith(async () => ({ value: '  ' + FAKE + '\r\n', source: 'env' })))
  assert.equal(got.value, FAKE)
})

console.log('# 该放弃的时候必须放弃')
await check('空值当没配（不能返回空串）', async () => {
  assert.equal(await pickDshCredential(ctxWith(async () => ({ value: '', source: 'env' }))), null)
})

await check('只有空白的值也当没配', async () => {
  assert.equal(await pickDshCredential(ctxWith(async () => ({ value: '   \n', source: 'env' }))), null)
})

await check('resolve 抛异常 → null，不把异常抛给启动流程', async () => {
  assert.equal(await pickDshCredential(ctxWith(async () => { throw new Error('store offline') })), null)
})

await check('宿主没有 credentials 服务 → null', async () => {
  assert.equal(await pickDshCredential({ get: () => undefined }), null)
})

await check('ctx 是空对象 / null 也不崩', async () => {
  assert.equal(await pickDshCredential({}), null)
  assert.equal(await pickDshCredential(null), null)
})

await check('get 本身抛错也不崩', async () => {
  assert.equal(await pickDshCredential({ get: () => { throw new Error('no service host') } }), null)
})

console.log('# 不泄漏')
await check('借来的 key 只在日志里写 source，不写 value', () => {
  // 借 key 的那段代码住在 supervisor 里，日志也一起搬过去了；
  // 约束是「整个借 key 链路都不许把值写进日志」，所以两个文件连着看。
  const src = ['index.js', 'lib/sidecar-supervisor.js']
    .map((f) => readFileSync(join(ROOT, f), 'utf8'))
    .join('\n')
  assert.equal(/log\([^)]*cred\.value/.test(src), false, '日志里出现了 cred.value')
  assert.match(src, /source: cred\.source/)
})

console.log('# 与侧车的衔接')
await check('健康检查暴露 keySource，但不暴露值', () => {
  const src = readFileSync(join(ROOT, 'brain.mjs'), 'utf8')
  assert.match(src, /keySource:/)
  assert.equal(/keySource:\s*[^,\n]*apiKey\b/.test(src), false, 'keySource 里塞了 key 本身')
})

console.log('\nPASS ' + passed + ' host-key checks')