<div align="center">
  <img src="public/brand/ecliptrix-logo.png" alt="Ecliptrix Logo" width="240" />
</div>

# Ecliptrix

**Where light and shadow collide**

[中文文档](README.zh-CN.md)

An AI-powered content creation desktop app combining video editing, voice
synthesis and material management — an Electron shell around a Next.js 15
renderer and a local FastAPI backend.

Everything runs on your machine. The Electron main process starts a FastAPI
backend (SQLite) and a Next.js standalone server, both bound to `127.0.0.1`,
and loads the local page. There is no account, no login and no server to
deploy to — the app opens straight into the editing workspace.

## Features

- **AI Video Editing** — Automatic video search, mixing, cutting, and composition with subtitle overlay
- **Voice Synthesis** — Volcano TTS integration with 100+ voice types and batch processing
- **Video Analysis** — Vision-Language model powered frame-by-frame video understanding
- **Storyboards & AI Generation** — ByteDance ARK video and image generation
- **Content Chat** — Multi-turn AI chat with streaming responses
- **Multi-tab Interface** — Work on chat and video editing side by side
- **YouTube Integration** — Download and process YouTube videos with yt-dlp

## Quick Start

### Prerequisites

| Tool | Version | Required |
|------|---------|----------|
| Node.js | 18+ | Yes |
| Python | 3.11+（网络研究路径） | Yes |
| FFmpeg | 4+ | For video features |

No database server is needed: the app uses SQLite.

### Run the desktop app in development

```bash
git clone https://github.com/xdrshjr/Ecliptrix.git
cd Ecliptrix
npm install

cd backend-services/basic-service
python3 -m venv venv
source venv/bin/activate        # Windows: source venv/Scripts/activate
pip install -r requirements.txt
cd ../..

cd desktop
npm install
npm run dev
```

`desktop/npm run dev` starts the backend, the Next.js dev server and Electron
together, wired to each other. The database file and storage directories are
created on first launch — there is no migration step.

### Build an installer

```bash
cd desktop
npm run build        # full installer
npm run build:dir    # unpacked build (what the smoke test runs against)
node scripts/smoke-test.js
```

### Browser-only debugging

The renderer is an ordinary Next.js app, so you can drive it in a browser
without Electron. This is a debugging path for the same product, not a second
supported form factor — the window controls simply do not render.

```bash
# Terminal 1 — backend
cd backend-services/basic-service
source venv/bin/activate        # Windows: source venv/Scripts/activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2 — frontend
npm run dev
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| API Docs | http://localhost:8000/docs |

### Configure your model credentials

On first launch the app prompts you to open **Settings → Model & credentials**
and enter an LLM key. You can also pre-fill `LLM_API_KEY` / `LLM_API_URL` in
the backend `.env` before starting.

### 网络研究与动态网页

Agent 可按需加载网页搜索、阅读、图片/音视频下载和动态浏览工具；资料保留
来源引用，下载验证成功后才导入本地素材库。公开网站内容无需登录，网页中的
指令不会授予额外操作权限。搜索需在 **设置 → 网络与研究** 配置 Tavily 凭证；
无凭证、站点拒绝、离线和浏览器不可用会分别显示状态，剪辑仍可使用。

搜索凭证被拒绝时检查并重新保存；限流时稍后手动重试；额度不足时检查服务商
账户。超时或响应异常不会清除已保存配置。设置中的“已配置”只表示已保存搜索凭证，
公网连接须通过“测试已保存连接”验证；状态读取失败可点击“刷新状态”。
连接测试从开始计时冷却5秒；测试仍在运行时不能再次发起。

在 **模型设置 → 功能分配 → 网络资料整理** 选择可选研究模型，并在网络与
研究中开启资料整理；关闭后由主模型整合。研究模型未单独分配时按完整配置组
回落到快速模型、再到聊天模型。高级设置中的主模型与研究模型上下文窗口应与
实际模型上限一致。下载素材保存在本机，临时研究资料按保留期限清理。

研究卡片分别标明“已读取原文”“仅搜索摘要”和“未取得内容”，并显示实际来源
覆盖情况。读到原文不等于事实已经验证；混合来源报告会保留原文缺失说明。
资料整理模型失败、超时或上下文不足时，已取得摘录仍可供主模型使用。
仅生成搜索查询不代表报告整理成功，界面按真实阶段显示模型状态。
长对话压缩后保留资料编号和来源质量；需要完整证据时按需读取原始研究资料。

网络研究开发路径要求 Python 3.10+（Windows 浏览器路径需 3.10/3.11 冒烟）；
桌面 smoke 要求 Node.js 22+。依赖只装 pip 包，**不执行**
`python -m playwright install`——动态浏览经 CDP 复用应用自带的 Electron
Chromium（spec §3.6），安装包零新增浏览器资源（playwright 包仅贡献约
50MB 的 node driver）：

```powershell
python -m pip install -r requirements.txt
python run.py
```

开发机的动态浏览调试：先拉起 Electron 浏览器宿主（desktop 目录下
`npx electron main/agentBrowserHost.js --agent-browser-host --cdp-port=9222
--control-port=9333`），再为后端设置 `AGENT_BROWSER_CDP_URL=
http://127.0.0.1:9222` 与 `AGENT_BROWSER_CONTROL_URL=
http://127.0.0.1:9333`；桌面安装版由主进程自动注入并监管宿主子进程，
无需手工设置。纯浏览器调试若更改前端地址，在前后端设置相同的
`RESEARCH_RENDERER_ORIGIN`（例如 `http://localhost:3000`），并将其加入后端
`CORS_ALLOWED_ORIGINS`。

代理：设置中心「网络与研究 → 代理模式」三选一（自动/直连/自定义）。
自动 = 自定义地址 > 系统/环境代理 > 直连；直连保留全量公网 IP 校验；
自定义仅使用填写的 http(s)://host:port（可含认证）。代理模式下目标主机
名交由代理解析（Fake-IP 代理环境可用），但字面私网/metadata 目标仍拒绝。

Windows 动态浏览验证使用 `python run.py` 的显式 Proactor 循环、单进程、
无 reload 启动路径（playwright driver 需要子进程支持）。宿主缺失时动态
浏览优雅降级为不可用，静态研究仍可使用。`node scripts/smoke-test.js`
检查打包应用的宿主存活/CDP 可达/capabilities/浏览器动作与退出清理。

完整构建成功后生成 `desktop/release/research-build-manifest.json`，绑定整个
安装资源树及本次安装器。研究发布验收命令在仓库根运行（`<run-id>` 每次使用新值）：

```powershell
npm --prefix desktop run build
node desktop/scripts/smoke-test.js --unpacked desktop/release/win-unpacked --research-manifest desktop/release/research-build-manifest.json --research-report .agentmesh/research-r2/<run-id>/package_offline.json
node desktop/scripts/verify-research-release.js --unpacked desktop/release/win-unpacked --installed .agentmesh/research-r2/<run-id>/installed --manifest desktop/release/research-build-manifest.json --evidence .agentmesh/research-r2/<run-id>/evidence.json
```

校验退出0表示全部门禁通过，1表示证据失败，2表示仍有合法的未运行或阻断项。
离线 smoke 不替代真实公网、模型、安装和离线视频闭环；报告与附件结构见
[第二轮方案](docs/plans/agent-general-capabilities-r2/spec.md)，实际验证与阻断见
[第三轮验收记录](docs/plans/agent-general-capabilities-r3/acceptance.md)。重建后必须重新验收；
终态报告不可覆写。运行日志、数据库和临时文件放在独立用户目录。

动态浏览仅允许公开 GET/HEAD 请求，不导入 Cookie，不支持登录、POST API 或
Service Worker。当前浏览器不能安全重新拦截的重定向会返回
`redirect_unsupported`；可改为直接打开已核实的最终公开地址。

### Agent general toolkit (workspace / documents / analysis / plan / ask / memory)

Besides the editing tools, the editing agent ships a set of video-agnostic
capabilities. Every one of them is switchable and quota-limited in
**Settings > Agent capabilities**:

| Capability | What it does | Default |
|---|---|---|
| Workspace | The agent writes outlines, script drafts, CSV and SVG as **local files**, reads them back page by page, and can import media into the material library for the timeline | On |
| Documents | Upload PDF / DOCX / TXT / MD / CSV / TSV / JSON / SRT / VTT / HTML and read them page by page; long documents get a layered digest (a digest is **not** evidence) | On |
| Analysis | Offline Python for arithmetic, tables, CSV/SVG artifacts | **Off** (opt-in) |
| Plan | `update_plan` publishes the multi-step plan in the chat | On |
| Ask | `ask_user` stops to ask one question at a decision fork, with no interrupt/resume protocol | On |
| Memory | Remembers confirmed preferences and decisions; per-entry delete, optional expiry | On |

Where it lives and what it does not promise:

- The workspace is `<parent of STORAGE_ROOT>/agent_workspace` (on desktop:
  `<userData>/agent_workspace`). It is **not** under `static/`, has no static
  mount, and is reachable only through `/api/agent-toolkit/*`. It is
  project-scoped with a 256 MB default quota.
- The analysis sandbox uses an **AST allow-list plus a separate process**. It is
  **not kernel-level isolation**: it stops the model from writing code that
  damages your files, it does not stop a malicious local user. Only a
  wall-clock timeout is enforced — there is **no memory limit**. That is why it
  ships off by default, and the settings panel says exactly this.
- Document digests use the fast model by default and can be switched to the
  research model in the same panel; the fast model falls back to the chat model.
- Tools are **progressively disclosed**: only `update_plan` and `ask_user` are
  always resident. The other ten load by category (workspace / documents /
  analysis / memory); unloaded schemas are never sent, and long documents and
  big tables are always paged, so the context cannot blow up.

## Tech Stack

### Desktop shell

- **Electron** main process — spawns and health-checks the backend and frontend child processes, owns the frameless window
- **Packaging:** electron-builder, with an embedded CPython and FFmpeg

### Frontend

- **Framework:** Next.js 15 (App Router, `output: 'standalone'`)
- **Language:** TypeScript 5
- **Styling:** Tailwind CSS 3
- **State:** React hooks + Context (Locale, Notifications)

### Backend

- **Framework:** FastAPI
- **Database:** SQLite + SQLAlchemy (async, aiosqlite); schema built by `create_all`
- **Storage:** Local filesystem
- **Video:** FFmpeg subprocess, OpenCV
- **TTS:** Volcano Engine TTS
- **LLM:** Multi-provider (OpenAI-compatible API, supports Qwen, Claude, GPT, etc.)

## Project Structure

```
Ecliptrix/
├── desktop/                          # Electron shell
│   ├── main/                         # Main process: window, child processes, env
│   ├── preload/                      # contextBridge surface (version, logs, window controls)
│   └── scripts/                      # dev / packaging / smoke-test scripts
├── src/                              # Next.js renderer
│   ├── app/                          # App Router + API proxy routes
│   ├── components/                   # Feature-organized React components
│   │   ├── video/                    # Video editing (30+ components)
│   │   ├── chat/                     # Chat interface
│   │   ├── settings/                 # Settings centre
│   │   ├── shell/                    # Title bar + action cluster
│   │   └── ui/                       # Shared UI components
│   ├── contexts/                     # Notification, Locale
│   ├── hooks/                        # useTasks, useLlmConfigStatus, ...
│   ├── lib/api/                      # Backend API service clients
│   └── types/                        # TypeScript type definitions
├── backend-services/basic-service/   # FastAPI backend
│   ├── app/
│   │   ├── main.py                   # App entry: 32 routers, middleware
│   │   ├── config.py                 # Settings loader (.env + YAML overrides)
│   │   ├── constants.py              # LOCAL_OWNER_ID / LOCAL_OWNER_NAME
│   │   ├── database.py               # Async SQLAlchemy engine + create_all
│   │   ├── models/                   # Pydantic + ORM models
│   │   ├── routers/                  # API route modules
│   │   └── services/                 # Service modules
│   ├── config/                       # YAML configs (TTS, upload, youtube, etc.)
│   └── tests/                        # Pytest suite
└── env.template                      # Frontend environment template
```

## Configuration

### Frontend `.env.local`

```bash
# LLM API (used by the direct-call chat routes)
LLM_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=your_key_here
LLM_MODEL=qwen3-next-80b-a3b-instruct

# Backend connection (server-side only)
BACKEND_URL=http://localhost:8000

# App settings
NEXT_PUBLIC_APP_NAME=Ecliptrix
NEXT_PUBLIC_AI_MATERIAL_SERVICE=local
```

### Backend `.env`

```bash
# LLM APIs (general, video cut, vision-language)
LLM_API_KEY=your_key_here
VIDEO_CUT_LLM_API_KEY=your_key_here
VL_LLM_API_KEY=your_key_here

# Database — SQLite file, created on first run
DATABASE_URL=sqlite+aiosqlite:///./data/ecliptrix.db

# External APIs (optional)
PEXELS_API_KEY=your_key_here
VOLCANO_TTS_APPID=your_appid
```

In the packaged app, `DATABASE_URL`, `STORAGE_ROOT`, `HOST`, `PORT` and
`CORS_ALLOWED_ORIGINS` are injected by the Electron main process and cannot be
overridden from `.env`.

See `env.template` (frontend) and `backend-services/basic-service/env.template`
(backend) for all available options.

### Multi-LLM Strategy

The backend supports several independent LLM configurations:

| Config | Used For | Default Model |
|--------|----------|---------------|
| `LLM_*` | Chat, agent, intent detection | qwen3-next-80b |
| `FAST_LLM_*` | Quick operations (translation, search queries) | — |
| `VIDEO_CUT_LLM_*` | AI mixed editing | claude-sonnet-4 |
| `VL_LLM_*` | Video frame analysis | qwen-vl-plus |

All endpoints use the OpenAI-compatible API format.

## Commands

### Desktop

```bash
# From desktop/
npm run dev        # Electron + backend + frontend, wired together
npm run build      # Package the installer
npm run build:dir  # Unpacked build
node scripts/smoke-test.js      # End-to-end gate on the packaged app
node main/window-state.test.js  # Main-process unit tests
```

### Frontend

```bash
npm run dev          # Development server
npm run build        # Production build
npm start            # Production server
npm run lint         # ESLint
npm run type-check   # TypeScript check
npm test             # Vitest unit tests
```

### Backend

```bash
# From backend-services/basic-service/ with venv activated
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000   # Dev server
pytest tests/ -v                                              # Run tests
pytest tests/ --cov=app --cov-report=html                     # Coverage
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the ISC License.

---

**Ecliptrix** — Transforming ideas into reality through the collision of light and shadow.
