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

下载源均可用环境变量覆盖:`ECLIPTRIX_PYTHON_URL`、`ECLIPTRIX_GET_PIP_URL`、
`ECLIPTRIX_FFMPEG_URL`、`ECLIPTRIX_PIP_INDEX`。FFmpeg 默认使用 gyan.dev 的
release-essentials 构建(GPL,许可证文本随包发布);国内网络不通时请用
`ECLIPTRIX_FFMPEG_URL` 指向可达的 zip 包。

## 首次启动与配置

打包产物双击即开——**不需要预先配置任何 API key**:

1. 启动后进入登录页,用 `.env` 中的 `ROOT_USERNAME` / `ROOT_PASSWORD`
   (默认 `admin` / `change_me_on_first_run`)登录;
2. 首次登录会弹出配置引导(管理员可见),点「前往设置」直达
   设置 → 模型设置:添加服务商 → 测试连接 → 分配给功能(对话/混剪/视觉理解);
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

流程:临时 userData + 预写仅含 ROOT 账号的 .env(零 LLM 配置)→ 拉起 exe →
90 秒内两个服务健康 → 登录 API → llm-status 返回未配置 → 鉴权读取工程列表
(SQLite 链路)→ 正常退出 → 断言无残留进程、SQLite 文件已生成。

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

## 常见问题

- **SmartScreen 提示「未知发布者」**:v1 安装包未签名,点「更多信息 → 仍要运行」。
  代码签名列入后续迭代。
- **安装包体积约 1–1.5GB**:包含 Electron、CPython site-packages(opencv/numpy)、
  FFmpeg 与 Next.js 产物,属预期(spec §7 风险 4)。
- **启动失败**:错误页会给出日志目录(`%APPDATA%\Ecliptrix\logs`),
  先看 `error.log`(汇聚所有告警/错误)与 `process.log`(子进程监管时序),
  再按需查看 `config.log` / `main.log` / `backend.log` / `frontend.log`。详见下方「日志」。
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
├─ assets/                 # splash.html / error.html
├─ resources/icons/        # 应用图标(v1 为脚本生成的占位图标)
├─ scripts/                # build.js 及 prepare-* 打包脚本、smoke-test.js、test-logger.js
├─ logs/                   # (生成,开发态)npm run dev 的分类日志,已 gitignore
├─ build/                  # (生成)打包前的工件组装区
├─ cache/                  # (生成)python/ffmpeg 下载缓存
└─ release/                # (生成)NSIS 安装包与 win-unpacked/
```
