#!/usr/bin/env node
/**
 * 一条命令把"建库 + 推送 + 补描述"做完。
 *
 *   $env:GH_TOKEN = 'ghp_xxx'          # PAT，需要 repo 权限
 *   node tools/gh-bootstrap.mjs                      # 预演，只检查
 *   node tools/gh-bootstrap.mjs --apply               # 真建库并推送
 *
 * 也可以：node tools/gh-bootstrap.mjs --token ghp_xxx --apply
 *
 * 为什么要这个脚本：建库和推送都要鉴权，而鉴权既不能靠猜也不能靠提交到仓库。
 * 这里只从环境变量/参数读 token，永不打印、永不落盘。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const val = (n) => {
  const i = args.indexOf('--' + n)
  if (i < 0) return null
  const next = args[i + 1]
  return next && !next.startsWith('--') ? next : true
}
const APPLY = args.includes('--apply')
const TOKEN = (typeof val('token') === 'string' ? val('token') : '') || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ''
const NAME = typeof val('name') === 'string' ? val('name') : 'chill-with-you-companion'
const OWNER = typeof val('owner') === 'string' ? val('owner') : ''
const PRIVATE = args.includes('--private')
const DESC = '《放松时光：与你共享 Lo-Fi Story》的 AI 陪伴插件：DeepSeek 负责想，游戏只负责演'
const TOPICS = ['bepinex', 'unity-mod', 'deepseek', 'ai-companion', 'text-to-speech', 'chill-with-you']

const say = (mark, msg) => console.log('  ' + mark + ' ' + msg)
const git = (...a) => spawnSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' })

if (!TOKEN) {
  say('×', '没有 token。两种给法：')
  console.log("     $env:GH_TOKEN = 'ghp_xxx'   然后重跑；或 --token ghp_xxx")
  console.log('     权限勾 repo（经典 token）或 Fine-grained 的 Administration: Read and write')
  console.log('     地址：https://github.com/settings/tokens')
  process.exit(2)
}

const API_BASE = process.env.CHILL_GH_API || 'https://api.github.com'
const api = async (path, init = {}) => {
  const res = await fetch(API_BASE + path, {
    ...init,
    headers: {
      authorization: 'token ' + TOKEN,
      accept: 'application/vnd.github+json',
      'user-agent': 'chill-bootstrap',
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = null }
  return { status: res.status, json, text }
}

const branch = (git('branch', '--show-current').stdout || '').trim() || 'main'
if (!existsSync(join(ROOT, '.git'))) {
  say('×', '这里不是 git 仓库：' + ROOT)
  process.exit(1)
}
const dirty = (git('status', '--porcelain').stdout || '').trim()
if (dirty) say('!', '工作区有 ' + dirty.split('\n').length + ' 处未提交改动（推送前建议先提交）')

const me = await api('/user')
if (me.status !== 200) {
  say('×', 'token 无效或没权限：HTTP ' + me.status + ' ' + (me.json?.message || ''))
  process.exit(1)
}
const login = me.json.login
const owner = OWNER || login
say('✓', 'token 属于 ' + login + '（' + me.json.type + '）')
say('·', '目标仓库 ' + owner + '/' + NAME + '，分支 ' + branch + '，' + (PRIVATE ? '私有' : '公开'))

const found = await api('/repos/' + owner + '/' + NAME)
let repo = found.status === 200 ? found.json : null
if (repo) {
  say('·', '仓库已存在：' + repo.html_url)
} else if (!APPLY) {
  say('·', '会创建仓库（加 --apply 才执行）')
  process.exit(0)
} else {
  const body = { name: NAME, description: DESC, private: PRIVATE, has_issues: true, has_wiki: false }
  const created = owner === login
    ? await api('/user/repos', { method: 'POST', body: JSON.stringify(body) })
    : await api('/orgs/' + owner + '/repos', { method: 'POST', body: JSON.stringify(body) })
  if (created.status !== 201) {
    say('×', '建库失败 HTTP ' + created.status + '：' + (created.json?.message || created.text.slice(0, 120)))
    process.exit(1)
  }
  repo = created.json
  say('✓', '已创建 ' + repo.full_name)
}

if (!APPLY) process.exit(0)

// 推送：用 token 走一次性 URL，避免把凭据写进 .git/config
const REMOTE_OVERRIDE = typeof val('remote') === 'string' ? val('remote') : ''
const remoteUrl = REMOTE_OVERRIDE || ('https://x-access-token:' + TOKEN + '@github.com/' + owner + '/' + NAME + '.git')
const push = spawnSync('git', ['-C', ROOT, 'push', remoteUrl, branch + ':refs/heads/' + branch], {
  encoding: 'utf8',
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
})
if (push.status !== 0) {
  say('×', '推送失败：' + (push.stderr || push.stdout || '').trim().split('\n').slice(-2).join(' ').replace(/x-access-token:[^@]+@/g, 'x-access-token:***@'))
  process.exit(1)
}
say('✓', '已推送 ' + branch)
// 远端地址不带 token，落盘的那个是干净的
git('remote', 'remove', 'origin')
git('remote', 'add', 'origin', REMOTE_OVERRIDE || ('https://github.com/' + owner + '/' + NAME + '.git'))
git('branch', '--set-upstream-to=origin/' + branch, branch)

await api('/repos/' + owner + '/' + NAME + '/topics', {
  method: 'PUT',
  body: JSON.stringify({ names: TOPICS }),
  headers: { accept: 'application/vnd.github.mercy-preview+json' },
})
say('✓', '已补描述与 topics')
console.log('\n  ' + repo.html_url)
console.log('  CI 会在推上去后自动跑（.github/workflows/ci.yml，windows-latest）')