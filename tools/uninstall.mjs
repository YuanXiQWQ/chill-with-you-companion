#!/usr/bin/env node
/**
 * 卸载：把安装时做的三件事逐一还原，**数据目录一个字不动**。
 *
 *   node tools/uninstall.mjs                       # 看要做什么（默认不动手）
 *   node tools/uninstall.mjs --apply               # 真卸
 *   node tools/uninstall.mjs --apply --game "<游戏目录>" --remove-dll
 *
 * 为什么卸载比安装更需要小心：安装最坏是多留一份东西，卸载最坏是**删掉不属于它的东西**。
 * 所以三条硬规矩：
 *   1) 只删"确认是本仓库的目录联接"，判据是 realpath 指回本仓库；
 *   2) 绝不递归删目录，联接用 unlink/rmdir 摘链，目标目录不受影响；
 *   3) 数据目录（记忆 / 状态 / llm.json / 语音缓存）永不碰，只打印位置和手动删法。
 */
import { existsSync, readFileSync, writeFileSync, lstatSync, statSync, unlinkSync, rmdirSync, realpathSync, rmSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf('--' + name)
  if (i < 0) return null
  const next = args[i + 1]
  return next && !next.startsWith('--') ? next : true
}
const APPLY = flag('apply') === true
const REMOVE_DLL = flag('remove-dll') === true
const norm = (v) => resolve(v).toLowerCase()
const say = (kind, msg, detail) => {
  const mark = { ok: '✓', todo: '·', skip: '·', warn: '!', bad: '✗' }[kind] || '·'
  console.log('  ' + mark + ' ' + msg + (detail ? '  ' + detail : ''))
}

const pkg = JSON.parse(stripBom(readFileSync(join(ROOT, 'package.json'), 'utf8')))
const PKG = pkg.name
console.log('\n卸载 ' + PKG + ' ' + pkg.version)
console.log(APPLY ? '模式：真的动手\n' : '模式：只看不动（加 --apply 才执行）\n')

// ---------- 1. profile 声明 ----------
function profilesBase() {
  return process.env.DSH_HOME ? join(process.env.DSH_HOME, 'profiles') : join(homedir(), '.dsh', 'profiles')
}
function pickProfile() {
  const given = flag('profile')
  if (given && typeof given === 'string') return /^[A-Za-z]:|^\//.test(given) ? resolve(given) : join(profilesBase(), given)
  const env = String(process.env.DSH_PROFILE || '').trim()
  if (env) return join(profilesBase(), env)
  const base = profilesBase()
  if (!existsSync(base)) return ''
  const hits = []
  for (const name of readdirSafe(base)) {
    const file = join(base, name, 'package.json')
    if (!existsSync(file)) continue
    const raw = stripBom(readFileSync(file, 'utf8'))
    if (raw.includes(PKG)) hits.push(join(base, name))
  }
  return hits.length ? hits[0] : ''
}
function readdirSafe(dir) {
  try { return existsSync(dir) ? readdirSync(dir) : [] } catch { return [] }
}

const PROFILE = pickProfile()
if (!PROFILE) {
  say('warn', '没有找到引用本插件的 profile', '已挂载的话用 --profile <名字> 指明')
} else {
  say('ok', 'profile', PROFILE)
  const file = join(PROFILE, 'package.json')
  if (!existsSync(file)) {
    say('warn', 'profile 里没有 package.json', file)
  } else {
    const raw = readFileSync(file, 'utf8')
    let json = null
    try { json = JSON.parse(stripBom(raw)) } catch (error) {
      say('bad', 'package.json 解析失败，不动它', String(error.message || error))
    }
    if (json) {
      const hadDep = json.dependencies && Object.prototype.hasOwnProperty.call(json.dependencies, PKG)
      const bundles = json.dsh && json.dsh.profile && Array.isArray(json.dsh.profile.bundles) ? json.dsh.profile.bundles : []
      const hadBundle = bundles.includes(PKG)
      if (!hadDep && !hadBundle) {
        say('skip', 'profile 里已经没有本插件的声明')
      } else if (!APPLY) {
        say('todo', '会从 profile 摘掉', [!hadDep ? '' : 'dependencies', !hadBundle ? '' : 'dsh.profile.bundles'].filter(Boolean).join(' + '))
      } else {
        if (hadDep) delete json.dependencies[PKG]
        if (hadBundle) json.dsh.profile.bundles = bundles.filter((b) => b !== PKG)
        // 先备份：这个文件坏了整个 profile 起不来
        writeFileSync(file + '.bak-' + Date.now(), raw, 'utf8')
        // 不带 BOM：带 BOM 的 package.json 会让每个模型请求前的清单扫描直接失败
        writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
        say('ok', '已从 profile 摘掉声明（原文件已备份）')
      }
    }
  }
}

// ---------- 2. 目录联接 ----------
if (PROFILE) {
  const link = join(PROFILE, 'node_modules', PKG)
  let state = 'absent'
  let real = ''
  try {
    const st = lstatSync(link)
    try { real = realpathSync(link) } catch { real = '' }
    // Windows 的 junction 在 lstat 里 isSymbolicLink()=false、isDirectory()=true，
    // 唯一可靠判据是 realpath 与自身路径不一致。反过来的错误同样致命：把普通目录当联接摘掉。
    state = st.isSymbolicLink() || (real && norm(real) !== norm(link)) ? 'link' : 'dir'
  } catch { state = 'absent' }

  if (state === 'absent') {
    say('skip', '目录联接已经不存在')
  } else if (state === 'dir') {
    say('bad', '同名普通目录，不是联接，不删', link)
    console.log('     这多半是当初整包拷贝进去的旧装法。确认无用后自己删，脚本不会碰它。')
  } else if (norm(real) !== norm(ROOT)) {
    say('bad', '联接指向别处，不删', link + '  ->  ' + real)
    console.log('     它连的不是本仓库，删了可能连带别人的东西。')
  } else if (!APPLY) {
    say('todo', '会摘掉目录联接（只摘链，仓库目录不受影响）', link)
  } else {
    // 只摘链：unlink 对 junction/symlink 都成立；失败再退 rmdir。绝不 recursive。
    try { unlinkSync(link) } catch { try { rmdirSync(link) } catch (error) { say('bad', '摘链失败', String(error.message || error)) } }
    say('ok', '已摘掉目录联接（仓库目录完好）', existsSync(join(ROOT, 'package.json')) ? '仓库仍在 ' + ROOT : '')
  }
}

// ---------- 3. 游戏端 DLL ----------
const GAME = (typeof flag('game') === 'string' ? resolve(flag('game')) : '') || (process.env.CHILL_GAME_DIR || '')
if (!GAME) {
  say('skip', '没给游戏目录，游戏端 DLL 保留', '要一起删：--game "<游戏目录>" --remove-dll')
} else {
  const dll = join(GAME, 'BepInEx', 'plugins', 'ChillPerformer.dll')
  if (!existsSync(dll)) {
    say('skip', '游戏端没有 ChillPerformer.dll', dll)
  } else if (!REMOVE_DLL) {
    say('todo', '游戏端 DLL 还在（加 --remove-dll 才删）', dll)
  } else if (!APPLY) {
    say('todo', '会删掉游戏端 DLL', dll)
  } else {
    const size = statSync(dll).size
    try {
      rmSync(dll, { force: true })
      say('ok', '已删掉游戏端 DLL', size + ' bytes')
    } catch (error) {
      say('bad', '删 DLL 失败', String(error.message || error))
    }
  }
}

// ---------- 4. 数据目录：永不碰 ----------
const dataDir = (typeof flag('data-dir') === 'string' ? resolve(flag('data-dir')) : '') || process.env.CHILL_DATA_DIR || join(ROOT, 'data')
console.log('\n  数据目录（**没有动过**）：' + dataDir)
if (existsSync(dataDir)) {
  const keep = ['memory', 'state.json', 'llm.json', 'characters', 'voices', 'audio']
  const present = keep.filter((n) => existsSync(join(dataDir, n)))
  if (present.length) console.log('    里面有：' + present.join('、') + '（记忆 / 好感度 / 明文 token 都在这里）')
  console.log('    确认不要了再自己删：Remove-Item -Recurse -Force "' + dataDir + '"')
} else {
  console.log('    这个目录不存在（从没跑过，或者你已经把它指到别处了）')
}

console.log('\n  卸载后：重启 dsh web 才会真的把它从进程里摘掉（刷新浏览器没用）')
console.log('  想装回来：node tools/install.mjs --game "<游戏目录>"\n')