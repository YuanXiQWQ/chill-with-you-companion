/**
 * gh-bootstrap 的端到端回归：不起真的 GitHub，用本地 mock API + 本地裸仓库，
 * 把「查重 → 建库 → 推送 → 写 remote → 补 topics」整条链跑一遍。
 * 唯一没被覆盖的只剩"真 GitHub 是否接受这个 token"。
 *
 * 两条纪律（第一版踩过）：
 *  - 所有子进程都带 timeout，绝不允许无限等；
 *  - 任何断言失败都要先把 mock server 关掉、origin 还原，否则进程挂住不退出。
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOOL = join(ROOT, 'tools', 'gh-bootstrap.mjs')
const tmp = mkdtempSync(join(tmpdir(), 'chill-gh-'))
const bare = join(tmp, 'remote.git')
const T = 60000
const git = (...a) => spawnSync('git', a, { encoding: 'utf8', timeout: T })

const originBefore = (git('-C', ROOT, 'remote', 'get-url', 'origin').stdout || '').trim()
const state = { created: null, topics: null }

const server = http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
  const u = String(req.url || '')
  const body = (cb) => { let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => cb(b)) }
  if (u === '/user') return send(200, { login: 'tester', type: 'User' })
  if (u.endsWith('/topics') && req.method === 'PUT') return body((b) => { state.topics = JSON.parse(b || '{}'); send(200, state.topics) })
  if (u === '/repos/tester/chill-with-you-companion' && req.method === 'GET') {
    return state.created ? send(200, state.created) : send(404, { message: 'Not Found' })
  }
  if (u === '/user/repos' && req.method === 'POST') {
    return body((b) => {
      const p = JSON.parse(b || '{}')
      state.created = { full_name: 'tester/' + p.name, html_url: 'http://example.invalid/tester/' + p.name, clone_url: bare, private: p.private }
      send(201, state.created)
    })
  }
  send(404, { message: 'unexpected ' + req.method + ' ' + u })
})

let passed = 0
const check = (label, fn) => { fn(); passed++; console.log('  ok  ' + label) }
// 必须异步：mock server 跑在本进程里，spawnSync 会阻塞事件循环，
// 子进程的请求永远等不到应答（第一次改成 spawnSync 就是这么挂死的）。
// token 字符串运行时拼出来：源码里不能出现形如真实 token 的字面量，否则密钥闸门会（正确地）报红
const FAKE_TOKEN = 'ghp_' + 'fake_for_test_only_000000'
const runTool = (extra = [], token = FAKE_TOKEN) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [TOOL, ...extra], {
      cwd: ROOT,
      env: { ...process.env, CHILL_GH_API: api, GH_TOKEN: token },
    })
    let out = '', err = ''
    const timer = setTimeout(() => child.kill(), T)
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', (d) => { err += d.toString() })
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout: out, stderr: err }) })
  })

let api = ''
const main = async () => {
  assert.equal(git('init', '--bare', '-q', bare).status, 0, '建裸仓库失败')
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  api = 'http://127.0.0.1:' + server.address().port

  console.log('# 预演')
  {
    const r = await runTool([])
    check('预演 exit 0 且不建库不推送', () => {
      assert.equal(r.status, 0, 'stdout=' + r.stdout + ' stderr=' + r.stderr)
      assert.equal(state.created, null)
      assert.match(r.stdout, /会创建仓库/)
    })
  }

  console.log('# 真建 + 真推（指向本地裸仓库）')
  {
    const r = await runTool(['--apply', '--remote', bare])
    check('工具 exit 0', () => assert.equal(r.status, 0, 'stdout=' + r.stdout + ' stderr=' + r.stderr))
    check('API 建库被调用，名字与可见性正确', () => {
      assert.equal(state.created.full_name, 'tester/chill-with-you-companion')
      assert.equal(state.created.private, false)
    })
    check('裸仓库收到 main', () => {
      const v = git('--git-dir', bare, 'rev-parse', '--verify', 'refs/heads/main')
      assert.equal(v.status, 0, '远端没有 main：' + v.stderr)
    })
    check('远端提交数与原仓库一致', () => {
      const local = git('-C', ROOT, 'rev-list', '--count', 'main').stdout.trim()
      const remote = git('--git-dir', bare, 'rev-list', '--count', 'main').stdout.trim()
      assert.equal(remote, local)
    })
    check('.git/config 里没有 token', () => {
      const cfg = readFileSync(join(ROOT, '.git', 'config'), 'utf8')
      assert.equal(/x-access-token/.test(cfg), false)
    })
    check('topics 被补上', () => assert.ok(Array.isArray(state.topics?.names) && state.topics.names.length > 0))
    // await 不能写在 check 的同步回调里：先跑完再断言
    const again = await runTool(['--apply', '--remote', bare])
    check('幂等：再跑一次走"仓库已存在"', () => {
      assert.equal(again.status, 0, 'stdout=' + again.stdout + ' stderr=' + again.stderr)
      assert.match(again.stdout, /仓库已存在/)
    })
  }

  console.log('# 提示态')
  {
    const r = await runTool(['--apply'], '')
    check('没有 token：exit 2 且不建库', () => {
      assert.equal(r.status, 2, r.stdout + r.stderr)
      assert.match(r.stdout, /没有 token/)
    })
  }
}

let code = 0
try {
  await main()
  console.log('\nPASS ' + passed + ' gh-bootstrap checks')
} catch (e) {
  code = 1
  console.log('\nFAIL ' + passed + ' checks 通过后中断')
  console.log(String(e && e.message ? e.message : e))
} finally {
  await new Promise((r) => server.close(r)).catch(() => {})
  if (originBefore) git('-C', ROOT, 'remote', 'set-url', 'origin', originBefore)
  rmSync(tmp, { recursive: true, force: true })
  process.exit(code)
}