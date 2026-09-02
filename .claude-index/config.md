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
- static/uploads
- desktop/build
- desktop/release
- desktop/cache
- backend-services/basic-service/data

## Priority Directories
- src/components/video/
- src/components/video/timeline/
- src/components/video/playback/
- src/components/chat/
- src/lib/api/
- src/lib/video-editing-agent/
- src/contexts/
- src/types/
- src/stores/
- src/app/api/
- backend-services/basic-service/app/routers/
- backend-services/basic-service/app/services/
- backend-services/basic-service/app/models/
- desktop/main/

## Tech Stack
- Frontend: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 3
- Backend: FastAPI, Python 3.10+, async SQLAlchemy + asyncpg
- Desktop: Electron (electron-builder), Node child processes for backend + Next standalone
- Database: SQLite (aiosqlite); schema via `create_all`, no migrations; SQLite in-memory for tests
- UI: shadcn/ui (new-york style)
- State: React Context API + Zustand stores
- Testing: Vitest (frontend), pytest (backend)
- Deployment: systemd + nginx

## Index Settings
- Generated: 2026-09-01
- Project Root: M:/takoAI/Ecliptrix
- Index Version: 2.1
- Environments Configured: No

## Clean Code Settings
- Enabled: Yes
- Preset: strict
- MAX_FILE_LINES: 1000
- MAX_METHOD_LINES: 60
- MAX_FUNCTION_PARAMS: 5
- MAX_CYCLOMATIC: 10
- MAX_LINE_LENGTH: 80
- MAX_NESTING_DEPTH: 4

> Primary languages detected: TypeScript, Python (JavaScript ~5% — below the 10%
> threshold, so it does not contribute to override merging). `MAX_LINE_LENGTH`
> is the polyglot minimum of TypeScript (100) and Python (80).

## CLAUDE.md Budget
- Measured: 13390 chars (2026-09-01)
- Tier: lean (<= 40000)
- Compaction: Enabled (not needed at this tier — no unit was compacted)
