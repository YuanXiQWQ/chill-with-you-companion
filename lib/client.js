// 客户端模块的注册 ID 必须与宿主「当前加载的」插件名一致。
// 宿主只在进程启动时读 cordis.patch.yml / package.json，改包名后要重启 dsh web 才对齐。
// 公开版固定用包名，不再兼容早期的本地别名——那条分支只会让改错名时静默丢面板。
const __CHILL_MODULE_ID__ = 'dsh-chill-with-you-companion'

window.__ModuleLoader__.load({
  id: __CHILL_MODULE_ID__,
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    const API = '/chill/v1'
    const PANEL_ID = 'chill-console'

    const T = {
      bg: 'var(--dsw-alias-bg-base)',
      l1: 'var(--dsw-alias-bg-layer-1)',
      l2: 'var(--dsw-alias-bg-layer-2)',
      b1: 'var(--dsw-alias-border-l1)',
      b2: 'var(--dsw-alias-border-l2)',
      tx: 'var(--dsw-alias-label-primary)',
      tx2: 'var(--dsw-alias-label-secondary)',
      brand: 'var(--dsw-alias-brand-primary)',
      ok: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      err: 'var(--dsw-alias-state-error-primary)',
      idle: 'var(--dsw-alias-state-idle-primary)',
    }

    const S = {
      page: {
        height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0,
        background: T.bg, color: T.tx,
        font: '13px/1.5 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
      },
      head: {
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
        borderBottom: '1px solid ' + T.b1, background: T.l1, flex: '0 0 auto',
      },
      title: { fontSize: 15, fontWeight: 600, letterSpacing: '.2px' },
      sub: { fontSize: 12, color: T.tx2 },
      tabs: { display: 'flex', gap: 4, padding: '8px 12px 0', background: T.l1, flex: '0 0 auto' },
      body: { flex: '1 1 auto', overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 },
      card: { background: T.l1, border: '1px solid ' + T.b1, borderRadius: 10, padding: 12 },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10 },
      grid2: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10 },
      label: { fontSize: 11, color: T.tx2, letterSpacing: '.4px', textTransform: 'uppercase' },
      value: { fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
      input: {
        width: '100%', boxSizing: 'border-box', padding: '9px 11px', fontSize: 13,
        borderRadius: 8, border: '1px solid ' + T.b2, background: T.l2, color: T.tx,
        outline: 'none', resize: 'vertical', font: 'inherit',
      },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 12 },
      chip: {
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11.5,
        borderRadius: 999, border: '1px solid ' + T.b1, background: T.l2, color: T.tx2,
      },
      scroll: { maxHeight: 'min(46vh, 380px)', overflow: 'auto' },
    }

    function tabStyle(on) {
      return {
        padding: '7px 14px', fontSize: 13, cursor: 'pointer', borderRadius: '8px 8px 0 0',
        border: '1px solid ' + (on ? T.b1 : 'transparent'),
        borderBottom: '1px solid ' + (on ? T.l1 : T.b1),
        background: on ? T.l1 : 'transparent',
        color: on ? T.tx : T.tx2, fontWeight: on ? 600 : 400,
        marginBottom: -1, userSelect: 'none',
      }
    }

    function btnStyle(on) {
      return {
        padding: '6px 12px', fontSize: 12.5, borderRadius: 8, cursor: 'pointer',
        border: '1px solid ' + (on ? T.brand : T.b2),
        background: on ? T.brand : 'transparent', color: on ? '#fff' : T.tx,
        whiteSpace: 'nowrap',
      }
    }

    function dot(color) {
      return { width: 8, height: 8, borderRadius: 4, background: color, display: 'inline-block' }
    }

    async function api(path, init) {
      const opts = Object.assign({ headers: { 'content-type': 'application/json' } }, init)
      const res = await fetch(API + path, opts)
      const text = await res.text()
      let json = null
      try { json = text ? JSON.parse(text) : null } catch (e) { json = { raw: text } }
      if (!res.ok) {
        const e2 = json && json.error
        const msg = e2 && (e2.message || e2)
        throw new Error(typeof msg === 'string' ? msg : ('HTTP ' + res.status))
      }
      return json
    }

    const PHASES = [
      ['focus_start', '开始专注'],
      ['focus_end', '结束专注'],
      ['break', '休息一下'],
      ['idle', '回到空闲'],
    ]

    function clock(ms) {
      if (!ms) return '—'
      const d = new Date(ms)
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
    }

    function PanelIcon(props) {
      const size = (props && props.size) || 20
      const active = !!(props && props.active)
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        style: { display: 'block', opacity: active ? 1 : 0.72 },
      },
      h('path', { d: 'M4 12a8 8 0 0 1 16 0', strokeWidth: 1.7, strokeLinecap: 'round' }),
      h('path', { d: 'M6.6 12.8c1.5.9 3 2.8 3.1 5.2', strokeWidth: 1.5, strokeLinecap: 'round' }),
      h('path', { d: 'M17.4 12.8c-1.5.9-3 2.8-3.1 5.2', strokeWidth: 1.5, strokeLinecap: 'round' }),
      h('path', { d: 'M12 8l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z', strokeWidth: 1.2, strokeLinejoin: 'round' }))
    }

    function Bar(props) {
      const r = Math.max(0, Math.min(1, Number(props.ratio) || 0))
      return h('div', { style: { height: 6, borderRadius: 3, background: T.l2, overflow: 'hidden', marginTop: 6 } },
        h('div', { style: { width: (r * 100).toFixed(1) + '%', height: '100%', background: props.color || T.brand, transition: 'width .3s ease' } }))
    }

    function StatCard(props) {
      return h('div', { style: S.card },
        h('div', { style: S.label }, props.label),
        h('div', { style: Object.assign({}, S.value, props.color ? { color: props.color } : null) }, props.value),
        props.hint ? h('div', { style: { fontSize: 11.5, color: T.tx2, marginTop: 2 } }, props.hint) : null)
    }

    function StatusTab(props) {
      const health = props.health
      const g = (health && health.game) || {}
      const healthErr = props.healthErr || ''
      const online = Boolean(health && health.gameOnline)
      const busy = Boolean(g.busy)
      const ageMs = health && health.gameAgeMs != null ? health.gameAgeMs : null
      const evidence = Array.isArray(g.evidence) ? g.evidence : []
      const st = (health && health.state) || {}
      const pomo = st.pomo || {}
      const pomoChip = (function () {
        if (!online) return ['番茄钟 —', T.tx2]
        if (pomo.running) {
          const ms = Number(pomo.remainMs) || 0
          const mm = Math.floor(ms / 60000)
          const ss = Math.floor((ms % 60000) / 1000)
          const total = pomo.totalMs > 0 ? Math.round(pomo.totalMs / 60000) : 0
          return ['番茄钟 ' + mm + ':' + String(ss).padStart(2, '0') + (total ? ' / ' + total + ' 分' : ''), T.brand]
        }
        if (st.phase === 'break') return ['刚跑完 · 休息中', T.ok]
        if (pomo.panelOpen) return ['番茄钟面板已开 · 未计时', T.tx2]
        return ['番茄钟 空闲 · 今天 ' + (st.focusCount || 0) + ' 个', T.tx2]
      })()
      const energy = Number(st.energy)
      const affection = Number(st.affection)

      const row = function (label, value, tone) {
        return h('div', { key: label, style: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0' } },
          h('span', { style: { color: T.tx2, fontSize: 12 } }, label),
          h('span', { style: { color: tone || T.tx, fontSize: 12, fontVariantNumeric: 'tabular-nums' } }, value))
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        h('div', { style: S.card },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 } },
            h('div', { style: Object.assign({}, S.label, { fontSize: 12 }) }, '游戏检测'),
            h('span', {
              style: Object.assign({}, S.chip, {
                borderColor: online ? T.ok : T.warn,
                color: online ? T.ok : T.warn,
              }),
            }, online ? '在线 · ' + (g.scene || '—') : '离线'),
            h('span', {
              style: Object.assign({}, S.chip, {
                borderColor: busy ? T.brand : T.b1,
                color: busy ? T.brand : T.tx2,
              }),
            }, busy ? '游戏占用演出 · ' + (g.busyReason || '') : '演出权在我们'),
            ageMs == null ? null : h('span', { style: Object.assign({}, S.chip, { color: T.tx2 }) }, '心跳 ' + (ageMs / 1000).toFixed(1) + 's'),
            h('span', {
              style: Object.assign({}, S.chip, { borderColor: pomoChip[1], color: pomoChip[1] }),
              title: '游戏那边番茄钟现在的状态（由心跳里的 focus / timer 推出来）',
            }, pomoChip[0]),
            Number.isFinite(energy)
              ? h('span', { style: Object.assign({}, S.chip, { color: T.tx2 }) }, '精神 ' + energy)
              : null,
            Number.isFinite(affection)
              ? h('span', { style: Object.assign({}, S.chip, { color: T.tx2 }) }, '亲近 ' + affection)
              : null),
          online
            ? h('div', { style: S.grid2 },
              h('div', null,
                h('div', { style: Object.assign({}, S.label, { marginBottom: 6 }) }, '运行'),
                row('场景', g.scene || '—'),
                row('帧率', g.fps == null ? '—' : g.fps + ' fps'),
                row('动作库', g.clips == null ? '—' : String(g.clips)),
                row('女主就绪', g.heroineReady ? '是' : '否'),
                row('拉取序号', g.pullSeq == null ? '—' : String(g.pullSeq)),
                row('插件版本', g.version || '—')),
              h('div', null,
                h('div', { style: Object.assign({}, S.label, { marginBottom: 6 }) }, '正在发生'),
                row('当前动作', g.clip || '—', g.clip ? T.ok : null),
                row('字幕', g.subtitle || '—', g.subtitle ? T.ok : null),
                row('口型', g.mouth ? '说话中' : '静'),
                row('语音', g.audio ? '播放中' : '—'),
                row('最后错误', g.lastError ? g.lastError : '无', g.lastError ? T.warn : null)))
            : h('div', { style: { color: T.tx2, fontSize: 12 } },
              '没收到游戏心跳。启动游戏（插件会每 2 秒上报一次），这里会自动亮起来。'),
          healthErr ? h('div', { style: { color: T.warn, fontSize: 12, marginTop: 8 } }, '健康检查失败：' + healthErr) : null),
        h('div', { style: S.card },
          h('div', { style: Object.assign({}, S.label, { marginBottom: 8 }) }, '让台判定依据'),
          evidence.length
            ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
              evidence.map(function (e) { return h('span', { key: e, style: S.chip }, e) }))
            : h('div', { style: { color: T.tx2, fontSize: 12 } }, '没命中任何条件：剧情场景 / 剧情文本 / 游戏语音 都没在跑。'),
          h('div', { style: { color: T.tx2, fontSize: 11, marginTop: 8 } },
            '判定规则：场景名含 story/novel/scenario；激活的剧情向 TMP 文本非空；非本插件音源在播 Voice* 命名 clip。任一命中即让台。')),
        h('div', { style: S.card },
          h('div', { style: Object.assign({}, S.label, { marginBottom: 8 }) }, '原始心跳'),
          h('pre', {
            style: {
              margin: 0, fontSize: 11, lineHeight: 1.5, color: T.tx2, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              maxHeight: 220, overflow: 'auto',
            },
          }, online ? JSON.stringify(g, null, 2) : '{}')))
    }

    function ChatTab(props) {
      const chat = props.chat || []
      // 两个模式共用同一份聊天记录：模式只决定她怎么动（观察那边，
      // 闲聊模式纯聊），不决定这里显示什么。她在被观察时主动说的那几句本来就写进
      // 同一份记忆，所以切到工作模式也能接上刚才聊到哪儿。
      // 那边的流水（提问/回答/工具调用）不混进聊天区——工作条上那一行已经写了
      // 她在看着谁、那轮跑没跑完，不需要把整条时间线铺在这儿。
      const msgs = chat
      const listRef = React.useRef(null)
      const mem = props.memStats || {}

      React.useEffect(function () {
        const el = listRef.current
        if (el) el.scrollTop = el.scrollHeight
      }, [msgs.length, props.busy])

      const HER = 'rgba(120,110,240,0.14)'
      const HER_LINE = 'rgba(120,110,240,0.38)'

      // 头像是游戏左上角那两个头像本身（聪音 / 玩家），圆形、1:1 显示。
      const avatar = function (mine, size) {
        const s = size || 34
        return h('img', {
          src: mine ? props.userAvatarUrl : props.avatarUrl,
          alt: mine ? '你' : '聪音',
          style: {
            width: s, height: s, flex: '0 0 auto', borderRadius: '50%',
            objectFit: 'cover', display: 'block', background: T.l2,
            border: '1px solid ' + T.b1,
          },
        })
      }

      // 气泡：QQ 那种小尖角用一个小方块旋转 45° 贴在气泡侧面
      const bubble = function (m, i, showHead) {
        const mine = m.role === 'user'
        const tail = h('div', {
          style: {
            position: 'absolute', top: 12, width: 8, height: 8,
            background: mine ? T.l2 : HER,
            borderLeft: '1px solid ' + (mine ? T.b1 : HER_LINE),
            borderBottom: '1px solid ' + (mine ? T.b1 : HER_LINE),
            transform: 'rotate(45deg)',
            left: mine ? 'auto' : -4,
            right: mine ? -4 : 'auto',
          },
        })
        return h('div', {
          key: (m.at || '') + i,
          style: {
            display: 'flex', gap: 8, marginBottom: 12,
            flexDirection: mine ? 'row-reverse' : 'row',
            alignItems: 'flex-start',
          },
        },
          showHead ? avatar(mine) : h('div', { style: { width: 34, flex: '0 0 auto' } }),
          h('div', { style: { maxWidth: '78%', display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' } },
            showHead
              ? h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3, flexDirection: mine ? 'row-reverse' : 'row' } },
                h('span', { style: { fontSize: 11, color: T.tx2 } }, mine ? '你' : '聪音'),
                m.emotion ? h('span', { style: Object.assign({}, S.chip, { fontSize: 10, padding: '0 6px', borderColor: T.brand, color: T.brand }) }, m.emotion) : null)
              : null,
            h('div', { style: { position: 'relative', display: 'inline-block' } },
              tail,
              h('div', {
                style: {
                  padding: '9px 12px', borderRadius: 10, fontSize: 13.5, lineHeight: 1.7,
                  background: mine ? T.l2 : HER,
                  border: '1px solid ' + (mine ? T.b1 : HER_LINE),
                  color: T.tx, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
                },
              }, m.text)),
            h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 10.5, color: T.tx2, marginTop: 3 } },
              m.audioUrl
                ? h('button', {
                  type: 'button',
                  style: Object.assign({}, btnStyle(false), { fontSize: 10, padding: '0 5px', minWidth: 0 }),
                  title: '听一遍她这句',
                  onClick: function () { try { new Audio(m.audioUrl).play() } catch (e) { /* 自动播放被拦就算了 */ } },
                }, '🔊')
                : null,
              h('span', null, clock(Date.parse(m.at || 0) || 0))
            )
          )
        )
      }

      // 时间分隔条：相邻两条间隔超过 10 分钟就插一条
      const rows = []
      let prevAt = 0
      let prevRole = ''
      msgs.forEach(function (m, i) {
        const at = Date.parse(m.at || 0) || 0
        if (!prevAt || at - prevAt > 10 * 60 * 1000) {
          rows.push(h('div', { key: 't' + i, style: { textAlign: 'center', margin: '6px 0 12px' } },
            h('span', { style: Object.assign({}, S.chip, { fontSize: 10.5, background: 'transparent' }) }, clock(at))))
          prevRole = ''
        }
        if (m.role === 'note') {
          // 过程提示（开始处理了 / 调了哪个工具 / 这轮没成）：居中小字，不占气泡
          rows.push(h('div', {
            key: 'n' + i,
            style: { textAlign: 'center', margin: '4px 0 8px' },
          }, h('span', { style: { fontSize: 11, color: m.error ? T.err : T.tx2 } }, m.text)))
          prevRole = ''
          prevAt = at
          return
        }
        rows.push(bubble(m, i, m.role !== prevRole))
        prevAt = at
        prevRole = m.role
      })

      const canSend = !props.busy && String(props.text || '').trim().length > 0
      const sendNow = function (remember) {
        props.onSay(props.text, remember)
      }
      const work = props.work || {}
      const bound = work.bound || null
      const herLabel = '聪音'
      const herStatus = props.busy
        ? '正在输入…'
        : (bound ? '在线 · 看着「' + bound.title + '」' : '在线 · 和游戏同步')

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 0, height: '100%', minHeight: 0 } },
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
            borderBottom: '1px solid ' + T.b1, background: T.l1, borderRadius: '10px 10px 0 0',
          },
        },
          avatar(false, 30),
          h('div', { style: { display: 'flex', flexDirection: 'column', lineHeight: 1.25 } },
            h('div', { style: { fontSize: 13.5, fontWeight: 600 } }, herLabel),
            h('div', { style: { fontSize: 11, color: (props.busy || (work.busy && work.busy.running)) ? T.brand : T.ok } }, herStatus)),
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' } },
            h('span', { style: S.chip }, '记忆 ' + (mem.facts == null ? 0 : mem.facts)),
            h('span', { style: S.chip }, '原文 ' + (mem.turns == null ? 0 : mem.turns) + ' 轮'),
            h('span', { style: S.chip }, '摘要 ' + (mem.summaryChars == null ? 0 : mem.summaryChars) + ' 字'),
            h('button', {
              type: 'button',
              style: Object.assign({}, btnStyle(false), { padding: '2px 8px', fontSize: 11 }),
              onClick: props.onRefresh,
            }, '刷新'))),

        // 模式条：在这儿切换聊天 / 工作
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
            background: T.l1, borderBottom: '1px solid ' + T.b1, flexWrap: 'wrap',
          },
        },
          (function () {
            const live = Boolean(work.watching)
            const liveText = live
              ? (work.busy && work.busy.running ? '那边这轮在跑' : '在看着')
              : (bound ? '看着的那条断了' : '')
            if (!bound) return h('span', { style: { fontSize: 11, color: T.tx2 } }, '在这儿聊天，游戏那边同步表演')
            return h('span', { style: { fontSize: 11, color: live ? T.ok : T.tx2 } },
              '观察：' + bound.title + (liveText ? ' · ' + liveText : ''))
          })(),
          h('div', { style: { display: 'flex', gap: 6, marginLeft: 'auto' } },
            // 网页自己开不了没有地址栏的窗口，还是让 sidecar 代拉浏览器 --app 模式。
            h('button', {
              type: 'button',
              style: Object.assign({}, btnStyle(false), { padding: '2px 8px', fontSize: 11 }),
              onClick: function () {
                fetch('/chill/v1/quickbox', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: '{}',
                }).then(function (r) { return r.json() }).then(function (j) {
                  if (!j || j.ok !== true) console.warn('[chill] 快捷框没起来', j)
                }).catch(function (e) { console.warn('[chill] 快捷框请求失败', e) })
              },
              title: '拉起快捷对话框：一个没有地址栏的小窗口，可以拖到任何地方',
            }, '启动快捷框'),
            h('button', {
              type: 'button',
              style: Object.assign({}, btnStyle(false), { padding: '2px 8px', fontSize: 11 }),
              onClick: function () { props.onReloadWork() },
            }, '刷新工作台'),
            h('button', {
              type: 'button',
              style: Object.assign({}, btnStyle(false), { padding: '2px 8px', fontSize: 11 }),
              onClick: function () { props.onSpark() },
              title: '不看她那边，纯让她自己想句话出来说（会推给游戏演）',
            }, '让她说句话'),
            bound
              ? h('button', {
                type: 'button',
                style: Object.assign({}, btnStyle(false), { padding: '2px 8px', fontSize: 11 }),
                onClick: function () { props.onLookWork() },
                title: '让她冷读一眼那条对话（不会干扰那边干活），自己判断要不要说句话',
              }, '看一眼')
              : null
          )),

        // 观察条常驻：选一条 DSH 对话让她看着（只读，不往里发话）
        h('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
              background: T.l1, borderBottom: '1px solid ' + T.b1, flexWrap: 'wrap',
            },
          },
            h('select', {
              value: props.workPick || '',
              onChange: function (e) { props.onPick(e.target.value) },
              style: Object.assign({}, S.input, { padding: '4px 8px', fontSize: 11.5, maxWidth: 340, width: 'auto' }),
            },
              h('option', { value: '' }, (work.sessions || []).length ? '选一条对话…' : '没有可选的对话'),
              (work.sessions || []).map(function (s) {
                return h('option', { key: s.sessionId, value: s.sessionId },
                  (s.running ? '● ' : '') + s.title + (s.bound ? '（正在观察）' : ''))
              })),
            h('button', {
              type: 'button',
              style: Object.assign({}, btnStyle(true), { padding: '2px 10px', fontSize: 11.5 }),
              disabled: Boolean(props.workBusy) || !props.workPick,
              onClick: function () {
                const picked = (work.sessions || []).filter(function (x) { return x.sessionId === props.workPick })[0]
                props.onBind(props.workPick, picked ? picked.title : '')
              },
            }, '观察'),
            // 停止观察：只解除当前选定的这一条，不碰别的
            h('button', {
              type: 'button',
              style: Object.assign({}, btnStyle(false), { padding: '2px 10px', fontSize: 11.5 }),
              disabled: Boolean(props.workBusy) || !(bound || work.watching),
              onClick: props.onUnbind,
              title: '不再盯着当前选定的这条对话（不中止在跑的投递，也不动其它状态）',
            }, '停止观察'),
            // 全部解除放最右边：一次放平所有正在观察的对话
            h('button', {
              type: 'button',
              style: Object.assign({}, btnStyle(false), { padding: '2px 10px', fontSize: 11.5 }),
              // 不只看 bound：只要还有东西活着（事件流在跟、那边在跑），就允许一键全放平。
              // 之前只认 bound，绑定丢了但观察还在的时候按钮是灰的，看着就是"停不掉"。
              disabled: Boolean(props.workBusy)
                || !(bound || work.watching || (work.busy && work.busy.running)),
              onClick: props.onReleaseAll,
              title: '把所有正在观察的对话一次性解除：中止在跑的投递、收掉事件流与抬眼定时器、清空绑定',
            }, '全部解除'),
            h('span', { style: { fontSize: 11, color: T.tx2 } },
              work.busy && work.busy.running ? '正在干…' : (bound ? '待命' : '先选一条对话')),
            work.boundStale
              ? h('span', { style: { fontSize: 11, color: T.err } }, '观察的这条已不可用（子代理会话或已删除），重新选一条')
              : null,
            props.workMsg ? h('span', { style: { fontSize: 11, color: T.err } }, props.workMsg) : null),

        h('div', {
          ref: listRef,
          style: {
            flex: '1 1 auto', minHeight: 260, maxHeight: 560, overflowY: 'auto',
            padding: '14px 14px 4px', background: T.bg,
          },
        },
          msgs.length === 0
            ? h('div', { style: { textAlign: 'center', color: T.tx2, fontSize: 12, padding: '40px 12px' } },
              h('div', { style: { fontSize: 13, marginBottom: 6, color: T.tx } }, '和聪音的聊天'),
              '说什么都行，她会记住值得记的部分。想让她知道你在忙什么，就在上面挑一条对话让她看着。')
            : rows,
          (props.busy || (work.busy && work.busy.running))
            ? h('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 12 } },
              avatar(false),
              h('div', {
                style: {
                  padding: '9px 14px', borderRadius: 10, background: HER,
                  border: '1px solid ' + HER_LINE, color: T.tx2, fontSize: 13,
                },
              }, '· · ·'))
            : null),

        (props.turn && props.turn.voice && props.turn.voice.audioUrl)
          ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px 6px' } },
            h('span', { style: Object.assign({}, S.chip, { borderColor: T.ok, color: T.ok, fontSize: 10.5 }) }, '这一句的语音'),
            h('audio', {
              controls: true,
              src: String(props.turn.voice.audioUrl).charAt(0) === '/' ? props.turn.voice.audioUrl : '/' + props.turn.voice.audioUrl,
              style: { height: 30, flex: '1 1 auto', minWidth: 160, maxWidth: 320 },
            }))
          : null,

        props.error ? h('div', { style: { color: T.err, fontSize: 12, padding: '0 14px 6px' } }, '失败：' + props.error) : null,

        (props.turn && props.turn.remember && props.turn.remember.length)
          ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '0 14px 6px' } },
            h('span', { style: { fontSize: 11, color: T.tx2 } }, '这一轮记住：'),
            props.turn.remember.map(function (r) {
              return h('span', { key: r, style: Object.assign({}, S.chip, { borderColor: T.ok, color: T.ok, fontSize: 11 }) }, r)
            }))
          : null,

        h('div', {
          style: {
            background: T.l1, padding: '6px 10px 10px',
            borderRadius: '0 0 10px 10px',
          },
        },
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-end' } },
            h('textarea', {
              style: Object.assign({}, S.input, {
                minHeight: 42, maxHeight: 132, flex: '1 1 auto', resize: 'none',
                borderRadius: 10, padding: '10px 12px', lineHeight: 1.55,
              }),
              value: props.text,
              placeholder: '说点什么…（Enter 发送 / Shift+Enter 换行）',
              onChange: function (e) { props.setText(e.target.value) },
              onKeyDown: function (e) {
                if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault()
                  if (canSend) sendNow(true)
                }
              },
            }),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
              h('button', {
                type: 'button',
                style: Object.assign({}, btnStyle(true), { minWidth: 62, opacity: canSend ? 1 : 0.5 }),
                disabled: !canSend,
                onClick: function () { sendNow(true) },
              }, props.busy ? '…' : '发送'),
              h('button', {
                type: 'button',
                style: Object.assign({}, btnStyle(false), { fontSize: 10.5, padding: '2px 6px' }),
                disabled: !canSend,
                title: '这句不进记忆，也不改状态',
                onClick: function () { props.onSay(props.text, false) },
              }, '不记'))),
          h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: T.tx2, marginTop: 6 } },
            h('span', null, (props.pushed || '每句都会自动推给游戏，由游戏端表演')),
            h('span', null, String(props.text || '').length + ' 字'))))
    }

    function AvatarPicker(props) {
      const fileRef = React.useRef(null)
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState('')
      const pick = function () { if (fileRef.current) fileRef.current.click() }

      const upload = function (file) {
        if (!file) return
        setBusy(true); setMsg('')
        const url = URL.createObjectURL(file)
        const img = new Image()
        img.onload = function () {
          // 居中裁成正方形再缩到 256，后端只收 PNG
          const side = Math.min(img.width, img.height)
          const canvas = document.createElement('canvas')
          canvas.width = 256; canvas.height = 256
          const g = canvas.getContext('2d')
          g.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256)
          URL.revokeObjectURL(url)
          canvas.toBlob(function (blob) {
            fetch(API + '/avatar/' + encodeURIComponent(props.id), {
              method: 'POST', headers: { 'content-type': 'image/png' }, body: blob,
            }).then(function (r) {
              return r.json().then(function (j) {
                if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status))
                return j
              })
            }).then(function () {
              setMsg('已更新')
              if (props.onChanged) props.onChanged()
            }).catch(function (e) {
              setMsg('失败：' + String(e.message || e))
            }).then(function () { setBusy(false) })
          }, 'image/png')
        }
        img.onerror = function () { setMsg('读不出这张图'); setBusy(false); URL.revokeObjectURL(url) }
        img.src = url
      }

      const reset = function () {
        setBusy(true); setMsg('')
        fetch(API + '/avatar/' + encodeURIComponent(props.id) + '/reset', { method: 'POST' })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
          .then(function () { setMsg('已恢复默认'); if (props.onChanged) props.onChanged() })
          .catch(function (e) { setMsg('失败：' + String(e.message || e)) })
          .then(function () { setBusy(false) })
      }

      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
        h('img', {
          src: props.url, alt: props.label,
          style: { width: 46, height: 46, borderRadius: '50%', objectFit: 'cover', border: '1px solid ' + T.b1, background: T.l2, flex: '0 0 auto' },
        }),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
          h('div', { style: { fontSize: 12, fontWeight: 600 } }, props.label),
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
            h('button', { type: 'button', style: btnStyle(false), disabled: busy, onClick: pick }, busy ? '…' : '选择图片'),
            h('button', { type: 'button', style: btnStyle(false), disabled: busy, onClick: reset }, '默认'),
            msg ? h('span', { style: Object.assign({}, S.sub, { fontSize: 11 }) }, msg) : null),
          h('input', {
            ref: fileRef, type: 'file', accept: 'image/*', style: { display: 'none' },
            onChange: function (e) { upload(e.target.files && e.target.files[0]) },
          })))
    }

    function CharCard(props) {
      const c = props.card
      const accent = c.accent || T.brand
      return h('div', {
        role: 'button',
        style: {
          position: 'relative', width: 190, minWidth: 190, minHeight: 104, padding: '10px 12px 10px 16px',
          borderRadius: 10, background: props.selected ? T.l2 : T.l1,
          border: '1px solid ' + (props.selected ? accent : T.b1),
          cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6,
        },
        onClick: function () { props.onSelect(c.id) },
      },
        h('div', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: accent, borderTopLeftRadius: 10, borderBottomLeftRadius: 10 } }),
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 6 } },
          h('div', { style: { fontSize: 14, fontWeight: 700 } }, c.name),
          c.nameJa ? h('div', { style: { fontSize: 11, color: T.tx2 } }, c.nameJa) : null,
          h('div', { style: { flex: 1 } }),
          c.active ? h('span', { style: Object.assign({}, S.chip, { borderColor: T.ok, color: T.ok, fontSize: 10 }) }, '使用中') : null),
        h('div', { style: { fontSize: 11, color: T.tx2, lineHeight: 1.45, minHeight: 32 } }, c.tagline || '（还没有介绍）'),
        h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 10, color: T.tx2 } },
          h('span', null, c.personaChars + ' 字'),
          h('span', null, c.loreCount + ' 设定'),
          c.voiceLangs ? h('span', null, c.voiceLangs) : null))
    }

    function CharactersTab(props) {
      const list = props.list || []
      const draft = props.draft
      const setDraft = props.onDraft
      const lore = (draft && draft.lore) || []
      const updLore = function (i, patch) {
        const next = lore.slice()
        next[i] = Object.assign({}, next[i], patch)
        setDraft(Object.assign({}, draft, { lore: next }))
      }
      const addLore = function () {
        const next = lore.concat([{ id: 'lore-' + Date.now().toString(36), title: '', tags: [], always: false, text: '' }])
        setDraft(Object.assign({}, draft, { lore: next }))
      }
      const delLore = function (i) {
        setDraft(Object.assign({}, draft, { lore: lore.filter(function (_, k) { return k !== i }) }))
      }
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, flex: '1 1 auto', minHeight: 0, overflow: 'auto' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('div', { style: S.label }, '角色卡（人设 + 剧情设定 + 声音装在同一张卡里）'),
          h('div', { style: { flex: 1 } }),
          h('button', { type: 'button', style: btnStyle(false), disabled: props.busy, onClick: props.onCreate }, '新建角色')),
        h('div', { style: { display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', border: '1px solid ' + T.b1, borderRadius: 10, padding: '10px 12px' } },
          h('div', { style: S.label }, '聊天头像'),
          h(AvatarPicker, { id: props.active || 'satone', label: props.herName || '角色', url: props.avatars && props.avatars.her, onChanged: props.onAvatarChanged }),
          h(AvatarPicker, { id: 'user', label: '我', url: props.avatars && props.avatars.me, onChanged: props.onAvatarChanged })),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          list.map(function (c) {
            return h(CharCard, { key: c.id, card: c, selected: Boolean(draft && draft.id === c.id), onSelect: props.onSelect })
          }),
          props.loading ? h('div', { style: S.sub }, '载入中…') : null),
        draft ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
            h('input', {
              style: Object.assign({}, S.input, { width: 150 }),
              value: draft.name || '',
              placeholder: '名字',
              onChange: function (e) { setDraft(Object.assign({}, draft, { name: e.target.value })) },
            }),
            h('input', {
              style: Object.assign({}, S.input, { flex: '1 1 220px' }),
              value: draft.tagline || '',
              placeholder: '一句话介绍（显示在卡片上）',
              onChange: function (e) { setDraft(Object.assign({}, draft, { tagline: e.target.value })) },
            }),
            h('span', { style: S.chip }, (draft.persona || '').length + ' 字'),
            h('button', {
              type: 'button', style: btnStyle(false), disabled: props.busy || props.active === draft.id,
              onClick: function () { props.onActivate(draft.id) },
            }, props.active === draft.id ? '当前角色' : '设为当前'),
            h('button', {
              type: 'button', style: btnStyle(true), disabled: props.busy,
              onClick: props.onSave,
            }, props.busy ? '保存中…' : '保存')),
          props.msg ? h('div', { style: Object.assign({}, S.sub, { color: T.ok }) }, props.msg) : null,
          h('div', { style: S.label }, '人设（prompt 的第一段，写「你是谁 / 怎么说话 / 什么时候用什么情绪」）'),
          h('textarea', {
            style: Object.assign({}, S.input, { minHeight: 230, lineHeight: 1.6 }),
            value: draft.persona || '',
            onChange: function (e) { setDraft(Object.assign({}, draft, { persona: e.target.value })) },
          }),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 } },
            h('div', { style: S.label }, '剧情与设定（勾「常驻」= 每轮都带上；不勾 = 聊到才提）'),
            h('div', { style: { flex: 1 } }),
            h('button', { type: 'button', style: btnStyle(false), onClick: addLore }, '+ 一条')),
          lore.map(function (item, i) {
            return h('div', {
              key: item.id || ('lore-' + i),
              style: { border: '1px solid ' + T.b1, borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 },
            },
              h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                h('input', {
                  style: Object.assign({}, S.input, { width: 170 }),
                  placeholder: '标题（如 第13话）',
                  value: item.title || '',
                  onChange: function (e) { updLore(i, { title: e.target.value }) },
                }),
                h('label', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.tx2, whiteSpace: 'nowrap' } },
                  h('input', { type: 'checkbox', checked: Boolean(item.always), onChange: function (e) { updLore(i, { always: e.target.checked }) } }),
                  '常驻'),
                h('div', { style: { flex: 1 } }),
                h('button', { type: 'button', style: btnStyle(false), onClick: function () { delLore(i) } }, '删除')),
              h('textarea', {
                style: Object.assign({}, S.input, { minHeight: 62, lineHeight: 1.55 }),
                value: item.text || '',
                onChange: function (e) { updLore(i, { text: e.target.value }) },
              }))
          })
        ) : h('div', { style: S.sub }, list.length ? '选一张卡开始编辑' : '还没有角色卡'))
    }

    function AssetsTab(props) {
      const manifest = props.manifest || {}
      const names = ['animations', 'chairs', 'deskObjects', 'pen', 'cameras', 'scenes', 'sfx', 'voiceClips', 'bgm']
      const groups = names.filter(function (g) { return Array.isArray(manifest[g]) && manifest[g].length })
      const group = groups.indexOf(props.group) >= 0 ? props.group : (groups[0] || 'animations')
      const items = Array.isArray(manifest[group]) ? manifest[group] : []
      const q = String(props.query || '').trim().toLowerCase()
      const filtered = (q
        ? items.filter(function (it) { return JSON.stringify(it).toLowerCase().indexOf(q) >= 0 })
        : items).slice(0, 400)

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, flex: '1 1 auto', minHeight: 0 } },
        h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
          groups.map(function (g) {
            return h('button', {
              key: g, type: 'button', style: btnStyle(g === group),
              onClick: function () { props.setGroup(g) },
            }, g + ' (' + manifest[g].length + ')')
          }),
          h('div', { style: { flex: 1 } }),
          h('input', {
            style: Object.assign({}, S.input, { maxWidth: 220, padding: '5px 10px' }),
            placeholder: '搜索 id / 名字',
            value: props.query,
            onChange: function (e) { props.setQuery(e.target.value) },
          })),
        props.loading ? h('div', { style: S.sub }, '读取资源清单…') : null,
        h('div', {
          style: Object.assign({}, S.scroll, {
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8,
          }),
        }, filtered.map(function (it, i) {
          const id = it && (it.id != null ? it.id : it.name)
          const label = it && (it.label || it.name || it.id)
          return h('div', {
            key: String(id == null ? i : id) + '#' + i,
            title: JSON.stringify(it),
            style: Object.assign({}, S.mono, {
              padding: '7px 9px', borderRadius: 8, background: T.l1, border: '1px solid ' + T.b1, overflow: 'hidden', cursor: 'pointer',
            }),
            onClick: function () {
              try { if (navigator.clipboard) navigator.clipboard.writeText(String(id)) } catch (e) {}
            },
          },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: 11, color: T.tx2 } }, String((it && (it.kind || it.group)) || group)),
              h('div', { style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, String(label == null ? id : label))),
            (group === 'animations' && props.onPushCue)
              ? h('button', {
                type: 'button',
                style: Object.assign({}, btnStyle(false), { padding: '2px 8px', fontSize: 11 }),
                onClick: function (e) { e.stopPropagation(); props.onPushCue(id) },
              }, '推送')
              : null))
        })),
        h('div', { style: S.sub }, '点击卡片复制 id。这份清单就是她能用的全部资源白名单。'))
    }

    // 面板会被反复挂载，聊天记录放模块作用域 + localStorage，切 tab / 刷新页面都不丢
    function ModelTab(props) {
      const data = props.data || {}
      const list = data.providers || []

      const busy = props.busy || ''
      const probe = props.probe
      const [form, setForm] = useState({ label: '', baseUrl: '', model: '', token: '' })
      const setF = function (k, v) { setForm(Object.assign({}, form, { [k]: v })) }
      const inp = function (w) {
        return {
          width: w, padding: '4px 8px', fontSize: 12, borderRadius: 6, boxSizing: 'border-box',
          border: '1px solid ' + T.b1, background: T.bg, color: T.tx,
        }
      }
      const chip = function (bg, color) {
        return {
          display: 'inline-block', padding: '1px 6px', borderRadius: 999, fontSize: 10,
          background: bg || T.l2, color: color || T.tx2, lineHeight: '16px',
        }
      }
      const cardBase = {
        border: '1px solid ' + T.b1, borderRadius: 10, padding: '10px 12px',
        display: 'flex', alignItems: 'center', gap: 10, background: T.l1,
      }
      const submit = function () {
        if (!form.baseUrl.trim()) return props.onMsg('先填 baseUrl（http 或 https）')
        props.onAdd({
          label: form.label.trim(), baseUrl: form.baseUrl.trim(),
          model: form.model.trim(), token: form.token.trim(),
        }).then(function (d) {
          if (d && d.ok) setForm({ label: '', baseUrl: '', model: '', token: '' })
        })
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
          h('span', { style: chip(T.ok, '#fff') }, '当前 ' + (data.current || '-')),
          h('div', { style: S.sub }, '默认与对话共用同一个 API 和同一把 key；要换别家就自己加一条'),
          h('div', { style: { flex: 1 } }),
          props.msg ? h('span', { style: Object.assign({}, S.sub, { color: T.tx2, fontSize: 11.5 }) }, props.msg) : null,
          h('button', { type: 'button', style: btnStyle(false), disabled: Boolean(busy), onClick: props.onRefresh }, '刷新')),

        probe ? h('div', {
          style: Object.assign({}, cardBase, {
            borderColor: probe.ok ? T.ok : T.err,
            alignItems: 'flex-start', flexDirection: 'column', gap: 4,
          }),
        },
          h('div', { style: { fontSize: 12.5, fontWeight: 600, color: probe.ok ? T.ok : T.err } },
            probe.ok ? ('通了 · ' + probe.ms + 'ms · ' + (probe.model || '')) : ('不通 · ' + (probe.error || '')),
          ),
          probe.ok && probe.reply ? h('div', { style: S.sub }, '回了：' + probe.reply) : null)
          : null,

        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          list.map(function (p) {
            const active = p.id === data.current
            return h('div', {
              key: p.id,
              style: Object.assign({}, cardBase, active ? { borderColor: T.brand, background: T.l2 } : {}),
            },
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                  h('span', { style: { fontSize: 13, fontWeight: 600 } }, p.label),
                  active ? h('span', { style: chip(T.brand, '#fff') }, '当前') : null,
                  p.builtin ? h('span', { style: chip() }, '内置') : h('span', { style: chip() }, '自建'),
                  p.hasKey ? h('span', { style: chip(T.ok, '#fff') }, 'key 就绪') : h('span', { style: chip(T.err, '#fff') }, '无 key')),
                h('div', { style: Object.assign({}, S.sub, { wordBreak: 'break-all' }) },
                  (p.model || '(未填模型)') + ' · ' + p.baseUrl + (p.keyRef ? ' · 借用 ' + p.keyRef : ''))),
              h('button', {
                type: 'button', style: btnStyle(active), disabled: Boolean(busy) || active,
                onClick: function () { props.onActivate(p.id) },
              }, active ? '使用中' : '用这个'),
              h('button', {
                type: 'button', style: btnStyle(false), disabled: Boolean(busy),
                onClick: function () { props.onTest(p.id) },
              }, busy === 'test' ? '测…' : '测试'),
              p.builtin ? null : h('button', {
                type: 'button', style: btnStyle(false), disabled: Boolean(busy),
                onClick: function () { props.onRemove(p.id) },
              }, '删除'))
          })),

        h('div', {
          style: {
            border: '1px dashed ' + T.b1, borderRadius: 10, padding: '10px 12px',
            display: 'flex', flexDirection: 'column', gap: 8, background: T.l1,
          },
        },
          h('div', { style: { fontSize: 12.5, fontWeight: 600 } }, '再加一条'),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            h('input', { style: inp(150), placeholder: '名称（随便起）', value: form.label, onChange: function (e) { setF('label', e.target.value) } }),
            h('input', { style: inp(300), placeholder: 'baseUrl（…/v1/chat/completions）', value: form.baseUrl, onChange: function (e) { setF('baseUrl', e.target.value) } }),
            h('input', { style: inp(160), placeholder: '模型名', value: form.model, onChange: function (e) { setF('model', e.target.value) } })),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
            h('input', {
              style: inp(300), placeholder: 'key（可留空：留空就与对话共用同一把）', value: form.token,
              onChange: function (e) { setF('token', e.target.value) },
            }),
            h('div', { style: { flex: 1 } }),
            h('button', { type: 'button', style: btnStyle(true), disabled: Boolean(busy), onClick: submit }, busy === 'add' ? '添加中…' : '添加')),
          h('div', { style: S.sub }, 'OpenAI 兼容的接口都行：本地 ollama / llama.cpp、通义、OpenRouter…'),
          h('div', { style: S.sub }, 'key 填了就用自己的，留空就跟着对话那把走；baseUrl 与模型名一律按你填的请求。')))
    }
    function VoiceTab(props) {
      const [form, setForm] = useState({ name: '', lang: 'ja', prompt: '', speed: 1 })
      const fileRef = React.useRef(null)
      const [fileName, setFileName] = useState('')
      const data = props.data || {}
      const items = data.items || []
      const busy = props.busy || ''

      const setF = function (k, v) { setForm(Object.assign({}, form, { [k]: v })) }
      const pick = function () { if (fileRef.current) fileRef.current.click() }
      const inp = function (w) {
        return {
          width: w, padding: '4px 8px', fontSize: 12, borderRadius: 6,
          border: '1px solid ' + T.b1, background: T.bg, color: T.tx, boxSizing: 'border-box',
        }
      }
      const chip = function (bg, color) {
        return {
          display: 'inline-block', padding: '1px 6px', borderRadius: 999, fontSize: 10,
          background: bg || T.l2, color: color || T.tx2, lineHeight: '16px',
        }
      }
      const submit = function () {
        const file = fileRef.current && fileRef.current.files && fileRef.current.files[0]
        if (!form.name.trim()) return props.onMsg('先给这条声线起个名字')
        if (!file) return props.onMsg('先选一段 WAV 参考音频（3–10 秒最稳）')
        props.onCreate({
          name: form.name.trim(), lang: form.lang,
          promptText: form.prompt, speed: Number(form.speed) || 1, file: file,
        })
      }

      const cardBase = {
        border: '1px solid ' + T.b1, borderRadius: 10, padding: '10px 12px',
        display: 'flex', alignItems: 'center', gap: 10, background: T.l1,
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
          h('span', { style: chip(data.online ? T.ok : (data.ready === false ? T.err : T.idle), '#fff') },
            data.online ? '引擎在线' : (data.ready === false ? '引擎待安装' : '引擎离线')),
          h('div', { style: S.sub }, data.online
            ? '试听会真的合成一句日语「ねえ、聞こえてる？」'
            : (data.ready === false
              ? '模型和 python 环境不随插件走，先按下面补齐'
              : '先在「状态」页启动语音引擎，试听才有声音')),
          h('div', { style: { flex: 1 } }),
          props.msg ? h('span', { style: Object.assign({}, S.sub, { color: T.tx2, fontSize: 11.5 }) }, props.msg) : null,
          h('button', { type: 'button', style: btnStyle(false), disabled: Boolean(busy), onClick: props.onRefresh }, '刷新')),

        // 缺件指引：插件本身装完就能用，只有引擎这几个大家伙要单独准备。
        data.ready === false && Array.isArray(data.missing) && data.missing.length
          ? h('div', {
            style: {
              border: '1px solid ' + T.err, borderRadius: 10, padding: '10px 12px',
              background: T.l1, display: 'flex', flexDirection: 'column', gap: 6,
            },
          },
            h('div', { style: { fontSize: 12.5, fontWeight: 600, color: T.tx } }, '语音引擎还缺 ' + data.missing.length + ' 项'),
            data.missing.map(function (m, i) {
              return h('div', { key: 'miss' + i, style: Object.assign({}, S.sub, { display: 'flex', gap: 8, flexWrap: 'wrap' }) },
                h('span', { style: chip(T.err, '#fff') }, m.label),
                h('span', { style: { color: T.tx2 } }, m.hint || ''),
                m.path ? h('span', { style: { color: T.tx2, fontSize: 11, wordBreak: 'break-all' } }, m.path) : null)
            }),
            h('div', { style: Object.assign({}, S.sub, { color: T.tx2 }) },
              '补齐后回这里点「刷新」，插件会自己把引擎拉起来，不需要计划任务或启动脚本。'))
          : null,

        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          items.map(function (v) {
            const inUse = v.id === data.active
            return h('div', {
              key: v.id,
              style: Object.assign({}, cardBase, inUse ? { borderColor: T.brand, background: T.l2 } : {}),
            },
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                  h('span', { style: { fontSize: 13, fontWeight: 600 } }, v.name),
                  inUse ? h('span', { style: chip(T.brand, '#fff') }, '使用中') : null,
                  v.builtin ? h('span', { style: chip() }, '内置') : null,
                  v.missing ? h('span', { style: chip(T.err, '#fff') }, '文件缺失') : null),
                h('div', { style: S.sub },
                  (v.note ? v.note + ' · ' : '') +
                  (v.duration ? v.duration + 's' : '') +
                  (v.rate ? ' · ' + v.rate + 'Hz' : '') +
                  ' · ' + v.promptLang + '/' + v.textLang + ' · ×' + v.speedFactor)),
              h('button', {
                type: 'button', style: btnStyle(inUse), disabled: Boolean(busy) || inUse,
                onClick: function () { props.onActivate(v.id) },
              }, inUse ? '当前' : '用这个'),
              h('button', {
                type: 'button', style: btnStyle(false), disabled: Boolean(busy),
                onClick: function () { props.onPreview(v.id) },
              }, busy === ('preview-' + v.id) ? '合成中…' : '试听'),
              v.builtin ? null : h('button', {
                type: 'button', style: Object.assign({}, btnStyle(false), { color: T.err }), disabled: Boolean(busy),
                onClick: function () { props.onDelete(v.id) },
              }, '删除'))
          })),

        h('div', {
          style: {
            border: '1px dashed ' + T.b2, borderRadius: 10, padding: 12,
            display: 'flex', flexDirection: 'column', gap: 8,
          },
        },
          h('div', { style: { fontSize: 12.5, fontWeight: 600 } }, '加一条声线'),
          h('div', { style: S.sub }, '要一段 3–10 秒的干净人声 WAV（别带背景音乐）。GPT-SoVITS 把它当参考音，越干净越像。'),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
            h('input', {
              value: form.name, placeholder: '名字，例如 我的声线',
              onChange: function (e) { setF('name', e.target.value) }, style: inp(180),
            }),
            h('select', {
              value: form.lang, onChange: function (e) { setF('lang', e.target.value) }, style: inp(84),
            }, ['ja', 'zh', 'en', 'ko', 'yue'].map(function (l) { return h('option', { key: l, value: l }, l) })),
            h('input', {
              type: 'number', min: 0.5, max: 2, step: 0.05, value: form.speed,
              onChange: function (e) { setF('speed', e.target.value) }, style: inp(76), title: '语速',
            }),
            h('button', { type: 'button', style: btnStyle(false), disabled: Boolean(busy), onClick: pick },
              fileName ? '…' + fileName.slice(-18) : '选择 WAV'),
            h('button', { type: 'button', style: btnStyle(true), disabled: Boolean(busy), onClick: submit },
              busy === 'create' ? '添加中…' : '添加')),
          h('input', {
            value: form.prompt, placeholder: '可选：这段录音的原文（写准了更像）',
            onChange: function (e) { setF('prompt', e.target.value) },
            style: Object.assign({}, inp('100%'), { fontSize: 11.5 }),
          }),
          h('input', {
            ref: fileRef, type: 'file', accept: '.wav,audio/wav,audio/*', style: { display: 'none' },
            onChange: function (e) {
              const f = e.target.files && e.target.files[0]
              setFileName(f ? f.name : '')
            },
          })))
    }

    // ── 测试页：沙箱对话，不写历史、不提炼事实、不动状态 ──────────────────────
    function TestTab() {
      const [text, setText] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [log, setLog] = React.useState([])
      const boxRef = React.useRef(null)

      const send = async function () {
        const q = text.trim()
        if (!q || busy) return
        setBusy(true)
        setText('')
        try {
          const r = await api('/act', {
            method: 'POST',
            body: JSON.stringify({ text: q, sandbox: true, debug: true }),
          })
          const d = (r && r.debug) || {}
          setLog(function (prev) {
            return [{ q: q, r: r, kb: d.kb || null, at: new Date().toLocaleTimeString() }].concat(prev).slice(0, 30)
          })
        } catch (e) {
          setLog(function (prev) {
            return [{ q: q, err: String((e && e.message) || e), at: new Date().toLocaleTimeString() }].concat(prev).slice(0, 30)
          })
        } finally {
          setBusy(false)
          if (boxRef.current) boxRef.current.focus()
        }
      }

      const inp = {
        width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8,
        border: '1px solid #d8d3cc', background: '#fff', color: '#2b2622', outline: 'none',
        fontFamily: 'inherit', resize: 'vertical',
      }
      const chip = { padding: '1px 7px', borderRadius: 999, fontSize: 11, background: '#f0ece6', color: '#6b6259' }

      return h('div', { style: { display: 'grid', gap: 12 } },
        h('div', {
          style: {
            padding: '10px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.6,
            background: '#fff8e6', border: '1px solid #f0e0b8', color: '#7a6417',
          },
        },
          h('strong', null, '沙箱测试'),
          '：这里发的话不进聊天历史，不提炼长期事实，不改状态。人设、角色设定、知识库检索照常走，用来验证「问到了会不会用上资料」。',
          h('br'),
          '记忆窗口在沙箱里是空的，所以她不记得刚才聊过什么——这是设计如此。'),

        h('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-start' } },
          h('textarea', {
            ref: boxRef, value: text, rows: 2, style: inp,
            placeholder: '例如：星穹铁道 4.7 版本叫什么名字',
            onChange: function (e) { setText(e.target.value) },
            onKeyDown: function (e) {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            },
          }),
          h('button', {
            onClick: send, disabled: busy,
            style: {
              padding: '8px 16px', borderRadius: 8, border: 'none', cursor: busy ? 'default' : 'pointer',
              background: busy ? '#d8d3cc' : '#2b2622', color: '#fff', fontSize: 13, whiteSpace: 'nowrap',
            },
          }, busy ? '跑…' : '发送')),

        log.length > 0 && h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
          h('button', {
            onClick: function () { setLog([]) },
            style: { padding: '3px 10px', fontSize: 11, borderRadius: 6, border: '1px solid #d8d3cc', background: '#fff', color: '#6b6259', cursor: 'pointer' },
          }, '清空记录（仅本页）')),

        log.map(function (item, i) {
          const r = item.r || {}
          const kb = item.kb || {}
          return h('div', {
            key: i,
            style: { padding: '10px 12px', borderRadius: 8, border: '1px solid #e6e1da', background: '#fff', display: 'grid', gap: 6 },
          },
            h('div', { style: { fontSize: 11, color: '#9a9188' } }, item.at),
            h('div', { style: { fontSize: 13, color: '#2b2622' } }, h('strong', null, 'Q '), item.q),
            item.err
              ? h('div', { style: { fontSize: 12, color: '#b23b3b' } }, '出错：' + item.err)
              : h('div', null,
                  h('div', { style: { fontSize: 13, color: '#1f5c3d', lineHeight: 1.6 } }, h('strong', null, 'A '), r.subtitleText || '（无字幕）'),
                  h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 } },
                    r.emotion && h('span', { style: chip }, r.emotion),
                    r.audioUrl ? h('span', { style: chip }, '有语音') : h('span', { style: chip }, '无语音'),
                    kb.body ? h('span', { style: chip }, '资料 ' + kb.body + ' 字') : h('span', { style: chip }, '无资料'),
                    (r.performance || []).map(function (c, j) { return h('span', { key: j, style: chip }, c.id) })),
                  kb.hits && kb.hits.length > 0 && h('div', { style: { marginTop: 6, fontSize: 11, color: '#9a9188', lineHeight: 1.7 } },
                    '命中：' + kb.hits.join(' · '))))
        }))
    }
    function KbTab(props) {
      const data = props.data || {}
      const libs = data.libraries || []
      const stats = data.stats || { chunks: 0, libraries: 0 }
      const [openId, setOpenId] = useState('')
      const [newLib, setNewLib] = useState({ name: '', note: '' })
      const [docName, setDocName] = useState('')
      const [docText, setDocText] = useState('')
      const [q, setQ] = useState('')
      const [hits, setHits] = useState(null)
      const [roleDraft, setRoleDraft] = useState({})
      const [refresh, setRefresh] = useState({})   // { [libId]: { loading, data } }
      const packRef = React.useRef(null)
      const fileRef = React.useRef(null)
      const busy = props.busy || ''

      const inp = function (w) {
        return {
          width: w, padding: '4px 8px', fontSize: 12, borderRadius: 6,
          border: '1px solid ' + T.b1, background: T.bg, color: T.tx, boxSizing: 'border-box',
        }
      }
      const chip = function (bg, color) {
        return {
          display: 'inline-block', padding: '1px 6px', borderRadius: 999, fontSize: 10,
          background: bg || T.l2, color: color || T.tx2, lineHeight: '16px',
        }
      }
      const cardBase = {
        border: '1px solid ' + T.b1, borderRadius: 10, padding: '10px 12px',
        background: T.l1, display: 'flex', flexDirection: 'column', gap: 8,
      }

      const doSearch = function () {
        if (!q.trim()) return props.onMsg('先输入一句要查的话')
        props.onSearch(q.trim())
      }

      // 更新检查：拿「该去查什么」的清单，不联网、不改库。
      const doRefresh = async function (libId) {
        setRefresh(function (m) { return Object.assign({}, m, { [libId]: { loading: true, data: null } }) })
        try {
          const r = await api('/kb/' + encodeURIComponent(libId) + '/refresh')
          setRefresh(function (m) { return Object.assign({}, m, { [libId]: { loading: false, data: r } }) })
        } catch (e) {
          setRefresh(function (m) { return Object.assign({}, m, { [libId]: { loading: false, data: { error: e.message } } }) })
        }
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
          h('span', { style: chip(T.brand, '#fff') }, stats.libraries + ' 个能力包'),

          h('button', { type: 'button', style: btnStyle(false), disabled: Boolean(busy), onClick: function () { if (packRef.current) packRef.current.click() } }, '导入包'),

          h('input', {
            ref: packRef, type: 'file', accept: '.json,application/json', style: { display: 'none' },
            onChange: function (e) {
              const file = e.target.files && e.target.files[0]
              if (file) props.onImport(file)
              e.target.value = ''
            },
          }),
          h('span', { style: chip() }, stats.chunks + ' 个片段'),
          (data.inUse && data.inUse.length)
          ? h('span', { style: chip(T.ok, '#fff') }, '在学：' + data.inUse.map(function (x) { return x.name }).join('、'))
          : null,
        h('div', { style: S.sub }, '启用的库在每轮都进她的知识底座，细节再按你说的那句检索'),
          h('div', { style: { flex: 1 } }),
          props.msg ? h('span', { style: Object.assign({}, S.sub, { fontSize: 11.5 }) }, props.msg) : null,
          h('button', { type: 'button', style: btnStyle(false), disabled: Boolean(busy), onClick: props.onRefresh }, '刷新')),

        libs.length === 0
          ? h('div', { style: Object.assign({}, cardBase, { borderStyle: 'dashed' }) },
            h('div', { style: { fontSize: 12.5, fontWeight: 600 } }, '还没有知识库'),
            h('div', { style: S.sub }, '建一个库，再把 md / txt 丢进去。比如「咖啡」库放冲煮笔记，「写作」库放大纲方法。'))
          : libs.map(function (lib) {
            const open = openId === lib.id
            return h('div', { key: lib.id, style: Object.assign({}, cardBase, open ? { borderColor: T.brand } : {}) },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                h('span', { style: chip(lib.enabled ? T.ok : T.idle, '#fff') }, lib.enabled ? '启用' : '停用'),
                h('span', { style: { fontSize: 13, fontWeight: 600 } }, lib.name),
                lib.note ? h('span', { style: S.sub }, lib.note) : null,
                h('span', { style: chip() }, lib.docs.length + ' 篇 · ' + lib.chars + ' 字 · ' + lib.chunks + ' 片段'),
                h('div', { style: { flex: 1 } }),
                h('button', { type: 'button', style: btnStyle(false), disabled: Boolean(busy || refresh[lib.id] && refresh[lib.id].loading), onClick: function () { doRefresh(lib.id) } }, refresh[lib.id] && refresh[lib.id].loading ? '同步中…' : '同步'),
                h('button', { type: 'button', style: btnStyle(false), disabled: Boolean(busy), onClick: function () { props.onToggle(lib.id) } }, lib.enabled ? '停用' : '启用'),
                h('button', {
                  type: 'button', style: btnStyle(false), disabled: Boolean(busy),
                  onClick: function () { setOpenId(open ? '' : lib.id); setDocName(''); setDocText('') },
                }, open ? '收起' : '＋文档'),
                h('button', { type: 'button', style: btnStyle(false), disabled: Boolean(busy), onClick: function () { props.onExport(lib.id) } }, '导出'),
                h('button', {
                  type: 'button', style: Object.assign({}, btnStyle(false), { color: T.err }), disabled: Boolean(busy),
                  onClick: function () { props.onDelete(lib.id) },
                }, '删库')),

              open ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid ' + T.b1, paddingTop: 8 } },
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                  h('div', { style: { fontSize: 11.5, color: T.tx2 } }, '能力说明 —— 她因为装上这个库学会什么（每轮都进提示词）'),
                  h('textarea', {
                    value: roleDraft[lib.id] != null ? roleDraft[lib.id] : (lib.role || ''),
                    placeholder: '例如：懂手冲与意式，会按豆子调参数、判断萃取问题，能给具体克数和温度。',
                    onChange: function (e) { setRoleDraft(Object.assign({}, roleDraft, { [lib.id]: e.target.value })) },
                    style: Object.assign({}, inp('100%'), { height: 68, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }),
                  }),
                  h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                    h('button', {
                      type: 'button', style: btnStyle(true), disabled: Boolean(busy),
                      onClick: function () {
                        const v = roleDraft[lib.id] != null ? roleDraft[lib.id] : (lib.role || '')
                        props.onRole(lib.id, v)
                      },
                    }, busy === ('role-' + lib.id) ? '保存中…' : '保存能力'),
                    h('span', { style: S.sub }, '写清"会做什么"，比堆资料更管用'))),
                lib.docs.length === 0
                  ? h('div', { style: S.sub }, '这个库还是空的')
                  : lib.docs.map(function (d) {
                    const age = (typeof d.ageDays === 'number') ? d.ageDays : null
                    const ageText = age === null ? '' : (age === 0 ? '今天同步' : age + ' 天前同步')
                    return h('div', { key: d.id, style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 } },
                      h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, d.name),
                      ageText ? h('span', { style: chip() }, ageText) : null,
                      h('span', { style: chip() }, d.chars + ' 字'),
                      h('button', {
                        type: 'button', style: Object.assign({}, btnStyle(false), { padding: '1px 8px', fontSize: 11, color: T.err }),
                        disabled: Boolean(busy), onClick: function () { props.onDeleteDoc(lib.id, d.id) },
                      }, '删'))
                  }),
                refresh[lib.id] && refresh[lib.id].data
                  ? (function () {
                    const rd = refresh[lib.id].data
                    if (rd.error) return h('div', { style: Object.assign({}, S.sub, { color: T.err }) }, '同步失败：' + rd.error)
                    const staleList = (rd.docs || []).filter(function (x) { return x.itemCount > 0 })
                    return h('div', { style: { border: '1px solid ' + T.b1, borderRadius: 8, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 } },
                      h('div', { style: { fontSize: 12, fontWeight: 600 } },
                        '当前 ' + (rd.currentVersion || '—') + (rd.nextVersion ? '，该查 ' + rd.nextVersion : '')),
                      h('div', { style: S.sub }, '已生成同步任务。把它交给能联网的一方去查，查到变化再改原文重导。'),
                      rd.taskFile
                        ? h('div', { style: Object.assign({}, S.sub, { fontFamily: 'ui-monospace, monospace', fontSize: 10.5, wordBreak: 'break-all' }) }, rd.taskFile)
                        : null,
                      (rd.queries || []).map(function (qq, i) {
                        return h('div', { key: 'q' + i, style: { fontSize: 12, fontFamily: 'ui-monospace, monospace' } }, '· ' + qq)
                      }),
                      staleList.length
                        ? h('div', { style: Object.assign({}, S.sub, { marginTop: 2 }) },
                          '需要留意的表述 ' + rd.totalItems + ' 处：' + staleList.map(function (x) { return x.docName + '(' + x.itemCount + ')' }).join('、'))
                        : h('div', { style: S.sub }, '没有明显会过期的表述'),
                      h('button', {
                        type: 'button', style: Object.assign({}, btnStyle(false), { alignSelf: 'flex-start', padding: '2px 10px', fontSize: 11 }),
                        onClick: function () {
                          const lines = ['按下面这些去查「' + ((rd.library || {}).name || '') + '」的最新情况，有变化就告诉我：']
                          ;(rd.queries || []).forEach(function (qq) { lines.push('- ' + qq) })
                          if (staleList.length) {
                            lines.push('', '重点核对这些表述：')
                            ;staleList.slice(0, 4).forEach(function (x) {
                              ;(x.items || []).slice(0, 3).forEach(function (it) { lines.push('- [' + x.docName + '] ' + it.line) })
                            })
                          }
                          try { navigator.clipboard.writeText(lines.join('\n')); props.onMsg('清单已复制，贴给能联网的一方去查') } catch (e) { props.onMsg('复制失败，手动选一下吧') }
                        },
                      }, '复制清单'))
                  })()
                  : null,
                h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 } },
                  h('input', { value: docName, placeholder: '文档名，例如 手冲步骤.md', onChange: function (e) { setDocName(e.target.value) }, style: inp(230) }),
                  h('button', { type: 'button', style: btnStyle(false), disabled: Boolean(busy), onClick: function () { if (fileRef.current) fileRef.current.click() } }, '选文件'),
                  h('input', {
                    ref: fileRef, type: 'file', accept: '.md,.markdown,.txt,text/plain,text/markdown', style: { display: 'none' },
                    onChange: function (e) {
                      const f = e.target.files && e.target.files[0]
                      if (!f) return
                      const reader = new FileReader()
                      reader.onload = function () {
                        setDocText(String(reader.result || ''))
                        if (!docName) setDocName(f.name)
                      }
                      reader.readAsText(f)
                    },
                  })),
                h('textarea', {
                  value: docText, placeholder: '把内容粘这里，或上面选一个 md/txt 文件',
                  onChange: function (e) { setDocText(e.target.value) },
                  style: Object.assign({}, inp('100%'), { height: 96, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }),
                }),
                h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                  h('button', {
                    type: 'button', style: btnStyle(true), disabled: Boolean(busy),
                    onClick: function () {
                      if (!docText.trim()) return props.onMsg('内容还是空的')
                      props.onAddDoc(lib.id, { name: docName.trim() || ('文档 ' + (lib.docs.length + 1)), text: docText })
                      setDocName('')
                      setDocText('')
                    },
                  }, busy === ('doc-' + lib.id) ? '收进去…' : '收进这个库'),
                  h('span', { style: S.sub }, '支持 Markdown 与纯文本，单篇上限 40 万字')))
              : null)
          }),

        h('div', { style: { border: '1px dashed ' + T.b2, borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 } },
          h('div', { style: { fontSize: 12.5, fontWeight: 600 } }, '新建能力包'),
          h('div', { style: S.sub }, '一个包 = 一段"她会什么"的说明 + 一堆资料。换用户就换包：装「前端」她就像做过前端，装「咖啡」她就懂冲煮。'),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
            h('input', { value: newLib.name, placeholder: '库名，例如 咖啡', onChange: function (e) { setNewLib(Object.assign({}, newLib, { name: e.target.value })) }, style: inp(180) }),
            h('input', { value: newLib.note, placeholder: '一句话说明（可空）', onChange: function (e) { setNewLib(Object.assign({}, newLib, { note: e.target.value })) }, style: inp(240) }),
            h('button', {
              type: 'button', style: btnStyle(true), disabled: Boolean(busy),
              onClick: function () {
                if (!newLib.name.trim()) return props.onMsg('先给库起个名字')
                props.onCreate(newLib)
                setNewLib({ name: '', note: '' })
              },
            }, '建库'))),

        h('div', { style: { border: '1px solid ' + T.b1, borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 } },
          h('div', { style: { fontSize: 12.5, fontWeight: 600 } }, '检索测试'),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            h('input', {
              value: q, placeholder: '输入一句她会听到的话，看命中什么资料',
              onChange: function (e) { setQ(e.target.value) },
              onKeyDown: function (e) { if (e.key === 'Enter') doSearch() },
              style: inp('100%'),
            }),
            h('button', { type: 'button', style: btnStyle(true), disabled: Boolean(busy), onClick: doSearch }, '测一下')),
          hits === null ? null
            : (hits.length === 0
              ? h('div', { style: S.sub }, '没命中任何片段')
              : hits.map(function (hit, i) {
                return h('div', { key: i, style: { borderTop: i ? '1px solid ' + T.b1 : 'none', paddingTop: i ? 6 : 0, display: 'flex', flexDirection: 'column', gap: 2 } },
                  h('div', { style: { fontSize: 11.5, display: 'flex', gap: 8, alignItems: 'center' } },
                    h('span', { style: chip(T.brand, '#fff') }, String(hit.score)),
                    h('span', { style: { fontWeight: 600 } }, hit.libName + ' / ' + hit.docName)),
                  h('div', { style: Object.assign({}, S.sub, { fontSize: 11.5, whiteSpace: 'pre-wrap' }) }, hit.text.slice(0, 220) + (hit.text.length > 220 ? '…' : '')))
              }))))
    }
    const CHAT_KEY = 'chill.chat.v2' // v2：v1 里存着被污染成日文/残 JSON 的气泡，换键即弃用旧缓存
    const CHAT_CACHE = (function () {
      const empty = { turns: [], memory: null }
      try {
        const raw = localStorage.getItem(CHAT_KEY)
        if (!raw) return empty
        const saved = JSON.parse(raw)
        return {
          turns: Array.isArray(saved.turns) ? saved.turns : [],
          memory: saved.memory || null,
        }
      } catch (e) {
        return empty
      }
    })()

    function Console() {
      const [tab, setTab] = useState('play')
      const [health, setHealth] = useState(null)
      const [healthErr, setHealthErr] = useState('')
      const [busy, setBusy] = useState(false)
      const [text, setText] = useState('')
      const [turn, setTurn] = useState(null)
      const [turnErr, setTurnErr] = useState('')
      const [pushed, setPushed] = useState('')
      const [chat, setChat] = useState(CHAT_CACHE.turns)
      const [memStats, setMemStats] = useState(null)
      const [cards, setCards] = useState({ active: '', list: [] })
      const [draft, setDraft] = useState(null)
      const [cardBusy, setCardBusy] = useState(false)
      const [cardMsg, setCardMsg] = useState('')
      const [avatarBust, setAvatarBust] = useState(0)
      const [manifest, setManifest] = useState(null)
      const [voice, setVoice] = useState(null)
      // ---- 模型供应商 ----
      const [llm, setLlm] = useState(null)
      const [llmBusy, setLlmBusy] = useState('')
      const [llmMsg, setLlmMsg] = useState('')
      const [llmProbe, setLlmProbe] = useState(null)

      const loadLlm = useCallback(function () {
        return api('/llm')
          .then(function (d) { setLlm(d) })
          .catch(function (e) { setLlm({ ok: false, providers: [], dshKeys: [], error: String(e.message || e) }) })
      }, [])

      const llmPost = function (body) {
        return api('/llm', { method: 'POST', body: JSON.stringify(body) })
      }

      const onActivateLlm = function (id) {
        setLlmBusy('activate')
        setLlmMsg('')
        llmPost({ action: 'activate', id: id })
          .then(function (d) { setLlm(d); setLlmMsg('已切到 ' + id) })
          .catch(function (e) { setLlmMsg('切换失败：' + String(e.message || e)) })
          .finally(function () { setLlmBusy('') })
      }

      const onAddLlm = function (input) {
        setLlmBusy('add')
        setLlmMsg('')
        return llmPost({ action: 'add', provider: input })
          .then(function (d) {
            setLlm(d)
            setLlmMsg(d.added ? '已添加 ' + d.added : '添加失败')
            return d
          })
          .catch(function (e) { setLlmMsg('添加失败：' + String(e.message || e)); return null })
          .finally(function () { setLlmBusy('') })
      }

      const onRemoveLlm = function (id) {
        setLlmBusy('remove')
        setLlmMsg('')
        llmPost({ action: 'remove', id: id })
          .then(function (d) { setLlm(d); setLlmMsg('已删除') })
          .catch(function (e) { setLlmMsg('删除失败：' + String(e.message || e)) })
          .finally(function () { setLlmBusy('') })
      }

      const onTestLlm = function (id) {
        setLlmBusy('test')
        setLlmMsg('')
        setLlmProbe(null)
        llmPost({ action: 'test', id: id })
          .then(function (d) { setLlm(d); setLlmProbe(d.probe || null) })
          .catch(function (e) { setLlmProbe({ ok: false, error: String(e.message || e) }) })
          .finally(function () { setLlmBusy('') })
      }
      const [voices, setVoices] = useState(null)
      const [vBusy, setVBusy] = useState('')
      const [vMsg, setVMsg] = useState('')

      const loadVoices = useCallback(function () {
        return api('/voices')
          .then(function (d) { setVoices(d) })
          .catch(function (e) { setVoices({ ok: false, items: [], error: String(e.message || e) }) })
      }, [])

      const voicePost = function (path, body) {
        return api(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined })
      }

      const onActivateVoice = function (id) {
        setVBusy('activate')
        setVMsg('')
        voicePost('/voices/' + encodeURIComponent(id) + '/activate')
          .then(function () { setVMsg('已切换声线'); return loadVoices() })
          .catch(function (e) { setVMsg('失败：' + String(e.message || e)) })
          .then(function () { setVBusy('') })
      }

      const uploadVoiceAudio = function (id, file) {
        return new Promise(function (resolve, reject) {
          const reader = new FileReader()
          reader.onload = function () {
            fetch(API + '/voices/' + encodeURIComponent(id) + '/audio', {
              method: 'POST', headers: { 'content-type': 'audio/wav' }, body: reader.result,
            }).then(function (r) {
              return r.json().then(function (j) {
                if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status))
                resolve(j)
              })
            }).catch(reject)
          }
          reader.onerror = function () { reject(new Error('读不出这个文件')) }
          reader.readAsArrayBuffer(file)
        })
      }

      const onCreateVoice = function (form) {
        const id = form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) ||
          ('voice-' + Date.now().toString(36))
        setVBusy('create')
        setVMsg('')
        voicePost('/voices', {
          id: id, name: form.name, promptText: form.promptText,
          promptLang: form.lang, textLang: form.lang, speedFactor: form.speed,
        }).then(function (r) {
          if (r && r.error) throw new Error(r.error)
          return uploadVoiceAudio(id, form.file)
        }).then(function () {
          setVMsg('已添加「' + form.name + '」')
          return loadVoices()
        }).catch(function (e) {
          setVMsg('失败：' + String(e.message || e))
        }).then(function () { setVBusy('') })
      }

      const onPreviewVoice = function (id) {
        setVBusy('preview-' + id)
        setVMsg('')
        voicePost('/voices/' + encodeURIComponent(id) + '/preview')
          .then(function (r) {
            if (r && r.audioUrl) {
              try { new Audio(r.audioUrl).play() } catch (e) { /* 自动播放被拦就算了 */ }
            }
            setVMsg('试听 ' + (r && r.duration ? r.duration.toFixed(1) + ' 秒' : '已合成'))
          })
          .catch(function (e) { setVMsg('试听失败：' + String(e.message || e)) })
          .then(function () { setVBusy('') })
      }

      const onDeleteVoice = function (id) {
        setVBusy('delete')
        setVMsg('')
        api('/voices/' + encodeURIComponent(id), { method: 'DELETE' })
          .then(function () { setVMsg('已删除'); return loadVoices() })
          .catch(function (e) { setVMsg('失败：' + String(e.message || e)) })
          .then(function () { setVBusy('') })
      }

      const [kbData, setKbData] = useState(null)
      const [kbBusy, setKbBusy] = useState('')
      const [kbMsg, setKbMsg] = useState('')
      const [kbHits, setKbHits] = useState(null)

      // 工作模式：控制台对话页把话交给玩家挑的那条 DSH 对话去干
      const [workData, setWorkData] = useState(null)
      const [workBusy, setWorkBusy] = useState(false)
      const [workMsg, setWorkMsg] = useState('')
      const [workPick, setWorkPick] = useState('')

      const loadKb = useCallback(function () {
        return api('/kb')
          .then(function (d) { setKbData(d) })
          .catch(function (e) { setKbData({ ok: false, libraries: [], stats: {}, error: String(e.message || e) }) })
      }, [])

      const kbRun = function (label, fn) {
        setKbBusy(label)
        setKbMsg('')
        return fn()
          .then(function () { return loadKb() })
          .catch(function (e) { setKbMsg('失败：' + String(e.message || e)) })
          .then(function () { setKbBusy('') })
      }

      const onCreateKb = function (form) {
        kbRun('create', function () {
          return api('/kb', { method: 'POST', body: JSON.stringify({ name: form.name, note: form.note }) })
            .then(function (r) { if (r && r.error) throw new Error(r.error); setKbMsg('已建库「' + form.name + '」') })
        })
      }

      const onToggleKb = function (id) {
        kbRun('toggle', function () {
          return api('/kb/' + encodeURIComponent(id) + '/toggle', { method: 'POST' })
            .then(function (r) { setKbMsg(r && r.enabled ? '已启用' : '已停用') })
        })
      }

      const onDeleteKb = function (id) {
        kbRun('delete', function () {
          return api('/kb/' + encodeURIComponent(id), { method: 'DELETE' })
            .then(function () { setKbMsg('已删库') })
        })
      }


      const onExportKb = function (id) {
        setKbMsg('')
        api('/kb/' + encodeURIComponent(id) + '/export')
          .then(function (r) {
            if (!r || !r.pack) throw new Error('空包')
            const blob = new Blob([JSON.stringify(r.pack, null, 2)], { type: 'application/json' })
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = (r.pack.name || id) + '.chillpack.json'
            a.click()
            setTimeout(function () { URL.revokeObjectURL(a.href) }, 4000)
            setKbMsg('已导出「' + r.pack.name + '」')
          })
          .catch(function (e) { setKbMsg('导出失败：' + String(e.message || e)) })
      }

      const onImportKb = function (file) {
        setKbBusy('import')
        setKbMsg('')
        const reader = new FileReader()
        reader.onload = function () {
          let payload = null
          try { payload = JSON.parse(String(reader.result || '{}')) } catch (e) { payload = null }
          if (!payload) { setKbBusy(''); setKbMsg('这不是能力包 json'); return }
          api('/kb/import', { method: 'POST', body: JSON.stringify(payload) })
            .then(function (r) {
              if (r && r.error) throw new Error(r.error)
              setKbMsg('已装入「' + (r.library && r.library.name) + '」（' + r.docs + ' 篇资料）')
              return loadKb()
            })
            .catch(function (e) { setKbMsg('导入失败：' + String(e.message || e)) })
            .then(function () { setKbBusy('') })
        }
        reader.onerror = function () { setKbBusy(''); setKbMsg('读不出这个文件') }
        reader.readAsText(file)
      }

      const onRoleKb = function (id, role) {
        setKbBusy('role-' + id)
        setKbMsg('')
        api('/kb/' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify({ role: role }) })
          .then(function (r) { if (r && r.error) throw new Error(r.error); setKbMsg('能力已保存'); return loadKb() })
          .catch(function (e) { setKbMsg('失败：' + String(e.message || e)) })
          .then(function () { setKbBusy('') })
      }

      const onAddKbDoc = function (libId, doc) {
        setKbBusy('doc-' + libId)
        setKbMsg('')
        api('/kb/' + encodeURIComponent(libId) + '/docs', { method: 'POST', body: JSON.stringify(doc) })
          .then(function (r) {
            if (r && r.error) throw new Error(r.error)
            setKbMsg('收进去了：' + r.doc.name + '（' + r.chunkCount + ' 个片段）')
            return loadKb()
          })
          .catch(function (e) { setKbMsg('失败：' + String(e.message || e)) })
          .then(function () { setKbBusy('') })
      }

      const onDeleteKbDoc = function (libId, docId) {
        kbRun('doc-del', function () {
          return api('/kb/' + encodeURIComponent(libId) + '/docs/' + encodeURIComponent(docId), { method: 'DELETE' })
            .then(function () { setKbMsg('已删文档') })
        })
      }

      const onSearchKb = function (query) {
        setKbBusy('search')
        setKbMsg('')
        api('/kb/search?q=' + encodeURIComponent(query) + '&k=5')
          .then(function (r) { setKbHits(r.hits || []) })
          .catch(function (e) { setKbMsg('检索失败：' + String(e.message || e)); setKbHits([]) })
          .then(function () { setKbBusy('') })
      }
      const [voiceBusy, setVoiceBusy] = useState('')
      const [voiceMsg, setVoiceMsg] = useState('')
      const [gameRun, setGameRun] = useState(null)
      const [gameBusy, setGameBusy] = useState(false)
      const [gameMsg, setGameMsg] = useState('')
      const [group, setGroup] = useState('animations')
      const [query, setQuery] = useState('')
      const cardsLoaded = useRef(false)

      const refresh = useCallback(function () {
        api('/health').then(function (d) { setHealth(d); setHealthErr('') })
          .catch(function (e) { setHealthErr(String(e.message || e)) })
      }, [])

      // ---- 角色卡（人设 + 剧情设定 + 声音） ----
      const loadCards = useCallback(function (keepId) {
        return api('/characters').then(function (d) {
          const list = d.list || []
          setCards({ active: d.active || '', list: list })
          const want = keepId || d.active || (list[0] && list[0].id)
          if (!want) return null
          return api('/characters/' + encodeURIComponent(want)).then(function (r) {
            setDraft(r.card || null)
            return r.card
          })
        }).catch(function (e) {
          setCardMsg('读取失败：' + String(e.message || e))
          return null
        })
      }, [])

      const onSelectCard = useCallback(function (id) {
        setCardMsg('')
        return loadCards(id)
      }, [loadCards])

      const onSaveCard = useCallback(function () {
        if (!draft) return
        setCardBusy(true)
        fetch(API + '/characters/' + encodeURIComponent(draft.id), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: draft.name, tagline: draft.tagline, persona: draft.persona, lore: draft.lore || [],
            accent: draft.accent, voice: draft.voice, actionMap: draft.actionMap,
          }),
        }).then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status)
          return res.json()
        }).then(function (r) {
          if (r.card) setDraft(r.card)
          setCardMsg('已保存（下一轮生效）')
          return loadCards(draft.id)
        }).catch(function (e) {
          setCardMsg('保存失败：' + String(e.message || e))
        }).then(function () { setCardBusy(false) })
      }, [draft, loadCards])

      const onActivateCard = useCallback(function (id) {
        setCardBusy(true)
        fetch(API + '/characters/' + encodeURIComponent(id) + '/activate', { method: 'POST' })
          .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status)
            return res.json()
          })
          .then(function () { setCardMsg('已切换角色'); return loadCards(id) })
          .then(function () { refresh() })
          .catch(function (e) { setCardMsg('切换失败：' + String(e.message || e)) })
          .then(function () { setCardBusy(false) })
      }, [loadCards, refresh])

      const onCreateCard = useCallback(function () {
        const raw = window.prompt('新角色 id（小写字母 / 数字 / - / _）', 'character2')
        if (!raw) return
        const id = String(raw).trim().toLowerCase()
        const name = window.prompt('显示名（之后也能改）', id) || id
        setCardBusy(true)
        fetch(API + '/characters', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: id, name: name }),
        }).then(function (res) {
          return res.json().then(function (r) {
            if (!res.ok || r.error) throw new Error(r.error || ('HTTP ' + res.status))
            return r
          })
        }).then(function () { return loadCards(id) })
          .then(function () { setCardMsg('已新建，写好人设后点「设为当前」') })
          .catch(function (e) { setCardMsg('新建失败：' + String(e.message || e)) })
          .then(function () { setCardBusy(false) })
      }, [loadCards])



      const loadVoice = useCallback(function () {
        return api('/admin/voice').then(function (d) { setVoice(d) })
          .catch(function (e) { setVoice({ ok: false, online: false, error: String(e.message || e) }) })
      }, [])

      const loadGame = useCallback(function () {
        return api('/admin/game').then(function (d) { setGameRun(d) })
          .catch(function () { setGameRun({ running: false }) })
      }, [])

      const launchGame = useCallback(function () {
        setGameBusy(true)
        setGameMsg('')
        return api('/admin/game/launch', { method: 'POST' })
          .then(function (d) {
            setGameRun(function (g) { return Object.assign({}, g || {}, d) })
            setGameMsg(d.note || '')
            setTimeout(loadGame, 4000)
            setTimeout(loadGame, 10000)
            setTimeout(loadGame, 20000)
          })
          .catch(function (e) { setGameMsg(String(e.message || e)) })
          .then(function () { setGameBusy(false) })
      }, [loadGame])

      const voiceAction = useCallback(function (action) {
        setVoiceBusy(action)
        setVoiceMsg('')
        return api('/admin/voice/' + action, { method: 'POST' })
          .then(function (d) {
            setVoice(function (v) { return Object.assign({}, v || {}, d) })
            setVoiceMsg(action === 'start' ? '已请求启动，模型加载约 30–50 秒' : (action === 'stop' ? '已请求停止' : '已请求重启'))
            setTimeout(loadVoice, 1500)
            setTimeout(loadVoice, 6000)
          })
          .catch(function (e) { setVoiceMsg(String(e.message || e)) })
          .then(function () { setVoiceBusy('') })
      }, [loadVoice])

      // 每次对话变化都全量 stringify 200 条，长会话每说一句话就把主线程卡一次。
      // 这是纯缓存：节流到 5 秒，只留最近 60 条。
      const lastChatSave = React.useRef(0)
      React.useEffect(function () {
        const now = Date.now()
        if (now - lastChatSave.current < 5000) return
        lastChatSave.current = now
        try {
          localStorage.setItem(CHAT_KEY, JSON.stringify({ turns: chat.slice(-60), memory: memStats }))
        } catch (e) { /* 超出配额就不存，不影响聊天 */ }
      }, [chat, memStats])

      const loadChat = useCallback(function () {
        return api('/chat?limit=80').then(function (d) {
          const list = Array.isArray(d.turns) ? d.turns : []
          CHAT_CACHE.turns = list
          CHAT_CACHE.memory = d.memory || null
          // 内容没变就不 setChat：否则轮询每 6 秒重排一次列表，滚动位置会被顶掉
          setChat(function (prev) {
            if (prev && prev.length === list.length) {
              const a = prev[prev.length - 1] || {}
              const b = list[list.length - 1] || {}
              if (a.at === b.at && a.text === b.text && a.role === b.role) return prev
            }
            return list
          })
          setMemStats(d.memory || null)
        }).catch(function (e) {
          // 这里失败不等于"连不上大脑"：它每 6 秒一次，任何瞬时抖动都会把整页刷成红条，
          // 要等下一次成功才恢复。健康状态由 refresh() 轮询 /health 决定，这里只记一笔。
          CHAT_CACHE.error = String(e.message || e)
        })
      }, [])

      // 事件驱动：只在「页面可见 / 窗口聚焦 / 切到状态页」时读一次状态；
      // 隐藏时完全静默。唯一的定时器只在过渡态（启动中/拉起中）兜底，避免点了没反应。
      useEffect(function () {
        refresh()
        loadChat()
        loadVoice()
        loadGame()
        loadLlm()
        const sync = function () {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          refresh()
          loadChat()
          loadVoice()
          loadGame()
          loadLlm()
        }
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', sync)
        if (typeof window !== 'undefined') window.addEventListener('focus', sync)
        // 她自己也会开口（工作观察 / 番茄钟 / 闲聊节拍），那些话不经过本页面，
        // 所以只要页面可见就轻量轮询一次聊天记录，让面板和游戏里说的保持同步。
        // 聊天记录单独轮询，见下面独立那个 useEffect。
        // 之前它挂在这个 effect 里，而这个 effect 的依赖含 voiceBusy / gameBusy /
        // taskStatus —— 语音或游戏状态一变就 cleanup 重建，定时器跟着重置，
        // 面板看上去就是"不刷新"。
        const transitional = Boolean(voiceBusy || gameBusy || (voice && voice.taskStatus === 'Starting'))
        const fallback = transitional ? setInterval(function () {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          loadVoice()
          loadGame()
        }, 4000) : null
        return function () {
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', sync)
          if (typeof window !== 'undefined') window.removeEventListener('focus', sync)
          if (fallback) clearInterval(fallback)
        }
      }, [refresh, loadChat, loadVoice, loadGame, loadLlm, voiceBusy, gameBusy, voice && voice.taskStatus])

      // 她自己也会开口（工作观察 / 番茄钟 / 闲聊节拍），那些话不经过本页面，
      // 所以只要页面可见就轻量轮询一次聊天记录，让面板和游戏里说的保持同步。
      // 依赖只有 loadChat（本身 useCallback 空依赖），定时器不会被别的状态打断。
      useEffect(function () {
        const chatPoll = setInterval(function () {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          void loadChat()
        }, 3000)
        return function () { clearInterval(chatPoll) }
      }, [loadChat])

      useEffect(function () {
        if (tab === 'characters' && !cardsLoaded.current) {
          cardsLoaded.current = true
          loadCards()
        }
        if (tab === 'status') { refresh(); loadVoice(); loadGame() }
        if (tab === 'voice') { loadVoices(); loadVoice() }
        if (tab === 'kb' && !kbData) { loadKb() }
        if (tab === 'assets' && !manifest) {
          api('/assets').then(function (d) { setManifest(d) })
            .catch(function () { setManifest({ counts: {}, manifest: {} }) })
        }
      }, [tab, manifest, loadCards])

      const onSay = useCallback(function (raw, remember) {
        const line = String(raw || '').trim()
        if (!line) return
        // 立刻清空输入栏，并先把这条气泡画出来（不等网络）
        setText('')
        setChat(function (prev) {
          const next = prev.concat([{ role: 'user', text: line, at: new Date().toISOString() }])
          CHAT_CACHE.turns = next
          return next
        })
        setBusy(true)
        setTurnErr('')
        api('/act', { method: 'POST', body: JSON.stringify({ text: line, remember: remember !== false }) })
          .then(function (result) {
            setTurn(result)
            if (result && result.subtitle && result.subtitle.text) {
              setChat(function (prev) {
                const next = prev.concat([{
                  role: 'assistant',
                  text: result.subtitle.text,
                  emotion: result.emotion || '',
                  at: new Date().toISOString(),
                }])
                CHAT_CACHE.turns = next
                return next
              })
            }
            refresh()
            loadChat()
            // /act 服务端已经把这条演掉了（返回里带 seq），这里再推一次 /play
            // 就会变成同一句话演两遍——那是「一句话重复几次」的来源。
            // 文案按返回里到底有没有 seq 分两种，别写一条不存在的推送记录。
            setPushed(result.seq ? '已推给游戏 seq=' + result.seq : '已在游戏里演出（服务端下发）')
          })
          .catch(function (e) {
            const msg = String(e.message || e)
            setTurnErr(msg)
            setChat(function (prev) {
              const next = prev.concat([{ role: 'assistant', text: '（没能接上：' + msg + '）', at: new Date().toISOString(), error: true }])
              CHAT_CACHE.turns = next
              return next
            })
          })
          .then(function () { setBusy(false) })
      }, [refresh, loadChat])

      // ── 工作台（走 Host 侧 /chill/host/work） ──────────────────────────
      const workApi = useCallback(function (path, init) {
        const opts = Object.assign({ headers: { 'content-type': 'application/json' } }, init || {})
        return fetch('/chill/host/work' + path, opts).then(function (res) {
          return res.text().then(function (text) {
            let json = null
            try { json = text ? JSON.parse(text) : null } catch (e) { json = { raw: text } }
            if (!res.ok) {
              const e2 = json && json.error
              const msg = (e2 && (e2.message || e2)) || ('HTTP ' + res.status)
              throw new Error(typeof msg === 'string' ? msg : ('HTTP ' + res.status))
            }
            return json
          })
        })
      }, [])

      const loadWork = useCallback(function () {
        return workApi('/?sessions=1').then(function (d) {
          setWorkData(d)
          setWorkMsg('')
        }).catch(function (e) {
          const msg = String(e.message || e)
          setWorkData({ ok: false, available: false, sessions: [], sessionsAvailable: false })
          setWorkMsg(msg.indexOf('404') >= 0
            ? '工作台还没加载：重启一次 Harness 就生效'
            : ('工作台没接上：' + msg))
        })
      }, [workApi])

      const onBindWork = useCallback(function (sessionId, title) {
        if (!sessionId) { setWorkMsg('先选一条对话'); return }
        setWorkBusy(true)
        setWorkMsg('')
        workApi('/bind', { method: 'POST', body: JSON.stringify({ sessionId: sessionId, title: title || '' }) })
          .then(function () { return loadWork() })
          .then(function () { setWorkMsg('已开始观察') })
          .catch(function (e) { setWorkMsg('观察失败：' + String(e.message || e)) })
          .then(function () { setWorkBusy(false) })
      }, [workApi, loadWork])

      // 停止观察：只解除当前选定的这一条
      const onUnbindWork = useCallback(function () {
        setWorkBusy(true)
        workApi('/unbind', { method: 'POST', body: '{}' })
          .then(function (j) {
            return loadWork().then(function () { return j })
          })
          .then(function (j) {
            const id = j && j.released && j.released[0]
            setWorkMsg(id ? '已停止观察 ' + String(id).slice(0, 8) : '没有正在观察的对话')
          })
          .catch(function (e) { setWorkMsg('停止观察失败：' + String(e.message || e)) })
          .then(function () { setWorkBusy(false) })
      }, [workApi, loadWork])

      // 全部解除：一次把所有正在观察的对话放平
      const onReleaseAllWork = useCallback(function () {
        setWorkBusy(true)
        workApi('/release', { method: 'POST', body: '{}' })
          .then(function (j) {
            return loadWork().then(function () { return j })
          })
          .then(function (j) {
            const n = (j && j.released && j.released.length) || 0
            setWorkMsg(n > 1 ? '已解除全部观察（' + n + ' 条）' : '已解除观察')
          })
          .catch(function (e) { setWorkMsg('全部解除失败：' + String(e.message || e)) })
          .then(function () { setWorkBusy(false) })
      }, [workApi, loadWork])

      const onStopWork = useCallback(function () {
        workApi('/cancel', { method: 'POST', body: '{}' })
          .then(function () { return loadWork() })
          .catch(function (e) { setWorkMsg('停止失败：' + String(e.message || e)) })
      }, [workApi, loadWork])

      // 让她现在就看一眼：冷读那条会话，自己判断要不要开口
      const onLookWork = useCallback(function () {
        setWorkMsg('正在看一眼…')
        workApi('/look', { method: 'POST', body: '{}' })
          .then(function (r) {
            if (r && r.error) throw new Error(r.error)
            const s = (r && r.summary) || {}
            setWorkMsg('看过了：' + (s.turns || 0) + ' 轮 / ' + (s.toolCalls || 0) + ' 次工具'
              + ((s.tools && s.tools.length) ? ' / ' + s.tools.join('、') : ''))
            return loadWork()
          })
          .catch(function (e) { setWorkMsg('看一眼失败：' + String(e.message || e)) })
      }, [workApi, loadWork])

      // 进页面先拉一次：不然下拉里永远是空的，得手动点「加载」才看得到可选的对话。
      React.useEffect(function () { void loadWork() }, [loadWork])

      // 让她自己说句话：不看工作，纯闲聊，走完整人设链路
      const onSpark = useCallback(function () {
        setWorkMsg('她正在想…')
        fetch('/chill/v1/spark', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
          .then(function (r) { return r.json() })
          .then(function (o) {
            if (!o || o.ok !== true) { setWorkMsg('这轮她没说出话'); return }
            setWorkMsg('她说了：' + String(o.subtitle || ''))
            void loadChat()
          })
          .catch(function (e) { setWorkMsg('开口失败：' + String(e.message || e)) })
      }, [loadChat])

      const onEvent = useCallback(function (type) {
        api('/event', { method: 'POST', body: JSON.stringify({ type: type }) })
          .then(function () { refresh() })
          .catch(function (e) { setHealthErr(String(e.message || e)) })
      }, [refresh])

      const pushToGame = useCallback(function (payload) {
        return api('/play', {
          method: 'POST',
          body: JSON.stringify(Object.assign({ source: 'console' }, payload)),
        })
      }, [])

      const onPush = useCallback(function (t) {
        if (!t) return
        pushToGame({
          performance: t.performance || [],
          subtitle: (t.subtitle && t.subtitle.text) || '',
          audioUrl: (t.voice && t.voice.audioUrl) || '',
          mouthFps: t.mouthFps || 0,
          mouthFrames: t.mouthFrames || 0,
          mouthFlat: t.mouthFlat || [],
        }).then(function () { setHealthErr('') })
          .catch(function (e) { setHealthErr('推送失败：' + String(e.message || e)) })
      }, [pushToGame])

      const onPushCue = useCallback(function (id) {
        pushToGame({ performance: [{ slot: 'animations', id: String(id), at: 0 }] })
          .then(function () { setHealthErr('') })
          .catch(function (e) { setHealthErr('推送失败：' + String(e.message || e)) })
      }, [pushToGame])

      // 版本号：turnId（每轮说话）+ avatarBust（换头像后立刻刷新）
      const avatarBustParam = '&b=' + avatarBust
      const avatarUrl = API + '/avatar/' + encodeURIComponent(cards.active || 'satone') +
        '?v=' + encodeURIComponent(String((turn && (turn.turnId || (turn.meta && turn.meta.turnId))) || '0')) + avatarBustParam
      const userAvatarUrl = API + '/avatar/user?b=' + avatarBust

      const activeCardInfo = (cards.list || []).filter(function (c) { return c.id === cards.active })[0]
      const herName = (activeCardInfo && activeCardInfo.name) || '角色'
      const connected = Boolean(health && health.ok)
      // 状态和测试排在最后：日常用不到，占着前排只会挤掉常用入口。
      const tabs = [['play', '对话'], ['model', '模型'], ['characters', '角色'], ['voice', '语音'], ['kb', '知识库'], ['assets', '资源'], ['status', '状态'], ['test', '测试']]

      const content = tab === 'status'
        ? h(StatusTab, { health: health, onEvent: onEvent })
        : (tab === 'play'
          ? h(ChatTab, {
            chat: chat, memStats: memStats, text: text, setText: setText, turn: turn,
            busy: busy, error: turnErr, onSay: onSay, pushed: pushed, onRefresh: loadChat,
            avatarUrl: avatarUrl, userAvatarUrl: userAvatarUrl,
                work: workData, workBusy: workBusy, workMsg: workMsg,
            workPick: workPick, onPick: setWorkPick,
            onBind: onBindWork, onUnbind: onUnbindWork, onReleaseAll: onReleaseAllWork,
            onStop: onStopWork,
            onReloadWork: loadWork, onLookWork: onLookWork,
            onSpark: onSpark,
          })
          : (tab === 'model'
            ? h(ModelTab, {
              data: llm, busy: llmBusy, msg: llmMsg, probe: llmProbe,
              onActivate: onActivateLlm, onAdd: onAddLlm, onRemove: onRemoveLlm,
              onTest: onTestLlm, onRefresh: loadLlm, onMsg: setLlmMsg,
            })
          : (tab === 'characters'
            ? h(CharactersTab, {
              list: cards.list, active: cards.active, draft: draft, busy: cardBusy, msg: cardMsg,
              onDraft: setDraft, onSelect: onSelectCard, onActivate: onActivateCard,
              onSave: onSaveCard, onCreate: onCreateCard,
              avatars: { her: avatarUrl, me: userAvatarUrl }, herName: herName,
              onAvatarChanged: function () { setAvatarBust(Date.now()) },
            })
            : (tab === 'voice'
              ? h(VoiceTab, {
                data: voices, busy: vBusy, msg: vMsg,
                onActivate: onActivateVoice, onCreate: onCreateVoice,
                onPreview: onPreviewVoice, onDelete: onDeleteVoice,
                onRefresh: loadVoices, onMsg: setVMsg,
              })
              : (tab === 'test'
                ? h(TestTab, null)
              : (tab === 'kb'
                ? h(KbTab, {
                  data: kbData ? Object.assign({}, kbData, {}) : null,
                  busy: kbBusy, msg: kbMsg, hits: kbHits,
                  onCreate: onCreateKb, onToggle: onToggleKb, onDelete: onDeleteKb,
                  onAddDoc: onAddKbDoc, onDeleteDoc: onDeleteKbDoc, onRole: onRoleKb,
                  onExport: onExportKb, onImport: onImportKb,
                  onSearch: onSearchKb, onRefresh: loadKb, onMsg: setKbMsg,
                })
                  : h(AssetsTab, {
                    manifest: manifest && manifest.manifest, loading: !manifest,
                    group: group, setGroup: setGroup, query: query, setQuery: setQuery, onPushCue: onPushCue,
                  })))))))

      // 语音引擎控制条：放在 tab 页上方，任何 tab 下都能启停
      const vOn = Boolean(voice && voice.online)
      const gRunning = Boolean(gameRun && gameRun.running)
      const vBtn = function (action, label, primary) {
        const on = voiceBusy === action
        return h('button', {
          key: action,
          disabled: Boolean(voiceBusy),
          onClick: function () { voiceAction(action) },
          style: Object.assign({}, btnStyle(Boolean(primary)), {
            padding: '3px 12px', fontSize: 11.5, cursor: voiceBusy ? 'default' : 'pointer',
            opacity: voiceBusy && !on ? 0.5 : 1,
          }),
        }, on ? label + '…' : label)
      }

      const voiceBar = h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: '7px 12px', borderRadius: 10, background: T.l1, border: '1px solid ' + T.b1,
        },
      },
      h('span', { style: { fontSize: 11.5, color: T.tx2, letterSpacing: '.02em' } }, '语音引擎'),
      h('span', {
        style: Object.assign({}, S.chip, { borderColor: vOn ? T.ok : T.warn, color: vOn ? T.ok : T.warn }),
      }, vOn ? '在线 · GPT-SoVITS' : '未启动'),
      voice && voice.port ? h('span', { style: Object.assign({}, S.chip, { color: T.tx2 }) }, '127.0.0.1:' + voice.port) : null,
      voice && voice.taskStatus && voice.taskStatus !== 'missing'
        ? h('span', { style: Object.assign({}, S.chip, { color: T.tx2 }) }, '任务 ' + voice.taskStatus)
        : null,
      h('div', { style: { flex: 1 } }),
      (gameMsg || (gameRun && gameRun.error)) ? h('span', { style: { fontSize: 11, color: T.tx2, marginRight: 4 } }, gameMsg || gameRun.error)
        : (voiceMsg ? h('span', { style: { fontSize: 11, color: T.tx2, marginRight: 4 } }, voiceMsg)
          : (voice && voice.lastError ? h('span', { style: { fontSize: 11, color: T.warn, marginRight: 4 } }, '上次合成失败：' + String(voice.lastError).slice(0, 40)) : null)),
      vBtn('start', '启动', !vOn),
      vBtn('stop', '停止'),
      vBtn('restart', '重启'),
      h('div', { style: { width: 1, height: 18, background: T.b1, margin: '0 3px' } }),
      h('span', {
        style: Object.assign({}, S.chip, { borderColor: gRunning ? T.ok : T.tx2, color: gRunning ? T.ok : T.tx2 }),
      }, gRunning ? '游戏运行中' : '游戏未运行'),
      h('button', {
        key: 'launch',
        disabled: gRunning || gameBusy,
        onClick: function () { launchGame() },
        style: Object.assign({}, btnStyle(!gRunning), {
          padding: '3px 12px', fontSize: 11.5,
          cursor: (gRunning || gameBusy) ? 'default' : 'pointer',
          opacity: (gRunning || gameBusy) ? 0.5 : 1,
        }),
      }, gameBusy ? '拉起中…' : '拉起游戏'))

      return h('div', { style: S.page },
        h('div', { style: S.head },
          h('div', null,
            h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
              h('div', { style: S.title }, herName + ' 控制台'),
              cards.active ? h('span', { style: Object.assign({}, S.chip, { fontSize: 10 }) }, cards.active) : null),
            h('div', { style: S.sub }, 'Chill with You · Lo-Fi Story —— 大脑 / 语音 / 表演资源')),
          h('div', { style: { flex: 1 } }),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.tx2 } },
            h('span', { style: dot(healthErr ? T.err : (connected ? T.ok : T.idle)) }),
            healthErr ? '未连接：' + healthErr : (connected ? '已连接 · ' + (health.model || '') : '连接中…')),
          h('button', { type: 'button', style: btnStyle(false), onClick: refresh }, '刷新')),
        voiceBar,
        h('div', { style: S.tabs },
          tabs.map(function (t) {
            return h('div', {
              key: t[0], style: tabStyle(tab === t[0]),
              onClick: function () { setTab(t[0]) },
            }, t[1])
          })),
        h('div', { style: S.body },
          healthErr
            ? h('div', { style: Object.assign({}, S.card, { borderColor: T.err, color: T.err }) },
              '连不上大脑：' + healthErr + '（确认 dsh-chill-with-you-companion 已挂载、dsh web 在跑）')
            : null,
          content))
    }

    class Safe extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) { return { error: error } }
      componentDidCatch() {}
      render() {
        if (this.state.error) {
          return h('div', { style: Object.assign({}, S.page, { padding: 20 }) },
            h('div', { style: { color: T.err, fontWeight: 600, marginBottom: 6 } }, '聪音控制台渲染出错'),
            h('pre', { style: Object.assign({}, S.mono, { color: T.tx2, whiteSpace: 'pre-wrap' }) },
              String((this.state.error && this.state.error.message) || this.state.error)))
        }
        return h(Console)
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', function () {
          return ctx.slots.register({
            name: 'sidebar.panellist', id: PANEL_ID, order: 96, label: '聪音控制台',
          }, PanelIcon)
        })
        ctx.slots.inject('main', function () {
          return ctx.slots.register({ name: 'main', key: PANEL_ID }, Safe)
        })
      },
    }
  },
})