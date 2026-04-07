# Phase 2 Digest

## Completed Tasks

| Task | Dev Agent | Review Verdict | Test Verdict | Key Output |
|---|---|---|---|---|
| TODO 04 — Next.js Routes Sweep | google-dev-04 | PASS | ALL PASS | Helper module + 81 routes refactored, **net −6614 LoC**, all 4 hard verification grep guards return zero matches, Pattern E 4/5 (under cap), build PASS |

## Key Decisions

- **`createPassthroughRoute(backendPath, opts?)`** is the canonical entry point for plain proxy routes. Returns `(req, ctx)` handlers compatible with Next.js 15 dynamic-route signature. Replaces ~85% of all routes with 2-3 line declarations.
- **Pattern classification** A/B/C/D/E from spec §4 enforced strictly. Final distribution: A=44, B=9, C=22, D=2, E=4.
- **Pattern E hard cap = 5**, used 4. Reserved 1 slot intentionally. Each escape hatch documented with `// SWEEP-EXCEPTION:` comment + concrete reason: chat (third-party LLM stream), storage/files/[...path] (response-header allowlist for Range seeking), video-editing-agent/chat (Agent SDK + custom SSE/heartbeat), video/analyze (two-step upload-then-analyze).
- **Helper extension `responseHeaderAllowlist`** (~12 LoC) added so `storage/files/[...path]` could use the helper instead of remaining a 5th escape hatch. Well-scoped, declarative semantics.
- **Dynamic route builder form** for `[*]` segments. Three observed patterns: suffix (`(p) => '/api/silence/status/${p.taskId}'`), mid-path with rename (`(p) => '/api/user/toggle-status/${p.userId}'` — note `users → user`), catch-all (`(p) => '/api/storage/files/${(p.path as string[]).join('/')}'`).
- **Body re-shapes delegated to T05** for: `auth/login` (`transformedUser`), `video-compose` (validation + retry loop), `video-understanding-script` (`referenceText` enrichment), `workflow-preferences/save` (`userId → user_id` rename), `convert-to-script` (`chatContent`). T05 must own these in its new typed clients OR the backend must accept the legacy shapes.
- **Next.js 15 strict route validators** require `RouteContext.params: Promise<...>` (NOT optional). Caught at build time, fixed in helper interface, defensive `ctx?.params` runtime check retained.

## Interfaces Established

- **`backendProxy.{get, post, put, del}(req, backendPath, ctx?, opts?)`** in `src/lib/api/server/backend-proxy.ts` — server-only, imports `backendConfig` from S02. Always forwards `Authorization` + `x-session-token`. Multipart vs JSON body handling. Streaming pass-through. AbortController + 60s default timeout. 504/502 envelopes for timeout/network failures. JSON/non-JSON backend error wrapping.
- **`createPassthroughRoute(backendPath, opts?)`** convenience builder — returns `{ GET, POST, PUT, DELETE }` handlers compatible with Next.js 15 `(req, ctx)` signature.
- **`BackendPath = string | (params) => string`** — supports both literal paths and dynamic-route builders.
- **Contract status:** verified by reviewer (statistical sampling + 4 hard grep guards) and tester (independent re-run + full build).

## Issues Resolved

- 67 routes using `BACKEND_URL`, 13 using `BACKEND_SERVICE_URL`, 4 using `PYTHON_BACKEND_URL` — all collapsed to `backendConfig.baseUrl`
- Mixed env-var routes (e.g., `audio-search/route.ts` reading both `BACKEND_URL` and `BACKEND_SERVICE_URL` in the same handler) — collapsed
- Hardcoded `localhost:8000` fallback strings in 84+ files — removed
- Dead `BACKEND_URL` constant in `video-ai-match` — removed (extra catch by dev-04)
- `tavily-search` route using `NEXT_PUBLIC_API_URL` (NOT in spec §5 special cases) — caught and migrated by dev-04

## Risks Carried Forward to Phase 3+

1. **Body re-shape contracts owed by T05**: 5 routes had body transform/validation logic that T04 deliberately removed. T05 must put these in the new typed clients (`auth.ts`, `videoComposition.ts`, `workflow.ts`, `workflowPreferences.ts`) OR the backend must accept the legacy shapes. List: login `transformedUser`, video-compose validation + retry, video-understanding-script `referenceText`, workflow-preferences `userId → user_id`, convert-to-script `chatContent`.
2. **Pattern E routes need integration coverage in T07**: 1 representative test per escape hatch (chat, storage/files Range seeking, video-editing-agent SSE/heartbeat, video/analyze upload-then-analyze).
3. **OPTIONS preflight handlers** — a few routes had explicit OPTIONS handlers that were dropped during the sweep. Verify Next.js auto-synthesizes correctly via Nginx in production. Risk noted but not blocking.
4. **`/login` page still does not exist** (carried from Phase 1) — wrapper redirects to `/login?reason=session-expired` but the page doesn't exist. T08 owns.
5. **Vitest install gap** (carried from Phase 1) — `backend-proxy.test.ts` is dormant Vitest syntax. T07 owns.
6. **Pattern E slot 5 reserved** intentionally for future routes that genuinely cannot fit Patterns A-D. Don't push back without a concrete case.

## Phase 2 Token Report

| Agent | Role | Confirmed | Delta |
|---|---|---|---|
| google-dev-04 | DEV | 165 | +60 (D1+D3+D4+D10+D12+C1) |
| google-reviewer-02 | REV | 130 | +15 (R1+C1) |
| google-tester-02 | TEST | 135 | +20 (T1+T3+C1) |
| All others | various | various | +5 (collective C1) |

All escrow confirmed. Zero penalties. Zero eliminations. dev-04 now leads the leaderboard at 165 tokens.

## Context for Next Phase (T05 + T06 — parallel)

Phase 3 launches **T05 (lib/api refactor) and T06 (direct browser call migration) in parallel**. Both depend on T03 (HTTP wrapper) and T04 (route contract). T05 and T06 explicitly partition the file set: T05 owns the 14+ existing `lib/api/*.ts` clients minus the 3 NEXT_PUBLIC files + the `useSettingsPanel` hook + 2 new clients (`auth.ts`, `workflowPreferences.ts`); T06 owns the 3 NEXT_PUBLIC files + 4 new proxy routes + 2 in-process consumer migrations (`video-editing-chat/route.ts` rewrite, `intent-detection/route.ts` deletion). The two scopes are explicitly disjoint per spec §10 of S05/S06.

**Critical: T05 owes the body re-shape contracts that T04 delegated.** Without T05 picking these up correctly, the `auth/login`, `video-compose`, `video-understanding-script`, `workflow-preferences/save`, and `convert-to-script` flows will break end-to-end (backend rejects the shape OR client misinterprets the response).
</parameter>
</invoke>