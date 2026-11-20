/**
 * state.json 的读写：加载、白名单合并、写前对账、原子落盘。
 *
 * 从 brain.mjs 拆出来（原来 3,000 行里 state 的读写夹在业务中间，改一处要读全文件）。
 * 两条硬规则留在这里，别在调用方重复实现：
 *   1. 写之前先和盘上对账：盘上被别人改过就以盘上为准，绝不用内存里的旧值盖掉外部编辑
 *   2. 整份写必须 tmp + rename：直接 writeFile 撞上进程换代就剩半份 JSON，
 *      下次启动按坏文件隔离（2026-11-14 真发生过）
 */
import { readFile, writeFile, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'

/**
 * @param {{ path: string, defaults: object, log?: Function, ensureDir?: () => Promise<void>, settleMs?: number }} opts
 * @returns {{ state: object, load: () => Promise<object>, save: () => Promise<void>, hash: (text: string) => string }}
 */
export function createStateFile(opts) {
  const { path, defaults } = opts
  const log = typeof opts.log === 'function' ? opts.log : () => {}
  const ensureDir = typeof opts.ensureDir === 'function' ? opts.ensureDir : async () => {}
  const settleMs = Number(opts.settleMs) || 150

  // 调用方拿到的就是这个对象本身（不是副本）：改 state.xxx 与 save() 看到的是同一份
  const state = { ...defaults }
  let seenHash = ''
  // 原来在 brain.mjs 模块级，搬过来要自带一份（save() 里拼 savedAt 用）
  const nowIso = () => new Date().toISOString()
  const hash = (text) => createHash('sha256').update(String(text)).digest('hex')

  /**
   * 读回上次的状态。以前只有 saveState、没有 loadState：好感度、心情、能量、
   * 番茄钟计数每次重启都从 defaults 重来，用户攒的东西白攒。
   * 坏文件不覆盖（改名留证），按默认值继续，别让一行坏 JSON 把侧车拦在启动前。
   */
  const load = async () => {
    try {
      let raw = await readFile(path, 'utf8')
      // 坏 JSON 先重试一次再判死：进程换代时可能读到上一份写了一半的文件，
      // 直接改名隔离会把「其实完好、只是赶上撕裂读」的状态扔掉
      // （2026-11-14 就隔离了一份解析起来完全正常的 state.json）。
      let parsed = null
      try {
        parsed = JSON.parse(raw)
      } catch (first) {
        await new Promise((resolve) => setTimeout(resolve, 150))
        raw = await readFile(path, 'utf8')
        parsed = JSON.parse(raw)   // 还是坏就交给外层 catch 走隔离
      }
      seenHash = hash(raw)
      if (parsed && typeof parsed === 'object') {
        // 白名单合并：只认 defaults 里已有的键，防止旧版本残留字段污染
        for (const key of Object.keys(defaults)) {
          if (parsed[key] !== undefined) state[key] = parsed[key]
        }
        // 这几个字段必须是数字，坏值会让 good/能量计算一路 NaN
        for (const key of ['affection', 'mood', 'energy', 'moodVel', 'turnCount', 'focusCount', 'breakCount']) {
          if (typeof state[key] !== 'number' || !Number.isFinite(state[key])) state[key] = defaults[key]
        }
        if (state.pomo && typeof state.pomo === 'object') {
          state.pomo = { ...defaults.pomo, ...state.pomo }
        }
        log('state loaded', { affection: state.affection, turnCount: state.turnCount })
      }
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        log('state load failed, using defaults', { error: String(error?.message || error) })
        try {
          await rename(path, path + '.bad-' + Date.now())
        } catch { /* 留证失败就算了，不挡启动 */ }
      }
    }
  }

  const save = async () => {
    try {
      await ensureDir()
      // 写之前先和盘上对账。
      //
      // 进程内的 state 和 state.json 是同一份数据的两个副本，没有这道检查就会出现
      // 「外部改过盘上的文件，进程下一次定时保存把它整份盖回去」——2026-11-14 清理记忆时
      // 就被这一下把清好的 lastTopic / recentSubs 又写了回来，删了等于没删。
      // 规则：盘上被人改过 → 认盘上的（外部编辑优先），只保留我们自己没被改的字段。
      try {
        const diskRaw = await readFile(path, 'utf8')
        const diskHash = hash(diskRaw)
        if (seenHash && diskHash !== seenHash) {
          const disk = JSON.parse(diskRaw)
          if (disk && typeof disk === 'object') {
            for (const key of Object.keys(defaults)) {
              if (disk[key] !== undefined) state[key] = disk[key]
            }
            log('state reloaded: 盘上被外部改过，按盘上的走', {})
          }
        }
      } catch (error) {
        // ENOENT = 第一次写，正常；坏 JSON 也不挡保存，下一行照样写出合法文件
        if (error && error.code !== 'ENOENT') {
          log('state pre-save check failed', { error: String(error?.message || error) })
        }
      }
      const text = JSON.stringify({ ...state, savedAt: nowIso() }, null, 2)
      // 原子写：先写 .tmp 再 rename。直接 writeFile 一旦撞上进程被换掉/杀掉，
      // 盘上就剩半份 JSON，下次启动按坏文件隔离，turnCount / lastTopic 全丢
      // （2026-11-14 换代码时真的发生过一次：state.json 变成 913B 的 .bad，
      //  但内容其实是合法的——是读到写了一半的文件）。
      const tmp = path + '.tmp'
      await writeFile(tmp, text, 'utf8')
      await rename(tmp, path)
      seenHash = hash(text)
      return { ok: true }
    } catch (error) {
      // 以前只 log，调用方无从得知：磁盘满 / 只读 / 被占锁时，/act 与面板都显示成功，
      // 重启后好感度、最近对话、lastTopic 一起消失，事后只能翻日志找。
      log('state save failed', { error: String(error?.message || error) })
      return { ok: false, error: String(error?.message || error) }
    }
  }

  return { state, load, save, hash }
}
