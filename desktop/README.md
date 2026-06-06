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

## 冒烟测试(对打包产物)

```bash
node scripts/smoke-test.js [--unpacked <path>]   # 默认 release/win-unpacked
```

流程:临时 userData + 预写 .env → 拉起 exe → 90 秒内两个服务健康 → 登录 API →
鉴权读取工程列表(SQLite 链路)→ 正常退出 → 断言无残留进程、SQLite 文件已生成。

## 开发模式

```bash
# 先手动启动开发服务:根目录 npm run dev(:3000)+ 后端 uvicorn(:8000)
cd desktop
npm run dev            # Electron 直连 http://localhost:3000,不拉起子进程
```

## 用户侧配置

首次启动会把内置模板复制为 `%APPDATA%\Ecliptrix\.env`。`LLM_API_KEY` / `LLM_API_URL`
为必填项,缺失时应用会弹出「打开配置文件 / 重新检测 / 退出」引导。其余密钥
(Pexels / ARK / 火山 TTS 等)均可选,缺失时对应功能自动降级。

以下值由主进程注入,用户在 .env 中配置不生效:`DATABASE_URL`、`STORAGE_ROOT`、
`HOST/PORT`、`CORS_ALLOWED_ORIGINS`。端口可在 `desktop-config.json` 中固定
(默认 18320/18321;被占用时自动向上探测并弹窗提示)。

## 常见问题

- **SmartScreen 提示「未知发布者」**:v1 安装包未签名,点「更多信息 → 仍要运行」。
  代码签名列入后续迭代。
- **安装包体积约 1–1.5GB**:包含 Electron、CPython site-packages(opencv/numpy)、
  FFmpeg 与 Next.js 产物,属预期(spec §7 风险 4)。
- **启动失败**:错误页会给出日志目录(`%APPDATA%\Ecliptrix\logs`),
  依次查看 `main.log` / `backend.log` / `frontend.log`。
- **杀毒软件拦截**:本地会启动 `python.exe` 子进程,部分杀软会拦截,需放行安装目录。
- **数据库结构演进约束**:桌面端跳过 alembic,完全依赖启动时 `create_all` 建表
  (spec §7 风险 12)。后端模型变更必须保持「create_all 可直接建出完整 schema」。

## 目录结构

```
desktop/
├─ package.json            # 独立 npm 包(electron / electron-builder)
├─ electron-builder.yml    # NSIS + extraResources 映射
├─ main/                   # Electron 主进程(进程托管 / 端口 / 配置 / 窗口 / 日志)
├─ preload/                # contextBridge 只读元信息(零业务 IPC)
├─ assets/                 # splash.html / error.html
├─ resources/icons/        # 应用图标(v1 为脚本生成的占位图标)
├─ scripts/                # build.js 及 prepare-* 打包脚本、smoke-test.js
├─ build/                  # (生成)打包前的工件组装区
├─ cache/                  # (生成)python/ffmpeg 下载缓存
└─ release/                # (生成)NSIS 安装包与 win-unpacked/
```
