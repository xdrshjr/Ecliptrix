# Execution Summary — Phase 3.5: ModelSettingsPanel Auth Fix

> **Agent:** google-dev-05 (continuation invocation)
> **Phase:** 3.5 (out of T05 spec scope, in-scope for unified-api-auth-refactor end-to-end correctness)
> **Date:** 2026-04-07
> **Verdict:** COMPLETE — zero `fetch(` matches in target file, type-check PASS (no new errors), build PASS, smoke tests added, audit doc updated.

---

## What was done

Migrated all 12 raw `fetch('/api/model-settings/...')` calls in `src/components/AdminSettings/ModelSettingsPanel.tsx` to the secure-by-default `http.*` wrapper from T03. The component is `'use client'` and was missed in T05's spec §3 (which only listed the sibling `useSettingsPanel.ts` hook). After T01's middleware enforced auth in production, every one of these 12 calls would have returned 401 because the route forwards no token.

This was correctly classified by the T05 reviewer as Phase 3.5 work (NOT T05 rework) because the file was broken the moment T01 shipped, not when T05 shipped.

### Concrete deliverables (1 modified, 1 created, 1 updated)

**Modified:**
- `src/components/AdminSettings/ModelSettingsPanel.tsx` — replaced 12 `fetch()` calls with `http.get`/`http.post`/`http.put`/`http.del`. Removed `headers: { 'Content-Type': 'application/json' }` and `body: JSON.stringify(...)` boilerplate (the wrapper handles it). Added 7 typed envelope interfaces (`KnownProvidersResponse`, `SavedProvidersResponse`, `AssignmentsResponse`, `ProviderMutationResponse`, `FetchModelsResponse`, `ResolveConfigResponse`). Converted all `res.ok && data.success` patterns to try/catch + typed `ApiError` propagation. Preserved the optional `fetchEffectiveConfigs` per-function swallow with a comment per spec §9. Removed one redundant `setSavingProvider(false)` early-return that the new try/finally handles.

**Created:**
- `src/components/AdminSettings/__tests__/ModelSettingsPanel.test.ts` — 6 smoke tests covering:
  1. `fetchData` parallel `http.get` calls on the three model-settings paths
  2. `handleSaveProvider` (create) → `http.post` with body
  3. `handleSaveProvider` (update) → `http.put` with `__KEEP__` sentinel
  4. `handleDeleteProvider` → `http.del`
  5. `handleResetAssignment` → `http.del` on `assignments/{ft}`
  6. `ApiError` propagation from the wrapper (load-bearing assertion that 401/403/500 reach the component catch)

**Updated:**
- `docs/plans/unified-api-auth-refactor/audit/lib-api-refactor-audit.md` — added "Phase 3.5 Addendum" section documenting the 12-row migration table, side fixes, verification grep results, and test coverage. Updated the original risk #1 to mark it RESOLVED.

---

## The 12 fetch calls migrated

| # | Old line | Old call | New call |
|---|---:|---|---|
| 1 | 195 | `fetch('/api/model-settings/providers')` | `http.get<KnownProvidersResponse>(...)` |
| 2 | 196 | `fetch('/api/model-settings/providers/saved')` | `http.get<SavedProvidersResponse>(...)` |
| 3 | 197 | `fetch('/api/model-settings/assignments')` | `http.get<AssignmentsResponse>(...)` |
| 4 | 353 | `fetch(.../providers/{id}, PUT, JSON)` | `http.put<ProviderMutationResponse>(path, body)` |
| 5 | 371 | `fetch(.../providers, POST, JSON)` | `http.post<ProviderMutationResponse>(path, body)` |
| 6 | 400 | `fetch(.../providers/{id}, DELETE)` | `http.del<ProviderMutationResponse>(path)` |
| 7 | 420 | `fetch(.../fetch-models, POST, JSON)` | `http.post<FetchModelsResponse>(path, body)` |
| 8 | 429 | `fetch(.../providers/{id}/fetch-models, POST)` | `http.post<FetchModelsResponse>(path)` |
| 9 | 493 | `fetch(.../test-connection, POST, JSON)` | `http.post<TestResult>(path, body)` |
| 10 | 546 | `fetch(.../assignments, PUT, JSON)` | `http.put<ProviderMutationResponse>(path, body)` |
| 11 | 573 | `fetch(.../assignments/{ft}, DELETE)` | `http.del(path)` |
| 12 | 618 | `fetch(.../resolve/{ft})` | `http.get<ResolveConfigResponse>(path)` |

---

## Hard verification

| Check | Command | Result |
|---|---|---|
| Zero raw `fetch` | `grep -n "fetch(" src/components/AdminSettings/ModelSettingsPanel.tsx` | **0 matches** |
| http-client import | `grep -n "from '@/lib/api/http-client'" src/components/AdminSettings/ModelSettingsPanel.tsx` | 1 match (line 6: `import { http, ApiError }`) |
| Type-check | `npx tsc --noEmit 2>&1 \| grep ModelSettingsPanel` | **0 new errors** |
| Type-check (full) | `npx tsc --noEmit` | Only pre-existing dormant Vitest test errors (`trimming.test.ts`, `lib/api/__tests__/*.test.ts`, etc.) — same posture as T02/T03/T04/T05 |
| Build | `BACKEND_URL=http://localhost:8088 npm run build` | **PASS** — all routes compile |

---

## Lines changed

- `ModelSettingsPanel.tsx`: net delta approximately **−25 LoC** (12 fetch+headers+stringify boilerplate blocks replaced with leaner `http.*` calls; ~40 lines added for typed envelope interfaces and explicit `ApiError` catch arms). Total file: 1482 → ~1497 lines.
- `ModelSettingsPanel.test.ts`: 110 LoC (new file).
- `lib-api-refactor-audit.md`: ~80 LoC added (Phase 3.5 Addendum section).

---

## Files touched

| Path | Change |
|---|---|
| `src/components/AdminSettings/ModelSettingsPanel.tsx` | 12 fetch calls migrated; 7 typed envelopes added; typed ApiError catches |
| `src/components/AdminSettings/__tests__/ModelSettingsPanel.test.ts` | New — 6 smoke tests |
| `docs/plans/unified-api-auth-refactor/audit/lib-api-refactor-audit.md` | Phase 3.5 Addendum + risk #1 marked RESOLVED |
| `docs/plans/unified-api-auth-refactor/summaries/phase-3/dev--google-dev-05--phase-3.5.md` | New — this summary |

---

## Notes for reviewer / tester

- The component still uses `'use client'` directive on line 1 (verified — required for the `http.*` wrapper which is browser-only and asserts `typeof window !== 'undefined'`).
- The original code's `catch {}` swallows in `handleResetAssignment` and `handleSaveAssignment` are preserved in spirit (now `catch (err)` with typed-error branching to surface the message), so the user still sees a toast on failure rather than silent breakage.
- The optional advanced-tab `fetchEffectiveConfigs` per-function inner `try/catch { return null }` swallow is intentionally preserved with an explanatory comment, matching the §9 spec guidance for non-fatal optional features.
- No backend changes required — all 12 endpoints already accept `Authorization: Bearer <token>` from the existing T01 middleware-enforced routes.
