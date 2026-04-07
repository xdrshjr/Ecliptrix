# Spec 05: Frontend lib/api Modules Refactor

> **Owner role:** Frontend developer (browser-side)
> **Layer:** Browser (`src/lib/api/`, plus 1 hook in `src/components/AdminSettings/components/`)
> **Depends on:** S03 (HTTP client wrapper), S04 (Next.js routes contract is settled)
> **Blocks:** S07 (testing exercises this)

---

## 1. Purpose

Refactor every typed service client under `src/lib/api/*.ts` to call the new HTTP wrapper from S03 instead of hand-rolling `fetch`. This eliminates:

- Duplicate `getAuthHeaders()` helpers (currently in 3 files: `userManagement.ts`, `systemSettings.ts`, `useSettingsPanel.ts`, soon to be 0)
- Direct `localStorage.getItem('ecliptrix-session-token')` reads (currently in 4 files including 1 component hook, soon limited to `AuthContext.tsx` and `http-client.ts` only)
- Inconsistent 401 handling (currently every client handles it differently or not at all)
- Inconsistent error format (some throw, some return `{success:false}`, some `console.error`)

After this spec, every browser→Next.js call goes through `http.get/post/put/del/upload` from S03. Auth header injection, 401 logout, error envelope normalization are all automatic.

---

## 2. Acceptance Criteria

1. Every file under `src/lib/api/*.ts` (except `http-client.ts` itself, the new `server/` subdir from S04, and `__tests__/`) is refactored to call `http.get/post/put/del/upload` instead of raw `fetch`
2. The `'use client'` hook `src/components/AdminSettings/components/useSettingsPanel.ts` is also refactored — it currently has its own `getAuthHeaders()` and calls `fetch` directly. After this spec it uses `http.*` like everything else
3. `grep -rn "fetch(" src/lib/api/` returns matches ONLY in `http-client.ts` and inside `__tests__/`
4. `grep -rn "localStorage.getItem('ecliptrix-session-token')\|localStorage.getItem(\"ecliptrix-session-token\")" src/` returns matches ONLY in `src/contexts/AuthContext.tsx` and `src/lib/api/http-client.ts`
5. `grep -rn "function getAuthHeaders\|const getAuthHeaders" src/` returns ZERO matches (all duplicates removed)
6. The 3 files that use `NEXT_PUBLIC_BACKEND_URL` / `NEXT_PUBLIC_API_BASE_URL` are NOT touched here — they belong to S06 (which depends on S05)
7. Every refactored client file preserves its existing exported function signatures so React components do not need to change
8. Every refactored client file uses the typed errors from S03 (`MissingAuthError`, `SessionExpiredError`, `ForbiddenError`, `ApiError`) — no string-matching error handling
9. Console error logs are removed from client files (the wrapper does NOT log; callers can opt in to log via try/catch). Rationale: noisy logs make production debugging harder
10. Unit tests in `src/lib/api/__tests__/<each-client>.test.ts` exist for the migrated clients — at minimum smoke tests verifying the wrapper is called with the correct path and body shape
11. The audit deliverable `docs/plans/unified-api-auth-refactor/audit/lib-api-refactor-audit.md` lists every refactored file with before/after line counts and a brief note on any non-trivial changes
12. Type checking passes: `npm run type-check` exits 0

---

## 3. Files In Scope

The 14 currently-existing service files in `src/lib/api/`, plus 1 component hook, plus 2 NEW typed clients delegated from S04:

| # | File | Current state | Auth needed? |
|---|---|---|---|
| 1 | `src/lib/api/config.ts` | Calls `/api/config` (a Next.js route). No auth helper. | yes (post-refactor; backend allowlist does not include `/api/config`) |
| 2 | `src/lib/api/userMaterials.ts` | CRUD on user materials. Has manual auth header. | yes |
| 3 | `src/lib/api/videoComposition.ts` | Composition task submission + status polling. | yes |
| 4 | `src/lib/api/videoCut.ts` | AI mixed editing trigger + status. | yes |
| 5 | `src/lib/api/workflow.ts` | Workflow agent CRUD. Already has auth. | yes |
| 6 | `src/lib/api/arkImage.ts` | ARK image generation status polling. | yes |
| 7 | `src/lib/api/userManagement.ts` | Admin user CRUD. Has `getAuthHeaders()` helper. | yes (admin) |
| 8 | `src/lib/api/promptPolish.ts` | LLM prompt polishing. | yes |
| 9 | `src/lib/api/arkVideo.ts` | ARK video generation status polling. | yes |
| 10 | `src/lib/api/audioTranscription.ts` | **OUT OF SCOPE for S05** — currently uses `NEXT_PUBLIC_API_BASE_URL`. Migrated by S06. |
| 11 | `src/lib/api/llm.ts` | **OUT OF SCOPE for S05** — currently uses `NEXT_PUBLIC_API_BASE_URL`. Migrated by S06. |
| 12 | `src/lib/api/systemSettings.ts` | System settings CRUD. Has `getAuthHeaders()` helper. | yes (admin) |
| 13 | `src/lib/api/tts.ts` | TTS task submission + status. | yes |
| 14 | `src/lib/api/storyboard.ts` | Storyboard generation + packing. | yes |
| 15 | `src/components/AdminSettings/components/useSettingsPanel.ts` | `'use client'` hook with own `getAuthHeaders()` + raw `fetch`. | yes |

Plus: `src/lib/intent-detection-service.ts` is **OUT OF SCOPE for S05** — belongs to S06.

**Two NEW files created by S05** (delegated from S04 — see S04 §5 special-case rows for `auth/login` and `workflow-preferences/save`):

| # | File | Why created here |
|---|---|---|
| 16 | `src/lib/api/auth.ts` | Receives the `result.user` → `transformedUser` reshape that S04 removes from `src/app/api/auth/login/route.ts` so that route can become Pattern A. Also exposes typed login/register/validate-session/logout functions built on `http.*`. |
| 17 | `src/lib/api/workflowPreferences.ts` | Receives the `userId` → `user_id` key rename that S04 removes from `src/app/api/workflow-preferences/save/route.ts` so that route can become Pattern A. Exposes typed save/load functions built on `http.*`. |

**Total in scope: 15 files (12 modified from `src/lib/api/` + 1 modified component hook + 2 new files).**

---

## 4. Migration Pattern

### 4.1 Standard pattern (most clients)

**Before** (the actual function in `src/lib/api/userManagement.ts` is `getUserList`, shown here in shortened form):
```ts
// src/lib/api/userManagement.ts
function getAuthHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined'
    ? localStorage.getItem('ecliptrix-session-token')
    : null
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

export async function getUserList(params: UserListParams = {}): Promise<UserListResponse> {
  const searchParams = new URLSearchParams()
  // ... build params ...
  const url = `/api/admin/users/list?${searchParams.toString()}`
  const response = await fetch(url, { headers: getAuthHeaders() })
  const json = await handleResponse<Record<string, unknown>>(response)
  // ... normalize snake_case → camelCase ...
  return normalizedResult
}
```

**After:**
```ts
// src/lib/api/userManagement.ts
import { http } from '@/lib/api/http-client'

export async function getUserList(params: UserListParams = {}): Promise<UserListResponse> {
  const searchParams = new URLSearchParams()
  // ... build params (unchanged) ...
  const json = await http.get<Record<string, unknown>>(
    `/api/admin/users/list?${searchParams.toString()}`,
  )
  // ... normalize snake_case → camelCase (unchanged) ...
  return normalizedResult
}
```

The exported function signature is unchanged. React components don't need to modify imports or call sites. The snake_case→camelCase normalization helpers stay where they are — only the auth/fetch boilerplate is removed.

### 4.2 Pattern for clients with custom error messages

If a client currently constructs a user-friendly error message from the raw response, that logic moves into a `try/catch`:

```ts
export async function getUserList(params: UserListParams = {}): Promise<UserListResponse> {
  try {
    return await http.get<UserListResponse>(`/api/admin/users/list?${qs}`)
  } catch (err) {
    if (err instanceof ApiError) {
      throw new Error(`Failed to list users: ${err.message}`)
    }
    throw err
  }
}
```

This is preferred over swallowing errors silently.

### 4.3 Pattern for clients with file uploads

Use `http.upload(path, formData)`:

```ts
export async function uploadMaterial(file: File): Promise<MaterialResponse> {
  const fd = new FormData()
  fd.append('file', file)
  return http.upload<MaterialResponse>('/api/user-materials/upload', fd)
}
```

### 4.4 Pattern for polling clients

Polling clients (`arkImage`, `arkVideo`, `videoComposition`, `tts`) currently call status endpoints in a loop. These do NOT need to change their loop logic — only the inner `fetch` call is replaced with `http.get`. The loop's abort/timeout behavior is preserved.

### 4.5 Pattern for `useSettingsPanel.ts` hook

This is the only React hook that owns its own auth helper. The migration:

1. Remove the local `getAuthHeaders()` function entirely
2. Remove the `localStorage.getItem('ecliptrix-session-token')` call
3. Replace `fetch(...)` calls with `http.get/post/put/del`
4. Remove any try/catch that was just re-formatting the error — let `ApiError` propagate to the React error boundary

The hook continues to expose the same return type so consuming components are unaffected.

---

## 5. Removal of duplicates

After this spec, the following code patterns disappear from the entire codebase:

| Pattern | Files removed from |
|---|---|
| `function getAuthHeaders(): Record<string, string>` | `userManagement.ts`, `systemSettings.ts`, `useSettingsPanel.ts` |
| `localStorage.getItem('ecliptrix-session-token')` outside of AuthContext / http-client | All consumers |
| `fetch('/api/...', { ... })` inside `src/lib/api/*` | All clients (replaced with `http.*`) |
| `console.error('Failed to ...', err)` inside `src/lib/api/*` | All clients (let errors propagate) |

---

## 6. Test Strategy

Each refactored client gets a smoke test in `src/lib/api/__tests__/<name>.test.ts`. The tests use Vitest and mock the HTTP client (NOT raw fetch).

```ts
// src/lib/api/__tests__/userManagement.test.ts (pseudocode)
import * as httpModule from '@/lib/api/http-client'
import { getUserList } from '../userManagement'

vi.spyOn(httpModule.http, 'get').mockResolvedValue({ users: [], total: 0 })

it('getUserList calls http.get with correct path', async () => {
  await getUserList({ page: 1, pageSize: 10 })
  expect(httpModule.http.get).toHaveBeenCalledWith(
    expect.stringContaining('/api/admin/users/list?'),
  )
})
```

| Per-client test coverage minimum |
|---|
| At least one positive case (verifies path + body shape) |
| At least one error case (verifies that an `ApiError` from `http.*` propagates without being wrapped/swallowed) |

The test count is roughly 30-34 (2 per client × 15 clients, counting the 12 modified `lib/api/*.ts` clients + the migrated `useSettingsPanel` hook + the 2 new `auth.ts`/`workflowPreferences.ts` clients). These are smoke tests, not exhaustive — exhaustive coverage of the auth/error paths is in S03's `http-client.test.ts`.

---

## 7. Files to Create / Modify

| File | Action | LoC est |
|---|---|---|
| `src/lib/api/config.ts` | Modify | net -10 |
| `src/lib/api/userMaterials.ts` | Modify | net -30 |
| `src/lib/api/videoComposition.ts` | Modify | net -40 |
| `src/lib/api/videoCut.ts` | Modify | net -25 |
| `src/lib/api/workflow.ts` | Modify | net -30 |
| `src/lib/api/arkImage.ts` | Modify | net -20 |
| `src/lib/api/userManagement.ts` | Modify | net -35 |
| `src/lib/api/promptPolish.ts` | Modify | net -15 |
| `src/lib/api/arkVideo.ts` | Modify | net -20 |
| `src/lib/api/systemSettings.ts` | Modify | net -35 |
| `src/lib/api/tts.ts` | Modify | net -30 |
| `src/lib/api/storyboard.ts` | Modify | net -25 |
| `src/components/AdminSettings/components/useSettingsPanel.ts` | Modify | net -25 |
| `src/lib/api/auth.ts` | Create (receives reshape from S04 `auth/login` route) | +60 |
| `src/lib/api/workflowPreferences.ts` | Create (receives key rename from S04 `workflow-preferences/save` route) | +40 |
| `src/lib/api/__tests__/<each>.test.ts` | Create (×15) | +750 (~50 each) |
| `docs/plans/unified-api-auth-refactor/audit/lib-api-refactor-audit.md` | Create | ~150 |

**Estimated total: net source LoC reduction of ~240 lines (auth/error boilerplate removal of ~340, offset by ~100 lines of new typed clients in `auth.ts` + `workflowPreferences.ts`). Adding tests adds ~750 lines but those are tests, not production surface.**

---

## 8. Audit Deliverable

`docs/plans/unified-api-auth-refactor/audit/lib-api-refactor-audit.md` contains a table:

| File | Before LoC | After LoC | Public functions changed | Notes |
|---|---|---|---|---|
| `userManagement.ts` | 145 | 110 | 0 | Removed `getAuthHeaders()` helper. All call sites preserved. |
| `useSettingsPanel.ts` | 87 | 62 | 0 | Was the only `'use client'` hook with raw `fetch` outside `lib/api`. Now uses `http.*` like everything else. |
| ... | ... | ... | ... | ... |

Plus a verification block at the bottom showing the result of each grep listed in Section 2 (proving all the constraints hold).

---

## 9. Failure Modes & Edge Cases

| Edge case | Handling |
|---|---|
| A client currently does its own retry loop (e.g., for polling) | Kept as-is. The wrapper's `retries` option is NOT used for polling — polling is a different concept. The inner call uses `http.get` once per iteration |
| A client currently passes a custom `Content-Type` header (rare) | Pass it via `http.get(..., { headers: { 'Content-Type': '...' } })` — the wrapper merges custom headers with its defaults |
| A client currently swallows errors with `.catch(() => null)` to allow optional features to fail silently | This is acceptable IF clearly intentional. Add a comment `// Optional feature; failure is non-fatal` and keep the swallow |
| A client currently makes a same-origin call to a non-`/api/*` path (e.g., `/storage/foo.jpg` for static asset) | These are NOT API calls and stay as `fetch` (or `<img src=>`). The grep in AC #3 only excludes `src/lib/api/`, so these remain valid |
| A client has `if (typeof window !== 'undefined')` SSR guards | Removable — `http-client.ts` has its own SSR guard (throws if called on server). The duplicate guard becomes redundant |
| The `useSettingsPanel.ts` hook's existing `useEffect` dependency arrays | Verify they don't depend on `getAuthHeaders` (which is being removed). If they do, drop that dependency |

---

## 10. Coordination Notes for Other Agents

- **For S03 (HTTP client wrapper):** S05 critically depends on the wrapper's API being final. If the wrapper API changes after S05 starts, all 13 clients need re-edits. **Lock the wrapper API in S03 before S05 launches its agents.**
- **For S04 (Next.js routes sweep):** The contract (path shape, body shape, error envelope) is unchanged for existing routes that S05 touches. However, two routes that S04 explicitly re-shapes — `auth/login` (transforms `result.user` → frontend shape, that reshape moves into `src/lib/api/auth.ts`) and `workflow-preferences/save` (renames `userId` → `user_id`, that rename moves into `src/lib/api/workflowPreferences.ts`) — MUST be coordinated with S04. Per the master-plan dependency graph (`S04 → S05` is a hard edge) and S04's own coordination notes, **S05 executes after S04 ships**, not in parallel. The minor exceptions above are precisely why the dependency edge exists.
- **For S06 (direct call migration):** The 3 NEXT_PUBLIC files are migrated by S06 using the same pattern as S05. S06's migrated clients should look indistinguishable from S05's migrated clients
- **For S07 (testing):** Integration tests verify that a logged-in user can call `userMaterials.list()` end-to-end and get a real result. Tests for a logged-out user calling the same function expect `MissingAuthError`
- **For Phase 2 reviewers:** Verify that no React component calls `localStorage.getItem('ecliptrix-session-token')` directly. The four legitimate readers are: `AuthContext.tsx`, `http-client.ts`, and (during the validate-session call) the validate-session route — but that route is server-side and uses request body, not localStorage

---

## 11. Out of Scope

- Adding a React Query / SWR layer on top of these clients — explicit non-goal per master plan D3
- Re-shaping any existing function signature (breaks consumers)
- Renaming any function — keep the same names so component imports don't change
- Adding new clients (S06 adds the 3 NEXT_PUBLIC migrations)
- Changing the polling cadence of any status-polling client
- Refactoring `src/lib/intent-detection-service.ts` — handled by S06
- Refactoring `src/lib/api/llm.ts` — handled by S06
- Refactoring `src/lib/api/audioTranscription.ts` — handled by S06
