# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ecliptrix is an AI-powered content creation platform combining video editing, voice synthesis, workflow automation, and creative brainstorming. It's a monorepo with a Next.js 15 frontend and a FastAPI backend service.

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

### System Dependencies

- **Node.js** 18+ and **npm** for the frontend
- **Python** 3.10+ for the backend
- **PostgreSQL** 13+ (required for production; tests use SQLite in-memory)
- **FFmpeg** (required for video composition, cutting, watermark removal, and audio processing)

## Architecture

### Frontend + Backend Stack

- **Frontend** (Next.js 15, App Router): `src/` — TypeScript + React 19 + Tailwind CSS 3
- **Backend** (FastAPI): `backend-services/basic-service/` — Python async with SQLAlchemy, port 8000

The frontend has 70+ Next.js API routes in `src/app/api/` that follow **two patterns**:
1. **Backend proxy** (most routes): Read `process.env.BACKEND_URL` and forward requests to the FastAPI backend. Example: `video-search/route.ts` proxies to `${BACKEND_URL}/api/video/search`.
2. **Direct LLM call** (chat routes): Read `process.env.LLM_API_URL` and `LLM_API_KEY` to call OpenAI-compatible APIs directly, bypassing the backend. Example: `chat/route.ts`.

`BACKEND_URL` is server-side only (no `NEXT_PUBLIC_` prefix). Most backend routes are mounted under `/api` prefix, except `ai_video_generate_router`, `video_export_router`, and `intent_detection_router` which mount at root.

### Frontend Structure

- **Path alias**: `@/*` maps to `./src/*`
- **State management**: React Context API — `src/contexts/` has AuthContext, NotificationContext, LocaleContext
- **API clients**: `src/lib/api/` — typed service clients (storage, tts, videoComposition, workflow, llm, etc.)
- **Components by feature**: `src/components/video/` (30+ components + `timeline/`, `hooks/`, `components/` subdirs), `src/components/workflow/` (node-based visual builder), `src/components/chat/`, `src/components/ui/` (shadcn-style)
- **i18n**: Single large translation file at `src/lib/i18n.ts`
- **Auth tokens**: Stored in localStorage as `ecliptrix-user` and `ecliptrix-session-token`; session validated on load and every 5 minutes
- **Types**: Centralized in `src/types/index.ts`
- **Dark mode**: Class-based (`darkMode: ["class"]` in Tailwind config), colors use CSS variables
- **UI components**: shadcn/ui (style: "new-york", RSC enabled) — see `components.json`
- **Comment language**: Mixed English and Chinese throughout frontend and backend code

### Backend Structure

- **Entry point**: `app/main.py` — registers 23 routers, CORS middleware, exception handlers, static file mounts
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
- **API docs**: Available at `http://localhost:8000/docs` (Swagger) and `/redoc` when backend is running

### Service Configuration

Complex services load YAML configs from `backend-services/basic-service/config/`:
- `batch_tts_config.yaml` — TTS batching/concurrency
- `youtube.yaml` — Download/upload settings
- `video-analysis-config.yaml` — Analysis queue management
- `upload-config.yaml` — File upload limits
- `watermark_removal_config.yaml` — Watermark removal
- `video-download.yaml` — Video download settings

### External API Integrations

The backend integrates with numerous external services, each requiring its own API key in `.env`:

| Service | Env Key(s) | Purpose |
|---------|-----------|---------|
| Pexels | `PEXELS_API_KEY` | Video search |
| Unsplash | `UNSPLASH_ACCESS_KEYS` | Image search |
| Tavily | `TAVILY_API_KEYS` | Web search |
| ByteDance ARK | `ARK_API_KEY` | AI video generation + AI image generation (Seedream) |
| Volcano TTS | `VOLCANO_TTS_*` | Text-to-speech (100+ voices) |
| Alibaba Cloud OSS | `OSS_*` | Optional cloud storage (enabled via `OSS_ENABLED=true`) |
| Freesound | `FREESOUND_API_KEY` | Audio search |

YouTube download/upload uses `yt-dlp` (no API key needed for downloads).

### Storage

**Primary**: Local filesystem (replaced Supabase). Root at `STORAGE_ROOT` env var (default: `static/uploads`). Static files served via FastAPI mounts at `/api/storage/files`, `/api/audio/generated`, `/api/audio/subtitles`, `/static/timeline_exports`. Directory structure created by `install.sh`: `static/uploads/{video,audio,images,files}`, `static/video/{composed,thumbnails}`, `static/audio/{generated,subtitles}`, `static/timeline_exports`, `temp/`, `logs/`.

**Optional**: Alibaba Cloud OSS as secondary/CDN storage when `OSS_ENABLED=true`.

## Key Conventions

- **ESLint**: `prefer-const: error`, `no-explicit-any: warn`, `exhaustive-deps: warn`. ESLint errors are ignored during production builds (`next.config.js`).
- **Backend error responses**: All exceptions return `ErrorResponse` model with `success`, `message`, `error_code`, `error_details` fields. Base response shape: `BaseResponse` with `success`, `message`, `timestamp`, `data`.
- **Async everywhere**: Backend uses `async/await` throughout — async DB sessions via `get_db_session()` dependency, async HTTP clients (httpx), async file I/O (aiofiles).
- **Git commit style**: Messages prefixed with `[add]`, `[modify]`, `[update]`, `[refactor]`, `[fix]`.
- **Environment files**: Frontend uses `.env.local`, backend uses `.env` in its own directory. Templates are `env.template` in each location.
- **Auth**: bcrypt password hashing, session token stored in `User.active_session_token` column (single-device login enforcement), no JWT expiry — token validated by DB lookup.
- **Gitignore is minimal**: The `.gitignore` only covers `/node_modules/`, `static/uploads/`, `venv/`, and `backend-services/basic-service/data/`. Notably missing: `__pycache__/`, `*.pyc`, `.next/`, `.idea/`, `.env*`. When staging files, be careful not to include `__pycache__/`, `.pyc` files, `tsconfig.tsbuildinfo`, `.next/`, or `.idea/` — they frequently show up as modified.

## Project Index

This project has a pre-generated index for quick codebase understanding.

- **Location:** `.claude-index/index.md`
- **Last Updated:** 2026-03-20
- **Contents:** Project overview, feature map, file index, exported symbols, module dependencies

**Usage:** Read `.claude-index/index.md` to quickly understand the project structure before making changes. The index provides a navigation map of the codebase without needing to explore every file.

**Regenerate:** Say "regenerate index" or "更新索引" to update the index after major changes.
