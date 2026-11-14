/**
 * 从游戏程序集元数据 dump 生成真实资源清单。
 * 输出：插件根目录下的 assets.seed.json —— 插件启动时若无 data/assets.json 就用它。
 *
 * 用法：node tools/build-manifest.mjs [enums-dump] [输出路径]
 * 两个参数都可省，默认读插件根目录下的 game-enums.txt、写插件根目录的 assets.seed.json。
 *
 * 只用游戏自己的枚举：动作名与 id 全部来自 Assembly-CSharp.dll，没有任何猜测。
 * semantic 是给模型看的中文标签（人写，不是游戏给的）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('..', import.meta.url))
const DUMP = process.argv[2] || path.join(HERE, 'game-enums.txt')
const OUT = process.argv[3] || path.join(HERE, 'game', 'assets.seed.json')

const WANTED = {
  'Bulbul.HeroineService/AnimationType': 'animations',
  'HeroineUseObjectController/ChairAnimationType': 'chairs',
  'HeroineUseObjectController/DeskObjectAnimationType': 'deskObjects',
  'HeroineUseObjectController/PenAnimationType': 'pen',
  'Bulbul.RoomCameraManager/AnimationType': 'cameras',
}

// 名字里的语义词 → 中文标签（人写；游戏侧只有英文标识符）
const TOKEN = {
  joy: '开心', sad: '难过', fun: '玩笑', guts: '加油', agree: '同意', nod: '点头',
  denial: '否认', frustration: '沮丧', frustrationright: '沮丧', frustrationleft: '沮丧',
  lookdown: '低头', shy: '害羞', thinking: '思考', thought: '思考', jump: '兴奋',
  confidence: '得意', feellarge: '得意', distress: '困扰', regret: '后悔',
  penguin: '歪头', introduce: '介绍', copycat: '模仿', presshands: '紧张',
  dropshoulders: '泄气', fidget: '坐立不安', touchglasses: '扶眼镜', glasses: '眼镜',
  stretch: '伸懒腰', stretchfllbody: '伸懒腰', stretchshoulder: '展肩', stretch2: '伸展',
  tea: '喝茶', drinktea: '喝茶', drinkhot: '喝热饮', wet: '被淋湿', banzai: '欢呼',
  openwindow: '开窗', closewindow: '关窗', breath: '深呼吸', deepbreath: '深呼吸',
  good: '点赞', tired: '累', completetask: '收工', gymnastics: '伸展', dryeye: '揉眼睛',
  yawn: '打哈欠', memorie: '回忆', keytype: '打字', keyboard: '敲键盘', pageflip: '翻页',
  break: '休息', usecoffeemaker: '煮咖啡', cooling: '吹凉', brushawaytrash: '拂掉碎屑',
  smallthinking: '思考', bigthinking: '深思', laugh: '笑', suspenseful: '紧张',
  outtrash: '倒垃圾', nextpage: '翻页', previouspage: '翻页', interest: '感兴趣',
  listenmusiclow: '听音乐', listenmusichigh: '听音乐', sleep: '睡觉',
  getupslowly: '慢慢起身', jumpup: '跳起', playpenloop: '转笔', droppen: '掉笔',
  speakblur: '含糊说话', climax: '情绪高潮', startclimax: '情绪铺垫',
  wavehandshorttime: '招手', leaningforward: '前倾凑近', talk: '说话',
  leavechair: '离座', sofa: '沙发', cup: '杯子', cupcake: '纸杯蛋糕', cookie: '饼干',
  breada: '面包', breadb: '面包', comeback: '回座', showloop: '展示', eat: '吃',
  spinning: '转笔', start: '开始', end: '结束', loop2: '循环', pickupdroppedpen: '捡笔',
  playfirst: '动作一', playsecond: '动作二', playend: '收尾',
  frompc: '从电脑', frombook: '从书', fromreport: '从报告', tobook: '到书',
  topc: '到电脑', toreport: '到报告', putworkbook: '放课本', takeworkbook: '拿课本',
  playstartmemorie: '回忆', startsitfromoutside: '从外面回来坐下',
  breakmovie: '看片', breakreadbook: '看书',
}

// 关键动作人工指定语义（覆盖自动推导，表情/聊天用得到）
const OVERRIDE = {
  0: '待机', 5: '害羞', 6: '兴奋跳', 7: '得意', 8: '思考', 9: '思考',
  11: '低头', 12: '点头', 13: '摇头', 19: '模仿', 21: '困扰', 23: '后悔', 24: '扶眼镜',
  50: '伸懒腰', 52: '喝茶', 55: '欢呼', 57: '开窗', 58: '关窗', 59: '深呼吸',
  62: '坐立不安', 64: '累', 65: '收工', 72: '打哈欠', 73: '打哈欠', 74: '回忆',
  202: '思考', 203: '喝茶', 204: '休息', 251: '打字', 252: '思考', 253: '翻页',
  256: '喝茶', 301: '思考', 302: '深思', 304: '喝茶', 305: '拂掉碎屑',
  405: '说话口型（对话时保持）', 601: '笑', 602: '紧张', 651: '翻页', 653: '感兴趣',
  700: '听音乐', 701: '听音乐晃头', 752: '伸懒腰', 754: '煮咖啡', 801: '睡觉',
  802: '慢慢起身', 803: '跳起', 851: '感兴趣', 852: '敲键盘', 853: '转笔', 854: '掉笔',
  1001: '开心笑', 1002: '难过', 1003: '玩笑逗你', 1004: '加油', 1301: '同意',
  1401: '低头犯难', 1402: '点头', 1403: '摇头否认', 1404: '含糊嘟囔',
  5001: '招手打招呼', 5002: '前倾凑近', 6500: '开场入座', 7000: '收尾',
  500: '坐姿招手', 150: '离座', 151: '到沙发', 10000: '从外面回来坐下',
}

const LOOPY = new Set([251, 852, 853, 700, 701, 601, 601])
const STANDING = new Set([150, 151, 152, 153, 154, 160, 170, 171, 180, 181, 190, 191, 195, 196])

const NOISE = new Set([
  'base001', 'wild001', 'wild002', 'wild003', 'workbase001', 'workbase002', 'workbase003',
  'breakbase001', 'breakbase002', 'breakbase003', 'breakbase004', 'breakbase005', 'breakbase006',
  'gamestart', 'gameend', 'desk', 'click', 'wanttalk', 'event', 'christmas', 'newyear',
  'halloween', 'countdown', 'subbase', 'story', 'normal', 'reaction', 'work', 'rest',
])

function tokens(name) {
  return name
    .split('_')
    .map((t) => t.toLowerCase())
    .filter((t) => t !== '' && !/^motion\d+$/.test(t) && !/^\d+$/.test(t) && !NOISE.has(t))
    .filter((t) => t !== 'base' && t !== '001' && t !== 'loop')
}

function semantic(name, id) {
  const override = OVERRIDE[id]
  const out = []
  if (override) out.push(override)
  for (const token of tokens(name)) {
    const zh = TOKEN[token]
    if (zh && !out.includes(zh)) out.push(zh)
  }
  if (out.length === 0) out.push(name.toLowerCase())
  return out.slice(0, 3)
}

const text = fs.readFileSync(DUMP, 'utf8').split(/\r?\n/)
const found = {}
let current = null
for (const line of text) {
  if (line.startsWith('## ')) {
    current = line.slice(3).replace(/\s+\[\d+\]\s*$/, '').trim()
    found[current] = found[current] ?? []
    continue
  }
  if (!current || !line.includes(' = ')) continue
  const [name, rawValue] = line.split(' = ')
  const value = Number(rawValue.trim())
  if (!Number.isFinite(value)) continue
  if (value === -1) continue
  if (/^Count$/.test(name.trim())) continue
  found[current].push({ name: name.trim(), id: value })
}

const manifest = {
  version: 1,
  source: 'game-metadata:Assembly-CSharp.dll',
  generatedAt: new Date().toISOString(),
  note: 'id / name 全部取自游戏程序集枚举；semantic 为人工中文标签，供模型选择用。',
  animations: [],
  chairs: [],
  deskObjects: [],
  pen: [],
  cameras: [],
  scenes: [],
  sfx: [],
  voiceClips: [],
  bgm: [],
}

for (const [enumName, slot] of Object.entries(WANTED)) {
  for (const entry of found[enumName] ?? []) {
    manifest[slot].push({
      id: String(entry.id),
      name: entry.name,
      semantic: semantic(entry.name, entry.id),
      loop: LOOPY.has(entry.id),
      durationMs: null,
      seat: STANDING.has(entry.id) ? 'standing' : null,
      text: null,
    })
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2), 'utf8')

const counts = Object.fromEntries(
  Object.entries(manifest).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length]),
)
const sample = manifest.animations.filter((a) => [1001, 1402, 202, 256, 5001, 405, 752, 852].includes(Number(a.id)))
console.log(JSON.stringify({ out: OUT, counts, sample }, null, 2))
