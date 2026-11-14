// Build the brain's asset manifest from the runtime clip dump produced by
// ChillPerformer (BepInEx\chill-clips.txt): objectName \t active \t clip \t length
// The DLL-derived names were type names, not playable clip names; these are the
// names the Animator really has, so a cue id == a clip name that plays.
//
// 用法：node tools/gen-anim-manifest.mjs [chill-clips.txt] [输出路径]
// 输出默认写插件根目录的 assets.seed.json，换机器不用改代码。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('..', import.meta.url));
const GAME = process.env.CHILL_GAME_DIR || '';
if (!GAME) {
  console.error('set CHILL_GAME_DIR to the game folder first');
  process.exit(2);
}
const DUMP = process.argv[2] || path.join(GAME, 'BepInEx', 'chill-clips.txt');
const OUT = process.argv[3] || path.join(HERE, 'game', 'assets.seed.json');

const GLOSS = {
  base: '基本', base001: '基本1', base002: '基本2', base003: '基本3', base004: '基本4', base005: '基本5', base006: '基本6',
  subbase001: '子姿势1', subbase002: '子姿势2', subbase003: '子姿势3', subbase004: '子姿势4',
  subbase005: '子姿势5', subbase006: '子姿势6', subbase007: '子姿势7', subbase008: '子姿势8',
  sub: '子动作', start: '进入', end: '结束', loop: '循环', loop2: '循环二', stop: '停止',
  joy: '开心', happy: '开心', sad: '难过', fun: '玩笑', anger: '生气', angry: '生气',
  surprise: '惊讶', shy: '害羞', thinking: '思考', think: '思考', rest: '静止', deep: '深沉',
  wink: '眨眼', smile: '微笑', zito: '沉默', monologue: '独白', talk: '说话', talking: '说话',
  nod: '点头', denial: '摇头', agree: '同意', lookdown: '低头', frustration: '沮丧', frustration2: '沮丧二',
  guts: '加油', drinktea: '喝茶', tea: '喝茶', laugh: '笑', movie: '看电影', pc: '用电脑',
  report: '写报告', book: '看书', keytype: '打字', pageflip: '翻页', brushawaytrash: '扫碎屑',
  dryeye: '揉眼睛', yawn: '打哈欠', yawning: '打哈欠', stretch: '伸展', tired: '疲惫',
  breath: '呼吸', deepbreath: '深呼吸', gymnastics: '伸展操', memorise: '回忆', memory: '回忆',
  phone: '看手机', walk: '走', come: '回来', comeback: '回座', leave: '离开', sit: '坐下',
  stand: '站起', wave: '招手', waving: '招手', greet: '打招呼', greeting: '打招呼',
  wet: '被淋湿', banzai: '欢呼', eieio: '哼歌', fidget: '坐立不安', complete: '完成',
  task: '任务', wanttalk: '想说话', chair: '椅子', idle: '待机', startscene: '开场',
  cutscene: '过场', sleep: '睡觉', sleepy: '困了', nervous: '紧张', excited: '兴奋',
  relaxed: '放松', curious: '好奇', understand: '理解', work: '工作', break: '休息',
  wild: '站立动作', story: '剧情动作', face: '表情', outfit: '换装', phonecall: '打电话',
};

const rows = fs.readFileSync(DUMP, 'utf8').trim().split(/\r?\n/).map((l) => l.split('\t'));
const byObject = new Map();
for (const [obj, active, clip, len] of rows) {
  if (!clip) continue;
  if (!byObject.has(obj)) byObject.set(obj, []);
  byObject.get(obj).push({ clip, len: Number(len) || 0, active: active === '1' });
}

function glossOf(name) {
  const tokens = name.replace(/^anim_/, '').split('_').filter(Boolean);
  const out = [];
  for (const t of tokens) {
    const g = GLOSS[t];
    if (g && !out.includes(g)) out.push(g);
  }
  if (!out.length) out.push(tokens[tokens.length - 1] || name);
  return out.slice(0, 4);
}

function entry(name, len) {
  const isLoop = /(_loop|_loop2)$/.test(name);
  return {
    id: name,
    name,
    semantic: glossOf(name),
    loop: isLoop,
    durationMs: len > 0 ? Math.round(len * 1000) : null,
    seat: null,
    text: null,
  };
}

const character = (byObject.get('Character') || []).map((c) => entry(c.clip, c.len));
const chairs = [];
for (const [obj, clips] of byObject) {
  if (!/chair/i.test(obj)) continue;
  for (const c of clips) chairs.push(entry(c.clip, c.len));
}

const skip = new Set(['Character']);
const ignored = [...byObject.keys()].filter((k) => !skip.has(k) && !/chair/i.test(k));

const manifest = {
  version: 2,
  source: 'runtime-animator-clips',
  generatedAt: new Date().toISOString(),
  note: 'id 即真实 clip 名；semantic 为中文标签，供模型选择；loop 表示循环片段。UI 动画器未收录。',
  animations: character,
  chairs,
  deskObjects: [],
  pen: [],
  cameras: [],
  scenes: [],
  sfx: [],
  voiceClips: [],
  bgm: [],
};

fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({
  animations: character.length,
  chairs: chairs.length,
  ignoredAnimators: ignored.length,
  ignoredSample: ignored.slice(0, 6),
  out: OUT,
  bytes: fs.statSync(OUT).size,
}));
