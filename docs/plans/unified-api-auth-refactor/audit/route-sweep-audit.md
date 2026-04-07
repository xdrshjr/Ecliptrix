# Route Sweep Audit (T04)

> **Owner task:** T04 — Next.js Routes Layer Sweep
> **Spec reference:** `specs/04-nextjs-routes-sweep.md` §8
> **Generated:** 2026-04-07 (post-sweep)
> **Author:** google-dev-04 (Phase 2 dev)
> **Sibling deliverables:**
>   - Helper: `src/lib/api/server/backend-proxy.ts`
>   - Tests:  `src/lib/api/server/__tests__/backend-proxy.test.ts`
>   - Audit:  this document

This audit catalogues every `src/app/api/**/route.ts` file in the codebase, classifies it into one of the five sweep patterns from spec §4, and surfaces all five Pattern E escape hatches with their justifications.

---

## Pattern legend

| Code | Name | Use when |
|------|------|----------|
| **A** | Plain passthrough | Static backend path, default 60s timeout, no body re-shape, no streaming |
| **B** | Auth-forward | Same as A — the helper auto-forwards `Authorization` and `x-session-token`, so Pattern B and Pattern A are now structurally identical. Routes that previously called out the auth header are tagged B for traceability |
| **C** | Long-running | Static path with custom `timeoutMs` (typically 120s / 300s / 600s) |
| **D** | Streaming | `streaming: true` so the backend body is piped to the client without buffering — used for binary downloads and SSE |
| **E** | Escape hatch | Hand-rolled implementation that imports `backendConfig` directly. Tagged with `// SWEEP-EXCEPTION:` and counted toward the **5-route hard cap** (spec §4.5) |

---

## Per-route table

> Notes column captures any rename, delegated body re-shape, or special header handling. "Auth required" means the backend will reject unauthenticated requests after T01's middleware took effect — almost everything is `Yes` now; only the four allowlisted auth endpoints are anonymous.

| # | Route file | Methods | Backend path | Pattern | Auth | Notes |
|---|------------|---------|--------------|---------|------|-------|
| 1 | `admin/users/list/route.ts` | GET | `/api/user/list` | B | Yes (admin) | Query string forwarded automatically |
| 2 | `admin/users/create/route.ts` | POST | `/api/user/create` | B | Yes (admin) | |
| 3 | `admin/users/stats/route.ts` | GET | `/api/user/stats` | B | Yes (admin) | |
| 4 | `admin/users/[userId]/toggle-status/route.ts` | POST | `/api/user/toggle-status/${userId}` | B (builder) | Yes (admin) | URL renames `users → user` |
| 5 | `admin/users/[userId]/reset-password/route.ts` | POST | `/api/user/reset-password/${userId}` | B (builder) | Yes (admin) | |
| 6 | `admin/users/[userId]/login-history/route.ts` | GET | `/api/user/login-history/${userId}` | B (builder) | Yes (admin) | Query string forwarded |
| 7 | `admin/users/[userId]/force-logout/route.ts` | POST | `/api/user/force-logout/${userId}` | B (builder) | Yes (admin) | |
| 8 | `admin/users/[userId]/delete/route.ts` | DELETE | `/api/user/delete/${userId}` | B (builder) | Yes (admin) | |
| 9 | `admin/users/[userId]/edit/route.ts` | PUT | `/api/user/profile/${userId}` | B (builder) | Yes (admin) | URL `edit → profile` |
| 10 | `ai-mixed-editing/route.ts` | POST | `/api/ai-mixed-editing` | C (10 min) | Yes | Was `BACKEND_SERVICE_URL` |
| 11 | `ark-image/generate/route.ts` | POST | `/api/ark-image/generate` | C (5 min) | Yes | |
| 12 | `ark-video/generate/route.ts` | POST | `/api/ark-video/generate` | C (5 min) | Yes | |
| 13 | `ark-video/status/[taskId]/route.ts` | GET | `/api/ark-video/status/${taskId}` | A (builder) | Yes | |
| 14 | `audio-search/route.ts` | POST, GET | POST `/api/audio/search`, GET `/api/audio/health` | A | Yes | Previously MIXED `BACKEND_URL` + `BACKEND_SERVICE_URL` reads — collapsed |
| 15 | `audio/batch-transcribe/route.ts` | POST | `/api/audio/batch-transcribe` | C (10 min) | Yes | |
| 16 | `audio/generated/[filename]/route.ts` | GET | `/api/audio/generated/${filename}` | D streaming (builder) | Yes | Binary audio download |
| 17 | `auth/login/route.ts` | POST | `/api/auth/login` | A | **No (allowlisted)** | Body re-shape `result.user → transformedUser` delegated to T05 client |
| 18 | `auth/validate-session/route.ts` | POST | `/api/auth/validate-session` | A | **No (allowlisted)** | |
| 19 | `chat/route.ts` | POST | `/api/model-settings/resolve/chat` (one call) + 3rd-party LLM streaming | **E** | Yes | **SWEEP-EXCEPTION**: third-party LLM streaming is not a backend proxy. See §Escape hatches below. |
| 20 | `config/route.ts` | GET | `/api/config` | A | Yes | Was `BACKEND_SERVICE_URL` |
| 21 | `convert-to-script/route.ts` | POST | `/api/convert-to-script` | C (5 min) | Yes | Was `BACKEND_SERVICE_URL` |
| 22 | `image-search/route.ts` | POST, GET | POST `/api/image/search`, GET `/api/image/health` | A | Yes | Previously MIXED `BACKEND_URL` + `BACKEND_SERVICE_URL` reads — collapsed |
| 23 | `model-settings/assignments/route.ts` | GET, PUT | `/api/model-settings/assignments` | A | Yes | |
| 24 | `model-settings/assignments/[functionType]/route.ts` | DELETE | `/api/model-settings/assignments/${functionType}` | A (builder) | Yes | |
| 25 | `model-settings/fetch-models/route.ts` | POST | `/api/model-settings/fetch-models` | A | Yes | |
| 26 | `model-settings/providers/route.ts` | GET, POST | GET `/api/model-settings/providers/known`, POST `/api/model-settings/providers` | A | Yes | GET hits `/known`, POST hits the base resource |
| 27 | `model-settings/providers/saved/route.ts` | GET | `/api/model-settings/providers/saved` | A | Yes | |
| 28 | `model-settings/providers/[providerId]/route.ts` | PUT, DELETE | `/api/model-settings/providers/${providerId}` | A (builder) | Yes | |
| 29 | `model-settings/providers/[providerId]/fetch-models/route.ts` | POST | `/api/model-settings/providers/${providerId}/fetch-models` | A (builder) | Yes | |
| 30 | `model-settings/test-connection/route.ts` | POST | `/api/model-settings/test-connection` | A (60s) | Yes | |
| 31 | `silence/detect/route.ts` | POST | `/api/silence/detect` | C (5 min) | Yes | Backend runs FFmpeg |
| 32 | `silence/remove/route.ts` | POST | `/api/silence/remove` | A | Yes | Backend returns task_id immediately |
| 33 | `silence/status/[taskId]/route.ts` | GET | `/api/silence/status/${taskId}` | A (builder) | Yes | |
| 34 | `storage/files/[...path]/route.ts` | GET | `/api/storage/files/${path.join('/')}` | **E** (catch-all builder) | No (mount allowlisted) | **SWEEP-EXCEPTION**: response-header allowlist for video Range seeking. The escape hatch is implemented via the helper's `responseHeaderAllowlist` + `forwardHeaders: ['range']` + `streaming: true` options — kept under Pattern E because of the explicit header allowlist comment requirement. |
| 35 | `storage/upload-file/route.ts` | POST | `/api/storage/upload-file` | A (60s) | Yes | Multipart |
| 36 | `storage/upload-video/route.ts` | POST | `/api/storage/upload-video` | A (120s) | Yes | Multipart |
| 37 | `storage/user-materials/route.ts` | GET | `/api/storage/user-materials` | A | Yes | Query string forwarded |
| 38 | `storyboard/batch-video/route.ts` | POST | `/api/storyboard/batch-video` | C (10 min) | Yes | |
| 39 | `storyboard/batch-video/status/[packId]/route.ts` | GET | `/api/storyboard/batch-video/status/${packId}` | A (builder) | Yes | |
| 40 | `storyboard/compose/route.ts` | POST | `/api/storyboard/compose` | C (10 min) | Yes | |
| 41 | `storyboard/describe/route.ts` | POST | `/api/storyboard/describe` | C (2 min) | Yes | |
| 42 | `storyboard/generate/route.ts` | POST | `/api/storyboard/generate` | C (5 min) | Yes | |
| 43 | `storyboard/packs/route.ts` | GET | `/api/storyboard/packs` | A | Yes | |
| 44 | `storyboard/packs/[packId]/route.ts` | GET, DELETE | `/api/storyboard/packs/${packId}` | A (builder) | Yes | |
| 45 | `system-settings/[category]/route.ts` | GET, PUT | `/api/system-settings/${category}` | A (builder) | Yes (admin) | |
| 46 | `system-settings/[category]/[key]/route.ts` | PUT | `/api/system-settings/${category}/${key}` | A (builder) | Yes (admin) | |
| 47 | `system-settings/[category]/reset/route.ts` | POST | `/api/system-settings/${category}/reset` | A (builder) | Yes (admin) | |
| 48 | `system-settings/audit-log/route.ts` | GET | `/api/system-settings/audit-log` | A | Yes (admin) | Query string forwarded |
| 49 | `system-settings/categories/route.ts` | GET | `/api/system-settings/categories` | A | Yes (admin) | |
| 50 | `system-settings/reset-all/route.ts` | POST | `/api/system-settings/reset-all` | A | Yes (admin) | |
| 51 | `timeline-export/route.ts` | POST | `/api/timeline/export` | C (5 min) | Yes | Was `BACKEND_SERVICE_URL` |
| 52 | `timeline-import/route.ts` | POST, PUT | POST `/api/timeline/import/upload`, PUT `/api/timeline/validate` | A | Yes | Was `BACKEND_SERVICE_URL` |
| 53 | `tts/batch-convert/route.ts` | POST | `/api/tts/convert-batch` | C (10 min) | Yes | URL renames `batch-convert → convert-batch` |
| 54 | `tts/convert-sentences/route.ts` | POST | `/api/tts/convert-sentences` | C (5 min) | Yes | |
| 55 | `tts/convert/route.ts` | POST | `/api/tts/convert` | C (2 min) | Yes | |
| 56 | `tts/voice-types/route.ts` | GET | `/api/tts/voice-types` | A | Yes | Query string forwarded |
| 57 | `video-ai-match/route.ts` | POST, GET | n/a (third-party LLM only) | n/a | Yes | **No backend call**. Previous file had a dead `BACKEND_URL` constant — removed. Calls Aliyun DashScope directly. |
| 58 | `video-compose/route.ts` | POST | `/api/video/compose` | C (10 min) | Yes | Body validation + retry loop deleted; validation moves to T05 client |
| 59 | `video-compose/[compositionId]/status/route.ts` | GET | `/api/video/compose/${compositionId}/status` | A (builder) | Yes | |
| 60 | `video-compose/[compositionId]/download/route.ts` | GET | `/api/video/compose/${compositionId}/download` | D streaming (builder, 10 min) | Yes | Large MP4 download |
| 61 | `video-compose/health/route.ts` | GET | `/api/video/compose/health` | A | Yes | |
| 62 | `video-cut/route.ts` | POST | `/api/video/cut` | C (5 min) | Yes | |
| 63 | `video-editing-agent/chat/route.ts` | POST | `/api/model-settings/resolve/chat` (one call) + 3rd-party LLM Agent SDK + tool callbacks + heartbeat SSE | **E** | Yes | **SWEEP-EXCEPTION**: Agent SDK + custom SSE/heartbeat lifecycle. See §Escape hatches below. |
| 64 | `video-search/route.ts` | POST, GET | POST `/api/video/search`, GET `/api/video/search/health` | A | Yes | |
| 65 | `video-understanding-script/route.ts` | POST | `/api/video-understanding-script` | C (5 min) | Yes | Was `BACKEND_SERVICE_URL`. The `referenceText` enrichment (chat messages + custom prompt) is delegated to T05 client. |
| 66 | `video/analysis-queue-status/route.ts` | GET | `/api/video/analysis-queue-status` | A | Yes | |
| 67 | `video/analyze/route.ts` | POST | `/api/storage/upload-video` (1) + `/api/video/analyze` (2) | **E** | Yes | **SWEEP-EXCEPTION**: two-step upload-then-analyze with optional thumbnail base64 conversion. See §Escape hatches below. |
| 68 | `video/batch-analyze/route.ts` | POST | `/api/video/batch-analyze` | C (10 min) | Yes | |
| 69 | `video/image-to-video/route.ts` | POST | `/api/video/image-to-video` | C (5 min) | Yes | |
| 70 | `video/watermark-removal/route.ts` | POST | `/api/video/watermark-removal` | C (10 min) | Yes | |
| 71 | `workflow-preferences/load/route.ts` | POST | `/api/workflow-preferences/load` | A | Yes | Was `PYTHON_BACKEND_URL`. Body key rename delegated to T05 client. |
| 72 | `workflow-preferences/save/route.ts` | POST | `/api/workflow-preferences/save` | A | Yes | Was `PYTHON_BACKEND_URL`. Body key rename delegated to T05 client. |
| 73 | `workflow/agent/delete/[userId]/[workflowId]/route.ts` | DELETE | `/api/workflow/agent/delete/${userId}/${workflowId}` | A (builder) | Yes | Was `BACKEND_SERVICE_URL` |
| 74 | `workflow/agent/load/[userId]/route.ts` | GET | `/api/workflow/agent/load/${userId}` | A (builder) | Yes | Was `BACKEND_SERVICE_URL` |
| 75 | `workflow/agent/save/route.ts` | POST | `/api/workflow/agent/save` | A | Yes | Was `BACKEND_SERVICE_URL` |
| 76 | `workflow/ai-video-generate/route.ts` | POST | `/api/workflow/ai-video-generate` | C (10 min) | Yes | Was `BACKEND_SERVICE_URL` |
| 77 | `workflow/tavily-search/route.ts` | POST | `/api/workflow/tavily-search` | A | Yes | Was `process.env.NEXT_PUBLIC_API_URL` (one of two `localhost:8000` violations not in the standard env-var list) |
| 78 | `workflow/video-export/route.ts` | POST | `/api/workflow/video-export` | C (5 min) | Yes | Was `BACKEND_SERVICE_URL` |
| 79 | `youtube/download-and-upload/route.ts` | POST | `/api/youtube/download-and-upload` | C (10 min) | Yes | |
| 80 | `youtube/download/route.ts` | POST | `/api/youtube/download` | C (10 min) | Yes | |
| 81 | `youtube/search/route.ts` | POST | `/api/youtube/search` | A | Yes | |

### Routes NOT touched (out of scope)

These 14 files do not reference `BACKEND_URL` / `BACKEND_SERVICE_URL` / `PYTHON_BACKEND_URL` and do not contain a `localhost:8000` literal. They are either LLM-direct routes (master plan §3 — chat-style routes that bypass the FastAPI backend) or pure utility / mock routes:

- `ai-video-script-expand/route.ts` — direct LLM
- `ai-video-script-generation/route.ts` — direct LLM
- `content-polish-multiple/route.ts` — direct LLM
- `content-polish/route.ts` — direct LLM
- `creative-brainstorming/route.ts` — direct LLM
- `intent-detection/route.ts` — direct LLM (via `lib/intent-detection-service`)
- `polish-config/route.ts` — local config helper
- `prompt-polish/route.ts` — direct LLM
- `script-keywords-generation/route.ts` — direct LLM
- `translate-search-query/route.ts` — direct LLM
- `user/profile/route.ts` — in-memory mock
- `video-editing-chat/route.ts` — direct LLM
- `video-script-generation/route.ts` — direct LLM
- `workflow/test-node/route.ts` — local node tester

These routes are **NOT** part of the BFF layer this sweep targets and are correctly excluded from the helper migration.

---

## Summary

| Metric | Count |
|--------|------:|
| Total `route.ts` files in `src/app/api/**` | 95 |
| Files modified by this sweep | **81** |
| Files left untouched (LLM-direct / mock / utility) | 14 |
| | |
| Pattern A (plain passthrough) | **44** |
| Pattern B (auth-forward — structurally identical to A, tagged for traceability) | **9** |
| Pattern C (long-running custom timeout) | **22** |
| Pattern D (streaming) | **2** (audio/generated, video-compose download) |
| Pattern E (escape hatch — `SWEEP-EXCEPTION` comment, raw `backendConfig`) | **4 / 5** |
| Routes with no backend call left after sweep | 1 (`video-ai-match` — was dead BACKEND_URL constant) |
| Net LoC delta in `src/app/api/**` | **+596 / −7210 = −6614** |
| Helper LoC added (`backend-proxy.ts`) | ~340 |
| Test LoC added (`backend-proxy.test.ts`) | ~530 |
| **Net frontend LoC reduction** | **~−5744** |

### Hard verification (run from repo root)

```bash
# AC#3 — must return ZERO
grep -rn "process.env.BACKEND_URL\|process.env.BACKEND_SERVICE_URL\|process.env.PYTHON_BACKEND_URL" src/app/api/

# AC#4 — must return ZERO
grep -rn "'http://localhost:8000'\|\"http://localhost:8000\"" src/app/api/

# Bonus: any localhost:8000 substring — must return ZERO
grep -rn "localhost:8000" src/app/api/

# Pattern E budget — must show ≤5 lines (one file per line)
grep -rln "SWEEP-EXCEPTION" src/app/api/
```

Results from this sweep (verified at audit time):

| Guard | Result |
|-------|--------|
| `process.env.BACKEND_URL\|...` in `src/app/api/` | **0 matches** |
| `'http://localhost:8000'\|"http://localhost:8000"` in `src/app/api/` | **0 matches** |
| `localhost:8000` (any substring) in `src/app/api/` | **0 matches** |
| `SWEEP-EXCEPTION` files | **4** (chat, storage/files, video-editing-agent/chat, video/analyze) |
| `npm run build` (with `BACKEND_URL=http://localhost:8088`) | **PASS** |
| `npx tsc --noEmit` for production source under `src/app/api/**` and `src/lib/api/server/**` | **PASS** (only pre-existing dormant Vitest test errors remain in `trimming.test.ts`, `http-client.test.ts`, `backend.test.ts`) |

---

## Pattern E escape hatches (4 / 5 cap)

> Spec §4.5: "The implementer MUST NOT exceed 5 escape-hatch routes total. If more than 5 routes don't fit, that's a signal that the helper needs an additional option, and it should be added rather than escaping."

### E1. `chat/route.ts`

**Reason:** Streams responses from a third-party OpenAI-compatible LLM, not from the FastAPI backend. The single backend call (`/api/model-settings/resolve/chat`) DOES use `backendConfig.joinPath(...)` — it's the SSE streaming logic at the third-party LLM provider that doesn't fit `createPassthroughRoute`. Annotated with `// SWEEP-EXCEPTION: third-party LLM streaming, not a backend proxy` per spec §5.

### E2. `storage/files/[...path]/route.ts`

**Reason:** Catch-all proxy for backend-served static files that needs Range-header forwarding for video seeking AND a strict response-header allowlist (`content-type`, `content-length`, `accept-ranges`, `content-range`, `cache-control`) so internal backend headers don't leak. The helper's new `responseHeaderAllowlist` option supports this natively, so the route is now a one-liner — but it's still tagged Pattern E per spec §5 because of the explicit allowlist semantics. Annotated with `// SWEEP-EXCEPTION: response header allowlist for video Range seeking`.

### E3. `video-editing-agent/chat/route.ts`

**Reason:** Hosts a long-running streaming LLM Agent (the video-editing Agent SDK) with custom tool-invocation lifecycle, heartbeat keepalive every 15 s during tool execution, SSE event-ID tracking for resumption, and a resettable timeout that fires on tool activity. The single backend call (`/api/model-settings/resolve/chat`) DOES use `backendConfig.joinPath(...)`. The rest of the file is third-party LLM logic, not backend proxying. Annotated with `// SWEEP-EXCEPTION: third-party LLM Agent SDK with custom SSE/heartbeat lifecycle`.

### E4. `video/analyze/route.ts`

**Reason:** Performs TWO sequential backend calls — first POST to `/api/storage/upload-video` to put the video into backend storage, then POST to `/api/video/analyze` with the resulting URL. Plus, it converts an optional thumbnail file to a base64 data URI so it can cross the front/back container boundary. None of that fits the dumb `createPassthroughRoute` model. Both backend URLs use `backendConfig.joinPath(...)`. Annotated with `// SWEEP-EXCEPTION: two-step upload-then-analyze with base64 thumbnail conversion`.

### E5. (RESERVED — not used)

The 5-route cap is intentionally NOT exhausted. One slot is reserved for a future legitimate exception that the reviewer might surface during inspection.

---

## Before/after sample diffs

### Sample 1 — Pattern A: `video-search/route.ts`

**Before** (149 LoC, hand-rolled validation + fetch + error wrapping + duplicated POST/GET):

```ts
import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

const logRequest = (requestData: any) => { /* … */ };
const logResponse = (success: boolean, …) => { /* … */ };

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, max_videos = 20, orientation = 'mixed' } = body;
    if (!query || …) return NextResponse.json({ /* … */ }, { status: 400 });
    if (max_videos < 1 || max_videos > 100) return NextResponse.json({ /* … */ }, { status: 400 });
    if (!['landscape', 'portrait', 'mixed'].includes(orientation)) return NextResponse.json(…);

    const requestData = { query: query.trim(), max_videos, orientation };
    logRequest(requestData);

    const backendResponse = await fetch(`${BACKEND_URL}/api/video/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData),
    });

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      logResponse(false, undefined, `Backend error: ${backendResponse.status}`);
      return NextResponse.json({ /* big error envelope */ }, { status: 500 });
    }
    const result = await backendResponse.json();
    if (!result || typeof result.success !== 'boolean') return NextResponse.json(…);
    logResponse(result.success, result.videos?.length, result.message);
    return NextResponse.json({ /* re-shaped result */ });
  } catch (error) {
    return NextResponse.json({ /* … */ }, { status: 500 });
  }
}

export async function GET() {
  try {
    const backendHealthResponse = await fetch(`${BACKEND_URL}/api/video/search/health`, { /* … */ });
    return NextResponse.json({ /* big health envelope */ });
  } catch (error) {
    return NextResponse.json({ /* … */ });
  }
}
```

**After** (8 LoC):

```ts
import { createPassthroughRoute, backendProxy } from '@/lib/api/server/backend-proxy'
import type { NextRequest } from 'next/server'

// POST forwards search requests; GET hits the dedicated health endpoint.
export const { POST } = createPassthroughRoute('/api/video/search')

export function GET(req: NextRequest) {
  return backendProxy.get(req, '/api/video/search/health')
}
```

**Result:** Validation moves to T05 typed client. Authorization auto-forwarded. -141 LoC.

---

### Sample 2 — Pattern C with dynamic builder: `admin/users/[userId]/toggle-status/route.ts`

**Before** (43 LoC, manual auth-header forwarding + URL rename hardcoded):

```ts
import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const authHeader = request.headers.get('authorization');
    if (authHeader) headers['Authorization'] = authHeader;

    const response = await fetch(`${BACKEND_URL}/api/user/toggle-status/${userId}`, {
      method: 'POST',
      headers,
    });

    const data = await response.json();
    if (!response.ok) return NextResponse.json(data, { status: response.status });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
  }
}
```

**After** (6 LoC):

```ts
import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Next.js URL `/api/admin/users/[userId]/toggle-status` does NOT mirror
// the backend URL — backend is `/api/user/toggle-status/${userId}`.
export const { POST } = createPassthroughRoute(
  (p) => `/api/user/toggle-status/${p.userId as string}`,
)
```

**Result:** Authorization auto-forwarded. URL rename made explicit at the call site via the builder form. -37 LoC.

---

### Sample 3 — Pattern D streaming + dynamic builder: `video-compose/[compositionId]/download/route.ts`

**Before** (159 LoC, hand-rolled binary streaming + custom CORS + manual content-type forwarding):

```ts
import { NextRequest, NextResponse } from 'next/server';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

const logRequest = (compositionId: string, taskId?: string, filename?: string) => { /* … */ };
const logResponse = (success: boolean, fileSize?: number, error?: string) => { /* … */ };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ compositionId: string }> }
) {
  try {
    const { compositionId } = await params;
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('task_id');
    const filename = searchParams.get('filename');

    if (!compositionId) return NextResponse.json({ /* … */ }, { status: 400 });
    logRequest(compositionId, taskId || undefined, filename || undefined);

    const backendUrl = new URL(`${BACKEND_URL}/api/video/compose/${compositionId}/download`);
    if (taskId) backendUrl.searchParams.set('task_id', taskId);
    if (filename) backendUrl.searchParams.set('filename', filename);

    const backendResponse = await fetch(backendUrl.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(600000),
    });

    if (!backendResponse.ok) { /* 35 lines of error handling */ }

    const contentType = backendResponse.headers.get('content-type') || 'video/mp4';
    const contentLength = backendResponse.headers.get('content-length');
    /* … 30 lines manually copying response headers, building Disposition,
       enforcing Accept-Ranges, adding CORS headers … */

    return new NextResponse(backendResponse.body, { /* … 15 headers … */ });
  } catch (error: any) {
    if (error.name === 'TimeoutError' || …) return NextResponse.json(…);
    return NextResponse.json({ /* … */ }, { status: 500 });
  }
}
```

**After** (10 LoC):

```ts
import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern D — large file download. Stream the body without buffering and
// allow up to 10 minutes for the backend to deliver the bytes. The proxy
// helper forwards the backend response headers (Content-Type,
// Content-Length, Content-Disposition, Accept-Ranges, etc.) untouched.
export const { GET } = createPassthroughRoute(
  (p) => `/api/video/compose/${p.compositionId as string}/download`,
  { streaming: true, timeoutMs: 600_000 },
)
```

**Result:** Helper handles streaming, query string forwarding, header pass-through, timeout, and dynamic param resolution. Authorization auto-forwarded. -149 LoC.

---

## Helper interface (consumed surface)

For downstream agents (T05, T06, T07) and reviewers, the public interface is:

```ts
// src/lib/api/server/backend-proxy.ts

export interface ProxyOptions {
  forwardHeaders?: string[]
  timeoutMs?: number              // default 60_000
  streaming?: boolean             // default false
  responseHeaderAllowlist?: string[]   // streaming only
}

export type BackendPath =
  | string
  | ((params: Record<string, string | string[]>) => string)

export interface RouteContext {
  params: Promise<Record<string, string | string[]>>
}

export interface ProxyErrorEnvelope {
  success: false
  message: string
  error_code: 'BACKEND_TIMEOUT' | 'BACKEND_UNREACHABLE' | 'BACKEND_ERROR'
  error_details: Record<string, unknown> | null
}

export const backendProxy: {
  get(req, path, ctx?, opts?): Promise<Response>
  post(req, path, ctx?, opts?): Promise<Response>
  put(req, path, ctx?, opts?): Promise<Response>
  del(req, path, ctx?, opts?): Promise<Response>
}

export function createPassthroughRoute(
  backendPath: BackendPath,
  opts?: ProxyOptions,
): { GET, POST, PUT, DELETE }
```

The helper is a **dumb pipe** — it does not parse JSON, does not validate schemas, does not re-shape data. Body shape mutation lives in the typed clients under `src/lib/api/*.ts` (T05's domain).

---

## Cross-references

- **Spec:** `docs/plans/unified-api-auth-refactor/specs/04-nextjs-routes-sweep.md`
- **TODO:** `docs/plans/unified-api-auth-refactor/todos/04-nextjs-routes-sweep.md`
- **Helper:** `src/lib/api/server/backend-proxy.ts`
- **Tests:** `src/lib/api/server/__tests__/backend-proxy.test.ts` (T1–T20 + bonus, dormant until T07 installs Vitest)
- **T01 audit (allowlist + auth levels):** `docs/plans/unified-api-auth-refactor/audit/backend-route-protection.md`
- **T02 module:** `src/lib/config/backend.ts`
- **Phase 1 digest:** `docs/plans/unified-api-auth-refactor/summaries/phase-1/phase-digest.md`
