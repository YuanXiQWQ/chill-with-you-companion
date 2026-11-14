// 回归测试：lib/work.mjs 的 watchLoop → settleTurn 路径不许抛未捕获异常。
//
// 为什么用它而不是 node --check：事故二（2026-11-13 21:35）的 `watchAcc is not defined`
// 语法完全合法，只在实际跑完一轮时才炸，而炸在 `void settleTurn()` 里就等于整个 dsh 下课。
//
// 断言不只看"没抛错"，还看 ambientText() 里出现了「一共过了 N 轮」——
// 那证明真的执行到了崩溃点（settleTurn → touchSnap），不是空跑通过。
//
// 跑法：node test/work-watch.verify.mjs      （或 npm test）
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const target = pathToFileURL(process.env.WORK_MJS || join(HERE, '..', 'lib', 'work.mjs')).href
const { createWork } = await import(target)

const rejections = []
process.on('unhandledRejection', (e) => rejections.push(String((e && e.message) || e)))

const frame = (event) => ({ type: 'event', event })
const frames = [
  frame({ type: 'turn/start', data: { turn: 1 } }),
  frame({ type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: '帮我把这个脚本跑一下' }] } }),
  frame({ type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: {} } }),
  frame({ type: 'tool/call', data: { turn: 1, step: 2, callId: 'c2', name: 'read_file', arguments: {} } }),
  frame({ type: 'assistant/message', data: { turn: 1, step: 3, message: { role: 'assistant', content: [{ type: 'text', text: '好了，跑完了。' }] } } }),
  frame({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }),
]

let followCalls = 0
async function* streamOnce() {
  for (const f of frames) yield f
}

const controller = {
  follow: async () => {
    followCalls += 1
    if (followCalls > 1) {
      // 第二轮故意挂住：让 watchLoop 停在这里，不干扰断言
      await new Promise(() => {})
    }
    return streamOnce()
  },
  inspect: async () => ({ meta: {}, inheritedEventCount: 0, events: [] }),
}

const work = createWork({
  dir: mkdtempSync(join(tmpdir(), 'chill-work-test-')),
  getController: () => controller,
  observe: async () => ({ ok: true, speak: false }),
  log: () => {},
})

await work.bind('sess-test-1', '测试会话')
// settleTurn 是即发即忘的，给它一点时间
await new Promise((r) => setTimeout(r, 600))

const ambient = work.ambientText()
work.stopWatch()
await new Promise((r) => setTimeout(r, 100))

console.log('follow 被调用次数:', followCalls)
console.log('unhandledRejection 数量:', rejections.length)
if (rejections.length) for (const r of rejections) console.log('  !', r)
console.log('ambientText:', ambient ? ambient.slice(0, 120) : '(空)')

const reachedSettleTurn = /一共过了 1 轮/.test(ambient)
const pass = rejections.length === 0 && reachedSettleTurn
console.log('\n结论: 走到 settleTurn = ' + reachedSettleTurn + ' / 无未捕获拒绝 = ' + (rejections.length === 0))
console.log(pass ? 'PASS  watchLoop → settleTurn 不再抛异常' : 'FAIL')
process.exit(pass ? 0 : 1)
