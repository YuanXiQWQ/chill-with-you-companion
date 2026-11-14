/**
 * 快捷框（聪音控制台的小窗）不能污染别的浏览器窗口。
 *
 * 真机上的症状：先开快捷聊天，再开 Harness/浏览器，窗口跟快捷框一样小。
 * 病因不是 CSS，是 Chromium 按 profile 记住上一次 app 窗口的边界——快捷框
 * 以前和默认 profile 共用，430×560 就被记进去了，之后任何 --app 窗口都继承它。
 *
 * 这里守住四件事，任何一条被改回去都会让症状复发：
 *   1) 快捷框有自己的 --user-data-dir（从 cfg.dataDir 派生，不写死路径）
 *   2) 尺寸显式给（--window-size），不靠 profile 记忆
 *   3) 打开后用 place-window.ps1 兜一次摆位 + 唤出（Chromium 会把窗口建成隐藏/最小化）
 *   4) 那个 ps1 必须纯 ASCII（PS 5.1 读非 BOM 文件按 ANSI 解释，中文注释会炸）
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const brain = readFileSync(join(ROOT, 'brain.mjs'), 'utf8')

const start = brain.indexOf("path: '/chill/v1/quickbox'")
assert.ok(start > 0, 'brain.mjs 里找不到 /chill/v1/quickbox 路由')
const end = brain.indexOf('POST /chill/v1/quickbox', start)
assert.ok(end > start, '找不到快捷框路由的结束标记')
const route = brain.slice(start, end)

// 0) 默认路径必须是原生浮窗（WebView2），不是浏览器 app 窗口。
//    理由：浏览器 app 窗口会借用用户正在用的浏览器（任务栏、profile 记忆尺寸、
//    关浏览器连带关框），实测用户不接受。
assert.match(route, /mode: 'widget'/, '默认路径必须拉起原生浮窗（mode: widget）')
assert.match(route, /quickfloat\.ps1/, '默认路径要调用 tools/quickfloat.ps1')
assert.match(route, /-UserDataDir', join\(cfg\.dataDir, 'quickfloat'\)/,
  '浮窗要自带 WebView2 user data 目录，不能共用浏览器的')
assert.match(route, /browser=1/, '浏览器模式必须退成显式 ?browser=1，不能是默认')

// 尺寸：默认 430x187（原 430x560 砍掉三分之二）
assert.match(brain, /CHILL_QUICKBOX_HEIGHT \|\| 187/, '默认高度应为 187（原 560 的三分之一）')
assert.match(readFileSync(join(ROOT, 'tools', 'quickfloat.ps1'), 'ascii'), /\[int\]\$Height = 187/,
  'quickfloat.ps1 的默认高度也要是 187，否则被接口传参覆盖前它自己是高的')
assert.match(readFileSync(join(ROOT, 'tools', 'quickfloat.ps1'), 'ascii'), /MinimumSize[^\r\n]*\(140 \* \$scale\)/,
  'MinimumSize 高度必须小于 187，否则窗口被撑回旧高度')

const floatPs1 = join(ROOT, 'tools', 'quickfloat.ps1')
assert.ok(existsSync(floatPs1), 'tools/quickfloat.ps1 不存在')
const floatRaw = readFileSync(floatPs1)
for (let i = 0; i < floatRaw.length; i++) {
  if (floatRaw[i] > 0x7f) {
    const line = floatRaw.subarray(0, i).toString('latin1').split('\n').length
    assert.fail(`quickfloat.ps1 第 ${line} 行有非 ASCII 字节：PS 5.1 会按 ANSI 解释`)
  }
}
const floatText = floatRaw.toString('ascii')
assert.match(floatText, /Microsoft\.Web\.WebView2\.WinForms\.WebView2/, '浮窗必须用 WebView2 承载页面')
assert.ok(!/TopMost/.test(floatText), '窗口要像普通窗口一样：不再强制置顶（TopMost）')
assert.match(floatText, /Add_Shown\(\{[\s\S]{0,400}\[QuickFloatChrome\]::Reveal/, '被 windowsHide 拉起时要显式 Restore，否则起来就是最小化')
assert.match(floatText, /ChillQuickFloat/, '浮窗要有单实例互斥，避免点一次弹一个')
assert.match(floatText, /Local\\\\ChillQuickFloat|Local\\ChillQuickFloat/, '互斥名要带 Local\\ 前缀')

// 窗框：最小化 / 关闭两个键，圆角，DPI 清晰
assert.match(floatText, /btnMin\.Add_Click\(\{ \$form\.WindowState = \[System\.Windows\.Forms\.FormWindowState\]::Minimized \}\)/,
  '要有一个真正最小化的按钮（WindowState = Minimized）')
assert.match(floatText, /New-StripButton/, '标题栏按钮要统一走 New-StripButton，风格才不散')
assert.match(floatText, /DwmSetWindowAttribute\(hwnd, 33/, 'Win11 要用 DWM corner preference=33 出系统圆角')
assert.match(floatText, /CreateRoundRectRgn/, '还要给窗口加圆角 region，否则 WebView2 子窗口会盖住圆角')
assert.match(floatText, /SetProcessDPIAware/, '要声明 DPI aware，否则 150% 屏上整窗被拉伸、字发虚')
assert.match(floatText, /Reveal\(\$form\.Handle\)/, '被 windowsHide 拉起时要显式 Restore，否则窗口起来就是最小化')

// 键位顺序：Dock 是「后加的排最右」，所以先加最小化，关闭才会在最右边
assert.match(floatText, /\$header\.Controls\.Add\(\$btnMin\)[\s\S]{0,160}\$header\.Controls\.Add\(\$btnClose\)/,
  '标题栏按键顺序：最小化在左、关闭在最右')
assert.ok(!/btnPin/.test(floatText), 'PIN 已取消，脚本里不应再有 pin 键')

// 页面：取消「清空」按钮，只留输入框的 Esc 清空
const quickHtml = readFileSync(join(ROOT, 'tools', 'quick.html'), 'utf8')
assert.ok(!/id="clear"/.test(quickHtml), '页面不再提供「清空」按钮')
assert.ok(!/clearBtn/.test(quickHtml), '清空按钮的监听要一并删掉，否则会对着空元素绑定')

// 记录口径：快捷框说的话要进控制台记录
assert.match(quickHtml, /'x-chill-quick': '1'/, '快捷框发 /act 时必须带 x-chill-quick 头，否则会被判成自动化、不落记录')
assert.match(brain, /headers\?\.\['x-chill-quick'\]/, '侧车要认这个头，把快捷框的请求当真人对话')

// 1) 独立 profile（浏览器兜底路径）
assert.match(brain, /const QUICK_PROFILE = join\(cfg\.dataDir, 'quickbox-profile'\)/,
  '快捷框必须用 cfg.dataDir 下的独立 profile（join(cfg.dataDir, \'quickbox-profile\')）')
assert.match(route, /'--user-data-dir=' \+ QUICK_PROFILE/,
  '启动参数里必须带上 --user-data-dir=QUICK_PROFILE，否则会回到默认 profile 记忆尺寸')

// 2) 尺寸显式给，并且可配置
assert.match(route, /'--window-size=' \+ QUICK_W \+ ',' \+ QUICK_H/,
  '必须显式传 --window-size，不能只依赖浏览器记忆')
assert.match(brain, /CHILL_QUICKBOX_WIDTH/, '宽度要能用 CHILL_QUICKBOX_WIDTH 覆盖')
assert.match(brain, /CHILL_QUICKBOX_HEIGHT/, '高度要能用 CHILL_QUICKBOX_HEIGHT 覆盖')

// 3) 摆位兜底
assert.match(route, /place-window\.ps1/, '打开后要调用 tools/place-window.ps1 兜一次摆位')
assert.match(route, /'-CommandLineMatch',\s*'quickbox-profile'/, '摆位脚本要按 profile 命令行认窗口（中文标题走命令行不可靠）')
assert.match(route, /stdio:\s*\['ignore',\s*'pipe',\s*'pipe'\]/,
  '摆位脚本的 stdio 必须是 pipe：重定向到文件 fd 时 PS 5.1 什么都不写，出问题没有线索')
assert.ok(!/placer\.unref\(\)/.test(route),
  '摆位脚本不要 unref：需要接 close 事件把输出落盘')

// 4) ps1 是纯 ASCII 且用 SW_SHOWNORMAL 唤出
const ps1 = join(ROOT, 'tools', 'place-window.ps1')
assert.ok(existsSync(ps1), 'tools/place-window.ps1 不存在')
const raw = readFileSync(ps1)
for (let i = 0; i < raw.length; i++) {
  if (raw[i] > 0x7f) {
    const line = raw.subarray(0, i).toString('latin1').split('\n').length
    assert.fail(`place-window.ps1 第 ${line} 行有非 ASCII 字节：PS 5.1 会按 ANSI 解释，注释里的中文也照炸`)
  }
}
const ps1Text = raw.toString('ascii')
assert.match(ps1Text, /ShowWindow\(\$h, 1\)/,
  '摆位脚本要用 SW_SHOWNORMAL(1) 唤出窗口——SW_SHOW(5) 在隐藏的 app 窗口上不生效')
assert.match(ps1Text, /MoveWindow\(\$h, \$PosX, \$PosY, \$Width, \$Height, \$true\)/,
  '摆位脚本要真的 MoveWindow 到目标几何')
assert.match(ps1Text, /IsWindowVisible\(\$h\)/, '摆位脚本要以「窗口真的可见」作为成功判据')

console.log('  PASS 浮窗走原生 WebView2 / 单实例 / 最小化+关闭 / 不强制置顶；浏览器路径仅作兜底')
