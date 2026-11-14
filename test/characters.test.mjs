/**
 * 角色卡：播种 / 新建 / 保存 / 激活 / lore 注入。
 * 用 mkdtemp 隔离，不碰真实 data/characters。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCharacters } from '../lib/characters.mjs'

let pass = 0
let fail = 0
const ok = (label, cond, extra) => {
  if (cond) { pass += 1; console.log(`  ok  ${label}`) } else { fail += 1; console.log(`  FAIL ${label}${extra ? ' → ' + extra : ''}`) }
}

const dir = mkdtempSync(join(tmpdir(), 'chill-chars-'))
const mk = (opts = {}) => createCharacters({
  dir,
  defaultId: 'satone',
  seedName: '聪音',
  seedPersona: '你是聪音，说话很短。',
  seedLore: [{ id: 'world', title: '世界', always: true, text: '隔着屏幕一起做事。' }],
  ...opts,
})

try {
  // ---- 首次启动：播种默认卡 ----
  const chars = mk()
  const seeded = await chars.ensureDefaults()
  ok('首次启动播种默认卡', seeded === 'satone', String(seeded))
  const first = await chars.active()
  ok('默认卡带人设', first && first.persona.length > 0)
  ok('默认卡带 lore', first && first.lore.length === 1)
  ok('persona() 读的是卡片', (await chars.persona()).includes('聪音'))

  // ---- 新建 / 校验 ----
  const bad = await chars.create({ id: 'BAD ID!' })
  ok('非法 id 被拒', Boolean(bad.error), JSON.stringify(bad))
  const upper = await chars.create({ id: 'Test_Card' })
  ok('大写/下划线 id 被规整', Boolean(upper.card) && upper.card.id === 'test_card', JSON.stringify(upper.error || upper.card?.id))
  const dup = await chars.create({ id: 'test_card' })
  ok('重复 id 被拒', Boolean(dup.error))

  // ---- 保存 / 读回 ----
  const saved = await chars.save('test_card', {
    name: '测试',
    tagline: '一句话',
    persona: '你是测试角色。',
    lore: [{ id: 'a', title: '设定', always: true, text: '测试设定正文' }],
  })
  ok('保存后字段生效', saved.name === '测试' && saved.persona === '你是测试角色。')
  ok('保存后 lore 写入', saved.lore.length === 1 && saved.lore[0].text === '测试设定正文')
  ok('version 递增', saved.version === 2, String(saved.version))
  const reread = await chars.get('test_card')
  ok('重读一致', reread && reread.persona === '你是测试角色。')

  // ---- 列表 ----
  const list = await chars.list()
  ok('列表含两张卡', list.list.length === 2, String(list.list.length))
  ok('列表标出 active', list.active === 'satone' && list.list.find((c) => c.id === 'satone').active === true)
  ok('列表带摘要字段', typeof list.list[0].personaChars === 'number' && typeof list.list[0].loreCount === 'number')

  // ---- 激活 ----
  const act = await chars.activate('test_card')
  ok('激活返回卡片', act && act.id === 'test_card')
  ok('激活后 persona 跟着变', (await chars.persona()) === '你是测试角色。')
  ok('激活状态落盘', (await mk().ensureDefaults()) === 'test_card')
  const missing = await chars.activate('nope')
  ok('激活不存在的卡返回 null', missing === null)

  // ---- lore 注入 ----
  await chars.activate('satone')
  const blockAlways = await chars.loreBlock('随便说点什么', { k: 4 })
  ok('常驻设定每轮都进', blockAlways.includes('隔着屏幕一起做事'))
  await chars.save('satone', {
    lore: [
      { id: 'world', title: '世界', always: true, text: '隔着屏幕一起做事。' },
      { id: 'ep13', title: '第13话', always: false, text: '协作通话的距离感，她认真想过。' },
      { id: 'ep20', title: '第20话', always: false, text: '毕业论文主题让她发愁。' },
    ],
  })
  const hit = await chars.loreBlock('你还记得协作通话的距离感吗', { k: 2 })
  ok('相关剧情被匹配出来', hit.includes('协作通话的距离感'), hit)
  ok('无关剧情不硬塞', !hit.includes('毕业论文主题'), hit)
  const none = await chars.loreBlock('今天天气不错', { k: 2 })
  ok('无关话题只留常驻', none.includes('隔着屏幕') && !none.includes('协作通话'), none)

  // ---- 尺寸护栏 ----
  const big = await chars.save('satone', { persona: 'x'.repeat(20000) })
  ok('人设超长被截断', big.persona.length <= 12000, String(big.persona.length))
  const many = await chars.save('satone', { lore: Array.from({ length: 120 }, (_, i) => ({ id: 'l' + i, text: '条目 ' + i })) })
  ok('lore 条数有上限', many.lore.length <= 80, String(many.lore.length))
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass} checks${fail ? `, ${fail} failed` : ''}`)
if (fail) process.exitCode = 1
