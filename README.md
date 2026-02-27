<div align="center">
  <img src="public/logo-ai.png" alt="Ecliptrix Logo" width="200" />
</div>

# Ecliptrix

**Where light and shadow collide**

[中文文档](README.zh-CN.md)

An AI-powered content creation platform combining video editing, voice synthesis, workflow automation, and creative brainstorming — built with Next.js 15 and FastAPI.

## Features

- **AI Video Editing** — Automatic video search, mixing, cutting, and composition with subtitle overlay
- **Voice Synthesis** — Volcano TTS integration with 100+ voice types and batch processing
- **Workflow Builder** — Visual node-based editor with 10+ node types (ChatLLM, Pexels, TTS, etc.)
- **Video Analysis** — Vision-Language model powered frame-by-frame video understanding
- **Content Chat** — Multi-turn AI chat with streaming responses
- **Image Generation** — FLUX-based image generation via RunningHub
- **Multi-tab Interface** — Work on chat, video, workflow, and brainstorming simultaneously
- **YouTube Integration** — Download and process YouTube videos with yt-dlp

## Quick Start

### Prerequisites

| Tool | Version | Required |
|------|---------|----------|
| Node.js | 18+ | Yes |
| Python | 3.10+ | Yes |
| PostgreSQL | 13+ | Yes |
| FFmpeg | 4+ | For video features |

### One-Click Install

```bash
git clone https://github.com/xdrshjr/Ecliptrix.git
cd Ecliptrix
bash install.sh
```

The install script handles everything: dependency installation, Python virtual environment, environment file creation, PostgreSQL database setup, Alembic migrations, and directory creation.

**Options:**

```bash
bash install.sh --cn-mirror      # Use Chinese mirror sources (npm + pip)
bash install.sh --skip-db        # Skip PostgreSQL auto-setup
bash install.sh --skip-frontend  # Skip npm install
bash install.sh --skip-backend   # Skip Python venv + pip install
bash install.sh --help           # Show all options
```

### Manual Install

<details>
<summary>Click to expand manual steps</summary>

**1. Frontend**

```bash
npm install
cp env.template .env.local
# Edit .env.local with your API keys
```

**2. Backend**

```bash
cd backend-services/basic-service
python3 -m venv venv
source venv/bin/activate        # Windows: source venv/Scripts/activate
pip install -r requirements.txt
cp env.template .env
# Edit .env with your API keys
```

**3. Database**

```sql
-- Connect as postgres superuser
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

### Start Services

```bash
# Terminal 1 — Backend
cd backend-services/basic-service
source venv/bin/activate        # Windows: source venv/Scripts/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Terminal 2 — Frontend
npm run dev
```

Or use the startup script:

```bash
bash start.sh
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| API Docs | http://localhost:8000/docs |

**Default login:** `admin` / `admin`

## Tech Stack

### Frontend

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript 5
- **Styling:** Tailwind CSS 3
- **State:** React hooks + Context (Auth, Locale, Notifications)

### Backend

- **Framework:** FastAPI 0.104
- **Database:** PostgreSQL + SQLAlchemy (async) + Alembic
- **Auth:** Local auth with bcrypt + JWT
- **Storage:** Local filesystem (configurable)
- **Video:** FFmpeg subprocess, OpenCV
- **TTS:** Volcano Engine TTS
- **LLM:** Multi-provider (OpenAI-compatible API, supports Qwen, Claude, GPT, etc.)

## Project Structure

```
Ecliptrix/
├── src/                              # Next.js frontend
│   ├── app/                          # App Router + API proxy routes
│   ├── components/                   # Feature-organized React components
│   │   ├── video/                    # Video editing (30+ components)
│   │   ├── workflow/                 # Node-based workflow builder
│   │   ├── chat/                     # Chat interface
│   │   └── ui/                       # Shared UI components
│   ├── contexts/                     # Auth, Notification, Locale
│   ├── hooks/                        # useTasks, useMobileDetection
│   ├── lib/api/                      # Backend API service clients
│   └── types/                        # TypeScript type definitions
├── backend-services/basic-service/   # FastAPI backend
│   ├── app/
│   │   ├── main.py                   # App entry: 22 routers, middleware
│   │   ├── config.py                 # Pydantic Settings + YAML overrides
│   │   ├── database.py               # Async SQLAlchemy engine
│   │   ├── models/                   # Pydantic + ORM models
│   │   ├── routers/                  # 22 API route modules
│   │   └── services/                 # 38 service modules
│   ├── config/                       # YAML configs (TTS, upload, youtube, etc.)
│   ├── alembic/                      # Database migrations
│   └── tests/                        # Pytest suite
├── install.sh                        # One-click installation script
├── start.sh                          # Service startup script
├── kill.sh                           # Kill all service processes
└── env.template                      # Frontend environment template
```

## Configuration

### Frontend `.env.local`

```bash
# LLM API (required)
LLM_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=your_key_here
LLM_MODEL=qwen3-next-80b-a3b-instruct

# Backend connection
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_API_URL=http://localhost:3000

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

# Database
DATABASE_URL=postgresql+asyncpg://ecliptrix:ecliptrix@localhost:5432/ecliptrix

# Auth
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin

# External APIs (optional)
PEXELS_API_KEY=your_key_here
VOLCANO_TTS_APPID=your_appid
```

See `env.template` (frontend) and `backend-services/basic-service/env.template` (backend) for all available options.

### Multi-LLM Strategy

The backend supports three independent LLM configurations:

| Config | Used For | Default Model |
|--------|----------|---------------|
| `LLM_*` | Chat, workflow, intent detection | qwen3-next-80b |
| `VIDEO_CUT_LLM_*` | AI mixed editing | claude-sonnet-4 |
| `VL_LLM_*` | Video frame analysis | qwen-vl-plus |

All endpoints use the OpenAI-compatible API format.

## Commands

### Frontend

```bash
npm run dev          # Development server
npm run build        # Production build
npm start            # Production server
npm run lint         # ESLint
npm run type-check   # TypeScript check
```

### Backend

```bash
# From backend-services/basic-service/ with venv activated
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000   # Dev server
pytest tests/ -v                                             # Run tests
pytest tests/ --cov=app --cov-report=html                    # Coverage
alembic upgrade head                                         # Run migrations
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
