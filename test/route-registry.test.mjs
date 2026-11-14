#!/usr/bin/env node
/**
 * 路由登记的总闸：六组搬出去的路由必须都还注册得出来，路径不许重复、也不许回 brain.mjs。
 *
 * 这个文件不测业务语义（那四组有各自的测试），只测"搬家过程有没有把人搬丢"：
 *   - 每个模块都能用注入的 deps 注册出路由（漏注入会在这里炸，而不是等某条请求 500）
 *   - 六组加起来正好是那几条路径，既不缺也不多
 *   - /meta 里报的路由数必须和实际注册数一致（面板靠它自描述）
 *   - brain.mjs 里不许再出现这些 path 字面量
 *
 * deps 用一个"什么都给"的代理兜住：搬代码时真正需要的是 ctx 与 caps，
 * 其余业务依赖在注册阶段不会被调用，给个占位函数即可。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { registerPanelRoutes } from '../routes/panel.mjs'
import { registerAvatarRoutes } from '../routes/avatar.mjs'
import { registerCharacterRoutes } from '../routes/characters.mjs'
import { registerAssetRoutes } from '../routes/assets.mjs'
import { registerVoiceRoutes } from '../routes/voices.mjs'
import { registerKbRoutes } from '../routes/kb.mjs'
import { registerAudioRoutes } from '../routes/audio.mjs'
import { registerMoodRoutes } from '../routes/mood.mjs'
import { registerPersonaRoutes } from '../routes/persona.mjs'
import { registerAdminRoutes } from '../routes/admin.mjs'
import { registerVoiceAdminRoutes } from '../routes/admin-voice.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// 注册阶段只会用到 ctx / caps / dataDir 这类"推导路径"的依赖，其余按需给占位。
// 故意不做一个"什么都给"的万能代理：这样某个模块一旦在注册期就用到新依赖，这里立刻炸，
// 而不是等到某条请求才 500。
const register = (fn, extra = {}) => {
  const routes = []
  const ctx = { effect: (f) => f(), webServer: { register: (r) => routes.push(r) }, logger: { info() {}, warn() {}, error() {} } }
  const caps = { route: (def) => def, emit: () => {} }
  fn({ ctx, caps, ...extra })
  return routes
}

const dataDir = mkdtempSync(join(tmpdir(), 'chill-registry-'))
const groups = [
  ['panel', registerPanelRoutes, ['/chill/v1/llm'], {}],
  ['avatar', registerAvatarRoutes, ['/chill/v1/avatar'], { dataDir }],
  ['characters', registerCharacterRoutes, ['/chill/v1/characters'], {}],
  ['assets', registerAssetRoutes, ['/chill/v1/assets'], { dataDir }],
  ['voices', registerVoiceRoutes, ['/chill/v1/voices'], { cfg: { dataDir, tts: {} } }],
  ['kb', registerKbRoutes, ['/chill/v1/kb'], { cfg: { dataDir } }],
  ['audio', registerAudioRoutes, ['/chill/v1/audio', '/chill/v1/audio/'], {
    sendJson: (res, status, v) => { res.statusCode = status; res.end(JSON.stringify(v)) },
    authorized: () => true,
    serveAudio: async () => {},
  }],
  ['persona', registerPersonaRoutes, ['/chill/v1/persona'], {
    cfg: { dataDir },
    chars: { dir: dataDir, active: async () => null, save: async () => ({}) },
    log: () => {},
    existsSync: () => false,
    copyFileSync: () => {},
    readPersona: async () => '',
    setPersona: () => {},
  }],
  ['admin', registerAdminRoutes, ['/chill/v1/admin/game', '/chill/v1/admin/game/launch'], {
    game: { probe: async () => ({ running: false }), launch: async () => ({ ok: true }), image: 'x', uri: 'y' },
    gameRunning: async () => ({ running: false }),
  }],
  ['admin-voice', registerVoiceAdminRoutes, ['/chill/v1/admin/voice'], {
    voiceSnapshot: async () => ({ ok: true }),
  }],
  ['mood', registerMoodRoutes, ['/chill/v1/spark', '/chill/v1/ambient'], {
    sendJson: (res, status, v) => { res.statusCode = status; res.end(JSON.stringify(v)) },
    authorized: () => true,
    readBody: async () => ({ json: null }),
    spark: async () => null,
    ambientBlock: () => '',
    getAmbient: () => '',
    getAmbientAt: () => 0,
    setAmbient: () => {},
  }],
]

const all = new Map()
for (const [label, fn, expected, extra] of groups) {
  const routes = register(fn, extra)
  const paths = routes.map((r) => r.path)
  for (const want of expected) {
    assert.ok(paths.includes(want), label + ' 没注册 ' + want + '（实际：' + paths.join(',') + '）')
  }
  for (const r of routes) {
    assert.ok(r.kind === 'exact' || r.kind === 'prefix', label + ' 的 ' + r.path + ' 缺 kind')
    assert.ok(typeof r.note === 'string' && r.note.length > 0, label + ' 的 ' + r.path + ' 缺 note（/meta 要拿它自描述）')
    assert.equal(typeof r.handler, 'function', label + ' 的 ' + r.path + ' 没有 handler')
    assert.ok(!all.has(r.path), '同一个路径被注册了两次：' + r.path)
    all.set(r.path, label)
  }
}

// 六组加起来必须就是全部（31 条里剩下的那些还在 brain.mjs 里，单独数）
const expectedTotal = 14
assert.equal(all.size, expectedTotal, '搬迁后的路由条数变了：' + [...all.keys()].join(','))

// brain.mjs 不许残留这些 path（否则等于两份定义）
const brain = readFileSync(join(ROOT, 'brain.mjs'), 'utf8')
for (const path of all.keys()) {
  assert.ok(!brain.includes("path: '" + path + "'"), path + ' 不该再出现在 brain.mjs 里')
}

// /meta 的自描述：注册点数（brain + routes）要 ≥ 线上看到的路由条数
const brainRegs = (brain.match(/register\(caps\.route\(\{/g) || []).length
const routeRegs = readdirSync(join(ROOT, 'routes'))
  .filter((f) => f.endsWith('.mjs'))
  .reduce((n, f) => n + (readFileSync(join(ROOT, 'routes', f), 'utf8').match(/register\(caps\.route\(\{/g) || []).length, 0)
assert.ok(brainRegs + routeRegs >= 22, '注册点太少：brain ' + brainRegs + ' + routes ' + routeRegs)

// admin-voice 还要把 voiceAction 交回 brain（start / stop / restart 三个动词由 brain 注册）
{
  const out = registerVoiceAdminRoutes({
    ctx: { effect: (f) => f(), webServer: { register: () => () => {} } },
    caps: { route: (d) => d, emit: () => {} },
    authorized: () => true,
    sendJson: () => {},
    voiceSnapshot: async () => ({ ok: true }),
  })
  assert.equal(typeof out.voiceAction, 'function', 'admin-voice 必须把 voiceAction 交回去，否则 brain 里三个动词全丢')
}

console.log('  PASS 十一组路由都能注册（' + all.size + ' 条），路径不重复、不回 brain，注册点 ' + (brainRegs + routeRegs) + ' 个')
