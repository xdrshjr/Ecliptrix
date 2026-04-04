# Agent Summary: google-dev-01

## Meta
- **Agent:** google-dev-01
- **Role:** DEV
- **Task:** T1 (toolFetch) + T2 (TTS fix)
- **Phase:** 1
- **Timestamp:** 2026-04-04T12:00:00Z
- **Verdict:** COMPLETED

## Key Decisions
- Used `AbortSignal.timeout()` combined with `AbortSignal.any()` for signal composition, supporting both timeout and caller-provided cancellation signals simultaneously
- Retry logic only triggers on `TypeError` (network-level errors like DNS/connection refused), never on `AbortError` (timeout) or HTTP status codes (4xx/5xx are deterministic backend responses)
- `parseToolResponse<T>` returns a discriminated union: either `T` on success or `{ success: false, error: string }` on JSON parse failure, allowing type-safe consumption without try/catch at every call site
- Header merging handles all three `HeadersInit` forms: `Headers` object, `[string, string][]` array, and `Record<string, string>` plain object
- Changed `duration || 0` to `duration ?? 0` in both TTS tools for correctness (a duration of `0` is valid and should not fall through)
- Error messages in catch blocks now distinguish timeout from network errors with explicit timeout duration in the message

## Execution Flow
1. Read all 8 required context files (master-plan, task-orchestration, types.ts, apiHelper.ts, generateTts.ts, batchGenerateTts.ts, TTS API routes)
2. Searched for all imports of `apiHelper` to understand downstream consumers (14 tools total)
3. Implemented `toolFetch` and `parseToolResponse` in `apiHelper.ts`, preserving the existing `apiUrl` export
4. Updated `generateTts.ts`: replaced `fetch`+`apiUrl` with `toolFetch` (60s timeout), replaced `response.json()` with `parseToolResponse`, added defensive null checks, improved error messages with HTTP status + response text
5. Updated `batchGenerateTts.ts`: replaced `fetch`+`apiUrl` with `toolFetch` (120s timeout), replaced `response.json()` with `parseToolResponse`, added defensive `'data' in result` check, improved error messages
6. Ran TypeScript type-check (`tsc --noEmit`) -- zero errors in modified files

## Artifacts
- **Created:** `docs/plans/agent-tool-robustness/summaries/phase-1/dev--google-dev-01--t1-t2.md` (this file)
- **Modified:**
  - `src/lib/video-editing-agent/tools/apiHelper.ts` — added `ToolFetchOptions` interface, `toolFetch()`, `parseToolResponse()`, `delay()` helper
  - `src/lib/video-editing-agent/tools/generateTts.ts` — migrated to `toolFetch`/`parseToolResponse`, 60s timeout, defensive checks, improved errors
  - `src/lib/video-editing-agent/tools/batchGenerateTts.ts` — migrated to `toolFetch`/`parseToolResponse`, 120s timeout, defensive checks, improved errors

## Interfaces Touched
- **Produces:** `toolFetch`, `parseToolResponse`, `ToolFetchOptions` (exported from `apiHelper.ts`) -- consumed by google-dev-02 (T3/T4/T5)
- **Preserves:** `apiUrl` export unchanged -- backward compatible for any tool not yet migrated
- **Contract status:** verified (TypeScript compiles, all 14 downstream tools still import successfully)

## Issues & Risks
- `AbortSignal.any()` requires Node.js 20+ / modern browsers. This project targets Next.js 15 which requires Node.js 18.17+. Node.js 20.3+ supports `AbortSignal.any()`. If the deployment environment runs Node.js 18, this will fail at runtime. Mitigation: Next.js 15 officially recommends Node.js 20+, and the project's `install.sh` likely enforces this.
- The retry delay is a fixed 1 second. No exponential back-off was added since `maxRetries` defaults to 1 (total 2 attempts max), making exponential back-off unnecessary.
- `parseToolResponse` consumes the response body. Callers must not read `response.json()` or `response.text()` after calling it. This is documented by convention (the function takes ownership of the body stream).

## Context for Downstream
google-dev-02 should use `toolFetch` and `parseToolResponse` as follows:

```typescript
import { toolFetch, parseToolResponse } from './apiHelper';

// Basic usage — 30s default timeout, 1 retry on network error
const response = await toolFetch(context, '/api/some/endpoint', {
  method: 'POST',
  body: JSON.stringify(payload),
});

// Custom timeout — e.g., 120s for long operations
const response = await toolFetch(context, '/api/ai/generate', {
  method: 'POST',
  timeout: 120_000,
  body: JSON.stringify(payload),
});

// Disable retry (e.g., for non-idempotent operations)
const response = await toolFetch(context, '/api/something', {
  method: 'POST',
  retry: false,
  body: JSON.stringify(payload),
});

// Safe JSON parsing
const result = await parseToolResponse<{ success: boolean; data?: SomeType }>(response);
if (!result.success) {
  // result.error exists if JSON parse failed
  // result.message may exist if backend returned an error
}

// Timeout detection in catch blocks
try {
  const response = await toolFetch(context, path, { timeout: 60_000 });
} catch (error) {
  const isTimeout = error instanceof DOMException && error.name === 'AbortError';
}
```

Key points:
- `toolFetch` auto-sets `Content-Type: application/json` -- no need to pass headers unless overriding
- `toolFetch` constructs the full URL via `apiUrl(context, path)` internally -- pass relative paths like `/api/video/search`
- The `apiUrl` export still exists and works for any edge case where raw URL construction is needed
- `timeout`, `retry`, `maxRetries` are stripped from the init object before passing to native `fetch` -- they won't cause issues
