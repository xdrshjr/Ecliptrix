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

## Priority Directories
- src/components/video/
- src/components/video/workbench/
- src/components/video/components/SegmentCard/
- src/components/video/components/SegmentDialogs/
- src/components/video/cover/
- src/components/video/timeline/
- src/components/video/playback/
- src/components/chat/
- src/components/settings/
- src/lib/api/
- src/lib/video-editing-agent/
- src/app/api/
- src/contexts/
- src/types/
- src/stores/
- backend-services/basic-service/app/routers/
- backend-services/basic-service/app/services/
- backend-services/basic-service/app/models/
- desktop/main/

## Tech Stack
- Frontend: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 3
- Backend: FastAPI, Python 3.10+, async SQLAlchemy + aiosqlite
- Desktop: Electron (electron-builder), Node child processes for backend + Next standalone + agent browser host
- Database: SQLite (aiosqlite); schema via `create_all`, no migrations; SQLite in-memory for tests
- UI: shadcn/ui (new-york style)
- State: React Context API + Zustand stores
- Testing: Vitest (frontend, 465 test files), pytest (backend, 156 test files), packaged-app smoke test
- Deployment: desktop only — electron-builder installer; no server deployment path

## Index Settings
- Generated: 2026-10-27
- Project Root: M:/takoAI/Ecliptrix
- Index Version: 3.0
- Environments Configured: No

> Regeneration notes (2026-10-27): the index was refreshed end-to-end against
> disk. Counts now recorded in `index.md`: 118 Next.js API routes, 36 backend
> router modules behind 37 `include_router` calls, 18 ORM tables, 465 frontend
> test files, 156 backend test files. New areas added to the feature map:
> `workbench/`, `components/SegmentCard/`, `components/SegmentDialogs/`,
> `cover/`, the agent vision / toolkit / web-research tool families, the
> `agent_toolkit` / `agent_vision` / `web_research` backend packages, and the
> Electron browser host.

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
> = 80. JavaScript is ~2% of source files (below the 10% threshold), so it does
> not contribute to the merge.

## CLAUDE.md Budget
- Measured: 18669 chars / 18787 bytes / 254 lines / 6 units (2026-10-27)
- Tier: lean (<= 40000)
- Compaction: Enabled (not needed at this tier — no unit was compacted)
