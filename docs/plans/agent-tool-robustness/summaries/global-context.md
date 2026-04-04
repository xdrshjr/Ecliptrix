# Global Execution Context: agent-tool-robustness

Accumulated context from all execution phases. Each agent MUST read this
file before starting work to understand the full project history.

---

## Phase 1 — completed 2026-04-04

### Completed Tasks
- T1: Created `toolFetch` + `parseToolResponse` in apiHelper.ts (timeout, retry, error handling)
- T2: Migrated generateTts.ts (60s timeout) and batchGenerateTts.ts (120s timeout) to toolFetch
- T6: Added SSE heartbeat keepalive (15s interval during tool execution, timeout 30s→90s)

### Key Context for Phase 2
- Import `toolFetch` and `parseToolResponse` from `./apiHelper` (same directory as tool files)
- `toolFetch(context, path, init?)` — init extends RequestInit with `timeout`, `retry`, `maxRetries`
- Retries only on TypeError (network error), NOT on TimeoutError or HTTP errors
- `parseToolResponse<T>(response)` returns parsed JSON or `{ success: false, error: '...' }`
- SSE heartbeat active — long-running tools (120s) will not cause connection drops

## Phase 2 — completed 2026-04-04

### Completed Tasks
- T3: 3 search tools migrated to toolFetch (10s translate, 15s search)
- T4: 3 AI gen tools migrated (120s), generateAiImage fire-and-forget eliminated
- T5: 6 script/storyboard tools migrated (60-120s), expandVideoScript silent failures fixed

### Integration Status
- All 14 API tools now use toolFetch + parseToolResponse
- TypeScript compilation: 0 errors
- All reviews passed, all tests passed
