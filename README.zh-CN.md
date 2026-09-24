<div align="center">
  <img src="public/brand/ecliptrix-logo.png" alt="Ecliptrix Logo" width="240" />
</div>

# Ecliptrix / 灵蚀创影

**光影交汇之处**

[English](README.md)

一个 AI 驱动的内容创作**桌面应用**，集视频编辑、语音合成与素材管理于一体 —
外层是 Electron，渲染进程是 Next.js 15，后端是本机 FastAPI。

一切都跑在你自己的电脑上。Electron 主进程会拉起 FastAPI 后端（SQLite）与
Next.js standalone 服务，两者都只监听 `127.0.0.1`，然后加载本地页面。没有账号、
没有登录、也没有需要部署的服务器 —— 启动即进入剪辑工作区。

## 功能特性

- **AI 视频编辑** — 自动视频搜索、混剪、裁切和合成，支持字幕叠加
- **语音合成** — 火山引擎 TTS 集成，100+ 种音色，支持批量处理
- **视频分析** — 视觉语言模型驱动的逐帧视频理解
- **分镜与 AI 生成** — 基于字节 ARK 的视频与图像生成
- **内容对话** — 多轮 AI 对话，支持流式响应
- **多标签界面** — 对话与视频剪辑可并行工作
- **YouTube 集成** — 使用 yt-dlp 下载和处理 YouTube 视频

## 快速开始

### 环境要求

| 工具 | 版本 | 必需 |
|------|------|------|
| Node.js | 18+ | 是 |
| Python | 3.10+ | 是 |
| FFmpeg | 4+ | 视频功能需要 |

不需要任何数据库服务：本项目使用 SQLite。

### 开发模式运行桌面应用

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

`desktop/npm run dev` 会把后端、Next.js 开发服务器和 Electron 一起拉起并互相连通。
数据库文件与存储目录在首次启动时自动创建，**没有迁移步骤**。

### 打包安装程序

```bash
cd desktop
npm run build        # 完整安装包
npm run build:dir    # 免安装目录（冒烟测试跑的就是它）
node scripts/smoke-test.js
```

### 纯浏览器调试

渲染进程就是一个普通的 Next.js 应用，因此可以脱离 Electron 在浏览器里调试。
这是**同一个产品的调试链路**，不是第二种产品形态 —— 区别仅仅是窗口控制按钮不渲染。

```bash
# 终端 1 — 后端
cd backend-services/basic-service
source venv/bin/activate        # Windows: source venv/Scripts/activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# 终端 2 — 前端
npm run dev
```

| 服务 | 地址 |
|------|------|
| 前端 | http://localhost:3000 |
| 后端 API | http://localhost:8000 |
| API 文档 | http://localhost:8000/docs |

### 配置模型凭证

首次启动时应用会提示你打开 **设置 → 模型与凭证** 填入 LLM 密钥；也可以在启动前先把
`LLM_API_KEY` / `LLM_API_URL` 写进后端 `.env`。

## 技术栈

### 桌面外壳

- **Electron** 主进程 —— 拉起并健康探测后端 / 前端子进程，管理无边框窗口
- **打包：** electron-builder，内嵌 CPython 与 FFmpeg

### 前端

- **框架：** Next.js 15（App Router，`output: 'standalone'`）
- **语言：** TypeScript 5
- **样式：** Tailwind CSS 3
- **状态：** React hooks + Context（Locale、Notifications）

### 后端

- **框架：** FastAPI
- **数据库：** SQLite + SQLAlchemy（异步，aiosqlite）；表结构由 `create_all` 建立
- **存储：** 本地文件系统
- **视频：** FFmpeg 子进程、OpenCV
- **TTS：** 火山引擎 TTS
- **LLM：** 多供应商（OpenAI 兼容 API，支持 Qwen、Claude、GPT 等）

## 项目结构

```
Ecliptrix/
├── desktop/                          # Electron 外壳
│   ├── main/                         # 主进程：窗口、子进程、环境变量
│   ├── preload/                      # contextBridge 暴露面（版本、日志、窗口控制）
│   └── scripts/                      # 开发 / 打包 / 冒烟测试脚本
├── src/                              # Next.js 渲染进程
│   ├── app/                          # App Router + API 代理路由
│   ├── components/                   # 按功能组织的 React 组件
│   │   ├── video/                    # 视频编辑（30+ 组件）
│   │   ├── chat/                     # 对话界面
│   │   ├── settings/                 # 设置中心
│   │   ├── shell/                    # 标题栏与动作簇
│   │   └── ui/                       # 共享 UI 组件
│   ├── contexts/                     # Notification、Locale
│   ├── hooks/                        # useTasks、useLlmConfigStatus 等
│   ├── lib/api/                      # 后端 API 服务客户端
│   └── types/                        # TypeScript 类型定义
├── backend-services/basic-service/   # FastAPI 后端
│   ├── app/
│   │   ├── main.py                   # 应用入口：32 个路由、中间件
│   │   ├── config.py                 # 配置加载（.env + YAML 覆盖）
│   │   ├── constants.py              # LOCAL_OWNER_ID / LOCAL_OWNER_NAME
│   │   ├── database.py               # 异步 SQLAlchemy 引擎 + create_all
│   │   ├── models/                   # Pydantic + ORM 模型
│   │   ├── routers/                  # API 路由模块
│   │   └── services/                 # 服务模块
│   ├── config/                       # YAML 配置（TTS、上传、youtube 等）
│   └── tests/                        # Pytest 测试套件
└── env.template                      # 前端环境变量模板
```

## 配置说明

### 前端 `.env.local`

```bash
# LLM API（直连对话路由使用）
LLM_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=your_key_here
LLM_MODEL=qwen3-next-80b-a3b-instruct

# 后端连接（仅服务端可见）
BACKEND_URL=http://localhost:8000

# 应用设置
NEXT_PUBLIC_APP_NAME=Ecliptrix
NEXT_PUBLIC_AI_MATERIAL_SERVICE=local
```

### 后端 `.env`

```bash
# LLM API（通用、视频混剪、视觉语言）
LLM_API_KEY=your_key_here
VIDEO_CUT_LLM_API_KEY=your_key_here
VL_LLM_API_KEY=your_key_here

# 数据库 —— SQLite 文件，首次运行自动创建
DATABASE_URL=sqlite+aiosqlite:///./data/ecliptrix.db

# 外部 API（可选）
PEXELS_API_KEY=your_key_here
VOLCANO_TTS_APPID=your_appid
```

打包后的应用中，`DATABASE_URL`、`STORAGE_ROOT`、`HOST`、`PORT`、
`CORS_ALLOWED_ORIGINS` 由 Electron 主进程强制注入，写在 `.env` 里不会生效。

完整可用选项见 `env.template`（前端）与
`backend-services/basic-service/env.template`（后端）。

### 多 LLM 策略

后端支持多套相互独立的 LLM 配置：

| 配置 | 用途 | 默认模型 |
|------|------|----------|
| `LLM_*` | 对话、Agent、意图识别 | qwen3-next-80b |
| `FAST_LLM_*` | 轻量操作（翻译、搜索词生成） | — |
| `VIDEO_CUT_LLM_*` | AI 混剪 | claude-sonnet-4 |
| `VL_LLM_*` | 视频帧分析 | qwen-vl-plus |

所有端点均使用 OpenAI 兼容的 API 格式。

## 常用命令

### 桌面端

```bash
# 在 desktop/ 目录下
npm run dev        # Electron + 后端 + 前端 一起拉起
npm run build      # 打包安装程序
npm run build:dir  # 免安装目录
node scripts/smoke-test.js      # 打包产物端到端门禁
node main/window-state.test.js  # 主进程单元测试
```

### 前端

```bash
npm run dev          # 开发服务器
npm run build        # 生产构建
npm start            # 生产服务器
npm run lint         # ESLint
npm run type-check   # TypeScript 检查
npm test             # Vitest 单元测试
```

### 后端

```bash
# 在 backend-services/basic-service/ 目录下，激活 venv 后
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000   # 开发服务器
pytest tests/ -v                                              # 运行测试
pytest tests/ --cov=app --cov-report=html                     # 覆盖率
```

## 参与贡献

1. Fork 本仓库
2. 创建功能分支（`git checkout -b feature/amazing-feature`）
3. 提交更改（`git commit -m 'Add amazing feature'`）
4. 推送分支（`git push origin feature/amazing-feature`）
5. 提交 Pull Request

## 许可证

本项目基于 ISC 许可证开源。

---

**Ecliptrix / 灵蚀创影** — 在光与影的交汇中，将想法化为现实。
