# 发布前检查

推到 GitHub 之前跑一次：

```bash
node tools/check-publish.mjs
```

它按 `.gitignore` 算出真正会被提交的文件，再对着这些文件扫三类红线。退出码 `0` 干净，`1` 有要处理的。

---

### 密钥的两道门

```powershell
node tools/scan-secrets.mjs --history   # 查格式：工作树 + 全部 git 历史
node tools/audit-keys.mjs               # 查本机真值：这把 key 落在哪些文件里
```

`scan-secrets` 看的是"像不像凭据"（`sk-…` 这类格式），`--history` 会连老提交一起翻——
工作树干净不等于仓库干净。`audit-keys` 拿本机实际在用的 key 值去比对仓库、数据目录、
dsh 存储与会话日志、临时目录，报告"哪里躺着同一把 key"；正常存放点（`.credentials.yaml`、
数据目录的 `llm.json`）会标成 `[正常存放]`，其余算残留。

`audit-keys --fix` 会：删掉凭据文件的备份副本（`*.credentials.yaml.bak-*`），
就地脱敏别处的命中（会话记录只改字符串、不删文件）。它**不动正本**。

## 三类红线

### 1. 密钥

**这一条现在有闸门了，不再靠自觉**：`node tools/scan-secrets.mjs` 扫仓库里的明文凭据
（`sk-` / Bearer / AKIA / `ghp_` / PEM 私钥 / 赋值式长串），`check-publish.mjs` 已经把它接成硬门，
不通过就不许发布。占位符（`sk-test`、`REDACTED`、`YOUR_KEY`）会被放过，测试桩不会误报。

**这条已经踩过一次。** `data/llm.json` 的 `providers[]` 里，"自己加的 provider" 是存**明文 token** 的：

```json
{ "id": "config", "source": "config", "token": "sk-……（打码）" }
```

跟 DSH 共用的那两个 provider 走 `keyRef`（指向 `$DSH_HOME/.credentials.yaml`），是安全的；只有手动加的会落明文。

- `data/llm.json` 整个文件已在 `.gitignore` 里
- 但**如果这个 key 曾经被推到任何地方，去 DeepSeek 控制台吊销重开**
- 想彻底不落地明文：界面里把 provider 改成 `keyRef: DEEPSEEK_API_KEY`，删掉 `source: config` 那条

### 2. 真人对话

| 路径 | 内容 |
| --- | --- |
| `data/memory/turns.jsonl` | 逐轮原文，含真人对她说的每句话 |
| `data/memory/summary.json` | 滚动摘要，含关系进展 |
| `data/memory/facts.jsonl` | 提炼出的事实与长期设定 |
| `data/state.json` | 好感度、精力、番茄钟计数等养成进度 |
| `data/cue.log.bak-*` | 带时间戳的备份，里面是真实台词 |

全部已忽略。注意 `*.log` 规则**盖不住** `cue.log.bak-20261114-014945` 这种名字，所以另加了一条 `*.bak-*`。

### 3. 游戏资源（版权不在我们这边）

| 路径 | 为什么不能进仓库 |
| --- | --- |
| `ref/*.wav` | 从游戏里取的人声参考，语音合成要用，但分发出去就是二次分发 |
| `data/audio/` | 127 MB 的 TTS 缓存，音色来自游戏角色 |
| `assets.seed.dll-derived.json` | 导出过程中的中间件（本机生成，可重算）。**最终的 `game/assets.seed.json` 是刻意随包的**，见 `NOTICE.md` |
| `*.pth` / `*.ckpt` / `*.safetensors` / `*.onnx` / `*.gguf` | 模型权重。体积大、许可见 `NOTICE`，**永不随包** |
| `llm.json` / `.env*` / `.credentials.yaml` | 凭据。含明文 token，**永不随包** |
| `data/assets.json` | 同上，389 个动作 + 146 把椅子的运行时缓存 |

后三样删掉不影响使用：游戏跑起来时插件会自己从游戏拉一份清单存到 `data/assets.json`，也可以用 `tools/build-manifest.mjs` 对自己的游戏生成。

`ref/ref-index.json` 会留在仓库里——它只有文件名和时长，用来提示「你需要放哪几个 wav」。

---

## 会提交什么

约 70 个文件，1.2 MB（**以 `node tools/check-publish.mjs` 的输出为准**，每次加文件都会变）：

```
package.json  cordis.patch.yml  index.js  serve.mjs  brain.mjs  persona.md
README.md  AGENTS.md  ARCHITECTURE.md  EXTENDING.md  CHANGELOG.md  PUBLISHING.md
LICENSE  .gitignore  .gitattributes  .github/workflows/ci.yml
lib/       16 个模块（client.js / core.js / assets.js / voice.mjs / memory-store.mjs …）
game/      ★ 游戏端，全部随包（它没有第二个下载源）
  ├── ChillPerformer.dll      预编译 BepInEx 插件
  ├── assets.seed.json        389 动作 / 146 椅子静态清单
  └── src/                    7 个文件：6 个 .cs + csproj（构建/部署脚本在 tools/ 与 game/src 之外）
tools/     build-manifest.mjs  gen-anim-manifest.mjs  usage-report.mjs  check-publish.mjs  quick.html
test/      6 个测试
skills/    chill-with-you-testing  kb-authoring  README.md
locale/    zh.json
persona.md                    聪音的默认人格与说话纪律，内置角色卡由它播种
ref/ref-index.json             需要哪些参考音频的清单
```

**分发口径**：有下载渠道的（BepInEx / Node / GPT-SoVITS / 模型）不随包，让 agent 装的时候自己下；
没有下载渠道的（`game/` 整目录、静态清单、角色卡、技能）全部随包。`tools/check-publish.mjs`
按这个口径体检，`game/*.dll` 已在二进制白名单里（源码就在 `game/src/`，产物随包是刻意的）。

---

## 密钥泄漏了怎么办

先把话说清楚：**本机做的一切都只是止血，真正让旧 key 失效的只有当你在服务商后台删掉它**。
顺序别颠倒——先撤销，再换钥，最后才清残留：

1. **撤销**：`https://platform.deepseek.com/api_keys` → 删掉旧 key（不删的话它一直是活凭据）。
2. **换钥**：在同一页新建一个，然后一条命令落到本机该落的地方：

   ```powershell
   node tools/rotate-key.mjs --key sk-新key --apply
   ```

   它会做三件事：写进 `$DSH_HOME\.credentials.yaml`（带备份、不带 BOM）、
   把旧 key 在会话缓存/日志里的残留副本抹成 `REDACTED_BY_ROTATE_KEY`（带备份）、
   打印还剩哪一步只有你能做。它**永不打印 key 本身**，只打印前 6 位指纹。
3. **验证**：重启 `dsh web`，在面板「模型」里点一次测试；或
   `node tools/scan-secrets.mjs` 确认仓库干净。

> 旧的会话记录里那份明文是历史文件：撤销之后它就是个失效字符串，不必强求抹净——
> 真要抹，也用 `rotate-key.mjs`，别手改 JSON（改坏一整轮对话就没了）。

## 首次发布步骤

远端仓库可以用一条命令建出来并推上去（需要一次 GitHub token）：

```powershell
$env:GH_TOKEN = 'ghp_xxx'      # 权限勾 repo；地址 https://github.com/settings/tokens
node tools/gh-bootstrap.mjs    # 预演：验证 token、算目标仓库名
node tools/gh-bootstrap.mjs --apply   # 建库 + 推送 + 补描述与 topics
```

token 只从环境变量/参数读，不打印、不落盘；推送成功后 remote 里存的是不带 token 的地址。
本地仓库已经建好了（3 个提交：大脑与宿主 / 游戏端 / 文档工具测试），分支先改名成 GitHub 的默认名：

```bash
git remote add origin https://github.com/shumourena/chill-with-you-companion.git
git push -u origin main
```

仓库已经上线：<https://github.com/shumourena/chill-with-you-companion>，main 上 CI 全绿。

github.com:443 不通时（国内常见，症状是 Failed to connect 或 Connection was reset），
走 API 通道推，效果一样：

```bash
node tools/push-via-api.mjs            # 预演：只看差异
node tools/push-via-api.mjs --apply    # 用 Git Data API 推送并同步本地
```

推之前再确认这四件事（都在 CI 里跑，本地也可以先跑一遍）：

```bash
node tools/check-publish.mjs       # problems 必须为 0
node tools/scan-secrets.mjs        # 明文密钥必须 0
node tools/run-tests.mjs           # 9 个测试文件全过
git ls-files | grep -E '\.(wav|mp3|bundle|assets)$'   # 应该没有输出
```

**游戏本体不进仓库**：`*.bundle` / `*.assets` / `*_Data/` / `UnityPlayer.dll` 都在 `.gitignore` 里，
不要用 `git add -f` 绕过。

---

## 仓库脚手架

| 文件 | 作用 |
| --- | --- |
| `LICENSE` | MIT。没有许可证的公开仓库等于「保留所有权利」 |
| `.gitattributes` | 统一 LF 行尾；把游戏资源类扩展名标成 binary |
| `.github/workflows/ci.yml` | 推上去自动跑语法检查 + `check-publish` + 6 个测试 |
| `CHANGELOG.md` | 版本变更记录，发版时必须在顶部加一条 |
| `PUBLISHING.md` | 本文件 |

CI 在 `windows-latest` 上跑，因为插件依赖 Windows 路径与 `spawn` 语义。**测试在干净检出下全绿**（46 个文件，不含任何被忽略的运行时数据）——这条已经用 `git checkout-index` 模拟验证过。

---

## 已知遗留（不阻塞发布）

- ~~README 里的本机路径~~ 已处理：命令示例改成 `<插件目录>`，`brain.mjs` 里给模型的知识库提示也不再说具体盘符。
- ~~技能文档的本机路径~~ 已处理：`skills/` 下两份 SKILL.md 已重写为相对路径 + 跨平台命令，见 `skills/README.md`。
- ~~`LICENSE` / `.gitattributes` / CI / `CHANGELOG`~~ 已补。
- ~~`build-manifest.mjs` 与 `gen-anim-manifest.mjs` 写死输出到本机绝对路径~~ 已改成默认写插件根目录，参数可覆盖。
- **`data/llm.json` 里那条明文 token 已清空**（改走 `keyRef: DEEPSEEK_API_KEY`）。但它曾经以明文存在于磁盘上，**首次公开发布前仍应去 DeepSeek 控制台吊销重发**。
- **目录名仍是 `chill-brain`**，与包名不一致。`link:` 已解耦，不影响功能；要改必须在 `dsh web` 停止时做（`index.js` 用 `fs.watch` 占着句柄）。
- **`CHANGELOG.md` 的链接指向 `OWNER/REPO` 占位**，建仓后要替换成真实地址。
