# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Rules

### Core Constraints
1. Always create a complete modification plan before making any changes
2. Only modify content that requires changes - preserve all unrelated functionality
3. Leave testing, dependency installation, and server execution to the user
4. Never perform Git operations - leave version control to the user
5. Separate styling into dedicated CSS/style files when working with UI components
6. Split files approaching 700 lines; refactor methods exceeding 150 lines
7. Apply Domain-Driven Design (DDD) for backend development
8. Follow Test-Driven Development (TDD) - provide runnable tests for each component

### Frontend Code Style
- Use early returns for readability
- Always use Tailwind classes for styling; avoid inline CSS or `<style>` tags
- Event handlers use "handle" prefix: `handleClick`, `handleKeyDown`
- Use `const` arrow functions with type annotations: `const toggle = () => {}`
- Include accessibility attributes: `tabIndex={0}`, `aria-label`, keyboard handlers
- Use descriptive variable names

### Backend Code Style
- Functional, declarative programming; avoid classes where possible
- Descriptive variable names with auxiliary verbs: `is_active`, `has_permission`
- Lowercase with underscores for files: `routers/user_routes.py`
- Use Receive an Object, Return an Object (RORO) pattern
- `def` for pure functions, `async def` for async operations
- Type hints on all function signatures; prefer Pydantic models over raw dicts
- Guard clauses and early returns for error handling; happy path last
- Use `HTTPException` for expected errors; middleware for unexpected ones

## Essential Commands

### Frontend (Next.js) - run from project root
```bash
npm run dev          # Development server (localhost:3000)
npm run build        # Production build
npm start            # Start production server
npm run lint         # ESLint
npm run type-check   # TypeScript type checking (tsc --noEmit)
```

### Backend (FastAPI) - run from backend-services/basic-service/
```bash
pip install -r requirements.txt                        # Install dependencies
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000  # Dev server (localhost:8000)
pytest tests/test_specific.py -v                       # Single test file
pytest tests/ --cov=app --cov-report=html              # All tests with coverage
pytest tests/test_video_composition.py -v              # Video composition tests
pytest tests/test_subtitle_*.py -v                     # Subtitle tests
```

## High-Level Architecture

Ecliptrix is an AI-powered content creation platform with a **Next.js 15 frontend** and a **FastAPI backend microservice**. The frontend handles multi-tab project UI, while the backend provides video processing, AI analysis, TTS, and media composition services.

### Project Layout
```
Ecliptrix/
├── src/                          # Next.js frontend
│   ├── app/                      # App Router (layout.tsx, page.tsx, api/ routes)
│   ├── components/               # Feature-organized React components
│   │   ├── video/                # Video editing (30+ modal/panel components)
│   │   ├── workflow/             # Node-based workflow builder (20 components)
│   │   ├── chat/                 # Chat interface (8 components)
│   │   ├── ui/                   # Shared UI (Toast, Dialog)
│   │   ├── AdminSettings/        # Admin panel
│   │   ├── UserProfile/          # User profile pages
│   │   └── HomePage/             # Landing page
│   ├── contexts/                 # AuthContext, NotificationContext, LocaleContext
│   ├── hooks/                    # useTasks (main state), useMobileDetection
│   ├── lib/
│   │   ├── api/                  # 9 backend API service clients
│   │   ├── workflow/             # ServerWorkflowExecutor
│   │   └── utils/                # Device detection, format conversion, media managers
│   ├── styles/                   # globals.css, video-editing.css
│   └── types/                    # index.ts (600+ lines), auth.ts
├── backend-services/basic-service/  # FastAPI backend
│   ├── app/
│   │   ├── main.py               # FastAPI app: 22 routers, middleware, lifespan
│   │   ├── config.py             # Pydantic Settings with YAML overrides
│   │   ├── logger.py             # Structured logging (file + console)
│   │   ├── models/               # 21+ Pydantic model files by feature domain
│   │   ├── routers/              # 22 API route modules
│   │   └── services/             # 38 service modules (business logic)
│   ├── config/                   # YAML configs (batch_tts, video-analysis, youtube, etc.)
│   ├── static/                   # Generated media (audio/, video/)
│   └── tests/                    # Pytest suite with test fixtures
├── env.template                  # Environment variable template
└── config/                       # Additional configuration files
```

### Frontend Architecture

**Entry Flow**: `layout.tsx` wraps app with `LocaleProvider` > `NotificationProvider` > `AuthProvider`. `page.tsx` is a client component that conditionally renders LandingPage or the multi-tab task interface.

**Multi-Task Tab System**: `useTasks` hook manages the core state. Creates all 4 task types (chat, video, workflow, brainstorming) simultaneously on first interaction. `VerticalTaskbar` provides left sidebar tab navigation, `Container` routes to the active task's component.

**State Management**: Context-based (Auth, Notifications, Locale) + custom hooks. Each task manages its own internal state independently. No external state library.

**API Service Layer** (`src/lib/api/`): 9 typed service modules - `videoComposition.ts`, `videoCut.ts`, `tts.ts`, `audioTranscription.ts`, `workflow.ts`, `llm.ts`, `storage.ts`, `userMaterials.ts`, `config.ts`. All follow RORO pattern with typed request/response interfaces.

**Key Types** (`src/types/index.ts`): Task/Tab/AppState, ChatMessage/Conversation, WorkflowNode/WorkflowConnection (11 node config interfaces), TimelineItem/Track/TimelineState, MaterialItem, SubtitleStyle, ScriptSentence/ScriptSegment.

**Next.js API Routes** (`src/app/api/`): 20+ proxy routes that forward requests to the FastAPI backend. Covers auth, chat, video generation, audio, image generation, content polish, digital human, and more.

### Backend Architecture

**Router Organization**: 22 routers all registered with `/api` prefix in `main.py`. Each router instantiates its own service at module level. Consistent pattern: logging at start/end, validation with early returns, service call, exception handling.

**Major Routers**: `video_router` (search/compose/analyze/cut), `tts_router` (convert/batch/sentence-batch/voices), `audio_router` (transcribe/search), `workflow_router` (create/save/load/analyze), `auth_router` (login/register/logout), `storage_router` (upload-video/upload-audio/upload-file/user-materials), `ai_mixed_editing_router`, `flux_router`, `ai_video_generate_router`.

**Service Layer** (38 services organized by domain):
- **Video**: video_search, video_composition (2156 lines, FFmpeg-based), video_analysis (VL LLM), video_cut, video_understanding_script, image_to_video
- **Audio/TTS**: tts, batch_tts (concurrent threading + retry), sentence_tts, audio_transcription, audio_search
- **Content**: subtitle, ai_mixed_editing, watermark_removal, chat, intent_detection
- **Data**: storage, file_upload, timeline_export/import/parser, user, workflow
- **Integration**: youtube (yt-dlp), runninghub (FLUX images), tavily_search, image_search, ai_video_generate, agent_workflow
- **Infrastructure**: queue_manager (universal semaphore-based concurrency limiter), queue_decorator, session

**Queue Manager**: Universal concurrent request limiter using `asyncio.Semaphore`. Per-queue `max_concurrent` control, task status tracking, processing time estimation. Used by video analysis (max 2 concurrent), batch TTS (3-10 threads), YouTube (20 concurrent), watermark removal (5 threads).

**Configuration** (`config.py`): Pydantic `Settings` with environment variables + YAML overrides from `config/` directory. Supports nested config models: `BatchTTSConfig`, `YoutubeConfig`, `WatermarkRemovalConfig`, `UploadConfig`. Precedence: env vars > YAML files > Pydantic defaults.

**Multi-LLM Strategy**: Three separate LLM configurations:
- **General LLM** (`llm_api_key/url/model`): workflow, chat, intent detection
- **Video Cut LLM** (`video_cut_llm_*`): AI mixed editing (defaults to Claude)
- **VL LLM** (`vl_llm_*`): Video analysis frame extraction (defaults to Qwen VL)

**Middleware**: CORS (all origins), request/response logging with processing time header, structured exception handlers. Third-party library logging (OpenAI, httpx, httpcore) suppressed to WARNING to prevent BASE64 data leakage.

**Static File Serving**: `/api/audio/generated`, `/api/audio/subtitles`, `/static/timeline_exports` mounted to `static/` subdirectories.

### Key Integration Patterns

**Video Processing Pipeline**: Timeline data > Validation > Download videos > Extract frames > Apply subtitles > Mix audio tracks > FFmpeg encoding > Output video

**Video Analysis Pipeline**: Video file > Frame extraction (interval-based) > Base64 conversion > VL LLM API (concurrent) > Frame analysis results > Storage

**Workflow System**: Visual node-based editor (frontend) with 8+ node types (ChatLLM, TextInput, Pexels, Tavily, VolcanoTTS, ToArray, ResultsCombine, AIVideoGenerate, VideoExport, Start, End). Server-side execution via `ServerWorkflowExecutor`.

## Environment Setup

Copy `env.template` to `.env.local` (frontend). Key variables:
- `NEXT_PUBLIC_BACKEND_URL`: FastAPI backend URL (default: `http://localhost:8000`)
- `NEXT_PUBLIC_API_URL`: Frontend URL (default: `http://localhost:3000`)
- `LLM_API_URL/KEY/MODEL`: General LLM provider
- `AI_VIDEO_MATCH_LLM_*`: Video matching LLM (Alibaba Qwen)
- `NEXT_PUBLIC_AI_MATERIAL_SERVICE`: `local` or `runninghub`
- LLM provider keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `AZURE_OPENAI_*`, `CUSTOM_LLM_*`

Backend `.env` is at `backend-services/basic-service/.env` with additional keys for Volcano TTS, PEXELS, RunningHub, VL LLM, Database, Storage, and agent LLM configurations.

## Design System

- **Dark mode**: Class-based toggling
- **Colors**: CSS custom properties using oklch color space, defined in `globals.css`
- **Typography**: Geist (sans), Lora (serif), Fira Code (mono) via CSS variables
- **Custom aspect ratios**: `9/16`, `4/3`, `21/9` for video editing
- **Component library**: Shadcn/Radix-compatible color tokens (primary, secondary, accent, muted, destructive, card, popover, sidebar)
- **Path alias**: `@/*` maps to `./src/*`

## Development Notes

### Frontend
- `Container.tsx` acts as the main task router - maps task types to their component
- Video editing interface (`components/video/`) is the most complex feature with 30+ modal components
- Auth tokens persisted in localStorage (`ecliptrix-user`, `ecliptrix-session-token`)
- All 4 task types created simultaneously (not incrementally) when user first interacts
- TypeScript strict mode enabled; path alias `@/*` for imports

### Backend
- All routers follow consistent error handling using `ErrorResponse` models from `models/base_models.py`
- `video_composition_service.py` is the largest file (2156 lines) - uses FFmpeg subprocess calls
- Auth uses local mode (username/password with bcrypt + SQLAlchemy)
- YAML configs in `config/` directory are loaded lazily with defaults
- Services are singleton pattern (module-level instantiation in routers)
- `batch_tts_config.yaml` contains 100+ voice types with categories

## Project Index

This project has a pre-generated index for quick codebase understanding.

- **Location:** `.claude-index/index.md`
- **Last Updated:** 2026-02-15
- **Contents:** Project overview, feature map, file index, exported symbols, module dependencies

**Usage:** Read `.claude-index/index.md` to quickly understand the project structure before making changes. The index provides a navigation map of the codebase without needing to explore every file.

**Regenerate:** Say "regenerate index" or "更新索引" to update the index after major changes.
