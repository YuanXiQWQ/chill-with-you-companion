/**
 * 静态卫生：拦那些"语法通过、跑到某条分支才炸"的错。
 * 起因很具体：'require is not defined in ES module scope' 在本轮里犯了三次，
 * 每次都是 node --check 全绿、只在真正走到那行时才抛，测试还很可能不覆盖那行。
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const files = []
const walk = (dir, depth = 0) => {
  if (depth > 3) return
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'game') continue
    const full = join(dir, e.name)
    if (e.isDirectory()) { walk(full, depth + 1); continue }
    if (/\.(mjs|js)$/.test(e.name)) files.push(full)
  }
}
walk(ROOT)

let passed = 0
const check = (label, fn) => { fn(); passed += 1; console.log('  ok  ' + label) }

check('没有 ESM 里不能用的 require()（' + files.length + ' 个文件）', () => {
  const bad = []
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    // 只认「真的调用且参数是字面量」：lib/client.js 里 factory(require) 是加载器注入的形参，
    // 打印提示里 node -e "require('fs')" 是字符串，两者都不算违规。
    if (text.includes('__ModuleLoader__')) continue
    const hits = text.split('\n').filter((l) => /(?<!['"`\w.])require\s*\(\s*['"`][^'"`]+['"`]\s*\)/.test(l) && !/^\s*(\/\/|\*)/.test(l))
    if (hits.length) bad.push(relative(ROOT, f).replace(/\\/g, '/') + ': ' + hits[0].trim().slice(0, 70))
  }
  assert.deepEqual(bad, [], '这些文件在 ESM 里用了 require：\n  ' + bad.join('\n  '))
})

check('没有 CJS 时代的目录变量与导出写法', () => {
  // 模式串拼接出来，否则检查器会把源码里的字面量当成违规（这个错我犯过一次）
  const DIR = '__dir' + 'name'
  const EXPORTS = 'module' + '.exports'
  const reDir = new RegExp('(^|[^.\\w])' + DIR + '\\b')
  const bad = []
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    if (reDir.test(text) || text.includes(EXPORTS)) bad.push(relative(ROOT, f))
  }
  assert.deepEqual(bad, [])
})

check('package.json 的 files 覆盖了 tools/ 与 NOTICE.md', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8').replace(/^\uFEFF/, ''))
  const list = pkg.files || []
  assert.ok(list.includes('tools/'), 'files 缺 tools/：卸载、换钥、扫密钥都在里面')
  assert.ok(list.includes('NOTICE.md'), 'files 缺 NOTICE.md：资源来源声明要随包')
})

check('注册的路由没有重复（meta 描述表不算注册）', () => {
  // 路由从 2026-11-14 起分布在 brain.mjs 与 routes/*.mjs 两处，一起数，否则会误报"路由太少"
  const routeFiles = ['brain.mjs'].concat(
    readdirSync(join(ROOT, 'routes')).filter((f) => f.endsWith('.mjs')).map((f) => 'routes/' + f),
  )
  // 只取「登记进 webServer 的那一行」：同行没有 note: 的才是注册，
  // 带 note: 的是 /meta 的描述表，它不是注册，重复出现是正常的。
  const paths = routeFiles.flatMap((f) => readFileSync(join(ROOT, f), 'utf8').split('\n'))
    .filter((l) => /path:\s*'\/chill\/v1/.test(l) && !/note:/.test(l))
    .map((l) => l.match(/path:\s*'(\/chill\/v1[A-Za-z0-9_\/]*)'/)[1])
  assert.ok(paths.length >= 25, '路由太少：' + paths.length)
  const dupes = paths.filter((p, i) => paths.indexOf(p) !== i)
  assert.deepEqual([...new Set(dupes)], [], '同一个路径注册了两次：' + dupes.join(','))
})


// secrets.test.mjs 会临时在 test/ 下放一个假密钥文件来验证闸门本身抓得到它。
// 两条测试并行跑时，这里的扫描正好会撞上那个探针——只放过这一处，别的一律算失败。
function scanOrProbeOnly(args) {
  try {
    return execFileSync(process.execPath, [join(ROOT, 'tools/scan-secrets.mjs'), ...args],
      { encoding: 'utf8', timeout: 180000 })
  } catch (e) {
    const out = String(e.stdout || '')
    const stray = out.split('\n')
      .filter((l) => /^\s+\S+:\d+\s/.test(l) && !/_secret_probe\.txt/.test(l))
    assert.deepEqual(stray, [], '除临时探针外还有明文密钥：\n' + out)
    return out
  }
}

check('密钥闸门能跑，且工作树干净', () => {
  const out = scanOrProbeOnly([])
  assert.ok(/没有明文密钥|_secret_probe\.txt/.test(out), out)
})

check('密钥闸门 --history 能读 git 历史（不是静默跳过）', () => {
  const out = scanOrProbeOnly(['--history'])
  assert.ok(/没有明文密钥|_secret_probe\.txt/.test(out), out)
  assert.doesNotMatch(out, /历史读取失败/)
})

check('残留审计能跑（本机没配 key 时也应 exit 0）', () => {
  const out = execFileSync(process.execPath, [join(ROOT, "tools/audit-keys.mjs")], { encoding: "utf8", timeout: 180000 })
  assert.match(out, /密钥来源|意外残留/)
})
console.log('\nPASS ' + passed + ' hygiene checks')