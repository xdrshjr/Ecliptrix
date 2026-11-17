# Ecliptrix 桌面端(Electron)打包

把 Ecliptrix 的 Next.js 前端、FastAPI 后端、CPython 运行时与 FFmpeg 全部打进一个
Windows 安装包。设计文档见 `docs/plans/desktop-electron-packaging/spec.md`。

## 架构一览

```
Ecliptrix.exe (Electron 主进程)
 ├─ [子进程] FastAPI 后端   resources/python/python.exe run.py → 127.0.0.1:18321
 ├─ [子进程] Next.js 前端   ELECTRON_RUN_AS_NODE fork server.js → 127.0.0.1:18320
 └─ 主窗口 loadURL(http://127.0.0.1:18320)
```

- 数据库:桌面端使用 SQLite(`userData/data/ecliptrix.db`),不需要安装 PostgreSQL。
- 可写数据全部在用户数据目录(Windows 为 `%APPDATA%\Ecliptrix`):
  `data/`(SQLite)、`storage/`(上传与生成的媒体)、`logs/`、`.env`、`desktop-config.json`。

## 前置条件(打包机)

- Windows x64,磁盘剩余空间 ≥ 8GB
- Node.js ≥ 18.18 与 npm(根项目前端构建 + Electron)
- 可访问下载源:python.org(或 npmmirror)、pypi、gyan.dev(FFmpeg)、Electron 发布源
- 仓库根目录已 `npm install` 过(prepare-frontend 会在根目录执行 `npm run build`)

## 打包

### 一键打包(推荐)

`build.ps1` 是自包含入口:环境检查 → 根项目与 desktop/ 依赖安装(缺失时)→
调用 `scripts/build.js` 打包 →(可选)冒烟测试。在资源管理器右键
「使用 PowerShell 运行」,或在任意工作目录下执行:

```powershell
# 在 desktop/ 下:
.\build.ps1                                  # 完整打包(等价 npm run build)
.\build.ps1 -Dir                             # 仅产出 win-unpacked/(迭代快)
.\build.ps1 -Dir -SkipFrontend -SkipBackend  # 复用上次工件,最快

# 执行策略受限(默认 Restricted)的机器,用标准调用:
powershell -NoProfile -ExecutionPolicy Bypass -File desktop/build.ps1 -Dir
```

参数一览(全部可选,白名单透传到 build.js):

| 参数 | 行为 | 透传 |
|------|------|------|
| `-Dir` | 跳过 NSIS,仅产出 win-unpacked | `--dir` |
| `-SkipFrontend` | 复用上次 build/frontend 工件 | `--skip-frontend` |
| `-SkipBackend` | 复用上次 build/backend + build/python 工件 | `--skip-backend` |
| `-CnMirror` | npm registry + Electron 下载镜像 + 全链路国内镜像 | `--cn-mirror` |
| `-Clean` | 只清理 build/ 与 release/ 后退出(优先于其余参数) | `--clean` |
| `-SkipInstall` | 跳过两处 npm install 探测(复用现有 node_modules) | — |
| `-SkipSmokeTest` | 跳过打包后默认执行的 `node scripts/smoke-test.js` | — |
| `-NoPause` | 结束时不暂停(CI / 终端用户) | — |

退出码:`0` 成功 / `2` 环境检查失败(node/npm 缺失或 node < 18.18)/
`3` npm install 失败 / `4` build.js 失败 / `5` smoke-test 失败。

PS 编排层日志(命令行、失败定位)写入 `cache/build-logs/build-<时间戳>.log`
(不进版本库、不被 `-Clean` 删除、无自动轮转,按需手动清理)。注意
PowerShell 5.1 下 node/npm 子进程的输出不会进入该日志;需要全量构建日志时,
在 powershell.exe 进程边界重定向:

```cmd
powershell -NoProfile -ExecutionPolicy Bypass -File desktop\build.ps1 -NoPause > full.log 2>&1
```

### npm 命令(等价方式)

```bash
cd desktop
npm install            # 安装 electron / electron-builder
npm run build          # 完整打包 → release/Ecliptrix-Setup-<ver>.exe + win-unpacked/
npm run build:dir      # 只产出 win-unpacked/(跳过 NSIS,迭代更快)
npm run clean          # 删除 build/ 与 release/(保留 cache/ 下载缓存)
```

`scripts/build.js` 支持的参数:

```
node scripts/build.js [--dir] [--skip-frontend] [--skip-backend] [--cn-mirror]
  --dir            跳过 NSIS,仅产出 win-unpacked
  --skip-frontend  复用上次 build/frontend 工件
  --skip-backend   复用上次 build/backend + build/python 工件
  --cn-mirror      python/pip/electron 走国内镜像(npmmirror / 清华 pypi)
```

### 载荷断言:`build/` 与 `desktop/` 两个根

`scripts/build.js` 在调 `electron-builder` 之前先校验「包里必须有的文件」,分两张
表(`BUILD_PAYLOADS` / `APP_PAYLOADS`),各自盯一个根目录:

- `BUILD_PAYLOADS` —— `prepare-*` 生成的产物,按 `build/` 校验:
  `frontend/`、`backend/`、`python/`、`ffmpeg/`、`env.template.desktop`;
- `APP_PAYLOADS` —— 应用外壳源码,按 `desktop/` 校验:`main/`、`preload/`、
  `assets/`。这几个目录由 `electron-builder.yml` 的 `files:` 直接打进
  `app.asar`,`build/` 里**永远不会**出现它们。

所以新增文件时按归属加进对应列表:**在 `main/` 或 `preload/` 下新增会被打包的
运行时文件,加 `APP_PAYLOADS`;新增某个 prepare 步骤的产物,加
`BUILD_PAYLOADS`。** 缺项会带上它归属的根(`build/xxx` 或 `desktop/xxx`)报出:

```
[assert] verifying build/ payloads...
[build] FAILED: missing required payloads (build/ = generated runtime payloads,
desktop/ = app-shell files packed into app.asar):
  - desktop/main/agentBrowserHost.js
```

把 app-shell 文件错写进 `BUILD_PAYLOADS` 正是曾经的打包卡点(见
`docs/diagnoses/desktop-build-agent-browser-host-missing-payload/root-cause.md`)。
校验逻辑与单测在 `scripts/lib/build-payload-checks.js`;
`node scripts/lib/build-payload-checks.test.js` 目前需手动执行,未接入 `build.ps1`。

下载源均可用环境变量覆盖:`ECLIPTRIX_PYTHON_URL`、`ECLIPTRIX_GET_PIP_URL`、
`ECLIPTRIX_FFMPEG_URL`、`ECLIPTRIX_PIP_INDEX`。FFmpeg 默认使用 gyan.dev 的
release-essentials 构建(GPL,许可证文本随包发布);国内网络不通时请用
`ECLIPTRIX_FFMPEG_URL` 指向可达的 zip 包。

### exe 图标(rcedit)

- `electron-builder.yml` 的 `win.signAndEditExecutable` 必须为 `true`:
  electron-builder 的「签名 + 编辑可执行文件」是同一步,关掉后 rcedit 不运行,
  `Ecliptrix.exe`(以及任务栏、固定到任务栏、快捷方式)显示的是 Electron 默认原子图标。
  未配置证书时构建日志会打印 `signing is skipped`,属正常,只做 rcedit。
- 首次打包需解压 electron-builder 缓存 `winCodeSign-2.6.0`,其中含 darwin 符号链接。
  若报 `Cannot create symbolic link`:开启 Windows「开发者模式」,或以管理员身份运行一次
  `npm run build` 填充缓存(`%LOCALAPPDATA%\electron-builder\Cache\winCodeSign`)后再正常打包。
- **禁止**把 `signAndEditExecutable` 改回 `false` 来绕过上述报错——修打包环境;
  `node main/appIcon.test.js` 会拦截该回归。
- 覆盖安装后图标仍是旧的:先卸载旧版再安装;仍不变则执行 `ie4uinit.exe -show` 刷新图标缓存。
- 安装包未签名,SmartScreen 提示见下方「常见问题」。
- 图标资产由 `python docs/brand/generate_brand_assets.py` 从品牌源图生成(见 `docs/brand/README.md`)。

## 首次启动与配置

打包产物双击即开——**不需要预先配置任何 API key**:

1. 启动后先出现登录界面(账号服务器登录 / 本地管理员登录),通过后才进入剪辑工作区;
   本地后端仍只绑 `127.0.0.1`、仍只有一个本机所有者(登录只决定谁能看到窗口,
   见下方「登录与破窗账号」);
2. 未配置 LLM 时会弹出配置引导,点「前往设置」直达
   设置 → 模型与凭证:添加服务商 → 测试连接 → 分配给功能(对话/混剪/视觉理解);
3. 配置保存后引导与设置入口的琥珀色提醒点自动消失,AI 功能即刻可用。

`.env`(`%APPDATA%\Ecliptrix\.env`)仍可作为高级/批量配置通道:填入真实的
`LLM_API_KEY` 等值后重启即生效(作为环境变量回退,优先级低于应用内设置);
`your_*_here` 占位值会被启动器自动忽略。从旧版本升级的存量 `.env` 中若有
不带 `_here` 后缀的火山 TTS 占位行(`your_volcano_tts_*`),请手动删除,
否则会被当作真实凭证在调用期报鉴权错误。

## 冒烟测试(对打包产物)

```bash
node scripts/smoke-test.js [--unpacked <path>]   # 默认 release/win-unpacked
```

流程:临时 userData + 预写空 .env(零配置、零凭证)→ 拉起 exe →
90 秒内两个服务健康 → llm-status 返回未配置 → **不带任何鉴权头**读取工程列表
(同一条断言证明「无鉴权层」与「SQLite 链路可读」)→ 正常退出 →
断言无残留进程、SQLite 文件已生成。

> **「空 `.env`」不等于「零凭证」。** 打包应用把**继承来的进程环境**当作配置层:
> `main/backendService.js` 把 `process.env` 展开给后端子进程,后端按
> 「数据库 > 环境变量 > 默认值」解析凭证。所以冒烟在拉起 exe 之前先调用
> `scripts/lib/electron-env.js` 的 `withoutCredentialEnv()`,剔除**构建机自己**
> 名字命中凭证规则(`*_API_KEY`、`*_SECRET`、`*_TOKEN`、`*_PASSWORD`、`*_ACCESS_KEY*`…,
> 判定与打包扫描共用 `scripts/lib/secret-shape.js`)或值呈厂商凭证形状的变量,
> 只把**被剔除的变量名**打进日志;随后在任何功能流程之前用 `/api/integrations`
> 断言全部集成未配置。实测:构建机把 `ARK_API_KEY` 存进 `HKCU\Environment` 后,
> 封面工作台的生成按钮会按设计启用,冒烟就会在封面流程深处报
> `generation is enabled without credentials and with a nonempty prompt`——
> 那是环境泄漏,不是打包缺陷。

## 开发模式

一条命令拉起前后端 + Electron(`scripts/dev.js` 编排):

```bash
cd desktop
npm run dev            # 自动启动后端(:8000)+ 前端(:3000),就绪后再开 Electron
```

`npm run dev` 会:检测端口 → 未占用则启动后端(`python -m uvicorn`,自动复用
`backend-services/basic-service/venv`,否则用 PATH 上的 `python`)与前端
(`next dev`,并注入 `BACKEND_URL`)→ 等前端就绪 → 启动 Electron(`--dev` 连
`http://localhost:3000`)。关闭 Electron 窗口或 `Ctrl+C` 会一并停掉**本命令启动的**
子进程;你事先已手动跑起来的服务会被自动识别并复用,不会被杀掉。

可选环境变量:`ECLIPTRIX_PYTHON`(指定 python 可执行文件)、
`ECLIPTRIX_DEV_BACKEND_PORT`(后端端口,默认 8000)、`BACKEND_URL`(前端代理目标)、
`ECLIPTRIX_BACKEND_RELOAD=1`(给 uvicorn 加 `--reload`)。

只想复用「手动起好开发服务、Electron 仅连接」的旧行为:

```bash
# 先各自起好:根目录 npm run dev(:3000)+ 后端 uvicorn(:8000)
npm run dev:attach     # Electron 直连 http://localhost:3000,不拉起任何子进程
```

## 用户侧配置

首次启动会把内置模板复制为 `%APPDATA%\Ecliptrix\.env`。LLM 凭证推荐在应用内
「设置 → 模型设置」中配置(见上方「首次启动与配置」);`.env` 中的 LLM 键仅作
环境变量回退。其余密钥(Pexels / ARK / 火山 TTS 等)均可选,缺失时对应功能
自动降级;`your_*_here` 占位值会被启动器忽略,不会注入子进程。

以下值由主进程注入,用户在 .env 中配置不生效:`DATABASE_URL`、`STORAGE_ROOT`、
`HOST/PORT`、`CORS_ALLOWED_ORIGINS`。端口可在 `desktop-config.json` 中固定
(默认 18320/18321;被占用时自动向上探测并弹窗提示)。

## 登录与破窗账号

桌面端启动后会先经过身份闸门（`desktop/main/authController.js`），界面在
`src/components/auth/` 下，规格见 `docs/plans/desktop-account-login-gate/spec.md`。

### 两种入口

| 入口 | 走什么 | 适用场景 |
|---|---|---|
| 账号服务器登录 | 主进程 HTTPS 调 `{accountServerUrl}/api/v1/auth/login`（`client: "desktop"`） | 日常使用；注册、找回口令、改密、设备管理同样直连该服务器 |
| 本地管理员登录 | 只在本机比对 `desktop-config.json` 里的 `localAdmin`，**不发任何请求** | 账号服务器宕机／忘记口令／网络被墙时救援本机数据 |

### 配置文件（权威来源）

`%APPDATA%\Ecliptrix\desktop-config.json`：

```json
{
  "schemaVersion": 1,
  "localAdmin": { "username": "admin", "password": "adminjr", "enabled": true },
  "auth": { "accountServerUrl": "https://id.example.com", "offlineGraceDays": 7 }
}
```

- **`auth.accountServerUrl` 是唯一权威来源**：改完重启生效。`userData/.env` 里的
  `ACCOUNT_SERVER_URL` 是**可选覆盖**：打包版主进程会读这个文件，一旦那里非空就会
  盖掉配置文件（`desktop/ npm run dev` 不读它）。随包模板把它留空，请保持留空，否则
  「改配置文件看不到反应」。
- **`localAdmin` 不联网、不写会话文件**：口令改完重启即生效，旧口令立即失效。安装包
  发布前**必须**改掉默认的 `admin`／`adminjr`，否则登录屏会一直显示红字告警。
- **`auth.offlineGraceDays`**（1–30，默认 7）：断网后仍可进入应用的天数，同时受刷新
  令牌寿命约束；超过后要求重新登录。若 `userData/.env` 里显式写了
  `ACCOUNT_OFFLINE_GRACE_DAYS`，它优先于本键（模板默认留空，即不覆盖）。
- 别把 `%APPDATA%` 纳入 OneDrive 等云同步——`localAdmin` 口令是明文存的。

### 开关与排障

| 目的 | 做法 |
|---|---|
| 彻底关闭闸门（紧急） | 启动前设 `ECLIPTRIX_AUTH_GATE=off`；界面顶部常驻红条，主进程每次启动告警 |
| 在 dev 下验证闸门本身 | `ECLIPTRIX_AUTH_GATE=on npm run dev`（dev 未设置时闸门默认关闭，只显示琥珀条） |
| 解除破窗失败锁定 | 删除 `%APPDATA%\Ecliptrix\auth-attempts.json`（5 次失败锁 60s，之后每次翻倍到 900s 上限） |
| 会话状态在哪 | `%APPDATA%\Ecliptrix\auth-session.json`（safeStorage 加密；无法加密时降级为明文并在界面显示黄条），删除即登出 |
| 账号服务器地址改错了 | 闸门显示「未配置账号服务器」阻断屏时，仍可用本地管理员进入后修配置 |
| 日志 | `%APPDATA%\Ecliptrix\logs\main.log` 里 `[auth]` 类别的行（WARN 及以上同时进 `error.log`）：只记通道名／路径／状态码／错误码／请求号，不记口令与令牌 |

> 打包冒烟（`node scripts/smoke-test.js`）在拉起 exe 时带 `ECLIPTRIX_AUTH_GATE=off`：
> 无账号服务器的零配置跑批必须显式关闸，否则会停在「未配置账号服务器」阻断屏。
> 闸门自身的行为由 `npm run test:auth` 与 `scripts/auth-smoke.js` 覆盖。

### 自检

```bash
npm run test:auth          # 主进程六个模块的单元测试（纯 node，不需要 Electron）
node scripts/auth-smoke.js # 假账号服务器上的 14 条端到端断言
```

## 常见问题

- **SmartScreen 提示「未知发布者」**:v1 安装包未签名,点「更多信息 → 仍要运行」。
  代码签名列入后续迭代。
- **安装包体积约 1–1.5GB**:包含 Electron、CPython site-packages(opencv/numpy)、
  FFmpeg 与 Next.js 产物,属预期(spec §7 风险 4)。
- **启动失败**:错误页会给出日志目录(`%APPDATA%\Ecliptrix\logs`),
  先看 `error.log`(汇聚所有告警/错误)与 `process.log`(子进程监管时序),
  再按需查看 `config.log` / `main.log` / `backend.log` / `frontend.log`。详见下方「日志」。
  启动链自身的回归测试是纯 node 文件,无 npm 脚本、需手动执行:
  `node main/browserHostCwd.test.js`(打包态宿主 cwd)、
  `node main/processManager.spawn-error.test.js`(spawn 失败必须立刻报错)、
  `node main/proxyProbe.test.js`(系统代理探测必须有 deadline)。
- **杀毒软件拦截**:本地会启动 `python.exe` 子进程,部分杀软会拦截,需放行安装目录。
- **数据库结构演进约束**:桌面端跳过 alembic,完全依赖启动时 `create_all` 建表
  (spec §7 风险 12)。后端模型变更必须保持「create_all 可直接建出完整 schema」。

## 日志

主进程日志按「来源 / 职责」分类落盘,每类一个文件,便于排查时直接定位:

| 文件 | 内容 |
|------|------|
| `error.log` | 所有 ≥ WARN 的主进程行 + 子进程 stderr(排查问题的第一落脚点) |
| `process.log` | 子进程监管时序(spawn / healthy / exit / stop / 强杀) |
| `config.log` | 配置、环境自愈、端口回退决策 |
| `main.log` | 应用生命周期(启动 / 版本 / userData 路径 / 退出) |
| `backend.log` | 后端 python 子进程的**原始** stdout/stderr(透传,不二次加工) |
| `frontend.log` | 前端 next 子进程的**原始** stdout/stderr |
| `ipc.log` | 渲染进程窗口控制 IPC(**仅 `ECLIPTRIX_LOG_LEVEL=debug` 时产出**,默认为空) |

日志目录按运行时归属:

- **打包态**(双击 exe):`%APPDATA%\Ecliptrix\logs`(安装目录在 Program Files 下只读,
  且应按用户隔离)。全套文件均由 Electron 主进程产出。
- **开发态**(`npm run dev`):重定向到项目内的 `desktop/logs/`(由 `scripts/dev.js` 注入
  `ECLIPTRIX_LOG_DIR`,并把 `backend`/`frontend`/`dev` 三类输出 tee 到该目录,已被 `.gitignore`
  忽略)。注意开发态前后端由 `dev.js` 监管、Electron 不 `attachChild`,故不产出打包态那样
  完整的 `process.log` 监管时序。

行格式(结构化类别):`[ISO8601] [LEVEL] [category] message`,可直接用
`findstr` / `Select-String` / `grep` 过滤;`backend.log` / `frontend.log` 保留子进程原始格式。

环境变量:

| 变量 | 取值 | 作用 | 默认 |
|------|------|------|------|
| `ECLIPTRIX_LOG_LEVEL` | `debug`/`info`/`warn`/`error` | 主进程结构化日志最小级别 | `info` |
| `ECLIPTRIX_LOG_DIR` | 绝对路径 | 覆盖日志目录 | 打包态 `userData/logs`、开发态 `desktop/logs` |

轮转与保留:单文件达 5MB 即多代轮转(`<file>.1/.2/.3`,默认保留 3 代),
构造时按天清理 7 天前的轮转文件(含旧版遗留的 `*.log.old`);当前活动文件永不被清理。

已知局限:`error.log` **仅镜像子进程 stderr**——uvicorn / Next 把错误打到 stdout 时
不会进 `error.log`(刻意避免海量 stdout 污染汇聚文件,「按内容启发式镜像」列入后续迭代)。

单测:`npm run test:logger`(纯 node、零新依赖,覆盖类别路由 / 级别过滤 / error.log 镜像 /
多代轮转 / 保留清理 / 原始 sink 保护)。

## 目录结构

```
desktop/
├─ package.json            # 独立 npm 包(electron / electron-builder)
├─ electron-builder.yml    # NSIS + extraResources 映射
├─ main/                   # Electron 主进程(进程托管 / 端口 / 配置 / 窗口 / 日志)
├─ preload/                # contextBridge 只读元信息(零业务 IPC)
├─ assets/                 # splash.html / error.html / brand-mark.png / icon.ico(运行时窗口图标)
├─ resources/icons/        # 应用图标(由 docs/brand/generate_brand_assets.py 从品牌源图生成)
├─ scripts/                # build.js 及 prepare-* 打包脚本、smoke-test.js、test-logger.js
├─ logs/                   # (生成,开发态)npm run dev 的分类日志,已 gitignore
├─ build/                  # (生成)打包前的工件组装区
├─ cache/                  # (生成)python/ffmpeg 下载缓存
└─ release/                # (生成)NSIS 安装包与 win-unpacked/
```

## 特效运行资源与验证

仓库根执行 `npm run effects:prepare`，安装独立 runtime 的锁定依赖并准备
专用 Chrome Headless Shell、Remotion native、三套离线字体和 manifest。
准备阶段需要网络；桌面运行时只使用 `resources/effects/` 内资源，禁止下载。
`npm --prefix effects-runtime run build` 在已有资源上重编译并重新封存 hash。
`node effects-runtime/scripts/generate-previews.mjs` 生成 24 对真实视频 / 海报。

主进程独立监管 effects controller，使用随机端口、Bearer token 与 IPC
心跳；配置仅注入后端，不进入 Next 客户端。输入快照、成品与工作目录位于
用户存储根的 `effects/projects/`；SQLite 保存草稿、资产与任务。缺少资源
只降级特效能力，普通编辑仍可用。关闭时先 drain 后端，再 reset / 停止自己
持有的 worker，禁止按进程名关闭用户浏览器。

快速检查：`node --test desktop/main/effectsService.test.js` 和
`npm --prefix effects-runtime test`。真实 Electron 测试需先准备资源：
PowerShell 中设置 `$env:EFFECTS_REAL_RUNTIME_TEST='1'` 后运行后者，验证
五秒文字 / 图片 / 视频源渲染、中文空格路径、取消、IPC 断开和 controller
强杀清理。也可单独运行 `node desktop/scripts/effects-smoke.js --render --packaged`
与 `--controller --packaged`。默认不启用重型测试时两项集成检查明确跳过。

`build:dir` 会准备并复制 effects extraResources；发布前还需实际安装包的
离线、只读安装目录、退出 / 崩溃、导出人工验收，不能用资源目录 smoke
代替 installer。Remotion 锁定 4.0.544，React 19.1.1；保留字体 OFL，
分发许可由负责人核对。[完整记录](../docs/plans/remotion-effects-studio/acceptance.md)。

### 特效恢复与安装验收

保存和生成均使用稳定请求身份；丢回包后先查询或同体重放，不能更换请求
ID 绕过待确认状态。本机记录不可写、损坏或 Web Locks 不可用时，界面保留
输入并停止发送。关闭时可继续编辑、保存并关闭，或丢弃未发送输入；已发送
的保存仍可能完成。多窗口写资格由项目编辑器租约保护，项目删除成功才清理。

以下命令从仓库根执行，示例 run 目录每次必须更换。包模式要求显式
`--report`，默认读取 unpacked 同级的 `research-build-manifest.json`；可用
`--manifest` 指定同一份真实构建清单。旧 `--packaged` 仅是开发 payload。

```powershell
node desktop/scripts/effects-smoke.js --unpacked desktop/release/win-unpacked --report .agentmesh/effects-r2/run-001/package/smoke.json
node desktop/scripts/effects-acceptance.js --unpacked desktop/release/win-unpacked --manifest desktop/release/research-build-manifest.json --report .agentmesh/effects-r2/run-001/unpacked/report.json --scenario package
node desktop/scripts/effects-acceptance.js --unpacked desktop/release/win-unpacked --installed .agentmesh/effects-r2/run-001/installed --manifest desktop/release/research-build-manifest.json --report .agentmesh/effects-r2/run-001/installed-evidence/report.json --scenario all
```

运行 all 前，将本次清单绑定的 NSIS 实际安装到隔离的 installed 目录，并在
报告同级保存 `install-record.json`：记录 `installer_sha256`、绝对
`installed_root`、UTC `started_at` / `finished_at`、`exit_code=0` 及安装日志
来源。安装树只读，额外 NSIS 卸载文件会另记散列，不能作为运行依赖。
测试自己的 userData、输入、缓存和附件全部位于本次证据目录，不读取现有用户工程。

场景参数为 package / visual / desktop / process / performance / agent / all。
工具分别使用包内 Electron / renderer / 字体 / FFmpeg / Python，拒绝资源
覆盖和仓库依赖回退。visual 执行 24×3 组合、两次 PNG、MP4/Player 实帧、
文字布局和校准音频；desktop 通过真实导出按钮验收。缺真实安装或测试模型
为 blocked；旧包、错误来源、证据缺失或阈值超限为 fail。

退出码 0 表示所选场景通过，1 表示失败，2 表示受环境阻塞。单场景通过
不会解锁发行。all 的源码回归要求 HEAD 等于清单、dirty=false，且测试前后
tracked 文件不变；实现节点的开发验证应在最终提交后重建、实装并重验。
报告先独占预留，进度写 partial，完成后原子封存；存在的报告不可覆盖，
崩溃遗留 running / partial 也不能作成功证据。

```powershell
node --test desktop/scripts/effects-smoke.test.js desktop/scripts/lib/effects-release-evidence.test.js
```
