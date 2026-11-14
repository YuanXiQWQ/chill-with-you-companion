/**
 * 密钥扫描器的回归：**该抓的必须抓到**，不该抓的别误报。
 * 这个测试自己不能出现任何字面量凭据——否则扫描器会抓它自己，
 * 所以所有样本都用拼接构造。
 */
import assert from 'node:assert/strict'
import { writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCANNER = join(ROOT, 'tools', 'scan-secrets.mjs')
const PROBE = join(ROOT, 'test', '_secret_probe.txt')

const run = () => spawnSync(process.execPath, [SCANNER], { encoding: 'utf8' })
const scan = (content) => {
  writeFileSync(PROBE, content + '\n', 'utf8')
  try {
    return run()
  } finally {
    rmSync(PROBE, { force: true })
  }
}

let passed = 0
const check = (label, fn) => { fn(); passed += 1; console.log('  ok  ' + label) }

// 真凭据样本：拼接构造，避免本文件被自己扫出来
const SAMPLES = [
  ['Bearer 令牌', 'Authorization: Bearer ' + 'a'.repeat(26) + '012345'],
  ['AWS access key', 'AKIA' + 'IOSFODNN7EXAMPL' + 'E'],
  ['GitHub token', 'ghp_' + 'b'.repeat(30)],
  ['PEM 私钥头', '-----BEGIN ' + 'RSA PRIVATE' + ' KEY-----'],
  ['赋值式口令', 'password = "' + 'c'.repeat(28) + '"'],
  ['sk- 真格式', 'key=' + 'sk-' + 'd'.repeat(24)],
]

for (const [label, line] of SAMPLES) {
  check('抓得到：' + label, () => {
    const r = scan(line)
    assert.equal(r.status, 1, label + ' 漏报了（exit=' + r.status + '）\n' + r.stdout)
    assert.match(r.stdout, /_secret_probe\.txt/, '报告里该指明文件')
  })
}

check('放过占位符与测试桩', () => {
  const r = scan(['sk-' + 'test-1234', 'YOUR_API' + '_KEY_HERE', 'EXAMPLE' + '_KEY', 'sk-' + 'x'.repeat(6)].join('  '))
  assert.equal(r.status, 0, '占位符被误报了：\n' + r.stdout)
})

check('输出不回显密钥原文', () => {
  const secret = 'sk-' + 'e'.repeat(24)
  const r = scan('key=' + secret)
  assert.equal(r.status, 1)
  assert.equal(r.stdout.includes(secret), false, '把密钥原文打印出来了')
  assert.match(r.stdout, /…/, '该给指纹')
})

check('仓库当前是干净的', () => {
  const r = run()
  assert.equal(r.status, 0, '仓库里有明文密钥：\n' + r.stdout)
})

check('check-publish 已经接上这道门', () => {
  const src = readFileSync(join(ROOT, 'tools', 'check-publish.mjs'), 'utf8')
  assert.match(src, /scan-secrets\.mjs/, '发布体检里没有密钥闸门，等于没门')
})

console.log('\nPASS ' + passed + ' secret checks')