/**
 * 卸载脚本的回归：安装最坏是多留东西，卸载最坏是删掉不属于它的东西。
 * 每条断言都对着这两件事：该摘的摘干净，不该碰的一根毫毛都不动。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync, realpathSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8').replace(/^\uFEFF/, '')).name
const SCRIPT = join(ROOT, 'tools', 'uninstall.mjs')

const home = mkdtempSync(join(tmpdir(), 'chill-uninst-'))
const profile = join(home, 'profiles', 'probe')
const nm = join(profile, 'node_modules')
const link = join(nm, PKG)
mkdirSync(nm, { recursive: true })

const writeProfile = (withDep = true, withBundle = true) => {
  const json = { name: 'probe-profile', dependencies: {}, dsh: { profile: { bundles: [] } } }
  if (withDep) json.dependencies[PKG] = 'file:' + ROOT
  if (withBundle) json.dsh.profile.bundles = ['other-bundle', PKG]
  // 不带 BOM：带 BOM 的 package.json 会让清单扫描直接失败
  writeFileSync(join(profile, 'package.json'), JSON.stringify(json, null, 2) + '\n', 'utf8')
  return json
}
writeProfile()
symlinkSync(ROOT, link, 'junction')
const dataDir = join(home, 'data')
mkdirSync(dataDir, { recursive: true })
writeFileSync(join(dataDir, 'state.json'), '{"affection":42,"keep":"me"}', 'utf8')

const run = (...extra) =>
  spawnSync(process.execPath, [SCRIPT, ...extra], {
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: home, DSH_PROFILE: 'probe', CHILL_DATA_DIR: dataDir },
  })
const isJunction = (p) => {
  try { return realpathSync(p) !== p } catch { return false }
}
const readPkg = () => JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8').replace(/^\uFEFF/, ''))

let passed = 0
const check = (label, fn) => {
  fn()
  passed += 1
  console.log('  ok  ' + label)
}

console.log('# 只看不动')
{
  const r = run()
  check('默认不执行，退出码 0', () => assert.equal(r.status, 0))
  check('联接还在', () => assert.ok(existsSync(link)))
  check('profile 声明还在', () => assert.ok(readPkg().dependencies[PKG]))
  check('输出里说明了会做什么', () => assert.match(r.stdout, /会摘掉目录联接|会从 profile 摘掉/))
}

console.log('# 真卸')
{
  const r = run('--apply')
  check('退出码 0', () => {
    assert.equal(r.status, 0, r.stdout + r.stderr)
  })
  check('目录联接被摘掉', () => assert.equal(existsSync(link), false))
  check('仓库本身完好（只摘链，不递归删）', () => assert.ok(existsSync(join(ROOT, 'package.json'))))
  const pkg = readPkg()
  check('dependencies 里没有本插件了', () => assert.equal(Object.prototype.hasOwnProperty.call(pkg.dependencies, PKG), false))
  check('bundles 里没有本插件了，别的 bundle 保留', () => {
    assert.deepEqual(pkg.dsh.profile.bundles, ['other-bundle'])
  })
  check('原 profile 已备份', () => {
    const found = readFileSync(join(profile, 'package.json'), 'utf8')
    assert.ok(existsSync(join(profile, 'package.json')))
    assert.ok(readdirSync(profile).some((f) => f.startsWith('package.json.bak-')))
    assert.ok(found.length > 0)
  })
  check('数据目录一个字节没动', () => {
    assert.equal(readFileSync(join(dataDir, 'state.json'), 'utf8'), '{"affection":42,"keep":"me"}')
  })
}

console.log('# 幂等')
{
  const r = run('--apply')
  check('再跑一次仍是 0，且不报错', () => assert.equal(r.status, 0, r.stdout + r.stderr))
  check('说的是"已经不存在"', () => assert.match(r.stdout, /已经不存在|已经没有本插件的声明/))
}

console.log('# 不该碰的三类')
{
  // ① 同名普通目录（旧装法整包拷贝进来）
  mkdirSync(link, { recursive: true })
  writeFileSync(join(link, 'i-am-not-a-link.txt'), 'x', 'utf8')
  const r1 = run('--apply')
  check('同名普通目录不删，只提示', () => {
    assert.ok(existsSync(join(link, 'i-am-not-a-link.txt')))
    assert.match(r1.stdout, /不是联接，不删/)
  })
  rmSync(link, { recursive: true, force: true })

  // ② 联接指向别处
  const other = mkdtempSync(join(tmpdir(), 'chill-other-'))
  writeFileSync(join(other, 'package.json'), '{"name":"别人的包"}', 'utf8')
  symlinkSync(other, link, 'junction')
  const r2 = run('--apply')
  check('指向别处的联接不删', () => {
    assert.ok(existsSync(link))
    assert.ok(existsSync(join(other, 'package.json')))
    assert.match(r2.stdout, /指向别处，不删/)
  })
  rmSync(link, { force: true })
  writeProfile()
}

console.log('# 游戏端 DLL')
{
  const game = mkdtempSync(join(tmpdir(), 'chill-game-'))
  mkdirSync(join(game, 'BepInEx', 'plugins'), { recursive: true })
  const dll = join(game, 'BepInEx', 'plugins', 'ChillPerformer.dll')
  writeFileSync(dll, 'MZfake', 'utf8')
  symlinkSync(ROOT, link, 'junction')

  check('不给 --remove-dll 就留着', () => {
    const r = run('--apply', '--game', game)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.ok(existsSync(dll))
    assert.match(r.stdout, /加 --remove-dll 才删/)
  })
  check('给了 --remove-dll 才删', () => {
    const r = run('--apply', '--game', game, '--remove-dll')
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.equal(existsSync(dll), false)
  })
  check('没给游戏目录时不会瞎猜', () => {
    writeFileSync(dll, 'MZfake', 'utf8')
    const r = run('--apply')
    assert.ok(existsSync(dll))
    assert.match(r.stdout, /没给游戏目录/)
  })
}

console.log('\nPASS ' + passed + ' uninstall checks')
rmSync(home, { recursive: true, force: true })