# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ecliptrix is an AI-powered content creation platform combining video editing, voice synthesis, material management and AI generation. It ships as a **single-user Electron desktop app**: the main process launches a local FastAPI backend (SQLite) and a Next.js standalone server, both bound to `127.0.0.1`, and the renderer loads the local page. There is no server deployment, no multi-tenancy and no login — `npm run dev` in a browser exists only as a debugging path for the same product.

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
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000  # Dev server on :8000
python run.py                                                # Alternative start
pytest tests/ -v                                             # Run tests
pytest tests/test_specific.py -v                             # Single test file
pytest tests/ --cov=app --cov-report=html                    # Coverage report
```

There are no migration commands: the schema is created by `create_all` at
startup (see **Database** below).

### Desktop (from `desktop/`)

```bash
npm run dev        # Electron + backend + Next dev server, all wired together
npm run build      # Package the installer (prepare-env → prepare-frontend →
                   # prepare-backend → electron-builder)
npm run build:dir  # Unpacked build, for the smoke test
node scripts/smoke-test.js      # End-to-end gate on the packaged app
node main/window-state.test.js  # Main-process unit tests
```

### System Dependencies

- **Node.js** 18+ and **npm** for the frontend
- **Python** 3.10+ for the backend
- **FFmpeg** (required for video composition, cutting, watermark removal, and audio processing)

## Architecture

### Frontend + Backend Stack

- **Frontend** (Next.js 15, App Router): `src/` — TypeScript + React 19 + Tailwind CSS 3
- **Backend** (FastAPI): `backend-services/basic-service/` — Python async with SQLAlchemy, port 8000

The frontend has 70+ Next.js API routes in `src/app/api/` that follow **two patterns**:
1. **Backend proxy** (most routes): Read `process.env.BACKEND_URL` and forward requests to the FastAPI backend. Example: `video-search/route.ts` proxies to `${BACKEND_URL}/api/video/search`.
2. **Direct LLM call** (chat routes): Read `process.env.LLM_API_URL` and `LLM_API_KEY` to call OpenAI-compatible APIs directly, bypassing the backend. Example: `chat/route.ts`.

`BACKEND_URL` is server-side only (no `NEXT_PUBLIC_` prefix). Most backend routes are mounted under `/api` prefix, except `video_export_router` and `intent_detection_router`, which mount at root.

### Frontend Structure

- **Path alias**: `@/*` maps to `./src/*`
- **State management**: React Context API — `src/contexts/` has NotificationContext, LocaleContext
- **API clients**: `src/lib/api/` — typed service clients (storage, tts, videoComposition, material, llm, etc.), all going through the `http-client` wrapper
- **Components by feature**: `src/components/video/` (30+ components + `timeline/`, `hooks/`, `components/` subdirs), `src/components/chat/`, `src/components/settings/` (the settings centre), `src/components/shell/` (title bar + its action cluster), `src/components/ui/` (shadcn-style)
- **i18n**: Single large translation file at `src/lib/i18n.ts`
- **Shell**: `app/page.tsx` renders title bar + task bar + workspace and opens a video-editing task straight away. Tasks are single-instance per type (at most one AI chat and one video-editing task; `useTasks.openTask` switches to / reopens the existing one, and legacy multi-task state is collapsed on load by `hooks/taskSingleton.ts`). `Container`'s empty state and the task bar's single "+" menu (`shell/NewTaskMenu`) are the ONLY ways to open a task — do not remove them.
- **Types**: Centralized in `src/types/index.ts`
- **Dark mode**: Class-based (`darkMode: ["class"]` in Tailwind config), colors use CSS variables
- **UI components**: shadcn/ui (style: "new-york", RSC enabled) — see `components.json`
- **Comment language**: Mixed English and Chinese throughout frontend and backend code

### Backend Structure

- **Entry point**: `app/main.py` — registers 31 routers, CORS middleware, exception handlers, static file mounts
- **Configuration**: `app/config.py` — manual `get_settings()` function that reads `.env` via python-dotenv then YAML from `config/`. Note: `llm_api_key` and `llm_api_url` are required with no defaults — app won't start without them.
- **Database**: `app/database.py` — async SQLAlchemy engine with `create_all` plus an idempotent `UPDATE` that claims any pre-refactor rows for `LOCAL_OWNER_ID`. No destructive DDL, ever.
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
| `AGENT_LLM_API_XX_*` | Dynamic numbered configs (01, 02, ...) for the video-editing agent |

### Database

- SQLite with async SQLAlchemy + aiosqlite. There is no PostgreSQL and no Alembic: the desktop app owns its own database file, so the schema is built by `Base.metadata.create_all` on startup and evolved with additive changes only.
- **Never add destructive DDL to startup** (`DROP TABLE` / `DROP COLUMN` / `ALTER … DROP`). Two production incidents came from "self-healing" DDL at boot. Removing a model is done by dropping it from the ORM and leaving the table behind as inert data.
- ORM models in `app/models/db_models.py`. Every business table keeps a `user_id` column, but it is no longer an identity: it always holds `LOCAL_OWNER_ID` (see Auth below).
- Default connection: `sqlite+aiosqlite:///./data/ecliptrix.db`. `app/database.py` rewrites a legacy PostgreSQL DSN to the SQLite path rather than failing, so an old `.env` still boots.
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
- `storyboard-config.yaml` — AI storyboard video generation queue (max_concurrent, 10-min timeout, poll interval). Overridable via `STORYBOARD_VIDEO_MAX_CONCURRENT`, `STORYBOARD_VIDEO_TIMEOUT_SECONDS`, etc. Legacy `STORYBOARD_MAX_CONCURRENT_VIDEO` is honoured for backward compatibility. NOTE: on local timeout, we do NOT call ARK cancel (ARK SDK has no cancel method); the remote task runs to completion on its own and its result is discarded.

### External API Integrations

The backend integrates with numerous external services, each requiring its own API key in `.env`:

| Service | Env Key(s) | Purpose |
|---------|-----------|---------|
| Pexels | `PEXELS_API_KEY` | Video search |
| Unsplash | `UNSPLASH_ACCESS_KEYS` | Image search |
| Tavily | `TAVILY_API_KEYS` | Web search |
| ByteDance ARK | `ARK_API_KEY` | AI video generation + AI image generation (Seedream) |
| Volcano TTS | `VOLCANO_TTS_*` | Text-to-speech (100+ voices) |
| Freesound | `FREESOUND_API_KEY` | Audio search |

YouTube download/upload uses `yt-dlp` (no API key needed for downloads).

### Storage

**Primary**: Local filesystem (replaced Supabase). Root at `STORAGE_ROOT` env var (default: `static/uploads`). Static files served via FastAPI mounts at `/api/storage/files`, `/api/audio/generated`, `/api/audio/subtitles`, `/static/timeline_exports`. Directory structure created by the Electron main process (`initUserData()`) on first launch: `static/uploads/{video,audio,images,files}`, `static/video/{composed,thumbnails}`, `static/audio/{generated,subtitles}`, `static/timeline_exports`, `temp/`, `logs/`. As a self-contained local desktop app, all material uploads and generated artifacts are saved local-only — there is no "upload to server" / cloud-object-storage step.

**Cached remote materials** (`cached_materials/<source>/<file>`): Remote video assets (Pexels, ARK, etc.) are pre-downloaded into `STORAGE_ROOT/cached_materials/<source>/<source_id>.<ext>` and tracked in the `cached_materials` table. They're served via the existing `/api/storage/files` mount — no separate static mount.

The frontend reads `local_url` from `/api/material/{ingest,lookup}` responses; the rule is `"/api/storage/files/cached_materials/" + source + "/" + basename(local_path)`. Preview/scrub paths use `selectPlaybackUrl(material, { purpose: 'preview' })` to swap to the cacheUrl when available. Desktop export paths use `selectPlaybackUrl(material, { purpose: 'export' })` to prefer backend-resolvable same-origin local storage/cache references, falling back to `serverUrl || url` only for legacy remote materials. Preview-only blob URLs, media-proxy URLs, and preview-proxy URLs must not be embedded in composition requests.

`MATERIAL_DOWNLOAD_MAX_CONCURRENT` (default 4) caps the background download semaphore. ARK / Storyboard generated videos write back via `material_svc.store_external_download_async(..., source='ark', source_id=<task_id>)` so the editor can preview them via the same-origin path immediately.

## Key Conventions

- **ESLint**: `prefer-const: error`, `no-explicit-any: warn`, `exhaustive-deps: warn`. ESLint errors are ignored during production builds (`next.config.js`).
- **Backend error responses**: All exceptions return `ErrorResponse` model with `success`, `message`, `error_code`, `error_details` fields. Base response shape: `BaseResponse` with `success`, `message`, `timestamp`, `data`.
- **Async everywhere**: Backend uses `async/await` throughout — async DB sessions via `get_db_session()` dependency, async HTTP clients (httpx), async file I/O (aiofiles).
- **Git commit style**: Messages prefixed with `[add]`, `[modify]`, `[update]`, `[refactor]`, `[fix]`.
- **Environment files**: Frontend uses `.env.local`, backend uses `.env` in its own directory. Templates are `env.template` in each location.
- **No auth**: there is no user system, login, session or RBAC. The backend binds to `127.0.0.1` and has exactly one owner, represented by the compile-time constants `LOCAL_OWNER_ID` / `LOCAL_OWNER_NAME` in `app/constants.py`, mirrored in `src/lib/localOwner.ts` (the two `LOCAL_OWNER_ID` values MUST stay identical). Routes take no auth dependency; `http-client` injects no credentials; the proxy in `src/lib/api/server/backend-proxy.ts` forwards none. `RateLimitError` / HTTP 429 handling IS still live — `media_proxy_service` keeps its own per-IP download throttle — so do not remove it while removing "auth-looking" code.
- **Stage precisely**: `.gitignore` covers the usual build output, but `__pycache__/`, `*.pyc`, `tsconfig.tsbuildinfo`, `.next/` and `.idea/` still surface as modified from time to time. Prefer `git add <path>` over `git add -A`, and check `git status --porcelain` before committing.
- **Preview flags**: the playback-v2 flag is gone — the multi-track canvas compositor is the SOLE preview path. What remains in `@/lib/playbackFlags` are two independent, default-ON flags gating the preview-proxy and local-download optimizations for remote material. Spec: `docs/plans/local-video-editing-refactor/`.

## Project Index

This project has a pre-generated index for quick codebase understanding.

- **Location:** `.claude-index/index.md`
- **Last Updated:** 2026-09-01
- **Contents:** Project overview, feature map, file index, exported symbols, module dependencies

**Usage:** Read `.claude-index/index.md` to quickly understand the project structure before making changes. The index provides a navigation map of the codebase without needing to explore every file.

**Regenerate:** Say "regenerate index" or "更新索引" to update the index after major changes.

## Clean Code Guidelines

<!-- project-indexer:cleancode:begin v1.2.0 -->
Google-style limits for **TypeScript, Python**. These are review gates, not lint config — exceed one only with a comment saying why.

**Size**
- File ≤ 1000 lines; method/function ≤ 60 lines; line ≤ 80 chars.
- Parameters ≤ 5 — past that, take an options object / dataclass.
- Cyclomatic complexity ≤ 10; nesting ≤ 4 — return early instead of indenting.

**Naming**
- Intention-revealing and searchable; no abbreviations, no type prefixes.
- Functions are verb phrases; booleans read as predicates (`isReady`, `has_frames`).
- One concept, one name across the repo — don't alias the same idea two ways.

**Structure**
- One responsibility per unit; extract when a function needs a section comment.
- No duplicated logic — the third copy becomes a helper.
- Comments explain *why*; delete commented-out code, git remembers it.

**Errors**
- Never swallow an exception: log with context or re-raise.
- Fail fast on invalid input; no silent fallback that hides a bug.
- No secrets, tokens or API keys in logs, messages or fixtures.

**Tests**
- Every bug fix ships with a regression test named for the behaviour it pins.
- One assertion topic per test; never sleep for synchronisation.

**Review checklist** — before calling work done: limits above respected; names honest; errors handled and logged; tests added *and actually run*; no stray debug output, TODOs or dead code; public API changes documented.

**Language notes**
- TypeScript: prefer `interface` for public API shapes; `unknown` over `any`; keep bindings `const` (`prefer-const` is an error in this repo's ESLint config).
- Python: type-hint every public signature; keep `async`/`await` end-to-end; no import cycles between `routers/`, `services/` and `models/`.
<!-- project-indexer:cleancode:end -->
