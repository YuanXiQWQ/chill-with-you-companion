#!/usr/bin/env node
/**
 * 全链路自检：一条命令问清楚「现在到底哪一层没通电」。
 *
 *   node tools/doctor.mjs                 # 人看：逐项 ✓ / ! / ×，末尾给下一步
 *   node tools/doctor.mjs --json          # 机器看：单行 JSON，agent 直接解析
 *   node tools/doctor.mjs --json --out x.json
 *   node tools/doctor.mjs --game "<游戏目录>"
 *
 * 设计原则（写给后来者，也是为了 agent 能靠它决策）：
 *
 * 1. **只读**。不生成 token、不写配置、不改 dll。要动手的命令放在 `fix[].cmd` 里，
 *    由人或有权限的 agent 自己执行——自检工具一旦会写，就没法安全地反复跑了。
 * 2. **结构化优先**。`--json` 的输出是对外契约：字段名改了，agent 侧就要跟着改，
 *    所以宁可不加字段，也不要随便改名。
 * 3. **分级而不是通过/失败**。`warn` 表示「能用但缺一块」（比如语音没装、游戏没开），
 *    `fail` 才是「现在真的跑不起来」。全绿但游戏没开是正常状态，不该退出码非零。
 * 4. **绝不打印密钥**。key 只看「落在哪一档」，token 只报「一致 / 不一致」。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)
const PORTS = { host: Number(process.env.CHILL_HOST_PORT || 10722), sidecar: Number(process.env.CHILL_BRAIN_PORT || 10723) }
// 与 /meta 对齐的期望值：路由数变了说明插件与侧车版本不一致（或有人没重启）
const EXPECTED_ROUTES = 31
const GAME_ID = '3548580'

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const val = (f) => {
  const i = args.indexOf(f)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : ''
}
const JSON_OUT = has('--json')
const OUT = val('--out')

const checks = []
const add = (id, status, summary, extra = {}) => {
  checks.push({ id, status, summary, ...extra })
}
const pass = (id, s, e) => add(id, 'pass', s, e)
const warn = (id, s, e) => add(id, 'warn', s, e)
const fail = (id, s, e) => add(id, 'fail', s, e)
const skip = (id, s, e) => add(id, 'skip', s, e)

const tryRead = (p) => {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}
const parseFlag = (text, key) => {
  const m = new RegExp('^\\s*' + key + '\\s*=\\s*(\\S*)', 'm').exec(text)
  return m ? m[1].trim() : ''
}
const fetchJson = async (url, headers = {}) => {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(3000) })
    const text = await r.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      /* 非 JSON：把原文截断带回去，便于判断是不是撞到别的服务 */
    }
    return { ok: r.ok, status: r.status, json, text: text.slice(0, 160) }
  } catch (e) {
    return { ok: false, status: 0, error: String(e.message || e) }
  }
}

// ---------------------------------------------------------------- 1. 运行时
{
  const major = Number(String(process.versions.node).split('.')[0])
  if (major >= 22) pass('runtime', 'Node ' + process.versions.node)
  else fail('runtime', 'Node ' + process.versions.node + '（要 ≥ 22）', { fix: [{ cmd: 'node -v', why: '低于 22 会在 serve.mjs 的路径处理上炸，报错不指向版本' }] })
}

// ---------------------------------------------------------------- 2. 仓库完整度
{
  const need = ['index.js', 'serve.mjs', 'brain.mjs', 'package.json', 'cordis.patch.yml', join('game', 'ChillPerformer.dll'), join('game', 'assets.seed.json')]
  const missing = need.filter((f) => !existsSync(join(ROOT, f)))
  if (missing.length === 0) pass('repo', '仓库文件齐全（' + need.length + ' 项）')
  else
    fail('repo', '缺 ' + missing.join(', '), {
      fix: [{ cmd: 'git -C "' + ROOT + '" status --short', why: '确认是不是被误删/被 .gitignore 挡住：这 7 个文件必须随包' }],
    })
}

// 版本：package.json / brain.mjs / 侧车 /meta 三方对齐
let pkgVersion = ''
try {
  pkgVersion = String(JSON.parse(tryRead(join(ROOT, 'package.json'))).version || '')
} catch {
  pkgVersion = ''
}
const brainVersion = (() => {
  const m = /^const VERSION = '([^']+)'/m.exec(tryRead(join(ROOT, 'brain.mjs')))
  return m ? m[1] : ''
})()

// ---------------------------------------------------------------- 3. 数据目录
// 与插件同一条优先级：cordis.patch.yml 的 dataDir → CHILL_DATA_DIR → <仓库>/data
const dataDir = (() => {
  const yml = tryRead(join(ROOT, 'cordis.patch.yml'))
  const m = /^\s*dataDir:\s*['"]?([^'"\r\n]+)['"]?\s*$/m.exec(yml)
  const raw = String((m && m[1]) || process.env.CHILL_DATA_DIR || '').trim()
  if (!raw) return join(ROOT, 'data')
  return isAbsolute(raw) ? raw : join(ROOT, raw)
})()
const tokenFile = join(dataDir, 'token')
const token = tryRead(tokenFile).trim()
{
  if (!existsSync(dataDir)) {
    warn('dataDir', '数据目录还不存在：' + dataDir, {
      why: '侧车第一次启动时会自动建；如果侧车从没起来过就是这个状态',
      fix: [{ cmd: 'node "' + join(ROOT, 'serve.mjs') + '"', why: '手动跑一次侧车，它会建目录并生成 token' }],
    })
  } else if (!token) {
    warn('dataDir', '目录在，但没有 token 文件', {
      fix: [{ cmd: 'node "' + join(ROOT, 'serve.mjs') + '"', why: '启动侧车会生成 token；也可以 node tools/sync-token.mjs 反推' }],
    })
  } else {
    pass('dataDir', '数据目录就绪，token 长度 ' + token.length)
  }
}

// ---------------------------------------------------------------- 4. 游戏本体
const gameDir = (() => {
  const given = val('--game') || process.env.CHILL_GAME_DIR
  if (given && existsSync(given)) return given
  // Steam 库：从 libraryfolders.vdf 里读，别全盘扫（慢且吵）
  const vdf = ['C:/Program Files (x86)/Steam/steamapps/libraryfolders.vdf', 'C:/Program Files/Steam/steamapps/libraryfolders.vdf'].map(tryRead).find(Boolean) || ''
  const libs = [...vdf.matchAll(/"path"\s+"([^"]+)"/g)].map((m) => m[1].replace(/\\\\/g, '\\'))
  const roots = [...new Set([...libs, 'C:/Program Files (x86)/Steam', 'C:/Program Files/Steam', 'D:/Steam', 'D:/SteamLibrary', 'E:/SteamLibrary', 'E:/Steam', 'F:/SteamLibrary'])]
  for (const r of roots) {
    const p = join(r, 'steamapps', 'common')
    if (!existsSync(p)) continue
    try {
      const hit = readdirSync(p).find((n) => /^Chill With You/i.test(n))
      if (hit) return join(p, hit)
    } catch {
      /* 没有权限就跳过 */
    }
  }
  return ''
})()
{
  if (!gameDir) {
    warn('game', '没找到《放松时光》安装目录', {
      why: '插件其他层可以全绿，但没有游戏就永远验证不了「她能演」',
      fix: [
        { cmd: '不要自己下别处版本，去 Steam 装 appid ' + GAME_ID, why: '只有 Steam 版才有 _Data/Managed/Assembly-CSharp.dll' },
        { cmd: 'node tools/doctor.mjs --game "<安装目录>"', why: '装在非标准位置时用参数指路' },
      ],
    })
  } else {
    // Unity 的数据目录名跟着 exe 名走（这里是 Chill With You_Data），不是固定的 `_Data`。
    // 别按字面拼路径——拼错了会把一台装得好好的机器报成"残缺安装"。
    const core = (() => {
      try {
        const dataDirs = readdirSync(gameDir).filter((n) => /_Data$/i.test(n))
        for (const d of dataDirs) {
          const p = join(gameDir, d, 'Managed', 'Assembly-CSharp.dll')
          if (existsSync(p)) return p
        }
      } catch {
        /* 读不到就按缺件处理 */
      }
      return ''
    })()
    if (core) pass('game', gameDir, { detail: { dir: gameDir, core: core.replace(gameDir, '.') } })
    else warn('game', '目录在，但不像完整安装：' + gameDir, { why: '缺 _Data/Managed/Assembly-CSharp.dll，多半是更新残留或残缺目录', fix: [{ cmd: 'Steam → 右键游戏 → 属性 → 已安装文件 → 验证文件完整性', why: '' }] })
  }
}

// ---------------------------------------------------------------- 5. 游戏端 DLL
{
  const dll = join(ROOT, 'game', 'ChillPerformer.dll')
  if (!gameDir) skip('bepinex', '没游戏目录，跳过游戏端检查')
  else {
    const bep = join(gameDir, 'BepInEx')
    const installed = join(bep, 'plugins', 'ChillPerformer.dll')
    if (!existsSync(bep)) {
      fail('bepinex', '游戏目录里没有 BepInEx', {
        fix: [
          { cmd: '下载 BepInEx 5.4.x x64 并解压到 "' + gameDir + '"', why: '没有它 dll 不会被加载' },
          { cmd: '启动游戏一次，让它生成 BepInEx/plugins 等目录', why: '然后再放 dll' },
        ],
      })
    } else if (!existsSync(installed)) {
      fail('bepinex', 'BepInEx 在，但 plugins 里没有 ChillPerformer.dll', {
        fix: [{ cmd: 'Copy-Item "' + dll + '" "' + join(bep, 'plugins') + '" -Force', why: '这一层不装，health 全绿而她一动不动' }],
      })
    } else {
      const same = (() => {
        try {
          return statSync(dll).size === statSync(installed).size
        } catch {
          return false
        }
      })()
      const log = tryRead(join(bep, 'LogOutput.log'))
      const loaded = /ChillPerformer/i.test(log)
      if (!same) warn('bepinex', '已装 dll 与仓库里的不是同一份（大小不同）', { fix: [{ cmd: 'Copy-Item "' + dll + '" "' + join(bep, 'plugins') + '" -Force', why: '仓库这份是配套版本，混用会动作对不上' }] })
      else if (!loaded) warn('bepinex', 'dll 已就位，但日志里没有加载记录', { why: '要么还没启动过游戏，要么被 BepInEx 拒绝加载', fix: [{ cmd: '启动游戏一次，再看 "' + join(bep, 'LogOutput.log') + '"', why: '' }] })
      else pass('bepinex', '游戏端已加载（日志有 ChillPerformer）', { detail: { path: installed, logHasLoad: true } })
    }
  }
}

// ---------------------------------------------------------------- 6. 游戏端 token
{
  if (!gameDir) skip('tokenSync', '没游戏目录，跳过 token 同步检查')
  else {
    const cfg = join(gameDir, 'BepInEx', 'config', 'local.chill.performer.cfg')
    if (!existsSync(cfg)) warn('tokenSync', '游戏端配置还没生成', { fix: [{ cmd: 'node tools/sync-token.mjs --apply --game "' + gameDir + '"', why: '会写配置并备份；改完要重启游戏' }] })
    else {
      const gameToken = parseFlag(tryRead(cfg), 'Token')
      if (!token) warn('tokenSync', '侧车 token 还没生成，无法比对', {})
      else if (!gameToken) fail('tokenSync', '游戏端配置里的 Token 是空的', { why: '侧车不放行空 token，DLL 会安静地重试被拒的请求：health 全绿、她一动不动', fix: [{ cmd: 'node tools/sync-token.mjs --apply --game "' + gameDir + '"', why: '' }] })
      else if (gameToken !== token) fail('tokenSync', '游戏端 Token 与侧车不一致', { fix: [{ cmd: 'node tools/sync-token.mjs --apply --game "' + gameDir + '"', why: '写前自动备份成 .bak-<时间戳>' }, { cmd: '重启游戏', why: 'DLL 只在启动/进场景时读配置' }] })
      else pass('tokenSync', '游戏端 Token 与侧车一致')
    }
  }
}

// ---------------------------------------------------------------- 7. 侧车
const auth = token ? { 'x-chill-token': token } : {}
let sidecarHealth = null
{
  const h = await fetchJson('http://127.0.0.1:' + PORTS.sidecar + '/chill/v1/health')
  if (h.status === 200 && h.json && h.json.ok) {
    sidecarHealth = h.json
    pass('sidecar', '侧车在线（' + PORTS.sidecar + '）', { detail: { gameOnline: h.json.gameOnline, hasApiKey: h.json.hasApiKey } })
  } else if (h.status === 401) {
    fail('sidecar', '侧车在，但 health 要鉴权（不该发生）', { fix: [{ cmd: 'curl -s http://127.0.0.1:' + PORTS.sidecar + '/chill/v1/health', why: 'health 是免鉴权的；401 说明撞到了别的服务或版本不对' }] })
  } else if (h.status === 0) {
    warn('sidecar', '侧车没在 ' + PORTS.sidecar + ' 上应答', { why: 'dsh web 没开、插件没挂载、或侧车崩了', fix: [{ cmd: 'Get-Content "' + join(dataDir, 'sidecar.log') + '" -Tail 20', why: '崩溃栈在这里' }, { cmd: '在 dsh 面板里重新挂载/重启 dsh web', why: '' }] })
  } else {
    warn('sidecar', '侧车端口有响应但不是预期的健康检查（HTTP ' + h.status + '）', { detail: { body: h.text } })
  }
}

// ---------------------------------------------------------------- 8. 宿主反代
{
  const h = await fetchJson('http://127.0.0.1:' + PORTS.host + '/chill/v1/health')
  if (h.status === 200 && h.json && h.json.ok) pass('host', '宿主端口在线（' + PORTS.host + '）')
  else if (h.status === 404) fail('host', '宿主没挂载这个插件（404）', { why: 'node_modules 里的联接、profile 的 bundles、以及有没有真的重启 dsh web', fix: [{ cmd: 'node tools/install.mjs --check', why: '它逐项打 ✓/✗' }, { cmd: '重启 dsh web', why: '新增 bundle 必须重启，刷新页面没用' }] })
  else if (h.status === 502 || h.status === 503) fail('host', '宿主在，但侧车没起来（' + h.status + '）', { fix: [{ cmd: 'Get-Content "' + join(dataDir, 'sidecar.log') + '" -Tail 20', why: '' }] })
  else if (h.status === 0) warn('host', '宿主端口没开（' + PORTS.host + '）', { why: 'dsh web 没运行', fix: [{ cmd: '打开 dsh web 再跑一次 doctor', why: '' }] })
  else warn('host', '宿主端口返回 HTTP ' + h.status, { detail: { body: h.text } })
}

// ---------------------------------------------------------------- 9. 路由与版本协商
{
  if (!sidecarHealth) skip('routes', '侧车没起来，跳过路由与版本核对')
  else {
    const m = await fetchJson('http://127.0.0.1:' + PORTS.sidecar + '/chill/v1/meta', auth)
    if (!m.ok || !m.json) fail('routes', '/meta 读不到（HTTP ' + m.status + '）', { why: 'token 不对时会 401', fix: [{ cmd: 'type "' + tokenFile + '"', why: '比对一下面板/curl 用的是不是这串' }] })
    else {
      const n = Array.isArray(m.json.routes) ? m.json.routes.length : 0
      if (n === EXPECTED_ROUTES) pass('routes', '路由 ' + n + ' 条（与预期一致）')
      else warn('routes', '路由 ' + n + ' 条，预期 ' + EXPECTED_ROUTES + ' 条', { why: '插件与侧车版本不一致，或改完没重启', fix: [{ cmd: '重启 dsh web 后再看', why: '' }] })
      const metaVersion = String(m.json.version || '')
      if (pkgVersion && metaVersion && pkgVersion !== metaVersion) warn('versions', 'package.json ' + pkgVersion + ' ≠ 侧车 ' + metaVersion, { why: '跑的还是旧代码（进程内模块有缓存）', fix: [{ cmd: '重启 dsh web', why: '原地改 .js 不会热加载' }] })
      else pass('versions', '版本一致：' + (metaVersion || pkgVersion || '未知') + (brainVersion ? '（brain VERSION ' + brainVersion + '）' : ''))
    }
  }
}

// ---------------------------------------------------------------- 10. 模型 key（只看档位）
{
  const llmFile = join(dataDir, 'llm.json')
  const cfg = (() => {
    try {
      return JSON.parse(tryRead(llmFile))
    } catch {
      return null
    }
  })()
  const providers = (cfg && Array.isArray(cfg.providers) && cfg.providers) || []
  const active = (cfg && cfg.active) || ''
  const shapes = providers.map((p) => ({ id: p.id, model: p.model, keyRef: p.keyRef || '', hasToken: Boolean(String(p.token || '').trim()) }))
  const fromHealth = sidecarHealth && typeof sidecarHealth.hasApiKey === 'boolean' ? sidecarHealth.hasApiKey : null
  if (fromHealth === true) pass('key', '模型 key 可用' + (sidecarHealth.keySource ? '（来源 ' + sidecarHealth.keySource + '）' : ''), { detail: { active, providers: shapes } })
  else if (fromHealth === false) fail('key', '四档 key 全空', { why: 'provider token → 环境变量 → dsh 凭据 → 宿主借来的，全没拿到', fix: [{ cmd: '面板「模型」页填 key 或点测试', why: '' }, { cmd: 'node tools/doctor.mjs --json', why: '看 key.detail.providers 里哪条空着' }] })
  else if (providers.length === 0) warn('key', '还没配过 provider（llm.json 不存在或为空）', { why: '侧车起来后默认那条会跟随 dsh 的凭据，通常不用自己配' })
  else warn('key', '侧车没起来，无法判断 key 是否可用', { detail: { active, providers: shapes } })
}

// ---------------------------------------------------------------- 11. 语音（可选链路）
// 侧车在线时以它为准（它真的探过活），否则退回文件系统猜测——猜错只报 warn，不报 fail。
{
  const live = sidecarHealth ? await fetchJson('http://127.0.0.1:' + PORTS.sidecar + '/chill/v1/voices', auth) : null
  if (live && live.ok && live.json && typeof live.json.online === 'boolean') {
    const v = live.json
    const detail = { online: v.online, ready: v.ready, active: v.active, missing: v.missing || [], loadError: v.loadError || '' }
    if (v.online && v.ready) pass('voice', '语音引擎在线，声线「' + (v.active || '?') + '」就绪', { detail })
    else if (!v.online) warn('voice', '语音引擎没起来（自动降级为纯字幕）', { why: '缺 python 环境或模型；不影响任何其它功能', fix: [{ cmd: '按 AGENTS.md §7 补引擎，再在面板「语音」页点刷新', why: '' }, { cmd: '面板「语音」页点「启动引擎」', why: '' }], detail })
    else warn('voice', '引擎在线但还缺件：' + (v.missing || []).join(', '), { detail })
  } else {
    const refIndex = (() => {
      try {
        return JSON.parse(tryRead(join(ROOT, 'ref', 'ref-index.json')))
      } catch {
        return null
      }
    })()
    const items = (refIndex && (refIndex.voices || refIndex.items)) || []
    const missing = items.filter((v) => v && v.required && !existsSync(join(ROOT, 'ref', String(v.file || v.path || '')))).map((v) => v.file || v.path)
    const engineRepo = join(ROOT, 'tools', 'gsv-src', 'GPT-SoVITS-main')
    const venv = join(ROOT, 'tools', 'gsv-venv')
    const detail = { refRequired: items.filter((v) => v && v.required).length, refMissing: missing, engineRepo: existsSync(engineRepo), venv: existsSync(venv) }
    if (missing.length === 0 && existsSync(engineRepo) && existsSync(venv)) pass('voice', '语音链路齐全（按文件判断）', { detail })
    else if (missing.length === 0 && !existsSync(engineRepo)) warn('voice', '语音引擎没装（可选）', { why: '缺它只影响出声：自动降级为纯字幕，游戏照常演', fix: [{ cmd: '按 AGENTS.md §7 放 GPT-SoVITS 到 tools/gsv-src/GPT-SoVITS-main', why: '' }], detail })
    else if (missing.length > 0) warn('voice', '参考音频缺 ' + missing.length + ' 个', { why: '参考音频版权在游戏，不随包；从自己的游戏安装目录取 3–10 秒人声放 ref/', fix: [{ cmd: 'node tools/doctor.mjs --json', why: '看 voice.detail.refMissing 的具体文件名' }], detail })
    else pass('voice', '语音链路齐全（按文件判断）', { detail })
  }
}

// ---------------------------------------------------------------- 汇总
const counts = checks.reduce((a, c) => ((a[c.status] = (a[c.status] || 0) + 1), a), {})
const next = checks
  .filter((c) => c.status === 'fail' || c.status === 'warn')
  .flatMap((c) => (c.fix || []).map((f) => ({ for: c.id, cmd: f.cmd, why: f.why || '' })))
const result = {
  ok: !counts.fail,
  generatedAt: new Date().toISOString(),
  tool: { name: 'chill-doctor', schema: 1 },
  env: { node: process.versions.node, platform: process.platform, repo: ROOT, dataDir, gameDir, ports: PORTS, expectedRoutes: EXPECTED_ROUTES },
  versions: { package: pkgVersion, brain: brainVersion },
  counts,
  checks,
  next,
}
const text = JSON.stringify(result, null, JSON_OUT && !OUT ? 2 : 0)
if (OUT) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n', 'utf8')
}

if (JSON_OUT) {
  console.log(text)
} else {
  const mark = { pass: '✓', warn: '!', fail: '×', skip: '-' }
  for (const c of checks) console.log('  ' + mark[c.status] + ' ' + c.id.padEnd(11) + c.summary)
  const tail = '  ' + [counts.pass ? counts.pass + ' 通过' : '', counts.warn ? counts.warn + ' 待补' : '', counts.fail ? counts.fail + ' 失败' : '', counts.skip ? counts.skip + ' 跳过' : ''].filter(Boolean).join(' · ')
  console.log(tail)
  if (next.length) {
    console.log('\n  下一步：')
    for (const n of next.slice(0, 6)) console.log('    [' + n.for + '] ' + n.cmd + (n.why ? '\n        ' + n.why : ''))
  }
  console.log('\n  机器可读： node tools/doctor.mjs --json')
}
process.exit(result.ok ? 0 : 1)
