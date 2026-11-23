# Index Configuration

## Excluded Directories
- node_modules
- .git
- dist
- build
- __pycache__
- .venv
- venv
- vendor
- coverage
- .next
- .nuxt
- .cache
- target
- bin
- obj
- .idea
- logs
- temp
- release
- out
- .pytest_cache
- static/uploads
- desktop/build
- desktop/release
- desktop/cache
- backend-services/basic-service/data
- .agentmesh
- .baseline-check
- .bug-diagnosis
- .web-debugger
- .pytest-workspace-import

## Priority Directories
- src/components/video/
- src/components/video/workbench/
- src/components/video/components/SegmentCard/
- src/components/video/components/SegmentDialogs/
- src/components/video/cover/
- src/components/video/timeline/
- src/components/video/playback/
- src/components/skillrouter/
- src/components/chat/
- src/components/settings/
- src/lib/api/
- src/lib/video-editing-agent/
- src/lib/effects/
- src/app/api/
- src/contexts/
- src/types/
- src/stores/
- backend-services/basic-service/app/routers/
- backend-services/basic-service/app/services/
- backend-services/basic-service/app/models/
- effects-runtime/
- desktop/main/

## Tech Stack
- Frontend: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 3
- Backend: FastAPI, Python 3.10+, async SQLAlchemy + aiosqlite
- Desktop: Electron (electron-builder), Node child processes for backend + Next standalone + agent browser host
- Account server: separate Next.js 15 project in `webserver/` (better-sqlite3, opaque tokens, scrypt)
- Effects: Remotion 4.0.544 + React 19.1.1 in `effects-runtime/` (worker bundle)
- Database: SQLite (aiosqlite); schema via `create_all`, no migrations; SQLite in-memory for tests
- UI: shadcn/ui (new-york style)
- State: React Context API + Zustand stores
- Testing: Vitest (frontend, 650 test files under `src/`), pytest (backend, 212 `test_*.py`),
  packaged-app smoke test

## Index Settings
- Generated: 2026-11-22
- Project Root: M:/takoAI/Ecliptrix
- Index Version: 3.1
- Environments Configured: No

> Regeneration notes (2026-11-22): refreshed end-to-end against disk. Counts now
> recorded in `index.md`: **140** Next.js API routes under `src/app/api`, **43**
> backend router modules behind **42** `include_router` calls in `app/main.py`,
> **22** ORM tables across 5 model modules, **650** frontend test files under
> `src/` (plus 28 in `webserver/`), **212** backend `test_*.py`, **15** service
> YAML configs, **84** plan folders under `docs/plans/`.
>
> Areas added or rewritten since the 2026-10-27 build: **SkillRouter capability
> gateway** (frontend `src/components/skillrouter/` + `src/lib/api/skillrouter.ts`,
> backend `app/services/skillrouter/` 17 modules), **Remotion effects studio**
> (`src/lib/effects/`, `effects-runtime/`, `app/services/effects/`), and the
> `agent_host` / `agent_skills` / `gateway` backend subpackages.
>
> Caveat recorded deliberately: the working tree contains a *stale full snapshot*
> of an older checkout at `backend-services/basic-service/data/ark-video-acceptance/
> review-index-20261105/`. It is excluded here, and any scan that reports ~4,700
> source files instead of ~2,600 is reading that copy instead of the tree.

## Clean Code Settings
- Enabled: Yes
- Preset: strict
- MAX_FILE_LINES: 800
- MAX_METHOD_LINES: 50
- MAX_FUNCTION_PARAMS: 5
- MAX_CYCLOMATIC: 10
- MAX_LINE_LENGTH: 80
- MAX_NESTING_DEPTH: 4

> Preset `strict` (1000 / 60 / 5 / 10) intersected with the language-aware
> minimum for the detected primary languages, so the block in `CLAUDE.md` is
> never looser than the language baseline: Python caps files at 800 and methods
> at 50, and the polyglot `MAX_LINE_LENGTH` is `min(TypeScript 100, Python 80)`
> = 80. Language mix at this build: TypeScript 1,987 files (~76%), Python 508
> (~19.5%), JavaScript/ESM 110 (~4%). JavaScript stays below the 10% threshold,
> so it does not contribute to the merge.

## CLAUDE.md Budget
- Measured: 37143 chars / 39556 bytes / 466 lines / 8 top-level units (2026-11-22)
- Tier: lean (<= 40000)
- Compaction: Enabled (not needed at this tier — no unit was compacted)
- Note: the 36,914-char figure in the launch prompt was measured before this run;
  the post-write measurement above is authoritative.
