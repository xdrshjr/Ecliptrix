<div align="center">
  <img src="public/logo-ai.png" alt="Ecliptrix Logo" width="200" />
</div>

# Ecliptrix / 灵蚀创影

**光影交汇之处**

[English](README.md)

一个AI驱动的内容创作平台，集视频编辑、语音合成、工作流自动化和创意头脑风暴于一体 — 基于 Next.js 15 和 FastAPI 构建。

## 功能特性

- **AI视频编辑** — 自动视频搜索、混剪、裁切和合成，支持字幕叠加
- **语音合成** — 火山引擎TTS集成，100+种音色，支持批量处理
- **工作流构建器** — 可视化节点编辑器，10+节点类型（ChatLLM、Pexels、TTS等）
- **视频分析** — 视觉语言模型驱动的逐帧视频理解
- **内容对话** — 多轮AI对话，支持流式响应
- **图像生成** — 基于FLUX的图像生成（RunningHub）
- **多标签界面** — 同时进行对话、视频、工作流和头脑风暴
- **YouTube集成** — 使用yt-dlp下载和处理YouTube视频

## 快速开始

### 环境要求

| 工具 | 版本 | 必需 |
|------|------|------|
| Node.js | 18+ | 是 |
| Python | 3.10+ | 是 |
| PostgreSQL | 13+ | 是 |
| FFmpeg | 4+ | 视频功能需要 |

### 一键安装

```bash
git clone https://github.com/xdrshjr/Ecliptrix.git
cd Ecliptrix
bash install.sh
```

安装脚本会自动完成：依赖安装、Python虚拟环境创建、环境变量文件生成、PostgreSQL数据库配置、Alembic数据库迁移和目录创建。

**可选参数：**

```bash
bash install.sh --cn-mirror      # 使用国内镜像源（npm + pip）
bash install.sh --skip-db        # 跳过PostgreSQL自动配置
bash install.sh --skip-frontend  # 跳过npm install
bash install.sh --skip-backend   # 跳过Python虚拟环境和pip install
bash install.sh --help           # 显示所有选项
```

### 手动安装

<details>
<summary>点击展开手动安装步骤</summary>

**1. 前端**

```bash
npm install
cp env.template .env.local
# 编辑 .env.local 填入你的 API 密钥
```

**2. 后端**

```bash
cd backend-services/basic-service
python3 -m venv venv
source venv/bin/activate        # Windows: source venv/Scripts/activate
pip install -r requirements.txt
cp env.template .env
# 编辑 .env 填入你的 API 密钥
```

**3. 数据库**

```sql
-- 以 postgres 超级用户连接
CREATE USER ecliptrix WITH PASSWORD 'ecliptrix';
CREATE DATABASE ecliptrix OWNER ecliptrix;
GRANT ALL PRIVILEGES ON DATABASE ecliptrix TO ecliptrix;
```

```bash
cd backend-services/basic-service
source venv/bin/activate
alembic upgrade head
```

</details>

### 启动服务

```bash
# 终端1 — 后端
cd backend-services/basic-service
source venv/bin/activate        # Windows: source venv/Scripts/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# 终端2 — 前端
npm run dev
```

或使用启动脚本：

```bash
bash start.sh
```

| 服务 | 地址 |
|------|------|
| 前端 | http://localhost:3000 |
| 后端API | http://localhost:8000 |
| API文档 | http://localhost:8000/docs |

**默认登录：** `admin` / `admin`

## 技术栈

### 前端

- **框架：** Next.js 15（App Router）
- **语言：** TypeScript 5
- **样式：** Tailwind CSS 3
- **状态管理：** React hooks + Context（Auth、Locale、Notifications）

### 后端

- **框架：** FastAPI 0.104
- **数据库：** PostgreSQL + SQLAlchemy（异步）+ Alembic
- **认证：** 本地认证（bcrypt + JWT）
- **存储：** 本地文件系统（可配置）
- **视频处理：** FFmpeg子进程、OpenCV
- **语音合成：** 火山引擎TTS
- **大模型：** 多供应商支持（OpenAI兼容API，支持通义千问、Claude、GPT等）

## 项目结构

```
Ecliptrix/
├── src/                              # Next.js 前端
│   ├── app/                          # App Router + API代理路由
│   ├── components/                   # 按功能组织的React组件
│   │   ├── video/                    # 视频编辑（30+组件）
│   │   ├── workflow/                 # 节点式工作流构建器
│   │   ├── chat/                     # 对话界面
│   │   └── ui/                       # 共享UI组件
│   ├── contexts/                     # Auth、Notification、Locale
│   ├── hooks/                        # useTasks、useMobileDetection
│   ├── lib/api/                      # 后端API服务客户端
│   └── types/                        # TypeScript类型定义
├── backend-services/basic-service/   # FastAPI 后端
│   ├── app/
│   │   ├── main.py                   # 应用入口：22个路由、中间件
│   │   ├── config.py                 # Pydantic Settings + YAML覆盖
│   │   ├── database.py               # 异步SQLAlchemy引擎
│   │   ├── models/                   # Pydantic + ORM模型
│   │   ├── routers/                  # 22个API路由模块
│   │   └── services/                 # 38个服务模块
│   ├── config/                       # YAML配置（TTS、上传、YouTube等）
│   ├── alembic/                      # 数据库迁移
│   └── tests/                        # Pytest测试套件
├── install.sh                        # 一键安装脚本
├── start.sh                          # 服务启动脚本
├── kill.sh                           # 终止所有服务进程
└── env.template                      # 前端环境变量模板
```

## 配置说明

### 前端 `.env.local`

```bash
# LLM API（必需）
LLM_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=your_key_here
LLM_MODEL=qwen3-next-80b-a3b-instruct

# 后端连接
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_API_URL=http://localhost:3000

# 应用设置
NEXT_PUBLIC_APP_NAME=Ecliptrix
NEXT_PUBLIC_AI_MATERIAL_SERVICE=local
```

### 后端 `.env`

```bash
# LLM API（通用、视频剪辑、视觉语言）
LLM_API_KEY=your_key_here
VIDEO_CUT_LLM_API_KEY=your_key_here
VL_LLM_API_KEY=your_key_here

# 数据库
DATABASE_URL=postgresql+asyncpg://ecliptrix:ecliptrix@localhost:5432/ecliptrix

# 认证
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin

# 外部API（可选）
PEXELS_API_KEY=your_key_here
VOLCANO_TTS_APPID=your_appid
```

完整配置项请参考 `env.template`（前端）和 `backend-services/basic-service/env.template`（后端）。

### 多LLM策略

后端支持三个独立的LLM配置：

| 配置 | 用途 | 默认模型 |
|------|------|----------|
| `LLM_*` | 对话、工作流、意图识别 | qwen3-next-80b |
| `VIDEO_CUT_LLM_*` | AI混剪编辑 | claude-sonnet-4 |
| `VL_LLM_*` | 视频帧分析 | qwen-vl-plus |

所有端点使用OpenAI兼容API格式。

## 常用命令

### 前端

```bash
npm run dev          # 开发服务器
npm run build        # 生产构建
npm start            # 生产服务器
npm run lint         # ESLint检查
npm run type-check   # TypeScript类型检查
```

### 后端

```bash
# 在 backend-services/basic-service/ 目录下，激活虚拟环境后
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000   # 开发服务器
pytest tests/ -v                                             # 运行测试
pytest tests/ --cov=app --cov-report=html                    # 测试覆盖率
alembic upgrade head                                         # 运行数据库迁移
```

## 贡献

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 开启 Pull Request

## 许可证

本项目基于 ISC 许可证授权。

---

**Ecliptrix / 灵蚀创影** — 通过光影交汇将想法转化为现实。
