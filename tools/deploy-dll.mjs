#!/usr/bin/env node
/**
 * 把仓库里的 game/ChillPerformer.dll 部署到 BepInEx/plugins，并按需处理游戏进程。
 *
 * 为什么需要它：csc 编译不需要游戏关，但**覆盖** plugins 里的 DLL 需要——文件被游戏进程
 * 映射住时报 `The requested operation cannot be performed on a file with a user-mapped
 * section open`。以前这件事靠人记得"先关游戏再构建"，结果就是仓库里的 DLL 和游戏里跑的
 * 那份悄悄分叉（doctor 的 versions 项会因此常年 warn）。
 *
 * 用法：
 *   node tools/deploy-dll.mjs                    # 只看：两份是否一致、游戏是否在跑
 *   node tools/deploy-dll.mjs --apply            # 一致就直接拷；游戏在跑则报错退出（不杀）
 *   node tools/deploy-dll.mjs --apply --restart  # 游戏在跑就先关、拷、再用 steam 拉起来
 *   node tools/deploy-dll.mjs --apply --restart --wait-idle 900
 *                                               # 等番茄钟/专注结束（最多 900 秒）再关
 *
 * 退出码：0 = 已就位；2 = 需要关游戏（没给 --restart）；3 = 等空闲超时；1 = 其它失败。
 */
import { readFileSync, copyFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = dirname(HERE)
const REPO_DLL = join(PLUGIN, 'game', 'ChillPerformer.dll')
const GAME = process.env.CHILL_GAME_DIR || 'E:/SteamLibrary/steamapps/common/Chill With You Lo-Fi Story'
const PLUGINS = join(GAME, 'BepInEx', 'plugins')
const INSTALLED = join(PLUGINS, 'ChillPerformer.dll')
const HOST = process.env.CHILL_HOST || 'http://127.0.0.1:10722'
const GAME_EXE = 'Chill With You'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes('--' + n)
const val = (n, d) => {
  const i = argv.indexOf('--' + n)
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d
}

const say = (s) => console.log('  ' + s)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function sizeOf(p) {
  try { return existsSync(p) ? statSync(p).size : -1 } catch { return -1 }
}

function sameBytes(a, b) {
  try {
    if (sizeOf(a) !== sizeOf(b) || sizeOf(a) < 0) return false
    return readFileSync(a).equals(readFileSync(b))
  } catch { return false }
}

/** 游戏进程在不在（按进程名；BepInEx 插件只有进程活着才会锁 DLL）。 */
function gamePids() {
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-Command',
      `Get-Process -Name '${GAME_EXE}' -ErrorAction SilentlyContinue | Where-Object { $_.StartTime } | ForEach-Object { $_.Id }`,
    ], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve([])
      resolve(String(stdout).split(/\s+/).filter(Boolean).map(Number))
    })
  })
}

async function busy() {
  try {
    const r = await fetch(HOST + '/chill/v1/health', { signal: AbortSignal.timeout(6000) })
    if (!r.ok) return null
    const j = await r.json()
    return {
      phase: j.state?.phase || '',
      pomoRunning: Boolean(j.state?.pomo?.running),
      remainMs: Number(j.state?.pomo?.remainMs) || 0,
      gameOnline: Boolean(j.gameOnline),
    }
  } catch { return null }
}

/** 她这会儿在忙吗：专注中、或番茄钟还在跑，都算。 */
function isBusy(h) {
  return Boolean(h && (h.pomoRunning || h.phase === 'focus'))
}

async function waitIdle(seconds) {
  const until = Date.now() + seconds * 1000
  let idleStreak = 0
  while (Date.now() < until) {
    const h = await busy()
    if (isBusy(h)) {
      idleStreak = 0
      const left = h.remainMs ? Math.round(h.remainMs / 60000) + ' 分钟' : '未知'
      say(`等她忙完：phase=${h.phase} 番茄钟剩 ${left}`)
    } else {
      idleStreak += 1
      say(`空闲采样 ${idleStreak}/2`)
      if (idleStreak >= 2) return true
    }
    await sleep(5000)
  }
  return false
}

function stopGame(pids) {
  return new Promise((resolve) => {
    if (!pids.length) return resolve(true)
    say('关闭游戏：' + pids.join(', '))
    execFile('powershell', ['-NoProfile', '-Command',
      pids.map((p) => `Stop-Process -Id ${p} -Force -ErrorAction SilentlyContinue`).join('; ') + '; Start-Sleep -Milliseconds 1500',
    ], { windowsHide: true }, () => resolve(true))
  })
}

function launchGame() {
  return new Promise((resolve) => {
    say('用 steam 拉起游戏（appid 3548580）')
    execFile('powershell', ['-NoProfile', '-Command', 'Start-Process "steam://rungameid/3548580"'],
      { windowsHide: true }, () => resolve(true))
  })
}

async function main() {
  say('仓库 DLL  ' + REPO_DLL + '  ' + sizeOf(REPO_DLL) + ' 字节')
  say('已装 DLL  ' + INSTALLED + '  ' + sizeOf(INSTALLED) + ' 字节')
  if (sizeOf(REPO_DLL) < 0) { say('✗ 仓库里没有 DLL，先构建'); process.exit(1) }
  if (sameBytes(REPO_DLL, INSTALLED)) { say('✓ 两份一致，无需部署'); process.exit(0) }

  const pids = await gamePids()
  say(pids.length ? '游戏在跑：PID ' + pids.join(', ') : '游戏没在跑')

  if (!flag('apply')) {
    say('只体检。加 --apply 才会拷；游戏在跑时还要 --restart（会关游戏）')
    process.exit(0)
  }

  if (pids.length && flag('wait-idle')) {
    const ok = await waitIdle(Number(val('wait-idle', 900)))
    if (!ok) { say('✗ 等空闲超时，没动游戏'); process.exit(3) }
    const again = await busy()
    if (isBusy(again)) { say('✗ 刚要看她又忙起来了（phase=' + again.phase + '），没动'); process.exit(3) }
  }

  if (pids.length) {
    if (!flag('restart')) {
      say('✗ 游戏在跑，DLL 被映射住，拷不进去。加 --restart 让它先关再拷（会打断当前这一局）')
      process.exit(2)
    }
    await stopGame(pids)
  }

  try {
    copyFileSync(REPO_DLL, INSTALLED)
  } catch (e) {
    say('✗ 拷贝失败：' + (e?.message || e))
    process.exit(1)
  }
  say('✓ 已拷贝 ' + sizeOf(INSTALLED) + ' 字节')

  if (!sameBytes(REPO_DLL, INSTALLED)) { say('✗ 拷完两份仍不一致'); process.exit(1) }
  say('✓ 校验一致')

  if (pids.length && flag('restart')) {
    await launchGame()
    say('游戏已重新拉起；进游戏后看 BepInEx/LogOutput.log 里有没有 facial -> / clip missing')
  }
  process.exit(0)
}

main()
