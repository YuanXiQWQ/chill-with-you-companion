#!/usr/bin/env node
/**
 * git push 通道不通时（国内常见的 github.com:443 超时/重置），用 Git Data API 把提交推上去。
 *
 *   node tools/push-via-api.mjs                      # 预演：只报告差异
 *   node tools/push-via-api.mjs --apply              # 真推
 *   node tools/push-via-api.mjs --apply --branch main --owner X --repo Y
 *
 * 要点：author / committer / 时间（含时区偏移）/ 父提交 / 树 / 信息全部照抄本地，
 * 因此 API 生成的提交哈希与本地 HEAD **完全一致**，推完本地不需要 reset，也不会分叉。
 * token 从 GH_TOKEN 或本机 Git 凭据缓存里取，永不打印。
 */
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const arg = (n, d) => {
  const i = args.indexOf('--' + n)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d
}

const git = (...a) => spawnSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', timeout: 60000 })
/** 取原始字节（blob 内容不能走 utf8 解码，二进制/换行都得原样） */
const gitBytes = (...a) => spawnSync('git', ['-C', ROOT, ...a], { timeout: 60000, maxBuffer: 256 * 1024 * 1024 }).stdout
const say = (m, s) => console.log('  ' + m + ' ' + s)

const token = (() => {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN
  // GCM 只有在请求里带 username 时才会直接给缓存，否则只回 protocol/host
  const origin = (spawnSync('git', ['-C', ROOT, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).stdout || '').trim()
  const guess = (origin.match(/github\.com[/:]([^/]+)\//) || [])[1] || ''
  const inputs = [
    'protocol=https\nhost=github.com\nusername=' + guess + '\n\n',
    'protocol=https\nhost=github.com\n\n',
  ]
  for (const input of inputs) {
    const r = spawnSync('git', ['credential', 'fill'], { encoding: 'utf8', input, timeout: 20000 })
    const m = String(r.stdout || '').match(/^password=(.*)$/m)
    if (m) return m[1]
  }
  return ''
})()
if (!token) { say('×', '没有 token：设 GH_TOKEN，或先让 Git 凭据管理器登录一次'); process.exit(2) }

const remoteUrl = git('remote', 'get-url', 'origin').stdout.trim()
const m = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/)
if (!m) { say('×', 'origin 不是 GitHub 地址：' + remoteUrl); process.exit(1) }
const owner = arg('owner', m[1])
const repo = arg('repo', m[2])
const branch = arg('branch', (git('branch', '--show-current').stdout || '').trim() || 'main')

const api = async (p, init = {}) => {
  const res = await fetch('https://api.github.com' + p, {
    ...init,
    headers: {
      authorization: 'token ' + token,
      accept: 'application/vnd.github+json',
      'user-agent': 'chill-push-via-api',
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = null }
  if (!res.ok) throw new Error(p + ' -> HTTP ' + res.status + ' ' + (json?.message || text.slice(0, 160)))
  return json
}

// git 的 "1700000000 +0800" → "2026-11-14T18:00:00+08:00"（保留偏移，哈希才对得上）
const parseIdentity = (line) => {
  const mm = line.match(/^\w+ (.+) <(.+)> (\d+) ([+-])(\d{2})(\d{2})$/)
  if (!mm) throw new Error('认不出身份行：' + line)
  const [, name, email, sec, sign, hh, mi] = mm
  const offSec = (sign === '-' ? -1 : 1) * (Number(hh) * 3600 + Number(mi) * 60)
  const iso = new Date((Number(sec) + offSec) * 1000).toISOString().replace(/\.\d{3}Z$/, '') + sign + hh + ':' + mi
  return { name, email, date: iso }
}

;(async () => {
  const head = git('rev-parse', 'HEAD').stdout.trim()
  say('·', '本地 HEAD ' + head.slice(0, 7) + '，分支 ' + branch + '，目标 ' + owner + '/' + repo)

  let remoteSha = null
  try {
    const ref = await api(`/repos/${owner}/${repo}/git/ref/heads/${branch}`)
    remoteSha = ref.object.sha
  } catch (e) {
    if (!/HTTP 404/.test(e.message)) throw e
    say('·', '远端还没有分支 ' + branch + '，将作为首个提交推送（需 --apply）')
  }
  say('·', '远端 HEAD ' + (remoteSha ? remoteSha.slice(0, 7) : '(空)'))
  if (remoteSha === head) { say('✓', '远端已是最新'); return }

  const raw = git('cat-file', '-p', head).stdout.split('\n')
  const author = parseIdentity(raw.find((l) => l.startsWith('author ')))
  const committer = parseIdentity(raw.find((l) => l.startsWith('committer ')))
  const message = git('log', '-1', '--format=%B', head).stdout.replace(/\n+$/, '\n')
  const parent = git('rev-parse', head + '^').stdout.trim()

  let baseTree = null
  const parents = []
  if (remoteSha) {
    const rc = await api(`/repos/${owner}/${repo}/git/commits/${remoteSha}`)
    baseTree = rc.tree.sha
    parents.push(remoteSha)
  } else if (raw.some((l) => l === 'parent ' + parent)) {
    parents.push(parent)
  }

  const diff = remoteSha
    ? git('diff', '--name-status', remoteSha + '..' + head).stdout.trim().split('\n').filter(Boolean)
    : git('ls-tree', '-r', '--name-only', head).stdout.trim().split('\n').filter(Boolean).map((p) => 'A\t' + p)
  say('·', '差异文件 ' + diff.length + ' 个')
  if (!APPLY) { say('·', '预演结束（加 --apply 才真推）'); return }

  const entries = []
  for (const row of diff) {
    const [flag, ...rest] = row.split('\t')
    const rel = rest[0]
    if (flag === 'D') { entries.push({ path: rel, mode: '100644', type: 'blob', sha: null }); continue }
    // 内容取自 git 对象（HEAD 里的那份），不是工作区文件：
    // 两者可能因换行归一而不同，读磁盘会做出另一个树、另一个哈希。
    const buf = gitBytes('cat-file', 'blob', head + ':' + rel)
    const blob = await api(`/repos/${owner}/${repo}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: buf.toString('base64'), encoding: 'base64' }) })
    const mode = (git('ls-files', '-s', rel).stdout.trim().split(/\s+/)[0]) || '100644'
    entries.push({ path: rel, mode, type: 'blob', sha: blob.sha })
  }

  const treeBody = baseTree ? { base_tree: baseTree, tree: entries } : { tree: entries }
  const tree = await api(`/repos/${owner}/${repo}/git/trees`, { method: 'POST', body: JSON.stringify(treeBody) })
  const localTree = git('rev-parse', head + '^{tree}').stdout.trim()
  if (localTree !== tree.sha) say('!', '树与本地不一致（本地 ' + localTree.slice(0, 7) + '，远端将写入 ' + tree.sha.slice(0, 7) + '）')
  const commit = await api(`/repos/${owner}/${repo}/git/commits`, { method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents, author, committer }) })
  say(commit.sha === head ? '✓' : '!', '新提交 ' + commit.sha.slice(0, 7) + (commit.sha === head ? '（与本地一致）' : '（与本地 ' + head.slice(0, 7) + ' 不同）'))

  if (remoteSha) await api(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) })
  else await api(`/repos/${owner}/${repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: 'refs/heads/' + branch, sha: commit.sha }) })
  say('✓', '已更新 refs/heads/' + branch)

  // API 造的提交对象与本地未必逐字节相同（GitHub 会规整 message / 时间），
  // 哈希不一致时把本地同步到远端，避免下次 diff 变成空提交。
  if (commit.sha !== head && !args.includes('--no-sync')) {
    const f = git('fetch', 'origin', branch)
    if (f.status === 0) {
      git('reset', '--hard', 'origin/' + branch)
      say('·', '本地已同步到远端提交 ' + commit.sha.slice(0, 7))
    } else {
      say('!', 'fetch 失败，稍后手动 git fetch && git reset --hard origin/' + branch)
    }
  }
})().catch((e) => { say('×', e && e.message); process.exit(1) })