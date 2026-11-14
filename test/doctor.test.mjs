/**
 * doctor 的输出是对外契约：字段名一改，agent 侧就要跟着改。
 * 这个测试只盯三件事，不测具体检查项（那会随环境变）：
 *
 * 1. `--json` 必须能被 JSON.parse，且 schema 版本、必备 check id 齐全；
 * 2. 状态取值只能是 pass / warn / fail / skip，summary 不能为空；
 * 3. `ok` 与 `counts.fail` 必须自洽，且**输出里不许出现 token 明文**。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOOL = join(ROOT, 'tools', 'doctor.mjs')
const tmp = mkdtempSync(join(tmpdir(), 'chill-doctor-'))
const dataDir = join(tmp, 'data')
mkdirSync(dataDir, { recursive: true })
// 埋一个显眼的假 token：它绝不该出现在任何输出里
const FAKE = 'tok_' + 'doctor_must_not_echo_me'
writeFileSync(join(dataDir, 'token'), FAKE + '\n', 'utf8')

let passed = 0
const check = (label, fn) => {
  fn()
  passed += 1
  console.log('  ok  ' + label)
}

const run = () =>
  spawnSync(process.execPath, [TOOL, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
    // 端口指到几乎肯定没人监听的高位：别让测试撞上本机正在跑的侧车
    env: { ...process.env, CHILL_DATA_DIR: dataDir, CHILL_HOST_PORT: '59991', CHILL_BRAIN_PORT: '59992', CHILL_GAME_DIR: join(tmp, 'no-game') },
  })

try {
  const r = run()
  let out = null
  check('--json 输出能解析', () => {
    assert.equal(r.error, undefined, String(r.error))
    out = JSON.parse(r.stdout)
  })

  check('schema 版本固定为 1', () => {
    assert.equal(out.tool.schema, 1, 'schema 变了就要同步改 agent 侧解析')
    assert.equal(out.tool.name, 'chill-doctor')
  })

  check('必备 check id 齐全', () => {
    const ids = out.checks.map((c) => c.id)
    for (const need of ['runtime', 'repo', 'dataDir', 'game', 'bepinex', 'tokenSync', 'sidecar', 'host', 'key', 'voice']) {
      assert.ok(ids.includes(need), '缺 check: ' + need + '（现有 ' + ids.join(',') + '）')
    }
    assert.equal(new Set(ids).size, ids.length, 'check id 有重复')
  })

  check('状态取值合法且 summary 非空', () => {
    for (const c of out.checks) {
      assert.ok(['pass', 'warn', 'fail', 'skip'].includes(c.status), '非法状态 ' + c.status + ' @' + c.id)
      assert.ok(String(c.summary || '').trim().length > 0, 'summary 为空 @' + c.id)
      if (c.fix) assert.ok(Array.isArray(c.fix) && c.fix.every((f) => typeof f.cmd === 'string' && f.cmd.trim()), 'fix 必须是 {cmd, why} 数组 @' + c.id)
    }
  })

  check('ok 与 counts 自洽，退出码跟着 ok', () => {
    const fails = out.checks.filter((c) => c.status === 'fail').length
    assert.equal(out.ok, fails === 0, 'ok 与 fail 数量矛盾')
    assert.equal(r.status, out.ok ? 0 : 1, '退出码应等于 ok ? 0 : 1')
  })

  check('next 只由 fail / warn 的 fix 组成', () => {
    const src = new Set(out.checks.filter((c) => c.status === 'fail' || c.status === 'warn').map((c) => c.id))
    for (const n of out.next) assert.ok(src.has(n.for), 'next 里混进了通过项的 id: ' + n.for)
    assert.ok(Array.isArray(out.next))
  })

  check('输出里没有 token 明文', () => {
    assert.equal(r.stdout.includes(FAKE), false, 'token 被输出泄漏了')
    assert.equal(r.stderr.includes(FAKE), false, 'token 从 stderr 泄漏了')
  })

  check('--out 落盘与 stdout 同构', () => {
    const file = join(tmp, 'doctor.json')
    const r2 = spawnSync(process.execPath, [TOOL, '--json', '--out', file], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, CHILL_DATA_DIR: dataDir, CHILL_HOST_PORT: '59991', CHILL_BRAIN_PORT: '59992', CHILL_GAME_DIR: join(tmp, 'no-game') },
    })
    assert.equal(r2.error, undefined, String(r2.error))
    const fromFile = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(fromFile.tool.schema, out.tool.schema)
    assert.deepEqual(fromFile.checks.map((c) => c.id), out.checks.map((c) => c.id))
  })

  console.log('\n  PASS ' + passed + ' doctor checks')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
