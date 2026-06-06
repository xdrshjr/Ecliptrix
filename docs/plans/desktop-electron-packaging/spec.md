# Ecliptrix 桌面端(Electron)打包改造 — 设计文档

> Feature: `desktop-electron-packaging`
> Version: v1(方案设计稿,待评审)
> Date: 2026-06-06
> Author: Subtask #0(方案设计节点)

---

## 1. Overview(概述)

Ecliptrix 目前是一个「Next.js 15 前端 + FastAPI 后端」的 Web 全栈应用,部署形态为 Linux 服务器上的 systemd + nginx。本方案的目标是在**不改变现有 Web 部署形态**的前提下,新增一条桌面端发行通道:用 Electron 把前端、后端、Python 运行时、FFmpeg 全部打进一个 Windows 安装包,使最终用户双击安装后即可离线(除外部 LLM / 素材 API 调用外)使用主要功能 — 登录、视频剪辑工程、时间线编辑、TTS、素材搜索、AI 对话、视频导出等。

所有桌面端专属的代码、配置与打包脚本**集中放在仓库根目录新建的 `desktop/` 目录**下,作为一个独立的 npm 包(拥有自己的 `package.json`),与根项目的依赖完全隔离。用户后续只需 `cd desktop && npm install && npm run build` 即可产出 Windows 安装包。对仓库既有源码的侵入被压缩到 4 个文件的最小修改(详见 §4),且每处修改都向后兼容:不设置桌面相关环境变量时,Web 形态行为与现在完全一致。

之所以选择「Electron 壳 + 两个本地子服务」而不是把前端静态导出进 Electron 渲染进程,是因为本项目的前端有 70+ 个 Next.js API 路由承担服务端职责(向 FastAPI 转发请求、用 server-only 的 `LLM_API_KEY` 直连 LLM、会话 cookie 鉴权回退等),`next export` 无法承载;同理后端依赖 PostgreSQL/FFmpeg/yt-dlp 等系统级能力,不可能改写为浏览器内实现。因此桌面端的本质是「本地化部署 + 进程托管 + 安装器」,这也最大限度复用了现有代码路径,降低主要功能回归的风险。

### 范围与非目标

- **v1 目标平台:Windows x64**(NSIS 安装包 + win-unpacked 免安装目录)。脚本全部用 Node.js 编写并保持跨平台结构,macOS/Linux 打包列为后续迭代,不在 v1 验收范围。
- **非目标**:自动更新(electron-updater)、代码签名、多实例数据同步、把 PostgreSQL 打进安装包(v1 改用 SQLite,见 §3.4)。

---

## 2. Technical Design(技术设计)

### 2.1 总体架构

```
┌────────────────────────── Ecliptrix.exe (Electron) ──────────────────────────┐
│  Main Process (desktop/main/*)                                               │
│   ├─ config.js      读写 userData/desktop-config.json + userData/.env        │
│   ├─ processManager 子进程拉起 / 健康轮询 / 树状终止(taskkill /T)            │
│   │    ├─ [child] FastAPI 后端                                               │
│   │    │    resources/python/python.exe run.py                               │
│   │    │    cwd=resources/backend  →  http://127.0.0.1:18321                 │
│   │    └─ [child] Next.js standalone 前端                                    │
│   │         ELECTRON_RUN_AS_NODE=1 fork(resources/frontend/server.js)        │
│   │         →  http://127.0.0.1:18320                                        │
│   └─ window.js      BrowserWindow → loadURL(http://127.0.0.1:18320)          │
│                     (splash.html 过渡;失败时 error.html + 日志路径)          │
└──────────────────────────────────────────────────────────────────────────────┘
 运行时可写数据全部在 app.getPath('userData') 下:
   data/ecliptrix.db(SQLite) · storage/(STORAGE_ROOT) · logs/ · .env · desktop-config.json
 只读资源全部在 resources/ 下(extraResources,不进 asar):
   frontend/(next standalone) · backend/(FastAPI 源码) · python/(embeddable 运行时) · ffmpeg/
```

要点:

1. **前端进程**:根项目以 `DESKTOP_BUILD=1 next build` 产出 `output: 'standalone'` 工件;运行时用 Electron 自带 Node(`process.execPath` + `ELECTRON_RUN_AS_NODE=1`)fork `server.js`,不必额外捆绑一份 Node。环境变量注入 `PORT=18320`、`HOSTNAME=127.0.0.1`、`BACKEND_URL=http://127.0.0.1:18321`、`LLM_API_URL/LLM_API_KEY`(chat 直连路由需要)。
2. **后端进程**:打包脚本把 CPython 3.11 Windows embeddable 发行版 + `pip install -r requirements.txt` 的完整 site-packages 组装为 `resources/python/`,运行 `resources/backend/run.py`。不用 PyInstaller — 本项目依赖 opencv/numpy/asyncpg/uvicorn 等含 C 扩展与动态导入的包,PyInstaller 收集极易遗漏,embeddable + site-packages 是确定性的。
3. **窗口加载远端为 http://127.0.0.1:18320**,与 Web 形态同源同代码路径:localStorage 会话 token、`/api/*` 同源代理、媒体标签 cookie 回退全部按原样工作,无需 CORS 豁免之外的前端改动。
4. **FFmpeg**:打包脚本下载 ffmpeg/ffprobe 静态构建放入 `resources/ffmpeg/`,主进程把该目录 prepend 到后端子进程 `PATH`,后端现有的 `ffmpeg` 子进程调用零改动。
5. **单实例锁**:`app.requestSingleInstanceLock()`,避免双开导致端口/SQLite 锁冲突。

### 2.2 启动时序(运行时)

1. `app.whenReady` → 获取单实例锁,失败则聚焦已有窗口并退出。
2. `config.js` 初始化 userData 目录结构(`data/`、`storage/`、`logs/`);首次运行时将打包内置的 `env.template.desktop` 复制为 `userData/.env`,生成默认 `desktop-config.json`。
3. `envCheck.js` 解析 `userData/.env`,校验硬性必填键(`LLM_API_KEY`、`LLM_API_URL`;后端 config.py 对二者无默认值,缺失则后端拒绝启动)。缺失时弹原生对话框:「打开配置文件」(shell.openPath)/「我已配置,重新检测」/「退出」,循环直到通过。
4. 显示 `splash.html` 启动页。
5. `ports.js` 探测 18321/18320 是否空闲;被占用时向上探测偶数步进的备用端口并在日志与对话框中警告(前端端口变化意味着 localStorage 域变化,见 §7 风险 5)。
6. 拉起后端子进程,环境变量见 §5.2;以 `GET /api/health`(auth 中间件公开路径)每秒轮询,120 秒超时。
7. 后端健康后 fork 前端子进程,轮询 `GET /` 返回 200,60 秒超时。
8. 创建主窗口 `loadURL(http://127.0.0.1:18320)`,关闭 splash。`setWindowOpenHandler` 把外部链接交给 `shell.openExternal`。
9. 退出:`before-quit` 中先 `child.kill()` 优雅终止,5 秒未退出则 `taskkill /PID <pid> /T /F` 强杀进程树(uvicorn/next 都可能有孙进程)。
10. 任一子进程意外退出 → 弹对话框(附 `userData/logs/` 路径)并提供「重启服务」/「退出」。

### 2.3 构建时序(打包,`desktop/scripts/build.js`)

1. **preflight**:校验 Node ≥ 18.18、npm 可用、磁盘剩余空间 ≥ 8GB;`--cn-mirror` 时设置 Electron/Python/pip/ffmpeg 镜像源。
2. **prepare-frontend**:在仓库根执行 `npm run build`(注入 `DESKTOP_BUILD=1`),将 `.next/standalone/` 复制到 `desktop/build/frontend/`,再把 `.next/static/` 复制进 `build/frontend/.next/static/`、`public/` 复制进 `build/frontend/public/`(standalone 工件不自动包含这两者)。校验 `server.js` 存在且 `node_modules/@mariozechner` 已被 file-tracing 收入(`serverExternalPackages` 依赖)。
3. **prepare-backend**:把 `backend-services/basic-service/` 中的 `app/`、`config/`、`run.py`、`requirements.txt`、`env.template` 复制到 `desktop/build/backend/`(排除 `venv/`、`tests/`、`alembic/`、`static/`、`logs/`、`__pycache__`、`.env`);下载 CPython 3.11.x embeddable amd64 zip 解压到 `desktop/build/python/`;改写 `python311._pth` 追加 `Lib/site-packages` 与 `import site`;用 `get-pip.py` 引导 pip;`python.exe -m pip install -r requirements.txt`。下载产物缓存在 `desktop/cache/`,重复构建不重复下载。
4. **prepare-ffmpeg**:下载 ffmpeg release essentials zip,抽取 `ffmpeg.exe`/`ffprobe.exe` 至 `desktop/build/ffmpeg/`,同目录放入构建版本的 LICENSE 文本。
5. **electron-builder**:asar 仅打包 `desktop/main`、`desktop/preload`、`desktop/assets`;`build/{frontend,backend,python,ffmpeg}` 以 extraResources 进入 `resources/`;产出 NSIS 安装包与 `win-unpacked/` 到 `desktop/release/`。
6. 打印产物路径、体积、SHA256 摘要。`--dir` 跳过 NSIS 仅出 win-unpacked,加速迭代;`--skip-frontend/--skip-backend` 跳过对应 prepare 步骤(用上次 build/ 产物)。

### 2.4 数据库:桌面模式切换到 SQLite

桌面端不捆绑 PostgreSQL。后端已用 `sqlite+aiosqlite:///:memory:` 跑全部测试,ORM 层(含 `JSON` 列、UUID 主键)已被测试证明 SQLite 兼容;`aiosqlite` 已在 requirements.txt 中。桌面主进程注入 `DATABASE_URL=sqlite+aiosqlite:///<userData>/data/ecliptrix.db`,跳过 alembic,完全依赖启动时 `init_db()` 的 `Base.metadata.create_all` + root 用户播种(这正是现有代码的既有路径)。

代码扫描发现 3 处 PostgreSQL 专有逻辑需要兼容处理(这是本方案对后端唯二的修改点之一,均为方言守卫,不改变 PG 行为):

| 位置 | 问题 | 处理 |
|------|------|------|
| `app/database.py:56` | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 是 PG 语法,SQLite 报错 | 仅当 `engine.dialect.name == 'postgresql'` 时执行(SQLite 下 create_all 建出的表本身已含该列) |
| `app/database.py:16` | `pool_size/max_overflow` 等连接池参数 | SQLite 方言下改为精简 engine 参数分支(QueuePool 兼容,但显式分支更稳),并对 SQLite 启用 `PRAGMA journal_mode=WAL` 以承受限流中间件的高频写 |
| `app/services/system_settings_service.py:455` | `pg_insert(...).on_conflict_do_update` 为 PG 方言 API | 按 `session.bind.dialect.name` 分支,SQLite 用 `sqlalchemy.dialects.sqlite.insert` 的同名 upsert API,语义一致 |

`video_project_service.py` 的 `pg_collation` 枚举已有非 PG 后端的优雅降级(回退二进制排序),无需改动。

---

## 3. File / Module Change Plan(文件 / 模块变更计划)

### 3.1 新建 — `desktop/` 目录(本特性主体)

| 文件 | 意图(一行) |
|------|-------------|
| `desktop/package.json` | 独立 npm 包:`electron`(打包时锁定到最新 stable,≥33)、`electron-builder` devDeps;`build`/`build:dir`/`dev`/`clean` 脚本 |
| `desktop/electron-builder.yml` | appId `com.ecliptrix.desktop`、productName `Ecliptrix`、NSIS(oneClick=false、可选安装路径)、extraResources 映射、asar 配置 |
| `desktop/README.md` | 桌面端打包与使用说明(前置依赖、命令、配置 .env、常见问题) |
| `desktop/.gitignore` | 忽略 `node_modules/`、`build/`、`release/`、`cache/` |
| `desktop/main/index.js` | 主进程入口:单实例锁、生命周期编排(启动时序 §2.2)、全局异常兜底 |
| `desktop/main/config.js` | userData 目录初始化、`desktop-config.json` 与 `.env` 的读写/首次运行复制 |
| `desktop/main/envCheck.js` | 必填环境键校验 + 「打开配置文件 / 重新检测」对话框循环 |
| `desktop/main/ports.js` | 端口空闲探测与备用端口选择 |
| `desktop/main/processManager.js` | 通用子进程托管:spawn、HTTP 健康轮询、优雅停止 + taskkill 树杀、退出回调 |
| `desktop/main/backendService.js` | 后端启动描述符:python 路径、cwd、env(DATABASE_URL/STORAGE_ROOT/HOST/PORT/CORS/PATH+=ffmpeg)、健康 URL |
| `desktop/main/frontendService.js` | 前端启动描述符:ELECTRON_RUN_AS_NODE fork server.js、env(PORT/HOSTNAME/BACKEND_URL/LLM_*)、健康 URL |
| `desktop/main/window.js` | 主窗口/splash 创建、外链 openExternal、窗口状态(尺寸记忆)、error.html 展示 |
| `desktop/main/logger.js` | 主进程与子进程 stdout/stderr 落盘到 `userData/logs/`,按大小轮转 |
| `desktop/preload/preload.js` | contextBridge 暴露最小只读信息(应用版本、日志目录路径);不开任何特权 IPC |
| `desktop/assets/splash.html` | 启动过渡页(纯静态,展示服务启动进度文案) |
| `desktop/assets/error.html` | 启动失败页(展示失败服务名与日志路径) |
| `desktop/resources/icons/icon.ico` | 应用图标(v1 用脚本生成的占位图标,后续可替换) |
| `desktop/scripts/build.js` | 打包编排入口:preflight → prepare-frontend → prepare-backend → prepare-ffmpeg → electron-builder |
| `desktop/scripts/preflight.js` | 环境与磁盘校验、镜像源参数解析 |
| `desktop/scripts/prepare-frontend.js` | 根项目 standalone 构建与工件拼装(§2.3 步骤 2) |
| `desktop/scripts/prepare-backend.js` | 后端源码复制 + python embeddable 组装 + pip 安装(§2.3 步骤 3) |
| `desktop/scripts/prepare-ffmpeg.js` | ffmpeg/ffprobe 下载抽取与许可证文本放置 |
| `desktop/scripts/lib/download.js` | 共享:带缓存/重试/SHA256 校验的下载与 zip 解压工具 |
| `desktop/scripts/env.template.desktop` | 桌面端 .env 模板:合并前后端必需键并预填桌面默认值(DATABASE_URL/STORAGE_ROOT 由主进程注入,模板中注释说明) |
| `desktop/scripts/smoke-test.js` | 对 win-unpacked 产物做脚本化冒烟:拉起 exe → 轮询两个端口健康 → 调用登录 API → 退出并断言无残留进程 |

### 3.2 修改 — 仓库既有文件(最小侵入,共 4 处)

| 文件 | 修改意图(一行) |
|------|------|
| `next.config.js` | 追加 `output: process.env.DESKTOP_BUILD === '1' ? 'standalone' : undefined`,Web 构建零影响 |
| `backend-services/basic-service/app/database.py` | PG 专有 `ALTER TABLE ... IF NOT EXISTS` 加方言守卫;engine 参数按方言分支 + SQLite WAL(§2.4) |
| `backend-services/basic-service/app/services/system_settings_service.py` | upsert 按方言选择 pg/sqlite 的 insert API(§2.4) |
| `.gitignore` | 追加 `desktop/node_modules/`、`desktop/build/`、`desktop/release/`、`desktop/cache/` |

> 除上述 4 个文件外不触碰任何既有源码。`docs/plans/desktop-electron-packaging/` 下后续可补充评审与实施记录。

---

## 4. Interface Design(接口设计)

### 4.1 CLI(用户侧入口,均在 `desktop/` 目录下执行)

```
npm install                  # 安装 electron / electron-builder
npm run build                # 完整打包 → release/Ecliptrix-Setup-<ver>.exe + win-unpacked/
npm run build:dir            # 等价 node scripts/build.js --dir(只出免安装目录,快)
npm run dev                  # 开发模式:Electron 直连已手动启动的 :3000/:8000 开发服务
npm run clean                # 删除 build/ release/(保留 cache/)

node scripts/build.js [--dir] [--skip-frontend] [--skip-backend] [--cn-mirror]
  --dir            跳过 NSIS,仅产出 win-unpacked
  --skip-frontend  复用上次 build/frontend 工件
  --skip-backend   复用上次 build/backend + build/python 工件
  --cn-mirror      npm/Electron/pip/python/ffmpeg 全链路国内镜像(与 install.sh 同名旗标对齐)

node scripts/smoke-test.js [--unpacked <path>]   # 打包产物冒烟(§6.2)
```

### 4.2 运行时环境变量契约(主进程 → 子进程)

**后端子进程**(在 `userData/.env` 基础上覆盖注入;python-dotenv 默认不覆盖已存在的环境变量,故注入值优先):

| 变量 | 值 |
|------|----|
| `DATABASE_URL` | `sqlite+aiosqlite:///<userData>/data/ecliptrix.db` |
| `STORAGE_ROOT` | `<userData>/storage`(绝对路径) |
| `HOST` / `PORT` | `127.0.0.1` / `18321`(或探测出的备用端口) |
| `CORS_ALLOWED_ORIGINS` | `http://127.0.0.1:18320`(后端启动必需项) |
| `PATH` | `<resources>/ffmpeg;` + 原 PATH |
| `DEBUG` | `false`(禁用 uvicorn reload) |

**前端子进程**:`PORT=18320`、`HOSTNAME=127.0.0.1`、`BACKEND_URL=http://127.0.0.1:18321`、`NODE_ENV=production`,以及从 `.env` 透传的 `LLM_API_URL`、`LLM_API_KEY`(chat 直连路由)。

### 4.3 IPC / preload 面

v1 刻意保持零业务 IPC:渲染层就是原 Web 应用,经 HTTP 与本地服务通信。preload 仅以 `contextBridge.exposeInMainWorld('ecliptrixDesktop', { version, logsPath })` 暴露只读元信息,`nodeIntegration=false`、`contextIsolation=true`、`webSecurity=true` 全部保持默认安全配置。

---

## 5. Data Model(数据模型)

**不新增任何数据库表**;后端 ORM 模型原样运行在 SQLite 上(测试套件已覆盖该方言)。新增两份桌面端本地文件形态:

`<userData>/desktop-config.json`(主进程读写):

```json
{
  "schemaVersion": 1,
  "frontendPort": 18320,
  "backendPort": 18321,
  "windowBounds": { "width": 1440, "height": 900 },
  "lastRunVersion": "1.0.0"
}
```

`<userData>/.env`(首次运行从模板复制,用户编辑):后端全部既有键(`LLM_API_KEY`、`LLM_API_URL` 必填;`FAST_LLM_*`、`VL_LLM_*`、`VOLCANO_TTS_*`、`PEXELS_API_KEY` 等可选,缺失时对应功能按既有逻辑降级)+ 前端透传键。`DATABASE_URL`、`STORAGE_ROOT`、`HOST/PORT`、`CORS_ALLOWED_ORIGINS` 由主进程强制注入,用户在 .env 中的同名配置不生效(模板中注释说明)。

磁盘布局:SQLite 主库 `data/ecliptrix.db`(WAL 模式,伴生 `-wal/-shm` 文件);上传与生成媒体在 `storage/` 下沿用 install.sh 既有子目录结构(`uploads/{video,audio,images,files}` 等,由后端/主进程首启创建)。

---

## 6. Testing & Acceptance Criteria(测试与验收)

### 6.1 构建验证

1. 干净环境(删除 `desktop/build`、`desktop/cache`)下 `npm run build` 全程无人值守成功;`release/` 产出 NSIS 安装包与 `win-unpacked/`。
2. `build/frontend/server.js`、`build/python/python.exe`、`build/python/Lib/site-packages/fastapi`、`build/ffmpeg/ffmpeg.exe` 均存在(build.js 内置这些断言,缺失即非零退出)。
3. 二次构建命中 `cache/`,不重复下载 python/ffmpeg。

### 6.2 脚本化冒烟(`smoke-test.js`,对 win-unpacked)

设置临时 userData(`--user-data-dir` 启动参数)并预写含测试 LLM 配置的 `.env` → 拉起 exe → 90 秒内 `/api/health` 与前端 `/` 均 200 → 用 env.template 默认 root 账号调用登录 API 拿到 session token → 调 `GET /api/video-projects`(鉴权链路 + SQLite 读写)→ 正常退出 → 断言无残留 `python.exe`/`Ecliptrix.exe` 进程、SQLite 文件已生成。

### 6.3 SQLite 兼容回归(后端)

1. 既有 `pytest tests/ -v` 保持全绿(本方案对 database.py / system_settings_service.py 的方言分支不得破坏 PG 行为)。
2. 新增针对性用例:SQLite 方言下 `init_db()` 成功(覆盖 ALTER 守卫)、system settings upsert 成功写入与更新(覆盖 sqlite insert 分支)— 各含正常与异常路径。

### 6.4 手工验收清单(打包产物,主要功能正常性)

| # | 场景 | 通过标准 |
|---|------|----------|
| 1 | 安装并首启 | 缺 LLM key 时出现配置引导对话框;补全后进入应用 |
| 2 | 登录 | root 账号登录成功,Header 显示角色 |
| 3 | AI 对话 | 新建会话,流式回复正常 |
| 4 | 视频工程 | 新建工程 → 上传本地视频素材 → 拖入时间线 → 预览播放 |
| 5 | TTS(配置 Volcano 时) | 文案生成语音并入轨 |
| 6 | 导出 | 时间线合成导出 mp4 成功(验证 FFmpeg 链路) |
| 7 | 持久化 | 重启应用后工程列表、登录态(localStorage)、素材均在 |
| 8 | 退出 | 关闭窗口后任务管理器无残留 python/node 子进程 |

### 6.5 Definition of Done

- `desktop/` 内 `npm run build` 在 Windows x64 上产出可安装、可运行的安装包;
- §6.2 冒烟脚本通过;§6.3 测试全绿;§6.4 清单 1–4、6–8 必须通过(5 取决于可选密钥);
- 根项目 Web 形态 `npm run build`、`pytest` 不受任何影响。

---

## 7. Risks & Mitigations(风险与缓解)

| # | 风险 | 等级 | 缓解 |
|---|------|------|------|
| 1 | SQLite 与 PG 行为差异(upsert、原生 SQL、并发写锁)导致桌面端隐性故障 | 高 | §2.4 三处方言守卫 + §6.3 专项用例;WAL 模式缓解限流中间件高频写;遗留原则:db_models 持续保持 SQLite 兼容(测试套件天然强制) |
| 2 | python embeddable 组装坑(`._pth` 不启用 site-packages、pip 引导失败) | 中 | prepare-backend.js 固化已知修复步骤并断言关键包可 import(`python -c "import fastapi, cv2, sqlalchemy"`) |
| 3 | Next standalone 漏收 `serverExternalPackages`(pi-ai/pi-agent-core 运行时 require 失败) | 中 | 构建断言 standalone node_modules 含 `@mariozechner/*`;冒烟覆盖 chat 路由 |
| 4 | 安装包体积大(Electron + python site-packages(opencv/numpy)+ ffmpeg + next,预估 1–1.5GB) | 中 | 接受为 v1 代价;pip 装完清理 `__pycache__`/`*.dist-info` 中非必要文件;文档明示体积 |
| 5 | 端口被占用→改用备用端口→localStorage 换源,登录态与本地偏好丢失 | 中 | 默认端口取 18320/18321 冷门段;变更时弹窗明示;`desktop-config.json` 可固定端口 |
| 6 | 子进程残留(uvicorn/next 的孙进程) | 中 | processManager 统一 `taskkill /T /F` 树杀 + 冒烟脚本断言;单实例锁防双开 |
| 7 | 未签名安装包触发 SmartScreen/杀软误报 | 中 | v1 文档说明「更多信息→仍要运行」;代码签名列入后续迭代 |
| 8 | FFmpeg 构建许可证(essentials 为 GPL) | 低 | 随包附 LICENSE 与来源说明;如需更宽松改用 LGPL 构建,脚本中 URL 可配置 |
| 9 | `.env` 明文存密钥 | 低 | 位于用户私有 userData 目录,与 Web 形态现状一致;后续可迁移 Electron safeStorage |
| 10 | 中文用户名路径/Windows 长路径导致 python 或 pip 异常 | 低 | 所有路径经绝对化与引号包裹;构建目录固定在 `desktop/build`(浅层);文档注明仓库勿置于超深路径 |
| 11 | 首启慢(后端冷启动 + create_all) | 低 | splash 进度文案 + 120s 健康超时;失败时 error.html 给出日志路径 |
| 12 | alembic 被跳过,未来 PG-only 迁移使桌面端 schema 漂移 | 低 | 桌面端依赖 create_all(既有启动路径);在 README 与本 spec 记录约束:模型变更须保持 create_all 可建 |

---

## 8. 实施顺序建议(供下游开发节点)

1. 后端 SQLite 方言守卫 + 新增测试(§2.4、§6.3)— 独立可验证,先行落地。
2. `next.config.js` 条件 standalone + 根目录构建验证。
3. `desktop/` 骨架:package.json、main/*、preload、assets(先用 `npm run dev` 直连本地开发服务验证主进程编排)。
4. scripts/*:prepare-frontend → prepare-backend → prepare-ffmpeg → build.js 编排与断言。
5. electron-builder 配置与 win-unpacked 联调,跑通 §6.2 冒烟。
6. NSIS 安装包、README、.gitignore 收尾,过 §6.4 清单。

<!-- 实施过程发现的方案缺陷:由 Subtask #2 在此段下方追加记录 -->

## 实施过程发现的方案缺陷(Subtask #2 记录)

> 实施时间:2026-06-06。注:实施开始时本文档仍为 v1 标注、无「评审记录」段
> (Subtask #1 上报完成但未修改文档),实施按 v1 现有内容执行。

1. **【已修复】SQLite 兼容性遗漏:PG 专有列类型无法在 SQLite 上编译。**
   §2.4 断言「ORM 层已被测试证明 SQLite 兼容」,但该兼容性实际依赖
   `tests/conftest.py` 中的 `@compiles(postgresql.UUID/JSONB, "sqlite")`
   编译 shim — 它只在测试进程里注册。生产代码路径(桌面模式 `init_db()`)
   直接对 SQLite 跑 `create_all` 会抛 `UnsupportedCompilationError`。
   修正:在 `app/database.py` 新增 `_install_sqlite_pg_type_shims()`,
   仅当 `DATABASE_URL` 为 sqlite 时注册同款方言级 shim(PG 行为零影响),
   并由 `tests/test_sqlite_dialect_compat.py::TestInitDbOnSqlite` 覆盖。

2. **【无需改动】`system_settings_service.py` 的 upsert 方言分支已存在。**
   §2.4 表格与 §3.2 将其列为待修改文件,但当前代码
   (`ensure_defaults_seeded()`,约 427–474 行)已按
   `session.bind.dialect.name` 分支(SQLite 走 select+insert/update,
   语义与方案一致)。未触碰该文件;新增测试覆盖其 SQLite 路径
   (首插 + 二次默认值刷新)。既有文件实际修改数由 4 降为 3。

3. **【小幅扩展】SQLite PRAGMA 在 WAL 之外补充 `busy_timeout=5000` 与
   `foreign_keys=ON`。** 仅 WAL 不足以避免限流中间件并发写时的
   "database is locked"(WAL 只允许单写者,冲突时 aiosqlite 默认立即报错);
   `foreign_keys=ON` 恢复与 PG 一致的外键约束语义。属 §2.4 风险 1
   缓解措施的必要补全。

4. **【计划表遗漏】§6.3.2 要求新增 SQLite 针对性测试,但 §3 变更计划表
   未列出测试文件路径。** 已按测试要求落地为
   `backend-services/basic-service/tests/test_sqlite_dialect_compat.py`(6 用例)。

5. **【实现取舍】`npm run clean` 以 `node scripts/build.js --clean` 实现。**
   §4.1 定义了 clean 命令,但 §3.1 文件清单没有独立的 clean 脚本;
   为不超出文件清单,将 clean 作为 build.js 的参数分支实现,行为与
   §4.1 一致(删 build/ 与 release/,保留 cache/)。

6. **【环境事实】本机既有 pytest 套件基线即有 112 项失败 / 2 文件收集错误**
   (cv2 二进制损坏、`pytest.config` 旧 API、网络依赖等环境性原因)。
   对照 stash 前后基线逐项核对:本次改动未新增任何失败;
   DB/auth/settings 相关测试文件改动前后失败集合完全一致。

## 代码 Review 记录(Subtask #3,2026-06-06)

对照本 spec 逐项复核 Subtask #2 产出,发现并就地修复 4 处问题:

1. **【严重,已修复】embeddable Python 受打包机 user site-packages 污染。**
   打包机自装的 Python 3.11 在 `%APPDATA%\Python\Python311\site-packages`
   留有同版本包;embeddable 运行时启用 `import site` 后能看到该目录,导致
   `pip install -r requirements.txt` 将全部依赖判为 "already satisfied"、
   **零安装**进 `Lib/site-packages`,而构建期 import 断言又从 user site 解析
   成功 — 产物在打包机上"验证通过",到最终用户机器上必然崩溃(实测
   review 时 `build/python/Lib/site-packages` 仅有 pip/wheel/packaging)。
   修复:`prepare-backend.js` 全部 python/pip 调用注入 `PYTHONNOUSERSITE=1`
   (`ISOLATED_PYTHON_ENV`);`backendService.js` 运行时 spawn 同样注入,
   防最终用户机器上的同类遮蔽。修复后重跑 prepare-backend 验证通过。
2. **【已修复】应用图标落错目录。** `electron-builder.yml` 与 README 约定
   `desktop/resources/icons/icon.ico`,实际文件生成在
   `backend-services/basic-service/desktop/resources/icons/` 下(脚本 cwd
   失误)。已移动至正确位置并清理误建目录。
3. **【已修复】`requirements.txt` 字母序破坏。** `email-validator==2.3.0`
   (auth/user 模型的 `EmailStr` 依赖,装进 embeddable 运行时必需)被插在
   pydantic 旁;已移回字母序位置(colorama 之后)。
4. **【确认通过】其余对照项。** §3.1 文件清单全部落地(resources/icons 含
   占位图标);§3.2 既有文件修改与"实施缺陷"记录一致(3 处);
   `tests/test_sqlite_dialect_compat.py` 6/6 通过;desktop 全部 17 个 JS
   文件 `node --check` 通过;`/api/health` 公开路径、登录响应
   `session_token` 字段、`/api/video-projects` 路由、`run.py` 的 HOST/PORT
   读取与 `ROOT_USERNAME` 播种链路逐一核对无误。
