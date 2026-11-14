#!/usr/bin/env node
/**
 * 一条命令装完。
 *
 *   node tools/install.mjs --game "E:\SteamLibrary\steamapps\common\Chill with You Lo-Fi Story"
 *
 * 做的事：目录联接 → profile 声明依赖 → 游戏端 DLL 就位 → 逐项验收。
 * 全部可逆：--check 只看不动；profile 的 package.json 改之前先备份成 .bak-<时间戳>。
 *
 * 为什么不是手工步骤：装这个插件最容易翻车的三处（联接名字、bundles 没加、DLL 没拷）
 * 都是"漏一步就静默 404"，而症状不指向病因。让人照着文档敲四遍比让脚本敲一遍更容易错。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, lstatSync, statSync, symlinkSync, realpathSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { resolveToken } from '../lib/config.mjs'

const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf('--' + name)
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : null
}
const CHECK = flag('check') === true
const say = (ok, msg, detail) => console.log((ok ? '  ✓ ' : '  ✗ ') + msg + (detail ? '  ' + detail : ''))

// ---- 插件自身 ----
const pkg = JSON.parse(stripBom(readFileSync(join(ROOT, 'package.json'), 'utf8')))
const PKG = pkg.name
console.log('\n' + PKG + ' ' + pkg.version + '   ' + ROOT + '\n')

// ---- 游戏目录 ----
function findGame() {
  const given = flag('game') || process.env.CHILL_GAME_DIR
  if (given && typeof given === 'string' && existsSync(given)) return resolve(given)
  // ① 权威：Steam 的应用清单能直接给出安装目录名，比猜目录可靠
  const roots = []
  for (const drive of ['C', 'D', 'E', 'F', 'G']) {
    roots.push(drive + ':\\SteamLibrary', drive + ':\\Steam', drive + ':\\Program Files (x86)\\Steam', drive + ':\\Games\\SteamLibrary')
  }
  if (process.env.ProgramFiles) roots.push(join(process.env.ProgramFiles, 'Steam'))
  if (process.env['ProgramFiles(x86)']) roots.push(join(process.env['ProgramFiles(x86)'], 'Steam'))
  for (const root of roots) {
    const acf = join(root, 'steamapps', 'appmanifest_3548580.acf')
    if (!existsSync(acf)) continue
    const m = readFileSync(acf, 'utf8').match(/"installdir"\s+"([^"]+)"/)
    if (!m) continue
    const dir = join(root, 'steamapps', 'common', m[1])
    if (existsSync(dir)) return dir
  }
  // ② 兜底：按目录名找
  for (const root of roots) {
    const common = join(root, 'steamapps', 'common')
    if (!existsSync(common)) continue
    try {
      for (const name of readdirSync(common)) if (/^Chill With You/i.test(name)) return join(common, name)
    } catch { /* 没这个库 */ }
  }
  return ''
}

// Node 版本是硬门槛：<22 会在路径处理上炸，而报错不指向版本
const nodeMajor = Number(String(process.versions.node).split('.')[0])
if (nodeMajor < 22) {
  console.log('  ✗ Node ' + process.versions.node + ' 太旧，这个插件要 >= 22：https://nodejs.org')
  process.exit(2)
}

const GAME = findGame()
if (!GAME) {
  console.log('  没找到游戏本体。先装《放松时光：与你共享 Lo-Fi Story》（Steam appid 3548580），')
  console.log('  或用 --game "<游戏目录>" 指路。没有游戏，装完也验证不了她动不动。\n')
  process.exit(2)
}
const hasAssembly = existsSync(join(GAME, 'Chill With You_Data', 'Managed', 'Assembly-CSharp.dll'))
say(hasAssembly, '游戏目录', GAME)

// ---- profile ----
function findProfile() {
  const given = flag('profile')
  if (given && typeof given === 'string') {
    return /^[A-Za-z]:|^\//.test(given) ? resolve(given) : join(profilesBase(), given)
  }
  const env = String(process.env.DSH_PROFILE || '').trim()
  if (env) return join(profilesBase(), env)
  const base = profilesBase()
  if (!existsSync(base)) return ''
  const names = readdirSync(base).filter((n) => existsSync(join(base, n, 'package.json')))
  if (!names.length) return ''
  if (names.length === 1) return join(base, names[0])
  // 本机往往有多个 profile（web、测试版…）。选"已经装过本插件"的那个，
  // 其次选最近改过的那个，并把它名字打出来——默认命令不该因为多一个 profile 就罢工。
  const already = names.find((n) => {
    try {
      const raw = stripBom(readFileSync(join(base, n, 'package.json'), 'utf8'))
      return raw.includes(PKG) || raw.includes('"' + PKG + '"')
    } catch { return false }
  })
  if (already) return join(base, already)
  const newest = names
    .map((n) => ({ n, at: statSync(join(base, n, 'package.json')).mtimeMs }))
    .sort((a, b) => b.at - a.at)[0]
  if (names.length > 1) console.log('  · 有 ' + names.length + ' 个 profile，默认用最近改过的「' + newest.n + '」（换一个：--profile <名字>）')
  return join(base, newest.n)
}
function profilesBase() {
  return process.env.DSH_HOME ? join(process.env.DSH_HOME, 'profiles') : join(homedir(), '.dsh', 'profiles')
}

const PROFILE = findProfile()
if (!PROFILE) {
  console.log('\n  没找到 dsh 的 profile（' + profilesBase() + '）。先运行一次 dsh web，或用 --profile <名字> 指明。')
  process.exit(2)
}
say(true, 'profile', PROFILE)

// ---- 1) 目录联接 ----
const target = join(PROFILE, 'node_modules', PKG)
const norm = (v) => resolve(v).toLowerCase()
// Windows 的 junction 在 lstat 里 isSymbolicLink()=false、isDirectory()=true，
// 唯一可靠判据是 realpath 与自身路径不一致。用错判据的后果是把它当普通目录删掉。
let linkState = 'absent'
try {
  const st = lstatSync(target)
  let real = ''
  try { real = realpathSync(target) } catch { real = '' }
  linkState = st.isSymbolicLink() || (real && norm(real) !== norm(target)) ? 'link' : 'dir'
} catch { linkState = 'absent' }

if (linkState === 'link') {
  const real = norm(realpathSync(target))
  if (real === norm(ROOT)) say(true, '目录联接已就位', target)
  else {
    say(false, '联接指向别处', target + '  ->  ' + realpathSync(target))
    console.log('     先删掉它再跑一次： node -e "require(\'fs\').unlinkSync(process.argv[1])" "' + target + '"')
    process.exit(1)
  }
} else if (linkState === 'dir') {
  // 绝不删：这里面可能是整包拷贝的插件，也可能是别的东西。
  say(false, '同名普通目录已存在（不是联接）', target)
  console.log('     确认无用后手动移走，再跑一次本脚本。脚本不会删任何已存在的目录。')
  process.exit(1)
} else if (!CHECK) {
  mkdirSync(join(PROFILE, 'node_modules'), { recursive: true })
  symlinkSync(ROOT, target, process.platform === 'win32' ? 'junction' : 'dir')
  say(true, '已建立目录联接', target + '  ->  ' + ROOT)
} else {
  say(false, '需要建立目录联接（--check 未改动）', target)
}

// ---- 2) profile 声明依赖 ----
const profilePkgPath = join(PROFILE, 'package.json')
const rawProfile = readFileSync(profilePkgPath, 'utf8')
const profilePkg = JSON.parse(stripBom(rawProfile))
const wantDep = 'link:' + ROOT.replace(/\\/g, '/')
profilePkg.dependencies = profilePkg.dependencies || {}
profilePkg.dsh = profilePkg.dsh || {}
profilePkg.dsh.profile = profilePkg.dsh.profile || {}
if (!Array.isArray(profilePkg.dsh.profile.bundles)) profilePkg.dsh.profile.bundles = []

const hadDep = profilePkg.dependencies[PKG] === wantDep
const hadBundle = profilePkg.dsh.profile.bundles.includes(PKG)
if (!hadDep) profilePkg.dependencies[PKG] = wantDep
if (!hadBundle) profilePkg.dsh.profile.bundles.push(PKG)

if (hadDep && hadBundle) {
  say(true, 'profile 已声明依赖与 bundle', PKG)
} else if (CHECK) {
  say(false, 'profile 需要补：' + [!hadDep ? 'dependencies' : '', !hadBundle ? 'dsh.profile.bundles' : ''].filter(Boolean).join(' + ') + '（--check 未改动）')
} else {
  // 先备份：这个文件坏了整个 profile 起不来
  writeFileSync(profilePkgPath + '.bak-' + Date.now(), rawProfile, 'utf8')
  // 无 BOM：带 BOM 的 package.json 会让每次模型请求前的清单扫描直接失败
  writeFileSync(profilePkgPath, JSON.stringify(profilePkg, null, 2) + '\n', 'utf8')
  say(true, '已写入 profile 声明（原文件已备份）', [!hadDep ? 'dependencies' : '', !hadBundle ? 'bundles' : ''].filter(Boolean).join(' + '))
}

// ---- 3) 游戏端 DLL ----
const dllSrc = join(ROOT, 'game', 'ChillPerformer.dll')
const bep = join(GAME, 'BepInEx')
const dllDst = join(bep, 'plugins', 'ChillPerformer.dll')
if (!existsSync(bep)) {
  say(false, '游戏目录里没有 BepInEx', '先下载 https://github.com/BepInEx/BepInEx/releases 解压到游戏根目录')
} else if (!existsSync(dllSrc)) {
  say(false, '仓库里缺 game/ChillPerformer.dll')
} else {
  // 只比 size 会漏掉"同尺寸的新构建"：改了字符串常量很容易还是一样大
  let same = false
  if (existsSync(dllDst)) {
    const a = statSync(dllSrc); const b = statSync(dllDst)
    same = a.size === b.size && Math.abs(a.mtimeMs - b.mtimeMs) < 2000
  }
  if (!same && !CHECK) {
    mkdirSync(join(bep, 'plugins'), { recursive: true })
    copyFileSync(dllSrc, dllDst)
  }
  // --check 下没做就是没做，不能打 ✓
  say(same, same ? '游戏端 DLL 已是最新' : (CHECK ? '游戏端 DLL 需要更新（--check 未改动）' : '已拷入游戏端 DLL'), dllDst)
}

// ---- 3.5) 把本机 token 写进游戏端配置 ----
// 侧车从 2026-11-14 起不放行空 token，DLL 只认 BepInEx 配置里的 brain.Token。
// 少这一步的症状是「游戏里她一动不动，而 health 全绿」——装的时候顺手写掉。
{
  const cfgFile = join(bep, 'config', 'local.chill.performer.cfg')
  // 与插件同一条优先级：cordis.patch.yml 的 dataDir → CHILL_DATA_DIR → <仓库>/data
  const dataDir = (() => {
    let fromCfg = ''
    try {
      const y = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
      const m = y.match(/^\s*dataDir:\s*['"]?([^'"\r\n]+)['"]?\s*$/m)
      if (m) fromCfg = m[1].trim()
    } catch { /* 配置文件不在就按环境变量走 */ }
    return fromCfg || String(process.env.CHILL_DATA_DIR || '').trim() || join(ROOT, 'data')
  })()
  if (!existsSync(cfgFile)) {
    say(false, '配置还没生成，token 未同步', '先启动一次游戏让 BepInEx 生成 ' + cfgFile)
  } else {
    try {
      const token = resolveToken({ dataDir })
      const lines = readFileSync(cfgFile, 'utf8').split(/\r?\n/)
      let section = ''
      let wrote = false
      let already = false
      for (let i = 0; i < lines.length; i += 1) {
        const bare = lines[i].trim()
        const head = bare.match(/^\[(.+)\]$/)
        if (head) { section = head[1].trim(); continue }
        if (section !== 'brain' || !/^Token\s*=/i.test(bare)) continue
        if (bare.replace(/^Token\s*=\s*/i, '').trim() === token) { already = true; break }
        lines[i] = 'Token = ' + token
        wrote = true
        break
      }
      if (already) say(true, '游戏端 token 已是最新', cfgFile)
      else if (!wrote) say(false, '配置里没有 [brain] Token 行', cfgFile)
      else if (CHECK) say(false, '游戏端 token 需要写入（--check 未改动）', cfgFile)
      else {
        copyFileSync(cfgFile, cfgFile + '.bak-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14))
        writeFileSync(cfgFile, lines.join('\r\n'), 'utf8')   // 不带 BOM
        say(true, '已把本机 token 同步进游戏端配置', cfgFile)
      }
    } catch (error) {
      say(false, 'token 同步失败：' + String(error?.message || error))
    }
  }
}

// ---- 4) 收尾 ----
console.log('\n  接下来：重启 dsh web（新增 bundle 必须重启进程，刷新浏览器没用）')
console.log('  验收：curl http://127.0.0.1:10722/chill/v1/health')
console.log('  语音可选：不装 GPT-SoVITS 就自动纯字幕，其它功能不受影响\n')