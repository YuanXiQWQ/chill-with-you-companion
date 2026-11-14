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
import { mkdtempSync, rmSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { pickBranch } = await import('../tools/gh-ref.mjs')
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

// 在指定仓库目录里跑工具（detached 用例要把工具搬进临时仓库，ROOT 才能落在那里）
const runToolAt = (toolPath, cwd, extra = []) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [toolPath, ...extra], {
      cwd,
      env: { ...process.env, CHILL_GH_API: api, GH_TOKEN: FAKE_TOKEN },
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
    // CI 的 actions/checkout 默认是浅克隆（--depth 1），浅历史推到裸仓库会被
    // "shallow update not allowed" 拒绝。允许它，测试才不挑环境。
    git('--git-dir', bare, 'config', 'receive.shallowUpdate', 'true')
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
    // PR 构建是 detached HEAD：工具把 HEAD 推到 main，本地也没有 main 分支，
    // 数提交数时本地这一侧要用 HEAD（用 main 只会得到空串，CI 上就是这么挂的）
    const cur = ((git('-C', ROOT, 'branch', '--show-current').stdout || '').trim())
    const expected = cur || 'main'
    const localRef = cur || 'HEAD'
    check('裸仓库收到 ' + expected, () => {
      const v = git('--git-dir', bare, 'rev-parse', '--verify', 'refs/heads/' + expected)
      assert.equal(v.status, 0, '远端没有 ' + expected + '：' + v.stderr)
    })
    check('远端提交数与原仓库一致', () => {
      const local = git('-C', ROOT, 'rev-list', '--count', localRef).stdout.trim()
      const remote = git('--git-dir', bare, 'rev-list', '--count', expected).stdout.trim()
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

  console.log('# PR 构建：detached HEAD（这条以前在 CI 上必挂）')
  {
    const det = join(tmp, 'detached')
    mkdirSync(join(det, 'tools'), { recursive: true })
    for (const f of ['gh-bootstrap.mjs', 'gh-ref.mjs']) copyFileSync(join(ROOT, 'tools', f), join(det, 'tools', f))
    copyFileSync(join(ROOT, 'package.json'), join(det, 'package.json'))
    const g = (...a) => spawnSync('git', ['-C', det, ...a], { encoding: 'utf8', timeout: T })
    g('init', '-q')
    g('add', '-A')
    g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'x')
    const detatched = g('checkout', '-q', '--detach')
    check('临时仓库已进入 detached HEAD', () => {
      assert.equal(detatched.status, 0, detatched.stderr)
      assert.equal((g('branch', '--show-current').stdout || '').trim(), '', 'detach 后分支名应为空')
    })

    const bare2 = join(tmp, 'remote2.git')
    git('init', '--bare', '-q', bare2)
    git('--git-dir', bare2, 'config', 'receive.shallowUpdate', 'true')
    const r = await runToolAt(join(det, 'tools', 'gh-bootstrap.mjs'), det, ['--apply', '--remote', bare2])
    check('detached 下不再报 src refspec does not match any', () => {
      assert.doesNotMatch(r.stdout + r.stderr, /src refspec/, '输出里还有 refspec 错误：' + r.stdout + r.stderr)
      assert.equal(r.status, 0, 'stdout=' + r.stdout + ' stderr=' + r.stderr)
    })
    check('detached 下裸仓库照样收到 main', () => {
      const v = git('--git-dir', bare2, 'rev-parse', '--verify', 'refs/heads/main')
      assert.equal(v.status, 0, '远端没有 main：' + r.stdout + r.stderr)
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