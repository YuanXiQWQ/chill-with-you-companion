# AGENTS.md · 安装与接入

## 第一件事：先确认这台机器上有没有《放松时光》

**在做任何别的事之前，先找游戏本体。没有就停下来，直接告诉宿主：请先去 Steam 安装《放松时光：与你共享 Lo-Fi Story》（appid `3548580`），装完再回来。不要往下走。**

理由很硬：这个插件的全部价值是「让游戏里的她动起来」。没有游戏，你能把前三层装得干干净净、`health` 全绿、面板一切正常，然后**永远验证不了它到底成不成**——而且会以为是自己装错了。

### 怎么查（命中任意一条即算装了）

```powershell
# ① 权威来源：Steam 的应用清单，能直接拿到安装路径
foreach ($d in @('C:','D:','E:','F:','G:')) {
  Get-ChildItem "$d\" -Filter 'appmanifest_3548580.acf' -Recurse -Depth 4 -ErrorAction SilentlyContinue |
    ForEach-Object { "  " + $_.FullName; "  " + (Select-String -Path $_.FullName -Pattern '"installdir"' | Select-Object -First 1).Line }
}
```

```powershell
# ② 兜底：直接按目录找
foreach ($d in @('C:','D:','E:','F:','G:')) {
  Get-ChildItem "$d\SteamLibrary\steamapps\common","$d\Steam\steamapps\common","$d\Program Files (x86)\Steam\steamapps\common" -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^Chill With You' } | Select-Object -ExpandProperty FullName
}
```

命中后记下 `$GAME`，后面 §4 要用。再核一下它是不是**完整**安装（缺 `_Data` 只是残留目录，不算）：

```powershell
Test-Path "$GAME\Chill With You_Data\Managed\Assembly-CSharp.dll"   # 应为 True
```

### 没装就到此为止

不要"先装着试试"、不要"装个免安装版"、不要自己去下盗版。**把缺的东西讲清楚，让宿主去 Steam 装**，然后等他说装好了再回来从 §1 开始。

---

> 这份文件写给**替你装东西的 AI agent**。人看的说明在 [README.md](./README.md)，
> 架构与扩展在 [ARCHITECTURE.md](./ARCHITECTURE.md) / [EXTENDING.md](./EXTENDING.md)。
>
> 按 §1 → §7 顺序执行。每一步末尾有「验收」，**验收不过不要往下走**——
> 后面所有失败都是前面那一步没成的回声，继续做只会浪费时间。

---

## 0. 你要装成什么

三件东西，**缺一件就只是半套**：

| 层 | 是什么 | 在哪 | 谁提供 |
| --- | --- | --- | --- |
| **宿主插件** | Cordis 插件。监护侧车、把 `/chill/v1/*` 反代到侧车、提供面板 | 本仓库根目录（`index.js`） | 随包 |
| **侧车** | node 子进程，真正干活的"大脑"（对话 / 记忆 / 演出编排 / 语音） | `serve.mjs` + `brain.mjs` + `lib/` | 随包 |
| **游戏端** | BepInEx 插件 `ChillPerformer.dll`。把指令变成她真实的身体动作 | `game/`（源码 + 预编译 DLL） | 随包 |

**只装前两层 = `health` 全绿、面板一切正常、游戏里她一动不动。** 这是最常见的失败形态，
因为它的症状不指向病因。

### 完成标准（五条全过才算装好）

| # | 判据 | 怎么验 |
| --- | --- | --- |
| 1 | `/chill/v1/health` 返回 200 且 `ok:true` | `curl` |
| 2 | `health.hasApiKey === true` | 同上，看字段 |
| 3 | 左侧栏出现「聪音控制台」图标 | 人眼 / 浏览器 |
| 4 | 开着游戏时 `health.gameOnline === true`，且生出 `<数据目录>/assets.json` | `curl` + `ls` |
| 5 | `POST /chill/v1/act` 返回 `subtitle` 和 `performance` | `curl` |

第 4、5 条是**端到端**判据。前三条只证明"进程活着"，不证明**它能演**。

---

## 1. 前置检查

先把这张表逐行查一遍，缺什么报给用户，**不要自己猜着装**。

| 项 | 要求 | 怎么查 |
| --- | --- | --- |
| 操作系统 | Windows 10 / 11 x64 | —— 游戏只出 Windows 版，插件跟随 |
| Node.js | **≥ 22** | `node -v` |
| dsh | ≥ 0.2.0 | `dsh --version` |
| 游戏 | Steam appid `3548580`，能正常启动 | 见文首那节，**最先查的就是它** |
| 磁盘 | 插件 + 清单约 1 MB；语音引擎另需约 8 GB | —— |

Node 版本是硬门槛：低于 22 会在 `serve.mjs` 的路径处理上炸，而且报错不指向版本。
`package.json` 里写了 `engines.node >= 22`，但 npm 只给警告、不拦安装——自己 `node -v` 看一眼更稳。

---

## 2. 需要自己下载的东西

**这张表之外的一切都已经在仓库里。** 本仓库的分发口径是：

> 有下载渠道的（运行时、引擎、模型、BepInEx）→ 不随包，装的时候自己下。
> 没有下载渠道的（游戏端 DLL、它的源码、静态动作清单、角色卡、技能）→ 全部随包。
> **私人内容一律不随包**：模型权重（`*.pth` / `*.ckpt` / `*.safetensors` / `*.onnx` / `*.gguf`，多数许可还禁止再分发）、
> API key 与任何凭据文件（`llm.json` / `.env` / `.credentials.yaml`）、聊天记录、TTS 缓存、状态与日志。

| 组件 | 必需？ | 下载地址 | 放到哪 |
| --- | --- | --- | --- |
| **BepInEx 5.4.x x64** | **必需**（只为装游戏端） | <https://github.com/BepInEx/BepInEx/releases> | 解压到**游戏根目录**，得到 `BepInEx/` |
| Node.js ≥ 22 | 必需 | <https://nodejs.org> | 系统安装 |
| GPT-SoVITS v2 | 可选 | <https://github.com/RVC-Boss/GPT-SoVITS> | `<插件>/tools/gsv-src/GPT-SoVITS-main` |
| Python 3.10 + 依赖 | 可选 | <https://www.python.org> | venv 建在 `<插件>/tools/gsv-venv` |
| GPT-SoVITS v2 预训练模型 | 可选 | <https://huggingface.co/lj1995/GPT-SoVITS> | 放进 GPT-SoVITS 自己的目录 |

**语音整条链可以完全不装。** 引擎缺失时插件自动降级为「纯字幕 + 不播语音」，游戏照常演，
其它功能一个不少。所以：**先把 1–5 做完跑通，再回头补语音**。别在一开始就陷进 Python 环境。

> **参考音频不随包**（`ref/*.wav` 是游戏的人声音频，版权不在本仓库）。
> 要日文音色就从用户自己的游戏安装目录取一段 3–10 秒人声放进去，文件名见
> `ref/ref-index.json`；不取也行，走纯字幕。

---

## 3. 安装宿主插件

插件用**目录依赖**挂进 profile，不要整包拷贝到 profile 里去——那样升级要拷两遍。

### 一条命令（优先用这个）

```powershell
node "<本仓库>\tools\install.mjs" --game "$GAME"
```

它一次做完：建目录联接 → 在 profile 的 `package.json` 里补依赖与 `dsh.profile.bundles`（改前自动备份）
→ 把 `game/ChillPerformer.dll` 拷进 `BepInEx/plugins` → 逐项打 ✓/✗。
`--check` 只体检不落盘，可反复跑（幂等）。profile 有多个时加 `--profile <名字>`。

**它不删任何已存在的目录**：发现同名普通目录会直接退出并让你手动处理。

### Windows

```powershell
$PLUGIN  = "D:\path\to\chill-with-you"          # 本仓库所在目录
$PROFILE = "$env:USERPROFILE\.dsh\profiles\<profile>"

# 1) 目录联接：把包名映射到仓库目录
New-Item -ItemType Junction `
  -Path   "$PROFILE\node_modules\dsh-chill-with-you-companion" `
  -Target $PLUGIN

# 2) 声明依赖（若 profile 的 package.json 里还没有这两处）
#    dependencies: { "dsh-chill-with-you-companion": "link:D:/path/to/chill-with-you" }
#    dsh.profile.bundles: [ ..., "dsh-chill-with-you-companion" ]
```

macOS / Linux 用 `ln -s "$PLUGIN" "$PROFILE/node_modules/dsh-chill-with-you-companion"`。

### 验收

```powershell
node -e "console.log(require.resolve('dsh-chill-with-you-companion',{paths:[process.argv[1]]}))" $PROFILE
# 期望打印 .../index.js，且路径能落到你的仓库目录
```

### 必须重启

**新增 bundle 后必须重启 `dsh web` 进程，刷新浏览器没有用。**
客户端模块和宿主插件都是进程启动时装配的，跟页面无关。

这一步最容易翻车的地方：`package.json` 改了名字但 `node_modules` 里的联接还是旧名字，
loader 解析不到，**整个插件静默消失**——`/chill/v1/health` 返回 **404** 而不是报错。
看到 404 先查联接，别查代码。

---

## 3.5 卸载（别手改 profile）

```powershell
node tools/uninstall.mjs                    # 只看不动
node tools/uninstall.mjs --apply            # 摘联接 + 从 profile 撤依赖与 bundle
node tools/uninstall.mjs --apply --game "<游戏目录>" --remove-dll
```

不要手工编辑 `~/.dsh/profiles/<profile>/package.json`——脚本会先备份再写，且不带 BOM。
卸载**不删** `data/`：记忆、好感度、`llm.json` 里的明文 key、语音缓存都在里面，脚本只打印位置。

## 4. 安装游戏端（`ChillPerformer.dll`）

### 方式 A：用随包的预编译 DLL（推荐）

```powershell
$GAME = "C:\Program Files (x86)\Steam\steamapps\common\Chill With You Lo-Fi Story"
Copy-Item "<本仓库>\game\ChillPerformer.dll" "$GAME\BepInEx\plugins\" -Force
```

它和 `game/src/` 里的源码是同一份，编译日期见 `CHANGELOG.md`。

### 方式 B：从源码构建

需要 .NET SDK，且能读到游戏自己的 `Assembly-CSharp` 与 Unity 模块。

```powershell
$env:CHILL_GAME_DIR = "C:\Program Files (x86)\Steam\steamapps\common\Chill With You Lo-Fi Story"
dotnet build "<本仓库>\game\src\ChillPerformer.csproj" -c Release
# 构建后会自动复制到 $env:CHILL_GAME_DIR\BepInEx\plugins\
```

`ChillPerformer.csproj` 里的 `<GameDir>` 优先读环境变量 `CHILL_GAME_DIR`，
没设才落到默认 Steam 路径。

### 验收

启动游戏一次，然后：

```powershell
Select-String "$GAME\BepInEx\LogOutput.log" -Pattern 'ChillPerformer' | Select-Object -First 5
```

能看到加载行即为成功。**这一步没验过就不要进 §6**——没有它，§6 的第 4、5 条永远过不了，
而 `health` 会一直是绿的，让你以为问题在插件侧。

---

## 5. 配 API key

> key 泄漏的处理顺序：**先去服务商后台撤销旧 key**（本机做什么都不等于撤它），
> 再 `node tools/rotate-key.mjs --key sk-新key --apply` 落到本机并抹掉残留副本，
> 最后重启 `dsh web` 在面板里点一次测试。仓库里的明文靠 `node tools/scan-secrets.mjs` 挡
> （已接进 `check-publish` 硬门）。

DeepSeek 的 key 按这个顺序解析，**前面找到就不看后面**：

1. 环境变量（`keyRef` 指向的变量名，默认 `DEEPSEEK_API_KEY`）
2. `<DSH_HOME>/.credentials.yaml`
3. `<数据目录>/llm.json` 里对应 provider 的 `token` 字段

```powershell
$env:DEEPSEEK_API_KEY = "sk-..."
```

> `<数据目录>/llm.json` 已被 `.gitignore` 排除，**不要把 key 提交进仓库**。

验收：`health.hasApiKey` 为 `true`。为 `false` 时表现是"能回话但不出声/直接报错"，
不是启动失败，容易误判成语音引擎坏了。

---

## 6. 端到端验收

重启 `dsh web`，然后逐条跑。**每条的失败含义都不一样，别混。**

```powershell
# ① 进程活着
curl.exe -s http://127.0.0.1:10722/chill/v1/health
```

期望：`200`，且含 `"ok":true`。

| 返回 | 含义 | 该查哪 |
| --- | --- | --- |
| **404** | 插件根本没挂载 | §3 的目录联接、profile 的 `bundles`、是否真的重启过 |
| **502 / 503** | 宿主在，侧车没起来 | `<数据目录>/sidecar.log`、端口是否被占 |
| **200 但 `ok` 缺失** | 撞到别的服务了 | 端口 10722 是不是别的进程 |

```powershell
# ② 路由全不全（应有 31 条）
curl.exe -s http://127.0.0.1:10722/chill/v1/meta
```

```powershell
# ③ 真正跑一次演出（sandbox:true = 不写记忆、不动真实状态）
curl.exe -s -X POST http://127.0.0.1:10722/chill/v1/act `
  -H "content-type: application/json" `
  -d '{\"text\":\"我开始了，25 分钟\",\"sandbox\":true}'
```

期望：返回里有 `subtitle`（中文台词，10–25 字）和 `performance`（动作/表情指令）。
**这一条过不了就不用看面板了**——面板只是这些接口的前端。

```powershell
# ④ 游戏端在线
curl.exe -s http://127.0.0.1:10722/chill/v1/health   # 看 gameOnline
Test-Path "<数据目录>\assets.json"                 # 应为 True
```

`gameOnline:false` 而其它全绿 = 游戏端没装好或游戏没开，回 §4。

```powershell
# ⑤ 面板
```

刷新页面，左侧栏应有「聪音控制台」。没有时先查 `/chill/v1/health` 是不是 200——
接口活着但图标不在，是客户端模块没挂上；接口 404，整个插件都没挂上，别在面板上找原因。

---

## 7. 可选：语音引擎

跳过不影响任何其它功能。要做：

1. GPT-SoVITS 仓库放到 `<插件>/tools/gsv-src/GPT-SoVITS-main`
2. venv 建在 `<插件>/tools/gsv-venv`，装该仓库的 `requirements.txt`
3. 模型放进 GPT-SoVITS 目录
4. 参考音频放 `<插件>/ref/`，文件名见 `ref/ref-index.json`
5. 打开面板「语音」页 → 点「刷新」→ 看引擎卡片是否变绿

也可以直接把绝对路径填进配置（`tts.engine.python` / `tts.engine.repo`），留空则按上面两个位置自动找。

验收：面板「试演」能播出一段日文；`<数据目录>/tts.log` 无持续报错。

---

## 8. 故障对照表

| 症状 | 最可能的原因 | 第一条要查的 |
| --- | --- | --- |
| `/chill/v1/health` 404 | 插件未挂载 | `node_modules/<包名>` 联接是否存在、目标是否存在 |
| 改包名后面板消失、接口 404 | 联接还是旧名字，loader 解析不到 | 同上。名字改了必须重建联接 |
| health 200 但 `gameOnline:false` | 游戏端 DLL 没装 / 游戏没开 | §4 的 `LogOutput.log` |
| `hasApiKey:false` | key 三处都没配 | §5 |
| 语音一直"缺件" | 参考音频文件名与配置不符 | `ref/ref-index.json` 里 `required:true` 那个 |
| 她只动不说话 | 语音引擎不可用，已降级 | 设计行为，不是 bug |
| 动作抽搐 / 卡住 | 游戏更新后 clip 名或帧数变了 | `<数据目录>/cue.log`，再用 `game/assets.seed.json` 对名字 |
| 面板接口全绿但没图标 | 客户端模块 ID 与当前插件名不符 | `lib/client.js` 第 1 段的 `id` |

### 日志在哪

| 文件 | 内容 |
| --- | --- |
| `<数据目录>/sidecar.log` | 侧车子进程生命周期、崩溃栈 |
| `<数据目录>/cue.log` | 每一次演出的动作/表情决策 |
| `<数据目录>/cue.test.log` | `sandbox:true` 的演出，与正式记录分开 |
| `<数据目录>/tts.log` | 语音合成 |
| `<数据目录>/warm.log` | 预热与缓存 |

> **安装阶段失败时这些文件还不存在**——它们是侧车起来之后才写的。
> 插件没挂载就去读 `dsh web` 自己的 stdout，那里才有装配错误。

---

## 9. 仓库结构

```
<仓库根>                        ← 只有代码与随包资产，没有任何私人内容
├── index.js              宿主插件：监护侧车 + 反代 /chill/v1 + 热换代
├── serve.mjs             侧车进程入口（默认 127.0.0.1:10723）
├── brain.mjs             全部业务：对话 / 记忆 / 演出编排 / 路由
├── lib/                  16 个模块：client.js（面板）/ core / assets / voice / memory…
├── persona.md            ★ 聪音的默认人格与说话纪律，内置角色卡的播种源
├── game/                 ★ 游戏端，全部随包
│   ├── ChillPerformer.dll    预编译，直接丢进 BepInEx/plugins
│   ├── assets.seed.json      389 个动作 + 146 把椅子的静态清单（离线核对用）
│   └── src/                  C# 源码，可自行构建
├── ref/ref-index.json    需要哪些参考音频（wav 本身不随包）
├── skills/               配套技能文档
├── tools/                清单生成、用量统计、发布体检
├── test/                 6 个测试，不联网、不碰真实数据
├── locale/zh.json        界面文案
└── cordis.patch.yml      默认配置（模型 / 预算 / 语音开关 / dataDir）
```

**私人内容不在这个树里。** 聊天记录、TTS 缓存、知识库、用户自己捏的人设卡、
状态与好感度、日志，全部落在下面说的「数据目录」。

**不要**手工改 `cordis.patch.yml` 里的 `id` 或 `name`：它必须和 `package.json` 的 `name`、
`index.js` / `brain.mjs` 的 `export const name`、profile 的依赖键、目录联接名全部一致，
改一处等于全挂。

### 数据目录（私人内容放哪）

优先级从高到低：**配置 `dataDir` → 环境变量 `CHILL_DATA_DIR` → 插件目录下的 `data/`**。
**目录不存在时启动会自动创建**，不用手动建。

```
<数据目录>
├── memory/         聊天记录、滚动摘要、长期事实        ← 最不可逆，删了就失忆
├── characters/     用户自己捏的人设卡 + _active.json   ← 内置 satone 不在这里，它从 persona.md 播种
├── audio/          TTS 合成缓存（100 MB 量级）         ← 删了会重新合成
├── voices/         音色微调产物
├── kb/ kb-sync/    知识库
├── avatar/         头像
├── state.json      心情 / 好感度 / 精力 / 番茄钟
├── llm.json        provider 配置（可能含明文 token，绝不进仓库）
└── *.log           运行日志
```

三种用法：

```powershell
# ① 默认：什么都不配，数据落在 <插件目录>\data\
# ② 和源码分开（推荐长期使用）：
$env:CHILL_DATA_DIR = "D:\chill-with-you-private"

# ③ 写进配置（优先级最高，适合多套数据来回切）
#    cordis.patch.yml 的 insert.config 里加一行：dataDir: 'D:/.../chill-with-you-private'
```

搬家就是把这个目录整体拷走，换机器指着它就行。**不要**把它放进仓库——
里面有真人对话和明文 token。

---

## 10. 不要做的事

| 别做 | 为什么 |
| --- | --- |
| 把插件整包拷进 profile 目录 | 升级要维护两份；用目录联接 |
| 改插件名只改 `package.json` | 至少六处要同步，漏一处就是 404 |
| 在组合行 `name` 上加 `?rev=N` | 会被当文件名解析，`ERR_MODULE_NOT_FOUND`，profile 直接起不来 |
| 改游戏目录里的任何原文件 | Steam 校验/更新会覆盖，且用户下次更新就坏 |
| 把 `*.wav` / `<数据目录>/memory/` 提交进仓库 | 版权 + 隐私 |
| 用 `Set-Content -Encoding utf8` 写 `package.json` | PowerShell 5.1 会写 BOM，插件清单解析失败，**所有会话同时瘫痪** |
| 在 `sandbox:false` 下反复试错 | 会写进真实记忆与好感度；调参一律 `sandbox:true` |

---

## 11. 装完之后

- 想看效果对不对 → 面板「演出」页，或 `curl POST /chill/v1/act`
- 想改她的性格 → `persona.md` + `<数据目录>/characters/`
- 想加知识 → 加载 `skills/kb-authoring`
- 想加功能 → `EXTENDING.md`
- 想发版 → `skills/github-release` + `PUBLISHING.md`
