// 动作知识的唯一真相源。
//
// 从前这些散在三处，靠 `verb` 字符串对齐，没有任何一致性约束：
//   director.js      verb → family + 匹配正则 + kind
//   needs.js         COMPANION_VERBS（和 director 的 SHARED 一字不差）
//                    CONTAGIOUS / HIS_BODY / CONTAGIOUS_FAM（HIS_BODY 又和 director 那份重复）
//   anim-type.js     verb → AnimationType
//
// 2026-11-17 一晚踩了两次，都是同一个病：
//   - `toNative` 返回 { name, id }，spread 进 cue 时把 cue 自己的 id 覆盖成枚举数字
//   - `shake` 有映射，但白名单没有、动作表也没有 —— 三道关卡全挡住，永远不生效
// 两次都不报错。合并成一张表之后，这类问题结构上不可能再出现：
// 一个动作一行，改一处就够，测试断言表自洽就行。
//
// 四个布尔位的含义（都是"这一列不写就是 false"，没有隐含默认）：
//   hisBody     他说到它时，这不算"她的动作" —— 除非会传染
//   contagious  会传染的身体反应：他打哈欠她也打，这不是抄，是谁看见都会这样
//   companion   他说他在做这件事，她陪着做自己那份（不算镜像）
//   native      游戏自己有的 AnimationType，走它就不用逐帧采样

export const ACTIONS = {
  // ── 喝水 / 茶 ────────────────────────────────────────────────
  drink: {
    kind: 'activity',
    family: 'anim_break_tea_sub_drink',
    label: '喝一口',
    re: /喝|渴|抿|润嗓|水/,
    hisBody: true,
    contagious: false,
    companion: false,
    // 游戏里没有"喝一口水"的原生动作，只能走采样：
    //   Wild001_Motion5_Wet  对应 clip anim_wild_wet，语义标注是「站立动作, 被淋湿」——不是喝水
    //   Wild001_Motion3_Tea  语义是「站立动作, 喝茶」，但已经被 tea 占用
    // 原来按名字猜成 Wet（"湿"≈"喝"）是错的，靠 assets.seed.json 的 semantic 字段核出来。
    //
    // 正确做法是按当前基底拼子动作名：游戏在 4 个基底里都实现了 DrinkTea
    //   BreakBase004_DrinkTea / WorkBase001_DrinkTea / WorkBase002_DrinkTea / WorkBase003_DrinkTea
    // 同一个"喝口茶"，坐着休息 / 在工位 / 看书时身体姿势完全不同，写死哪一条都是错的。
    // sub 只写后缀，全名由游戏端按她此刻的基底拼（见 docs/游戏动作组合模型.md）。
    native: { sub: 'DrinkTea' },
  },
  tea: {
    kind: 'activity',
    family: 'anim_break_tea_sub_hot',
    label: '喝茶/咖啡',
    re: /茶|咖啡|暖手|泡/,
    hisBody: false,
    contagious: false,
    companion: true,
    native: { name: 'Wild001_Motion3_Tea', id: 52 },
  },

  // ── 身体反应 ────────────────────────────────────────────────
  sleep: {
    kind: 'activity',
    family: 'anim_break_sleep_sub_fall',
    // 不挂 state：她的睡意是游戏按"连续专注时长"自己累积出来的，
    // 到点了游戏会自己把她送进 BreakSleep。我们去切这个状态，
    // 等于替游戏决定她累不累——而且要先强行置 ActivateSleepFlg 才切得动，
    // 那是在改游戏自己的状态位，不属于"不侵入"的范畴。
    // 所以这个动词只表示"我知道你在说睡觉这件事"，不产生任何动作，见 noMotion。
    noMotion: true,
    label: '趴一会',
    // "睡会儿""睡觉"这类说法比"睡一会"更常见，原来漏了，判定会落到 yawn 的「困」上。
    re: /趴一会|趴着|眯一会|眯一下|睡一会|睡一下|睡.{0,2}觉|睡.{0,2}会儿|睡觉|睡吧|该睡|去睡|早点睡|好好睡/,
    // 主语规则不能动：他说"我要睡了"是他的事，她不该跟着趴。
    // state 只在 sleep 被选中时才生效 —— 也就是"你眯一会儿吧"这种她被指到的场景。
    hisBody: true,
    contagious: false,
    companion: false,
    native: null,
  },
  stretch: {
    kind: 'activity',
    family: 'anim_wild_stretchfullbody',
    label: '伸懒腰',
    facial: 'Shy_Joy',
    re: /伸懒腰|伸个懒腰|伸展|抻|活动活动|舒展/,
    hisBody: true,
    contagious: true,
    companion: false,
    // Stretch 只在 BreakBase004 有（坐着伸懒腰）。站着走 Wild001 那条全身版。
    // 两条语义不同，所以 sub 优先、name 兜底。
    native: { name: 'Wild001_Motion1_StretchFllBody', id: 50, sub: 'Stretch' },
  },
  shoulder: {
    kind: 'activity',
    family: 'anim_wild_stretchshoulder',
    label: '揉肩',
    re: /肩膀|肩颈|揉肩|脖子酸|落枕/,
    hisBody: true,
    contagious: false,
    companion: false,
    native: { name: 'Wild001_Motion2_StretchShoulder', id: 51 },
  },
  yawn: {
    kind: 'activity',
    family: 'anim_break_yawn_1',
    label: '打哈欠',
    facial: 'Shy_Sad',
    re: /哈欠|打哈|困|睡意|睁不开眼/,
    hisBody: true,
    contagious: true,
    companion: false,
    native: { name: 'Wild001_Motion23_Yawn_1', id: 72 },
  },
  tired: {
    kind: 'activity',
    family: 'anim_wild_tired',
    label: '累瘫',
    facial: 'Shy_Sad',
    re: /累|疲惫|没力气|乏|撑不住|精疲力/,
    hisBody: true,
    contagious: false,
    companion: false,
    native: { name: 'Wild001_Motion15_Tired', id: 64 },
  },
  breathe: {
    kind: 'activity',
    family: 'anim_wild_breath',
    label: '深呼吸',
    facial: 'Shy_Rest',
    re: /深呼吸|喘口气|呼吸一下|喘一下/,
    hisBody: true,
    contagious: true,
    companion: false,
    native: { name: 'Wild001_Motion17_DeepBreath', id: 66 },
  },

  // ── 在做事 ──────────────────────────────────────────────────
  work_pc: {
    kind: 'activity',
    family: 'anim_work_pc_sub_thinking',
    // 官方状态机入口。有它就不走采样：游戏自己跑 base_start -> base_loop -> base_end。
    state: 'WorkPC',
    label: '敲键盘',
    re: /写.{0,3}代码|敲.{0,3}代码|编码|调试|debug|程序|电脑|键盘|跑一下|编译/,
    hisBody: false,
    contagious: false,
    companion: true,
    native: null,
  },
  work_report: {
    kind: 'activity',
    family: 'anim_work_report_sub_thinking',
    // 官方状态机入口。有它就不走采样：游戏自己跑 base_start -> base_loop -> base_end。
    state: 'WorkReport',
    label: '写报告',
    re: /写.{0,3}报告|报告|文档|写字|周报/,
    hisBody: false,
    contagious: false,
    companion: true,
    native: null,
  },
  read_book: {
    kind: 'activity',
    family: 'anim_work_book_sub_pageflip',
    // 官方状态机入口。有它就不走采样：游戏自己跑 base_start -> base_loop -> base_end。
    state: 'WorkBook',
    label: '看书',
    re: /看.{0,2}书|读.{0,2}书|翻书|课本|教材|习题/,
    hisBody: false,
    contagious: false,
    companion: true,
    native: null,
  },
  novel: {
    kind: 'activity',
    family: 'anim_break_novel_sub_pageflip_next',
    // 官方状态机入口。有它就不走采样：游戏自己跑 base_start -> base_loop -> base_end。
    state: 'BreakReadBook',
    label: '看小说',
    re: /小说|故事|章节|长篇小说/,
    hisBody: false,
    contagious: false,
    companion: true,
    native: null,
  },
  movie: {
    kind: 'activity',
    family: 'anim_break_movie_sub_suspense',
    // 官方状态机入口。有它就不走采样：游戏自己跑 base_start -> base_loop -> base_end。
    state: 'BreakMovie',
    label: '看电影',
    re: /电影|影片|看片|追剧/,
    hisBody: false,
    contagious: false,
    companion: true,
    native: null,
  },
  music: {
    kind: 'activity',
    family: 'anim_break_music_low',
    // 官方状态机入口。有它就不走采样：游戏自己跑 base_start -> base_loop -> base_end。
    state: 'BreakListenMusic',
    label: '听歌',
    // "听会儿歌"中间夹了字，写死"听歌"匹配不到。
    re: /听.{0,4}歌|音乐|耳机|放首歌|来首歌/,
    hisBody: false,
    contagious: false,
    companion: true,
    native: null,
  },

  // ── 手势（一两秒的反应，不占主时间）───────────────────────────
  nod: {
    kind: 'gesture',
    family: 'anim_story_base001_sub_nod',
    label: '点头',
    re: /点头|同意|赞成|就这么定了|按这个来|好耶/,
    hisBody: false,
    contagious: false,
    companion: false,
    native: { name: 'Base001_Motion12_Start_Nod', id: 12 },
  },
  shy: {
    kind: 'gesture',
    family: 'anim_story_base001_sub_shy',
    label: '害羞',
    facial: 'Shy_Fun',
    re: /害羞|不好意思|脸红|别夸|夸我|讨厌/,
    hisBody: false,
    contagious: false,
    companion: false,
    native: { name: 'Base001_Motion5_Shy', id: 5 },
  },
  think: {
    kind: 'gesture',
    family: 'anim_story_base001_sub_thinking1',
    label: '想一想',
    re: /想想|琢磨|思考|纠结|犹豫|怎么办/,
    hisBody: false,
    contagious: false,
    companion: false,
    // Thinking 在 WorkBase001/002/003 里都有，工位上想事情和坐着想事情姿势不同。
    native: { name: 'Base001_Motion8_Thinking', id: 8, sub: 'Thinking' },
  },
  laugh: {
    kind: 'gesture',
    family: 'anim_break_movie_sub_laugh',
    label: '笑',
    facial: 'Shy_Joy',
    re: /好笑|哈哈|笑死|搞笑|逗/,
    hisBody: false,
    contagious: false,
    companion: false,
    // BreakBase001_Laugh 是坐下时真的笑出声，比采样 anim_break_movie_sub_laugh 对口。
    native: { sub: 'Laugh' },
  },

  // ── 持续状态里的"片段"，不是换状态 ───────────────────────────────
  // 游戏在每个基底上都实现了一遍同名子动作（WorkBase002_PageFlip、WorkBase002_Thinking…），
  // 而且演完会自己回到 base_loop。所以这里只给后缀，全名由 DLL 按她此刻的基底拼。
  // 只在读书/写字这类持续状态里成立：基底对不上时 DLL 会退回采样或跳过。
  pageflip: {
    kind: 'gesture',
    family: 'anim_work_book_base_loop2_pageflip',
    label: '翻页',
    re: /翻页|翻一页|翻到下一|下一页|翻过去/,
    hisBody: false,
    contagious: false,
    companion: false,
    native: { sub: 'PageFlip', also: 'NextPage' },
  },

  // 电影看到揪心处的那种反应。基底是 BreakBase001 时才有 Suspenseful，
  // 不在看电影就会被 ResolveNativeSub 判成"基底无此子动作"，退回采样。
  suspense: {
    kind: 'gesture',
    family: 'anim_break_movie_sub_suspense_loop',
    label: '揪心',
    re: /紧张|揪心|好悬|捏把汗|不敢看/,
    hisBody: false,
    contagious: false,
    companion: false,
    native: { sub: 'Suspenseful' },
  },
}

// 顺序即优先级：先说到的、更需要身体的排前面。
// decideCore 按这个顺序找第一个命中，所以调整顺序会改变匹配结果。
export const ACTION_ORDER = [
  'drink',
  'tea',
  'sleep',
  'stretch',
  'shoulder',
  'yawn',
  'tired',
  'breathe',
  'work_pc',
  'work_report',
  'read_book',
  'novel',
  'movie',
  'music',
  'nod',
  'shy',
  'think',
  'laugh',
  'pageflip',
  'suspense',
]

// 数组形态，给按顺序遍历的调用方（decideCore）
export const ORDERED_ACTIONS = ACTION_ORDER.map((verb) => ({ verb, ...ACTIONS[verb] }))

// ── 派生的集合：不再手抄第二份 ──────────────────────────────────
const pick = (field) => ACTION_ORDER.filter((v) => ACTIONS[v][field])

/** 他说他在做的事，她陪着做自己那份 */
export const COMPANION_VERBS = new Set(pick('companion'))
/** 会传染的身体反应，按动词 */
export const CONTAGIOUS = new Set(pick('contagious'))
/** 他的身体，按族名（精确匹配，不是子串） */
export const HIS_BODY = new Set(pick('hisBody').map((v) => ACTIONS[v].family))
/** 会传染的族名 */
export const CONTAGIOUS_FAM = new Set(pick('contagious').map((v) => ACTIONS[v].family))

/**
 * 专注态下这些动词演不了（要抬胳膊 / 起身 / 切整个状态），换成头颈能做的那个。
 *
 * 早先是"排完再丢"：导演层照常给全身动作，直到 extractNeeds 末端才判掉。
 * 后果不是"她只动头"，而是**十条里空六条**——预算全花在不能演的素材上，
 * 她像掉线一样坐在那儿。所以这里给每个演不了的动词指定一个头颈替代，
 * 由 needs 在过滤时替换而不是删除。
 *
 * 只放手势类、且不带 state 的动词：`nod` / `think` / `suspense` / `shy` / `laugh`。
 * 挑法按"同一个意思里最不打断工作的那一个"：
 *   - 看东西 / 干活 → think（抬头想一想）
 *   - 喝 / 伸 / 累 / 听音乐 → nod（轻轻点一下）
 *   - 看电影 → suspense（本来就是电影族的子动作，只是不切状态）
 */
export const FOCUS_ALT = {
  drink: 'nod',
  tea: 'nod',
  stretch: 'nod',
  shoulder: 'nod',
  yawn: 'nod',
  tired: 'nod',
  breathe: 'nod',
  music: 'nod',
  work_pc: 'think',
  work_report: 'think',
  read_book: 'think',
  novel: 'think',
  pageflip: 'think',
  movie: 'suspense',
}

export function isHisBody(family) {
  return HIS_BODY.has(String(family))
}

export function isContagiousFamily(family) {
  return CONTAGIOUS_FAM.has(String(family))
}

/** 动词 → 族名（未知动词返回空串） */
export function familyOf(verb) {
  const a = ACTIONS[verb]
  return a ? a.family : ''
}

/** 动词 → 原生 AnimationType，没有就 null
 *
 * nativeSub 只带后缀（如 "DrinkTea"），全名由游戏端按她此刻的基底拼：
 *   BreakBase004_DrinkTea / WorkBase002_DrinkTea / ...
 * 同一个语义在不同基底下姿势不同，所以这里不能写死全名。
 * nativeName 仍然保留：基底拼不出来时（比如她在站着）当兜底。
 */
export function nativeOf(verb) {
  const a = ACTIONS[verb]
  if (!a || !a.native) return null
  const out = {}
  if (a.native.name) out.nativeName = a.native.name
  if (a.native.id !== undefined) out.nativeId = a.native.id
  if (a.native.sub) out.nativeSub = a.native.sub
  if (a.native.also) out.nativeAlso = [].concat(a.native.also).join(',')
  return out
}
