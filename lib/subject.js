// 一句话里，某个作作的主语是谁：我（他）／你（她）／我们（一起）／没说。
//
// 为什么要有这一层：心心作作层只认作词不认人，于是
//   「我去沙发上躺一会儿」→ 判成"她要离座"：他要躺，躺的却是她；
//   「我有点渴了」        → 判成"她要喝水"：他渴，她去抿一口；
//   「你困了吧」          → 这个是对的，主语是她。
// 这些都不是参数没调好，是主谓关系没判。所以先把"谁"判出来，再交给作作层。
//
// 中文里主语常省略，规则只能按就近 + 常见句式来：
//   1. 派活句式（让我 / 帮我 / 给你 / 叫你）先把主语翻过去 —— 「帮我倒杯水」是让她倒；
//   2. 否则在作词前一小段里找最近的人称代词，谁更靠近作词就是谁；
//   3. 都没找到 = 省略主语，按"她"处理（她说自己的状态、或者这句话是在吩咐她）。

// 派活：这些字眼 + 我 = 作作是给"我"做的，但执行者是她
const DELEGATE = /让|帮|替|给|叫|请|麻烦/

/**
 * @param {string} text 整句
 * @param {number} atChar 作词在句中的位置
 * @param {number} window 往前看多少字
 * @returns {'me'|'you'|'we'|'none'}
 */
export function subjectOf(text, atChar, window = 10) {
  const s = String(text || '')
  const at = Number.isFinite(atChar) ? Math.max(0, atChar) : 0
  const before = s.slice(Math.max(0, at - window), at)

  // 「让我歇会儿」「帮我倒杯水」：执行者是她
  if (DELEGATE.test(before) && /我/.test(before)) return 'you'

  const iMe = Math.max(before.lastIndexOf('我'), before.lastIndexOf('俺'), before.lastIndexOf('咱'))
  const iYou = Math.max(before.lastIndexOf('你'), before.lastIndexOf('您'))
  if (iMe < 0 && iYou < 0) return 'none'
  if (iYou < 0) {
    // 「我们/咱们」= 一起，不算把他自己的事推给她
    if (/我们|咱们|咱俩/.test(before)) return 'we'
    return 'me'
  }
  if (iMe < 0) return 'you'
  return iMe > iYou ? 'me' : 'you'
}

/** 这句话是不是在说"他自己要做这件事"。 */
export function isHisOwn(text, atChar) {
  return subjectOf(text, atChar) === 'me'
}

/**
 * 整句是不是都在说他（有"我"、没"你"、也不是派活）。
 * 用来在作作层兜底：模型看到"我困得不行了"会自己挑打哈欠，
 * 那条不是从文本判出来的心心，光靠 decideCore 拦不住，得在 cue 层也过滤一次。
 */
export function isAboutHim(text) {
  const s = String(text || '')
  if (!/[我俺咱]/.test(s)) return false
  if (DELEGATE.test(s) && /我/.test(s)) return false // 帮我/让我…＝她做
  return !/[你您]/.test(s)
}
