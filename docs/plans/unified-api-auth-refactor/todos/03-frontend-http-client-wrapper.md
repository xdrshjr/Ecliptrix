# TODO 03: Frontend HTTP Client Wrapper

> **Spec:** [specs/03-frontend-http-client-wrapper.md](../specs/03-frontend-http-client-wrapper.md)

## Dependencies

```yaml
depends_on: []
blocks: [05, 06, 07]
parallel_group: A
```

- **No upstream dependencies** — can start immediately. Browser-side work, independent of backend.
- **Blocks T05 (lib/api refactor)** — every refactored client uses `http.*` from this wrapper
- **Blocks T06 (direct call migration)** — migrated direct-call clients also use `http.*`
- **Blocks T07 (testing suite)** — integration tests exercise this wrapper end-to-end (per spec §1 header and master-plan §8)
- **Parallel group A** — runs in Phase 1 alongside T01 and T02

## Tasks

- [ ] Read sibling spec `03-frontend-http-client-wrapper.md` end to end
- [ ] Create `src/lib/auth/storage-keys.ts` exporting `SESSION_TOKEN_KEY = 'ecliptrix-session-token'` and `SESSION_USER_KEY = 'ecliptrix-user'`
- [ ] Implement `src/lib/api/http-client.ts` per spec §3 pseudocode
  - [ ] Define `RequestOptions` interface from §3 with `requireAuth` defaulting to `true` (secure-by-default per AC #3)
  - [ ] Define typed errors: `MissingAuthError`, `SessionExpiredError`, `ForbiddenError`, `ApiError`, `TimeoutError`
  - [ ] Implement internal `request<T>(method, path, body?, opts?)` per §3.1 flow
  - [ ] Browser-only guard: `if (typeof window === 'undefined') throw Error('http-client is browser-only')`
  - [ ] Path validation: reject paths starting with `http://` or `https://` per §4 (synchronous throw, no fetch issued)
  - [ ] Auth injection: read `localStorage.getItem(SESSION_TOKEN_KEY)`, throw `MissingAuthError` if `requireAuth` and no token. The error message MUST tell the developer to either log in first or pass `{requireAuth: false}` (per AC #4)
  - [ ] Body handling: JSON.stringify objects, pass FormData unchanged with no Content-Type. Treat `body: undefined` on `post` as empty JSON `{}` (per spec §8 edge case)
  - [ ] Timeout: AbortController + setTimeout, default 30000
  - [ ] External signal support: forward `opts.signal` to AbortController
  - [ ] 401 handler: clear localStorage FIRST (both `SESSION_TOKEN_KEY` and `SESSION_USER_KEY`), then dispatch `ecliptrix:session-expired` event, then redirect to `/login?reason=session-expired` UNLESS already on `/login` or `/register`, then throw `SessionExpiredError`. Order matters per AC #5. Use a once-flag to debounce parallel 401s so 10 in-flight requests cause a single redirect (T18)
  - [ ] 403 handler: throw `ForbiddenError` with parsed body
  - [ ] >= 400 handler: throw `ApiError` carrying `status`, `errorCode`, `message`, `details`
  - [ ] 204 / empty response handling: return `null as T`
  - [ ] Non-JSON response handling: catch parse error, re-throw as `ApiError` with `details: { rawBodyTruncated }`
  - [ ] Retry logic: only on network errors / 5xx, never on 4xx, default `retries: 0`
  - [ ] Export `http` object with methods: `get`, `post`, `put`, `del`, `upload`
- [ ] Modify `src/contexts/AuthContext.tsx`:
  - [ ] Replace inline `'ecliptrix-session-token'` and `'ecliptrix-user'` strings with imports from `storage-keys.ts`
  - [ ] Add a `useEffect` listener for the `ecliptrix:session-expired` window event that calls the existing logout state-clearing logic
- [ ] Create `src/lib/api/__tests__/http-client.test.ts` with all 18 cases (T1-T18) from spec §6. Use Vitest syntax + `vi.fn()` to mock fetch
- [ ] Tests cannot run until T07 installs Vitest — document the gap in the completion report
- [ ] Run `npm run type-check` — must pass
- [ ] Run `npm run build` — must succeed (catches missing imports / SSR-unsafe references in the wrapper module)
- [ ] Sync `src/lib/api/http-client.ts`, `src/lib/auth/storage-keys.ts`, `src/contexts/AuthContext.tsx`, `src/lib/api/__tests__/http-client.test.ts` to Singapore-01 staging area
- [ ] Write execution summary at `summaries/phase-1/dev--<agent-id>--todo-03.md`
- [ ] Mark TODO complete in the agent's completion report
