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
npm run build      # Package the installer (prepare-frontend → prepare-backend →
                   # prepare-ffmpeg → prepare-env → electron-builder)
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
- **First-run setup wizard**: on every launch `useSetupStatus` reads `GET /api/config/capability-status` (backend `setup_status_service`, secret-free; core = chat/fast/video_cut/vision, extended = research/web_search) and `page.tsx` opens `components/Onboarding/SetupWizard` when a core capability — or an extended one the user did not opt out of — has no usable config. The wizard writes through the SAME endpoints as the settings panel (`lib/api/modelSettings.ts`) and every write path calls `notifySetupConfigUpdated()` (event `ecliptrix-llm-config-updated`); settings → General re-runs it in manual mode. Never fill a slot that is already `ready` (auto mode).
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

**Primary**: Local filesystem (replaced Supabase). Root at `STORAGE_ROOT` env var (default: `static/uploads`). Static files served via FastAPI mounts at `/api/storage/files`, `/api/audio/generated`, `/api/audio/subtitles`, `/static/timeline_exports`. Directory structure created by the Electron main process (`initUserData()` in `desktop/main/config.js`) on first launch: `data/` (SQLite), `storage/` (injected to the backend as `STORAGE_ROOT`), `logs/`, plus `desktop-config.json` and a first-run `.env` copied from the bundled template. The backend creates its own subdirectories at startup: uploads/cache/preview-proxy dirs under `STORAGE_ROOT`, and `static/audio/{generated,subtitles}` + `static/timeline_exports` relative to its cwd (which the launcher sets to the userData dir), so those also live under userData rather than in the install directory. As a self-contained local desktop app, all material uploads and generated artifacts are saved local-only — there is no "upload to server" / cloud-object-storage step.

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
- **Last Updated:** 2026-10-27
- **Contents:** Project overview, feature map, file index, exported symbols, module dependencies
- **Machine-readable graph:** `.claude-index/graph.json` — modules, components and relations, rendered as an interactive architecture view

**Usage:** Read `.claude-index/index.md` to quickly understand the project structure before making changes. The index provides a navigation map of the codebase without needing to explore every file.

**Regenerate:** Say "regenerate index" or "更新索引" to update the index after major changes.

## Clean Code Guidelines

<!-- project-indexer:cleancode:begin v1.2.0 -->
> Maintained by `project-indexer` from `.claude-index/config.md` (preset `strict`, intersected with this repo's primary languages). Google-style thresholds, not lint config — exceed one only with a comment saying why. Do not hand-edit between the markers: say "regenerate index" to refresh.

### 1. Overview

Read this before writing or changing any code in this repo. The rules exist so that code written by humans and code written by agents sits on the same measurable floor: no thousand-line files, no hundred-line methods, no swallowed errors, no missing tests. Every threshold below can be changed — but only by editing `.claude-index/config.md` and saying so in review, never by quietly ignoring the number.

### 2. File and function size

- Files ≤ **800** lines. Past that, split by responsibility into a new module.
- Functions / methods ≤ **50** lines. If it feels like it is growing, extract.
- Parameters ≤ **5** — beyond that take an options object, a dataclass, or a named struct. Never stack positional arguments.
- Cyclomatic complexity ≤ **10** — extract a function or introduce a lookup table.
- Lines ≤ **80** columns. Judgement is simple: over the threshold is debt; fix it before committing.

### 3. Naming

- Functions start with a verb (`loadConfig`, `parseToken`); queries may be nouns or `get`/`find`.
- Booleans and predicates start with `is`, `has`, `should`, `can`.
- Constants in UPPER_SNAKE, classes and interfaces in PascalCase, variables in camelCase (TS) or snake_case (Python) — consistently.
- Do not abbreviate domain words; five more letters is cheaper than a reader's guess.
- Ban contentless names: `data`, `info`, `temp`, `obj`. Use the domain noun.

### 4. Comments and docs

- Comments explain *why*, not *what* — the code is the truth about what.
- Every public API gets a docstring/JSDoc: parameters, return value, thrown errors.
- Delete commented-out code and zombie comments; git remembers it. A surviving `TODO` carries an owner and a date.
- Line-level comments are precious — do not stack one per line.
- Business rules, past incidents and workarounds must state the reason and the condition under which they can be reverted.

### 5. Error handling

- Propagate errors explicitly. Never swallow an exception or return `null` as if nothing happened.
- Validate external input once, at the boundary; trust internal data afterwards — no repeated re-validation.
- Do not write defensive `try/except` for branches that "cannot happen"; that is noise.
- Error messages must carry location clues: where, which inputs, what the caller should do.
- At IO, network and subprocess boundaries use a structured wrapper with timeout and retry, not a bare call.
- Keep catch scopes narrow; handle only the error kinds you can actually act on.
- Exposed error codes and exception classes are API — renaming one is a breaking change and belongs in the changelog.

### 6. Complexity and nesting

- Nesting ≤ **4** levels; deep nesting is the precursor of a long function.
- Prefer guard clauses over `else` ladders.
- More than three boolean conditions in one expression → extract a well-named helper.
- Complex branching inside a loop usually wants a lookup table or a strategy object.
- One function, one job. If describing its responsibility needs "and", "also" or "then", split it.

### 7. Tests

- Fixing a bug starts with a test that reproduces it, then the fix.
- Public behaviour needs a normal-path test and at least one failure-path test.
- Test names describe the behaviour, not the implementation (`rejects_expired_token`).
- Do not mock high-risk paths (schema creation, FFmpeg invocation, the timeline aggregate) — use real integration tests.
- Tests must be fast and repeatable; isolate external dependencies, never depend on shared environment state.
- Every regression found gets its own test, so the old pit becomes a permanent guardrail.

### 8. Review checklist

Before calling work done, all 8 must hold:

1. Names are self-explanatory and free of meaningless abbreviations.
2. File, method, parameter, nesting and complexity thresholds are all respected.
3. Errors propagate explicitly; boundary validation is in place.
4. Comments explain only *why*; no dead code, no orphan TODOs.
5. Tests cover normal and failure paths and pin any bug that was fixed.
6. New dependencies are necessary and carry no security/licence risk.
7. No secrets, personal data or internal links leaked into code, logs or fixtures.
8. Consistent with the existing architecture and naming — no new island.

### 9. Language notes

Primary languages: **TypeScript, Python**.

- TypeScript: Prefer `interface` over `type` for public APIs.
- Python: PEP 8 + Google docstrings.
- Project TypeScript: use `unknown` over `any` (ESLint warns); keep bindings `const` — `prefer-const` is an *error* here; `exhaustive-deps` is a warning, so honour it rather than silence it.
- Project Python: type-hint every public signature; keep `async`/`await` end-to-end (`get_db_session`, httpx, aiofiles); no import cycles between `routers/`, `services/` and `models/`.
- Cross-language: the camera-motion math in `src/components/video/playback/camera/` and `app/services/composition/camera_motion.py` is mirrored 1:1 — change both, and keep the golden vectors passing.

### 10. Meta

Template and marker version match. Say "regenerate index" or "更新索引" to rebuild this section; say "disable cleancode" to drop it.
<!-- project-indexer:cleancode:end -->
