/**
 * 拉起的顺序是硬的：先真检测，再拉。
 *
 * 这几条测试锁的就是那个"关掉以后再也拉不起来"的现场：
 * 面板上的 running 来自带缓存的探针，游戏关掉后它还会继续报运行中，
 * 于是按钮置灰、点击也被提前 return 挡住。所以这里全部用**假进程表**驱动，
 * 不需要真的去开关游戏。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../lib/game.mjs'

const IMAGE = 'Chill With You.exe'

/** 假进程表 + 假 explorer：记录每次请求 Steam 的次数。 */
function rig(initial) {
  const box = { running: Boolean(initial), launches: [] }
  const execFileAsync = async (file, args) => {
    if (file === 'tasklist') {
      return {
        stdout: box.running ? `"${IMAGE}","12204","Console","1","1,234 K"\r\n` : '',
      }
    }
    if (file === 'explorer.exe') {
      box.launches.push(args[0])
      return { stdout: '' }
    }
    throw new Error('unexpected exec: ' + file)
  }
  return { box, execFileAsync }
}

test('游戏真在场景里：一次 URI 都不发', async () => {
  const { box, execFileAsync } = rig(true)
  const game = createGame({ image: IMAGE, execFileAsync })
  game.touch({ ok: true, scene: 'RoomScene' })
  const r = await game.launch({ waitMs: 30, gapMs: 10 })
  assert.equal(r.running, true)
  assert.equal(r.stale, false)
  assert.equal(box.launches.length, 0, '已经在跑就不该再请求 Steam')
  assert.match(r.note, /已经在跑/)
})

test('进程在但没心跳（标题界面/残影）：照样请求一次 Steam，并如实报 stale', async () => {
  const { box, execFileAsync } = rig(true)
  const game = createGame({ image: IMAGE, execFileAsync })
  // 没有 touch()：心跳为空 → 进程活着也算 stale
  const r = await game.launch({ waitMs: 30, gapMs: 10, attempts: 2 })
  assert.equal(box.launches.length, 2, '两轮都要发：不发就永远是"点不动也拉不起"')
  assert.equal(r.stale, true)
  assert.equal(r.running, true)
  assert.match(r.note, /带到前台/)
})

test('没在跑：先查一次，再拉，等到进程起来就返回 pid', async () => {
  const { box, execFileAsync } = rig(false)
  const game = createGame({ image: IMAGE, execFileAsync })
  const p = game.launch({ waitMs: 300, gapMs: 10, attempts: 1 })
  // 模拟 Steam 真的把进程拉起来了
  setTimeout(() => { box.running = true }, 60)
  const r = await p
  assert.equal(box.launches.length, 1)
  assert.equal(r.running, true)
  assert.equal(r.attempts, 1)
  assert.equal(r.pid, 12204, 'pid 要从进程表里读出来')
})

test('拉了但进程始终没起来：不谎报成功', async () => {
  const { box, execFileAsync } = rig(false)
  const game = createGame({ image: IMAGE, execFileAsync })
  const r = await game.launch({ waitMs: 40, gapMs: 10, attempts: 2 })
  assert.equal(box.launches.length, 2)
  assert.equal(r.ok, true)
  assert.equal(r.running, false)
  assert.match(r.note, /还没起来/)
})

test('stale 的口径：进程在 + 心跳陈旧', async () => {
  const { execFileAsync } = rig(true)
  const game = createGame({ image: IMAGE, execFileAsync })
  assert.equal(await game.stale(true), true, '没心跳就算 stale')
  game.touch({ ok: true })
  assert.equal(await game.stale(true), false, '有新鲜心跳就不 stale')
})
