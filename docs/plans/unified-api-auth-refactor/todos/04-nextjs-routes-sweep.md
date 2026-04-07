# TODO 04: Next.js Routes Layer Sweep

> **Spec:** [specs/04-nextjs-routes-sweep.md](../specs/04-nextjs-routes-sweep.md)

## Dependencies

```yaml
depends_on: [01, 02]
blocks: [05, 06, 07]
parallel_group: B
```

- **Depends on T01** — backend must be enforcing auth before routes start consistently forwarding `Authorization`
- **Depends on T02** — must import `backendConfig` from S02's module
- **Blocks T05, T06** — route contract must be settled before clients bind to it
- **Blocks T07** — testing exercises the proxy helper end-to-end
- **Parallel group B** — runs in Phase 2, alone (it modifies ~90 files and parallelizing more agents in this phase would risk merge conflicts)

## Tasks

- [ ] Read sibling spec `04-nextjs-routes-sweep.md` end to end, especially §3.0 (dynamic route patterns) and §5 (special-case routes table)
- [ ] Read approved sibling specs `01-backend-auth-middleware.md` and `02-backend-url-config-module.md`
- [ ] Implement `src/lib/api/server/backend-proxy.ts` per spec §3 pseudocode
  - [ ] First line: `import 'server-only'`
  - [ ] Import `backendConfig` from `@/lib/config/backend`
  - [ ] Define types: `ProxyOptions`, `BackendPath`, `RouteContext`
  - [ ] Export TypeScript types for the proxy result and the error envelope shape (`{success: false, message, error_code, error_details}`) per AC #11
  - [ ] Implement `backendProxy.{get, post, put, del}` per spec §3.1 execution flow
  - [ ] Always forward `Authorization` and `x-session-token` headers
  - [ ] Resolve `BackendPath` builder via awaited `ctx.params` (Next.js 15)
  - [ ] Multipart vs JSON body handling per §3.1
  - [ ] Streaming pass-through when `streaming: true`
  - [ ] AbortController + configurable `timeoutMs`
  - [ ] On timeout: return 504 with timeout envelope
  - [ ] On network error: return 502 with network envelope
  - [ ] Error response handling: forward backend 4xx/5xx with status + body unchanged when body is JSON; wrap non-JSON backend errors in `{success:false, message, error_code:'BACKEND_ERROR', error_details:{...}}` per AC #7
  - [ ] Implement `createPassthroughRoute(backendPath, opts?)` returning `(req, ctx)` handlers
- [ ] Create `src/lib/api/server/__tests__/backend-proxy.test.ts` with all 20 cases (T1-T20 from spec §6)
- [ ] **Sweep all route files under `src/app/api/**/route.ts`:**
  - [ ] First, generate the audit table at `docs/plans/unified-api-auth-refactor/audit/route-sweep-audit.md` listing every file BEFORE starting (run grep for the 3 env var names + count routes)
  - [ ] For each route, classify as Pattern A / B / C / D / E (per spec §4)
  - [ ] Apply Pattern A transform to plain passthroughs
  - [ ] Apply Pattern B for auth-forwarding (now automatic via helper)
  - [ ] Apply Pattern C with `timeoutMs` for long-running routes
  - [ ] Apply Pattern D with `streaming: true` for streaming routes
  - [ ] For Pattern E (escape hatches), import `backendConfig` directly + add `// SWEEP-EXCEPTION:` comment + reason
  - [ ] **Limit Pattern E to ≤5 routes total** — if more, extend the helper instead
  - [ ] For dynamic routes (`[id]`, `[...slug]`), use `BackendPath` builder form per §3.0
- [ ] Special-case routes from spec §5:
  - [ ] `auth/login/route.ts` — convert to Pattern A (the body re-shape is delegated to S05's new `auth.ts` client)
  - [ ] `auth/register/route.ts` — Pattern A
  - [ ] `auth/validate-session/route.ts` — Pattern A
  - [ ] `auth/logout/route.ts` — Pattern B (Authorization forwarded)
  - [ ] `video-compose/route.ts` — Pattern C with 600s timeout
  - [ ] `chat/route.ts` — replace `BACKEND_URL` reads with `backendConfig.baseUrl` for the `/api/model-settings/resolve/chat` call. The third-party LLM streaming portion stays as escape-hatch with `// SWEEP-EXCEPTION: third-party LLM stream`
  - [ ] `workflow/ai-video-generate/route.ts` — Pattern C, was `BACKEND_SERVICE_URL`
  - [ ] `ai-mixed-editing/*` — convert from `BACKEND_SERVICE_URL`
  - [ ] `audio-search/*` — convert; collapse the mixed `BACKEND_URL` + `BACKEND_SERVICE_URL` reads to `backendConfig.baseUrl`
  - [ ] `workflow-preferences/save/route.ts` — Pattern A (body key rename delegated to S05's new `workflowPreferences.ts` client)
  - [ ] `timeline-export/route.ts` — Pattern C or D (verify file size during implementation)
  - [ ] `config/route.ts` — Pattern A
  - [ ] Dynamic-route family `admin/users/[userId]/*` — use builder form
  - [ ] Dynamic-route family `silence/status/[taskId]` — use builder form
  - [ ] Catch-all `storage/files/[...path]` — Pattern E with explicit response-header allowlist
- [ ] Run `grep -rn "process.env.BACKEND_URL\|process.env.BACKEND_SERVICE_URL\|process.env.PYTHON_BACKEND_URL" src/app/api/` — must return ZERO matches
- [ ] Run `grep -rn "'http://localhost:8000'" src/app/api/` — must return ZERO matches
- [ ] Run `npm run type-check` — must pass
- [ ] Run `npm run build` — must succeed (catches missing imports)
- [ ] Generate the final audit table per spec §8 (file, methods, backend path, pattern, auth, notes) plus the summary block (totals, lines added/removed, escape-hatch list)
- [ ] Append before/after sample diffs for at least 3 representative routes (one Pattern A, one Pattern B/C, one dynamic-route builder) to the audit doc per AC #14
- [ ] Sync all changed files under `src/lib/api/server/`, `src/app/api/**/route.ts`, plus the audit doc to Singapore-01 staging area
- [ ] Write execution summary at `summaries/phase-2/dev--<agent-id>--todo-04.md`
- [ ] Mark TODO complete in the agent's completion report
