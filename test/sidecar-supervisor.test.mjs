// 侧车监护的单元测试。只碰不启动子进程的部分 —— start/recycle 会真的 spawn，
// 那是回归脚本（live-performance.ps1）该覆盖的，不是单测。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSidecarSupervisor } from '../lib/sidecar-supervisor.js'

const quiet = () => {}
function make(over = {}) {
  return createSidecarSupervisor({
    ctx: {},
    log: quiet,
    warn: quiet,
    servePath: 'D:/nonexistent/serve.mjs',
    here: 'D:/nonexistent/repo',
    port: 10723,
    rawConfig: {},
    appendLog: quiet,
    pickCredential: async () => null,
    ...over,
  })
}

test('初始状态：没起来、端口是首选值、没有 pid', () => {
  const sup = make()
  assert.equal(sup.ready, false)
  assert.equal(sup.port, 10723)
  assert.equal(sup.pid, null)
  assert.equal(sup.restartCount, 0)
})

test('state() 给反代和 admin 用的形状是稳定的', () => {
  const sup = make({
    // 端口可以来自调用方，state 必须把它报成 preferredPort 而不是混在 port 里
  })
  const s = sup.state()
  assert.equal(typeof s, 'object')
  assert.equal(s.ready, false)
  assert.equal(s.port, 10723)
  assert.equal(s.preferredPort, 10723)
  assert.equal(s.pid, null)
  assert.equal(s.restarts, 0)
})

test('stop() 在没有子进程时立即完成，不挂住', async () => {
  const sup = make()
  const t0 = Date.now()
  await sup.stop()
  assert.ok(Date.now() - t0 < 1000, 'stop 不该等 4 秒超时')
})

test('stop() 之后 start() 不再拉起任何东西', async () => {
  const calls = []
  const sup = make({ log: (...a) => calls.push(a) })
  await sup.stop()
  await sup.start('after-stop')
  // stopping 一旦置位就不再 spawn：日志里不该出现 starting sidecar
  assert.equal(calls.some((a) => String(a[0]).includes('starting sidecar')), false)
  assert.equal(sup.ready, false)
})

test('recycleSafe 永远返回 Promise，绝不抛出去', () => {
  const sup = make()
  // 只验证它会返回 thenable 而不是同步抛 —— 真换代由回归脚本覆盖
  let p
  assert.doesNotThrow(() => { p = sup.recycleSafe('unit-test-noop') })
  assert.equal(typeof p?.then, 'function')
  // 别让它真的去 spawn：立刻停掉（recycle 内部 await stopSidecar 后才会 spawn）
  void sup.stop()
})
