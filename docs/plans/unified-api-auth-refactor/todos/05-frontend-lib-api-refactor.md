# TODO 05: Frontend lib/api Modules Refactor

> **Spec:** [specs/05-frontend-lib-api-refactor.md](../specs/05-frontend-lib-api-refactor.md)

## Dependencies

```yaml
depends_on: [03, 04]
blocks: [07]
parallel_group: C
```

- **Depends on T03** — uses `http.*` from the wrapper. The wrapper API must be locked.
- **Depends on T04** — two new clients (`auth.ts`, `workflowPreferences.ts`) receive body re-shape logic that S04 explicitly removes from route handlers
- **Blocks T07** — integration tests verify these clients end-to-end
- **Parallel group C** — runs in Phase 3 (after Phase 2 = T04 finishes), can run in parallel with T06

## Tasks

- [ ] Read sibling spec `05-frontend-lib-api-refactor.md` end to end
- [ ] Read approved sibling specs `03-frontend-http-client-wrapper.md` and `04-nextjs-routes-sweep.md`
- [ ] **Refactor 12 existing `src/lib/api/*.ts` clients** (one per file, in any order):
  - [ ] `config.ts`
  - [ ] `userMaterials.ts`
  - [ ] `videoComposition.ts`
  - [ ] `videoCut.ts`
  - [ ] `workflow.ts`
  - [ ] `arkImage.ts`
  - [ ] `userManagement.ts` — also remove the local `getAuthHeaders()` helper
  - [ ] `promptPolish.ts`
  - [ ] `arkVideo.ts`
  - [ ] `systemSettings.ts` — also remove the local `getAuthHeaders()` helper
  - [ ] `tts.ts`
  - [ ] `storyboard.ts`
- [ ] For each refactored file:
  - [ ] Replace raw `fetch(...)` calls with `http.get/post/put/del/upload(...)` from `@/lib/api/http-client`
  - [ ] Remove duplicate `getAuthHeaders()` if present
  - [ ] Remove `localStorage.getItem('ecliptrix-session-token')` (the wrapper handles it)
  - [ ] Remove `if (typeof window !== 'undefined')` SSR guards that become redundant (the wrapper has its own SSR guard per spec §9)
  - [ ] Preserve existing exported function signatures (consumers must not need changes)
  - [ ] Apply Pattern 4.2 (try/catch for friendly error messages) only where the original code constructed user-facing messages
  - [ ] When catching errors, use the typed errors from S03 (`MissingAuthError`, `SessionExpiredError`, `ForbiddenError`, `ApiError`) — NO string-matching against `err.message` (per spec AC #8)
  - [ ] Remove `console.error` logs (let errors propagate to error boundary)
  - [ ] Preserve any intentional `.catch(() => null)` swallows for optional features, adding a comment `// Optional feature; failure is non-fatal` (per spec §9)
- [ ] **Migrate 1 component hook:**
  - [ ] `src/components/AdminSettings/components/useSettingsPanel.ts` — remove its `getAuthHeaders()` and `localStorage` reads, switch to `http.*`
- [ ] **Create 2 new typed clients** (delegated from T04):
  - [ ] `src/lib/api/auth.ts` — receives the `result.user → transformedUser` reshape that T04 removed from `auth/login/route.ts`. Exposes `login`, `register`, `validateSession`, `logout` functions built on `http.*`
  - [ ] `src/lib/api/workflowPreferences.ts` — receives the `userId → user_id` key rename that T04 removed from `workflow-preferences/save/route.ts`. Exposes `save`, `load` functions built on `http.*`
- [ ] **Smoke tests** — for each of the 15 refactored / new files, create `__tests__/<name>.test.ts` with at least 2 cases (positive case verifying path + body shape, and error case verifying that an `ApiError` from `http.*` propagates without being wrapped/swallowed). Use Vitest syntax with `vi.spyOn(httpModule.http, 'get')` to mock the wrapper (NOT raw fetch)
  - [ ] 12 tests under `src/lib/api/__tests__/` for the modified clients (one per refactored file in the 12-file list above)
  - [ ] 1 test under `src/components/AdminSettings/components/__tests__/useSettingsPanel.test.ts`
  - [ ] 2 additional tests under `src/lib/api/__tests__/` for the new `auth.ts` and `workflowPreferences.ts` clients
- [ ] **Verify the 3 NEXT_PUBLIC files are NOT touched in this TODO** (`src/lib/api/audioTranscription.ts`, `src/lib/api/llm.ts`, `src/lib/intent-detection-service.ts`) — they belong to TODO 06 (per spec AC #6 / §11)
- [ ] Run `npm run type-check` — must pass (per spec AC #12)
- [ ] Run `grep -rn "fetch(" src/lib/api/` — only matches in `http-client.ts` and `__tests__/` (per spec AC #3)
- [ ] Run `grep -rn "function getAuthHeaders\|const getAuthHeaders" src/` — ZERO matches (per spec AC #5)
- [ ] Run `grep -rn "localStorage.getItem('ecliptrix-session-token')\|localStorage.getItem(\"ecliptrix-session-token\")" src/` — only matches in `AuthContext.tsx` and `http-client.ts` (per spec AC #4)
- [ ] Generate audit at `docs/plans/unified-api-auth-refactor/audit/lib-api-refactor-audit.md` per spec §8 (before/after LoC table for each refactored/created file + "Public functions changed" column + Notes column + verification block at the bottom showing the result of each grep listed in spec §2)
- [ ] Sync all changed files in `src/lib/api/`, `src/components/AdminSettings/components/useSettingsPanel.ts`, and audit doc to Singapore-01 staging area
- [ ] Write execution summary at `summaries/phase-3/dev--<agent-id>--todo-05.md`
- [ ] Mark TODO complete in the agent's completion report
