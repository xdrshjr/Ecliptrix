# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ecliptrix is an AI-powered content creation platform combining video editing, voice synthesis, workflow automation, and creative brainstorming. It's a monorepo with a Next.js 15 frontend and two Python backend services.

## Commands

### Frontend (from repo root)

```bash
npm run dev          # Dev server on :3000
npm run build        # Production build (ESLint errors ignored)
npm start            # Production server
npm run lint         # ESLint
npm run type-check   # TypeScript check (tsc --noEmit)
```

### Backend (from `backend-services/basic-service/` with venv activated)

```bash
# On Windows: source venv/Scripts/activate
# On Linux/Mac: source venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000   # Dev server on :8000
python run.py                                                # Alternative start (used by start.sh)
pytest tests/ -v                                             # Run tests
pytest tests/test_specific.py -v                             # Single test file
pytest tests/ --cov=app --cov-report=html                    # Coverage report
alembic upgrade head                                         # Run DB migrations
alembic downgrade -1                                         # Roll back one migration
```

### Lifecycle Scripts

```bash
bash install.sh [--skip-db] [--skip-frontend] [--skip-backend] [--cn-mirror]
bash start.sh [PORT] [--dev]   # Starts DB + backend(:8000) + frontend(:3010)
bash kill.sh           # Kills processes on ports 8000, 3000, 3001, 3008, 3010
```

## Architecture

### Two-Service Stack

- **Frontend** (Next.js 15, App Router): `src/` — TypeScript + React 19 + Tailwind CSS 3
- **Backend** (FastAPI): `backend-services/basic-service/` — Python async with SQLAlchemy, port 8000

The frontend proxies API calls through Next.js API routes (`src/app/api/`) to the backend. The backend URL is read from `process.env.BACKEND_URL` (server-side only, no `NEXT_PUBLIC_` prefix). Most backend routes are mounted under `/api` prefix, except `flux_router`, `ai_video_generate_router`, `video_export_router`, and `intent_detection_router` which mount at root.

### Frontend Structure

- **Path alias**: `@/*` maps to `./src/*`
- **State management**: React Context API — `src/contexts/` has AuthContext, NotificationContext, LocaleContext
- **API clients**: `src/lib/api/` — typed service clients (storage, tts, videoComposition, workflow, llm, etc.)
- **Components by feature**: `src/components/video/` (30+ components + `timeline/`, `hooks/`, `components/` subdirs), `src/components/workflow/` (node-based visual builder), `src/components/chat/`, `src/components/ui/` (shadcn-style)
- **i18n**: Single large translation file at `src/lib/i18n.ts`
- **Auth tokens**: Stored in localStorage as `ecliptrix-user` and `ecliptrix-session-token`; session validated on load and every 5 minutes
- **Types**: Centralized in `src/types/index.ts`
- **Dark mode**: Class-based (`darkMode: ["class"]` in Tailwind config), colors use CSS variables
- **Comment language**: Mixed English and Chinese throughout frontend code

### Backend Structure

- **Entry point**: `app/main.py` — registers 22 routers, CORS middleware, exception handlers, static file mounts
- **Configuration**: `app/config.py` — manual `get_settings()` function that reads `.env` via python-dotenv then YAML from `config/`. Note: `llm_api_key` and `llm_api_url` are required with no defaults — app won't start without them.
- **Database**: `app/database.py` — async SQLAlchemy engine (pool_size=10, max_overflow=20) with auto-create tables and admin user seeding on startup
- **Pattern**: Router → Service → (LLM/DB/External API). Each feature has a router in `app/routers/`, a service in `app/services/`, and models in `app/models/`
- **Queue system**: `QueueManager` provides async semaphore-based concurrency limiting; `@with_simple_queue` decorator for simpler cases

### Multi-LLM Configuration

The backend uses multiple independent LLM configurations, all using OpenAI-compatible API format:

| Env prefix | Purpose |
|------------|---------|
| `LLM_*` | General chat, workflow, intent detection |
| `FAST_LLM_*` | Quick operations (translation, search queries) |
| `VIDEO_CUT_LLM_*` | AI mixed editing |
| `VL_LLM_*` | Video frame analysis (vision-language) |
| `AGENT_LLM_API_XX_*` | Dynamic numbered configs (01, 02, ...) for workflow node builder |

### Database

- PostgreSQL 13+ with async SQLAlchemy + asyncpg
- Migrations via Alembic (`backend-services/basic-service/alembic/`)
- ORM models in `app/models/db_models.py` — `User` (UUID PK, session fields for single-device login), `AgentWorkflow` (JSON workflow_data)
- Default connection: `postgresql+asyncpg://ecliptrix:ecliptrix@localhost:5432/ecliptrix`
- **Tests use SQLite in-memory** (`sqlite+aiosqlite:///:memory:`), not PostgreSQL

### Service Configuration

Complex services load YAML configs from `backend-services/basic-service/config/`:
- `batch_tts_config.yaml` — TTS batching/concurrency
- `youtube.yaml` — Download/upload settings
- `video-analysis-config.yaml` — Analysis queue management
- `upload-config.yaml` — File upload limits
- `watermark_removal_config.yaml` — Watermark removal
- `video-download.yaml` — Video download settings

### Storage

Local filesystem storage (replaced Supabase). Root at `STORAGE_ROOT` env var (default: `static/uploads`). Static files served via FastAPI mounts at `/api/storage/files`, `/api/audio/generated`, `/api/audio/subtitles`, `/static/timeline_exports`. Directory structure created by `install.sh`: `static/uploads/{video,audio,images,files}`, `static/video/{composed,thumbnails}`, `static/audio/{generated,subtitles}`, `static/timeline_exports`, `temp/`, `logs/`.

## Key Conventions

- **ESLint**: `prefer-const: error`, `no-explicit-any: warn`, `exhaustive-deps: warn`. ESLint errors are ignored during production builds (`next.config.js`).
- **Backend error responses**: All exceptions return `ErrorResponse` model with `success`, `message`, `error_code`, `error_details` fields. Base response shape: `BaseResponse` with `success`, `message`, `timestamp`, `data`.
- **Async everywhere**: Backend uses `async/await` throughout — async DB sessions via `get_db_session()` dependency, async HTTP clients (httpx), async file I/O (aiofiles).
- **Git commit style**: Messages prefixed with `[add]`, `[modify]`, `[update]`, `[refactor]`, `[fix]`.
- **Environment files**: Frontend uses `.env.local`, backend uses `.env` in its own directory. Templates are `env.template` in each location.
- **Auth**: bcrypt password hashing, session token stored in `User.active_session_token` column (single-device login enforcement), no JWT expiry — token validated by DB lookup.
