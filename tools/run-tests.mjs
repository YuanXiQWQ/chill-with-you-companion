/**
 * 跑 test/ 下的全部 *.mjs，按文件名顺序，逐个独立进程。
 *
 * 为什么要有这层：`npm test` 以前手写了两条命令，加了第三个测试就忘了补，
 * 于是本地绿、CI 红（或者反过来）。这里遍历目录，不再有"忘了加"的可能。
 *
 * 用法：node tools/run-tests.mjs [过滤子串]
 */
import { readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const HERE = fileURLToPath(new URL('..', import.meta.url))
const TEST_DIR = join(HERE, 'test')
const filter = process.argv[2] || ''

const all = (await readdir(TEST_DIR)).filter((f) => f.endsWith('.mjs')).sort()
const files = filter ? all.filter((f) => f.includes(filter)) : all
if (!files.length) {
  console.error('没有匹配的测试文件' + (filter ? '：' + filter : ''))
  process.exit(1)
}

const run = (file) =>
  new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(process.execPath, [join(TEST_DIR, file)], { cwd: HERE, stdio: 'inherit' })
    child.on('error', (error) => resolve({ file, code: -1, ms: 0, error: String(error?.message || error) }))
    child.on('exit', (code, signal) => resolve({ file, code: code === null ? -1 : code, signal, ms: Date.now() - started }))
  })

const failed = []
for (const file of files) {
  console.log('\n--- ' + file + ' ---')
  const r = await run(file)
  if (r.code !== 0) failed.push({ ...r, file })
}

const total = files.length
console.log('\n' + '='.repeat(48))
if (!failed.length) {
  console.log('全部通过：' + total + ' 个测试文件')
  process.exit(0)
}
console.log('失败 ' + failed.length + ' / ' + total + '：')
for (const f of failed) {
  console.log('  ' + f.file + '  exit=' + f.code + (f.signal ? ' signal=' + f.signal : '') + (f.error ? ' ' + f.error : ''))
}
process.exit(1)
