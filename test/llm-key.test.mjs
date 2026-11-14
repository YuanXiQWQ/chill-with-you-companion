/**
 * key 解析的四档优先级 —— 自定义必须永远赢过 dsh 借来的默认值。
 *
 *   ① provider.token（面板里填的 / /llm add 加的）
 *   ② 环境变量（keyRef 指向的名字，用户自己设的）
 *   ③ dsh 的 .credentials.yaml
 *   ④ 宿主借来的 CHILL_DSH_KEY（仅当 CHILL_DSH_KEY_REF 与 keyRef 相同）
 *
 * 还有个硬要求：baseUrl / model / headers 是用户的配置，一个都不许被覆盖。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLlm } from '../lib/llm.mjs'

let passed = 0
const check = (label, fn) => { fn(); passed += 1; console.log('  ok  ' + label) }

const KEY = { custom: 'sk-' + 'custom_from_panel', env: 'sk-' + 'from_user_env', file: 'sk-' + 'from_dsh_file', dsh: 'sk-' + 'borrowed_from_dsh' }

const store = {
  active: 'dsh-deepseek',
  providers: [
    {
      id: 'dsh-deepseek',
      label: 'DeepSeek · 跟 DSH 共用',
      baseUrl: 'https://api.deepseek.com/v1/chat/completions',
      model: 'deepseek-flash',
      keyRef: 'DEEPSEEK_API_KEY',
    },
    {
      id: 'relay',
      label: '我的中转',
      baseUrl: 'https://relay.example.com/v1/chat/completions',
      model: 'my-own-model',
      token: KEY.custom,
      headers: { 'x-org': 'mine' },
    },
    {
      id: 'ark',
      label: '豆包 ARK',
      baseUrl: 'https://ark.example.com/api/v3/chat/completions',
      model: 'doubao-pro',
      keyRef: 'ARK_API_KEY',
    },
  ],
}

/** 每个用例一套干净环境：临时 dataDir + 临时 DSH_HOME，环境变量互相不串。 */
const make = ({ active = 'dsh-deepseek', creds = null, env = {} } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'chill-llm-'))
  const home = mkdtempSync(join(tmpdir(), 'chill-home-'))
  writeFileSync(join(dir, 'llm.json'), JSON.stringify({ ...store, active }), 'utf8')
  if (creds) {
    // dsh 的凭据文件是两空格缩进的 refs: 段
    writeFileSync(join(home, '.credentials.yaml'), 'refs:\n' + Object.entries(creds).map(([k, v]) => '  ' + k + ': "' + v + '"').join('\n') + '\n', 'utf8')
  }
  const saved = { DSH_HOME: process.env.DSH_HOME, DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY, ARK_API_KEY: process.env.ARK_API_KEY, CHILL_DSH_KEY: process.env.CHILL_DSH_KEY, CHILL_DSH_KEY_REF: process.env.CHILL_DSH_KEY_REF }
  process.env.DSH_HOME = home
  for (const k of ['DEEPSEEK_API_KEY', 'ARK_API_KEY', 'CHILL_DSH_KEY', 'CHILL_DSH_KEY_REF']) delete process.env[k]
  Object.assign(process.env, env)
  const llm = createLlm({ dataDir: dir, cfg: {}, existsSync, readFileSync, writeFileSync, mkdir: mkdirSync, join, log: () => {} })
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  }
  return { llm, dir, home, restore }
}

const run = (opts, pick) => { const h = make(opts); try { return pick(h) } finally { h.restore() } }

console.log('# 四档优先级')
check('① provider 自己的 token 最高——借来的 key 不参与', () => {
  const out = run({ active: 'relay', env: { CHILL_DSH_KEY: KEY.dsh, CHILL_DSH_KEY_REF: 'DEEPSEEK_API_KEY' } }, ({ llm }) => llm.resolve())
  assert.equal(out.apiKey, KEY.custom)
})

check('② 环境变量压过凭据文件与借来的 key', () => {
  const out = run({ creds: { DEEPSEEK_API_KEY: KEY.file }, env: { DEEPSEEK_API_KEY: KEY.env, CHILL_DSH_KEY: KEY.dsh, CHILL_DSH_KEY_REF: 'DEEPSEEK_API_KEY' } }, ({ llm }) => llm.resolve())
  assert.equal(out.apiKey, KEY.env)
})

check('③ 环境变量没设时读 dsh 的凭据文件', () => {
  const out = run({ creds: { DEEPSEEK_API_KEY: KEY.file }, env: { CHILL_DSH_KEY: KEY.dsh, CHILL_DSH_KEY_REF: 'DEEPSEEK_API_KEY' } }, ({ llm }) => llm.resolve())
  assert.equal(out.apiKey, KEY.file)
})

check('④ 全都没有时才用宿主借来的', () => {
  const out = run({ env: { CHILL_DSH_KEY: KEY.dsh, CHILL_DSH_KEY_REF: 'DEEPSEEK_API_KEY' } }, ({ llm }) => llm.resolve())
  assert.equal(out.apiKey, KEY.dsh)
})

check('四档全空 → 空串（health 才会报 hasApiKey:false）', () => {
  const out = run({}, ({ llm }) => llm.resolve())
  assert.equal(out.apiKey, '')
})

console.log('# 不许张冠李戴')
check('借来的是 DeepSeek 的 key，选豆包时不使用它', () => {
  const out = run({ active: 'ark', env: { CHILL_DSH_KEY: KEY.dsh, CHILL_DSH_KEY_REF: 'DEEPSEEK_API_KEY' } }, ({ llm }) => llm.resolve())
  assert.equal(out.apiKey, '')
  assert.equal(out.id, 'ark')
})

check('CHILL_DSH_KEY_REF 对上时才认（同名 keyRef 正常生效）', () => {
  const out = run({ active: 'ark', env: { CHILL_DSH_KEY: KEY.dsh, CHILL_DSH_KEY_REF: 'ARK_API_KEY' } }, ({ llm }) => llm.resolve())
  assert.equal(out.apiKey, KEY.dsh)
})

console.log('# 自定义配置不许被覆盖')
check('baseUrl / model / headers 原样保留', () => {
  const out = run({ active: 'relay' }, ({ llm }) => llm.resolve())
  assert.equal(out.baseUrl, 'https://relay.example.com/v1/chat/completions')
  assert.equal(out.model, 'my-own-model')
  assert.deepEqual(out.headers, { 'x-org': 'mine' })
})

check('内置的 DeepSeek 那条也照旧是官方地址', () => {
  const out = run({}, ({ llm }) => llm.resolve())
  assert.equal(out.baseUrl, 'https://api.deepseek.com/v1/chat/completions')
})

check('面板视角的「配没配」与真解析一致（借来的也算配了）', () => {
  const out = run({ env: { CHILL_DSH_KEY: KEY.dsh, CHILL_DSH_KEY_REF: 'DEEPSEEK_API_KEY' } }, ({ llm }) => llm.view())
  const ds = out.providers.find((p) => p.id === 'dsh-deepseek')
  const ark = out.providers.find((p) => p.id === 'ark')
  assert.equal(ds.hasKey, true)
  assert.equal(ark.hasKey, false, 'ARK 没配却显示配了')
})

check('面板视角不吐出 key 本身', () => {
  const out = run({ active: 'relay' }, ({ llm }) => llm.view())
  const s = JSON.stringify(out)
  assert.equal(s.includes(KEY.custom), false, 'view() 把 token 漏出去了')
})


console.log('# 面板要看得出 key 从哪来（keyFrom 分档）')
check('面板自定义那条 → token', () => {
  const out = run({ active: 'relay' }, ({ llm }) => llm.resolve().keyFrom)
  assert.equal(out, 'token')
})

check('环境变量那条 → env', () => {
  const out = run({ env: { DEEPSEEK_API_KEY: KEY.env } }, ({ llm }) => llm.resolve().keyFrom)
  assert.equal(out, 'env')
})

check('凭据文件那条 → credentials', () => {
  const out = run({ creds: { DEEPSEEK_API_KEY: KEY.file } }, ({ llm }) => llm.resolve().keyFrom)
  assert.equal(out, 'credentials')
})

check('靠宿主借来 → dsh', () => {
  const out = run({ env: { CHILL_DSH_KEY: KEY.dsh, CHILL_DSH_KEY_REF: 'DEEPSEEK_API_KEY' } }, ({ llm }) => llm.resolve().keyFrom)
  assert.equal(out, 'dsh')
})

check('四档全空 → 空串', () => {
  const out = run({}, ({ llm }) => llm.resolve().keyFrom)
  assert.equal(out, '')
})

check('view() 每条 provider 都带 keyFrom，与 resolve 一致', () => {
  const out = run({ env: { CHILL_DSH_KEY: KEY.dsh, CHILL_DSH_KEY_REF: 'DEEPSEEK_API_KEY' } }, ({ llm }) => llm.view())
  const ds = out.providers.find((p) => p.id === 'dsh-deepseek')
  const relay = out.providers.find((p) => p.id === 'relay')
  assert.equal(ds.keyFrom, 'dsh')
  assert.equal(relay.keyFrom, 'token')
})

check('view() 交代宿主借的是哪个 ref（面板据此显示「跟随 dsh」）', () => {
  const out = run({ env: { CHILL_DSH_KEY: KEY.dsh, CHILL_DSH_KEY_REF: 'DEEPSEEK_API_KEY' } }, ({ llm }) => llm.view())
  assert.deepEqual({ ref: out.dshBorrow.ref, present: out.dshBorrow.present }, { ref: 'DEEPSEEK_API_KEY', present: true })
})

check('没有借来的时候 dshBorrow 老实说没有', () => {
  const out = run({}, ({ llm }) => llm.view())
  assert.equal(out.dshBorrow.present, false)
  assert.equal(out.dshBorrow.ref, '')
})

console.log('# 自己加的 provider：留空 key 就跟着对话走')
check('留空 token → keyRef 落到 DEEPSEEK_API_KEY，用的就是对话那把', () => {
  const added = run({ env: { DEEPSEEK_API_KEY: KEY.env } }, ({ llm }) => {
    const r = llm.add({ label: 'my relay', baseUrl: 'https://relay.example.com/v1/chat/completions', model: 'm', token: '' })
    const view = llm.view()
    return view.providers.find((x) => x.id === r.id)
  })
  assert.equal(added.keyRef, 'DEEPSEEK_API_KEY')
  assert.equal(added.hasKey, true)
  assert.equal(added.keyFrom, 'env')
})

check('填了 token 再切过去 → 用自己那把，不蹭对话的 key', () => {
  const out = run({ env: { DEEPSEEK_API_KEY: KEY.env } }, ({ llm }) => {
    const r = llm.add({ label: 'other', baseUrl: 'https://o.example.com/v1/chat/completions', model: 'x', token: KEY.custom })
    llm.activate(r.id)
    return llm.resolve()
  })
  assert.equal(out.apiKey, KEY.custom)
  assert.equal(out.keyFrom, 'token')
})

check('自定义那条的 baseUrl / model 原样生效', () => {
  const out = run({}, ({ llm }) => {
    const r = llm.add({ label: 'local-ish', baseUrl: 'http://127.0.0.1:9090/v1/chat/completions', model: 'qwen3', token: KEY.custom })
    llm.activate(r.id)
    return llm.resolve()
  })
  assert.equal(out.baseUrl, 'http://127.0.0.1:9090/v1/chat/completions')
  assert.equal(out.model, 'qwen3')
})

console.log('# 内置清单')
check('内置只有两条：与对话共用 + 本地，不包含豆包', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chill-empty-'))
  const llm = createLlm({ dataDir: dir, cfg: {}, existsSync, readFileSync, writeFileSync, mkdir: mkdirSync, join, log: () => {} })
  const ids = llm.view().providers.map((x) => x.id)
  assert.deepEqual(ids, ['dsh-deepseek', 'local'])
})

check('老 llm.json 里自己留着的 dsh-ark 不会被删（那是用户的东西）', () => {
  // 老配置：豆包曾是内置，用户可能已经填过 keyRef 或 token
  const dir = mkdtempSync(join(tmpdir(), "chill-legacy-"))
  const legacy = {
    active: 'dsh-ark',
    providers: [
      { id: "dsh-ark", label: "豆包 ARK", baseUrl: "https://ark.example.com/api/v3/chat/completions", model: "doubao-pro", keyRef: "ARK_API_KEY" },
    ],
  }
  writeFileSync(join(dir, "llm.json"), JSON.stringify(legacy), "utf8")
  const llm = createLlm({ dataDir: dir, cfg: {}, existsSync, readFileSync, writeFileSync, mkdir: mkdirSync, join, log: () => {} })
  const out = llm.view()
  const ark = out.providers.find((x) => x.id === "dsh-ark")
  assert.ok(ark, "自己留着的条目被删了")
  assert.equal(ark.builtin, false)
  assert.equal(out.active, "dsh-ark")
  assert.ok(out.providers.some((x) => x.id === "dsh-deepseek"), "内置两条应当补回来")
})
console.log('\nPASS ' + passed + ' llm-key checks')