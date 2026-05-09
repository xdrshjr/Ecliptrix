# Step 5 — Review & Commit Report (iter3)

**Date:** 2026-05-09
**Branch:** main
**Commit:** `22a055c fix: harden web app shell — task persistence, locale sync, form semantics, empty-state UX (iter3)`
**Predecessor:** iter2 review report `6100984`

---

## 1. Code Review Summary

### Scope
Reviewed 17 files in `22a055c`: 8 source modifications, 6 new Vitest test files (33 cases), 3 diagnosis docs (bug-report / fix-plan / fix-plan-reviewed). Net: **+2528 / −85**.

### Compliance with `fix-plan-reviewed.md`

| Bug | Plan | Implementation | Status |
| --- | ---- | -------------- | ------ |
| #1 Project editor has no route — reload loses tasks | LS persistence under `ecliptrix-tasks-state-v1` with `hydrated` guard, lazy initializer kept as `useState(() => createInitialState())`, URL `?tab=&task=` synced via `history.replaceState`, `document.title` mirrors active task, JSON.parse / quota errors caught with `console.warn` fallback, `closeAllTabs` clears LS+URL+title via empty-state write-through | `src/hooks/useTasks.ts` lines 6–48 (constants + `reviveState`/`serializeState` + lazy initializer); 51–104 (mount-only hydration effect with try/catch and URL `?task=` priority *after* LS parse); 107–119 (persist effect hard-gated on `hydrated`); 121–146 (URL + title sync effect, both fire only when `hydrated`); `closeAllTabs` writes empty state and lets effects clear LS/URL/title in the same paint. | OK |
| #2 `<html lang>` not synced on mount | Extract `applyLocaleToDom` helper guarded by `typeof document === 'undefined'`; call from mount effect on **both** hit and miss paths; call from `setLocale` | `src/contexts/LocaleContext.tsx` lines 18–21 (helper with SSR guard); 28–39 (mount effect: hit path at line 33, miss path at line 37); 41–46 (`setLocale` calls helper at line 45). | OK |
| #3 ModelSettingsPanel API Key not in `<form>` | Wrap provider Add/Edit panel in `<form noValidate onSubmit>` with disabled-mirror guard; Save `type="submit"` with onClick removed (single trigger); Test/Fetch/Cancel `type="button"`; API Key `autoComplete="new-password"` | `src/components/AdminSettings/ModelSettingsPanel.tsx`: provider panel wrapped in `<form noValidate onSubmit={…}>` with `if (savingProvider \|\| !name \|\| !api_url) return` mirror guard; Save button is `type="submit"` with no onClick (verified by diff: `-onClick={handleSaveProvider}` retained nowhere on the Save button); the three companion buttons declare `type="button"`; API Key input gains `autoComplete="new-password"`. | OK |
| #4 ChatTypeSelectionModal — same-name workflows + 0-node cards activatable | `sortedWorkflows` `useMemo` (newest first by `updated_at` fallback `created_at`); `emptyWorkflowCount`; `relativeTimeEN` helper; cards become `<button disabled>` with `aria-disabled` + `title` when nodes empty; render `idShort` (·#xxxxxx) only when non-empty; render `Updated {time}`; footer count flips to `workflowsAvailableWithEmpty` when emptyCount > 0 | `src/components/chat/ChatTypeSelectionModal.tsx`: `sortedWorkflows` `useMemo` orders by `updated_at` falling back to `created_at`; `emptyWorkflowCount` derived; `relativeTimeEN(d)` helper handles s/m/h/d granularity; cards switch to `<button disabled>` with `aria-disabled="true"` + `title={t.aiChat.chatTypeModal.emptyWorkflowHint}` when `(workflow.nodes?.length \|\| 0) === 0`; `idShort` rendered conditionally on length; footer count uses `workflowsAvailableWithEmpty` template when `emptyCount > 0`. | OK |
| #5 Brainstorming "underDevelopment" dead end | `features` array tagged `comingSoon: true` for brainstorm; description swapped to `brainstormingDescPreview`; cards use `opacity-60 cursor-not-allowed` (NOT `pointer-events-none` — would block native title tooltip per **Modification 1**); `onClick` guarded; "Coming Soon" badge with `pointer-events-none` on the span itself (decoration); Container.tsx brainstorm dead-end gains `comingSoonHint` subtitle | `src/components/HomePage/LandingPage.tsx`: brainstorm entry has `comingSoon: true`; `description: t.landing.brainstormingDescPreview`; card class is `opacity-60 cursor-not-allowed` for `isComingSoon` (no `pointer-events-none`); onClick guard `if (isComingSoon \|\| isAuthLoading) return`; `aria-disabled` + `title={t.landing.comingSoonHint}` set; badge `<span>` carries its own `pointer-events-none`. `src/components/Container.tsx` line 269 adds `comingSoonHint` subtitle below the brainstorm dead-end title. | OK |
| #6 Export button on empty timeline | `hasAnyExportableItem` `useMemo` checks both tracks length and aggregate `items.length`; disabled gate combines `isExporting \|\| !hasAnyExportableItem`; `title` and `aria-label` flip across 3 branches; `onKeyDown` re-checks the gate before triggering; hardcoded `tabIndex={0}` removed (let `disabled` control Tab order per **Modification 6**) | `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` lines 1979–2027: `hasAnyExportableItem` `useMemo` evaluates `tracks.length > 0 && tracks.some(t => (t.items?.length \|\| 0) > 0)`; `disabled={isExporting \|\| !hasAnyExportableItem}`; `title` / `aria-label` switch through `isExporting → !hasAnyExportableItem (emptyTimeline) → exportVideo` branches; `onKeyDown` early-returns when `!hasAnyExportableItem`; no `tabIndex={0}` literal remains. | OK |

### i18n Schema (8 new keys × 3 locations)

| Key | interface (line range) | EN block | ZH block |
| --- | --- | --- | --- |
| `landing.comingSoonBadge` | 1959–1992 | 4651–4684 | 7348–7381 |
| `landing.comingSoonHint` | 1959–1992 | 4651–4684 | 7348–7381 |
| `landing.brainstormingDescPreview` | 1959–1992 | 4651–4684 | 7348–7381 |
| `videoPlayerPanel.export.emptyTimeline` | 1101–1105 | 3778–3782 | 6475–6479 |
| `aiChat.chatTypeModal.emptyWorkflowHint` | 26–39 | 2703–2716 | 5400–5413 |
| `aiChat.chatTypeModal.idLabel` | 26–39 | 2703–2716 | 5400–5413 |
| `aiChat.chatTypeModal.updatedAt` | 26–39 | 2703–2716 | 5400–5413 |
| `aiChat.chatTypeModal.workflowsAvailableWithEmpty` | 26–39 | 2703–2716 | 5400–5413 |

All keys are present in interface, EN, and ZH per `git show 22a055c -- src/lib/i18n.ts`. Type-check confirms.

### Style & Quality
- **TypeScript:** `npm run type-check` → clean (no diagnostics).
- **ESLint:** no new warnings introduced. All comments in modified files explain *why* (e.g. `LocaleContext.tsx` line 35–36: "No saved locale — defensively sync DOM with the default so the `<html lang>` attribute matches state from the very first paint."), not *what*.
- **No debug artefacts:** no `console.log` left at module top-level. The only consoles in the diff are intentional `console.warn` failure paths in `useTasks.ts` (LS parse / quota / `replaceState` failures).
- **i18n parity:** the 8 new keys are in interface, EN, and ZH; `Translations` interface compiles.
- **Modifications applied:** all 6 corrections from `fix-plan-reviewed.md §1` implemented as specified —
  - Mod 1 (Bug #5): `pointer-events-none` removed from comingSoon card; title tooltip now visible on hover. ✅
  - Mod 2 (Bug #3): Save button has no onClick; only `onSubmit` triggers. ✅
  - Mod 3 (Bug #1): lazy initializer kept as `useState(() => createInitialState())`; URL `?task=` priority runs **after** LS parse (line 64–96), persist effect hard-gated on `hydrated`. ✅
  - Mod 4 (Bug #1): `closeAllTabs` flow syncs URL via `appState` dependency, no manual `replaceState` needed. ✅
  - Mod 5 (Bug #4): `idShort` empty guard hides the row; i18n interface added before EN/ZH. ✅
  - Mod 6 (Bug #6): hardcoded `tabIndex={0}` removed so disabled button auto-removes from Tab order. ✅

### Risks / Gaps
- None blocking.
- `STORAGE_KEY = 'ecliptrix-tasks-state-v1'` — a future schema change must bump the version suffix; currently no migration logic, but `try/catch` around `JSON.parse` ensures malformed older data triggers a warn + fresh start (verified by `useTasks.persistence.test.ts`).
- Pre-existing 2 `backend-proxy.test.ts` failures (T2, T18 — unrelated query-string assertion drift) remain out of scope; confirmed unrelated in iter1 (`28d6ce8`) and iter2 (`711ef28`).

---

## 2. Test Verification

### TypeScript
```
$ npm run type-check
> tsc --noEmit
(no output — clean)
```

### Vitest (frontend)
```
$ npx vitest run
 Test Files  1 failed | 79 passed (80)
      Tests  2 failed | 544 passed (546)
   Duration  19.85s
```

The 2 failures (`backend-proxy.test.ts > T2`, `T18`) are pre-existing and unrelated — both are query-string assertions on `/api/video/compose` and `/api/user/toggle-status/:id` that were already failing in iter1 step 4 (history confirmation) and iter2 (`711ef28`).

### New / extended Vitest tests for iter3 (all 33 passing)

| File | Cases | Coverage |
| --- | --- | --- |
| `src/hooks/__tests__/useTasks.persistence.test.ts` | 7 | LS hydration, malformed JSON fallback, URL `?task=` priority, `closeAllTabs` clears LS+URL+title, `document.title` sync |
| `src/contexts/__tests__/LocaleContext.test.tsx` | 3 | `applyLocaleToDom` SSR guard, mount-effect hit/miss paths, `setLocale` DOM sync |
| `src/components/AdminSettings/__tests__/ModelSettingsPanel.form.test.tsx` | 5 | Save button is `type="submit"`, form `noValidate`, autoComplete on API Key, single-fire submit, disabled-state mirror guard |
| `src/components/chat/__tests__/ChatTypeSelectionModal.test.tsx` | 7 | sort order by `updated_at`, empty-node cards become disabled buttons, `idShort` conditional render, footer count switch |
| `src/components/HomePage/__tests__/LandingPage.brainstorm.test.tsx` | 5 | `comingSoon` card has `cursor-not-allowed` not `pointer-events-none`, hover title set, onClick guard, badge present |
| `src/components/video/components/VideoPlayerPanel/__tests__/exportButton.test.tsx` | 6 | empty timeline disables export, `aria-label` flips through 3 states, onKeyDown gate, no hardcoded `tabIndex={0}` |

---

## 3. Commit Record

```
$ git log --oneline -5
22a055c fix: harden web app shell — task persistence, locale sync, form semantics, empty-state UX (iter3)
6100984 docs: add step-5 review report for web-auth/settings/log-hygiene fixes (iter2)
711ef28 fix: harden web auth, settings validation, and log hygiene (iter2)
ca1bf2d docs: add step-5 review report for video-cover modal fixes
28d6ce8 fix: harden video cover modal — WYSIWYG export, a11y, and input safety
```

`22a055c` covers:
- 8 modified source files
- 6 new Vitest test files (33 cases)
- 3 diagnosis docs (bug-report.md, fix-plan.md, fix-plan-reviewed.md)
- Total: **17 files, +2528 / −85**

This review report is committed separately to keep the source-only and docs-only histories clean (matching iter1 `28d6ce8`/`ca1bf2d` and iter2 `711ef28`/`6100984` cadence).

### Push status
Branch is ahead of `origin/main` by 39 commits. **No push performed** — user has not requested it; iter1 and iter2 likewise held back. Awaiting explicit "push" instruction.

---

## 4. Deployment

Deployed to dev server (192.168.1.123) via `dev/deploy_dev_20260420.py`:
- SFTP mirror of source tree (excluding venv/.next/.idea/__pycache__)
- `npm run build` on remote (Node 18.x)
- `pip install -r requirements.txt` (UTF-8 conversion applied per memory)
- Restart `uvicorn app.main:app :8000` and `next start :3010` via `(setsid nohup … &)` per memory `feedback_paramiko_detach.md`
- Health checks: `curl http://192.168.1.123:8000/health` → 200; `curl http://192.168.1.123:3010/` → 200

Live at <http://192.168.1.123:3010/>. Smoke checked: login modal loads, brainstorm card on landing shows Coming Soon badge with hover tooltip, project tab persists across reload (Bug #1 acceptance), `<html lang>` correctly set on first paint (Bug #2), Provider Save in admin settings fires once (Bug #3), workflow modal shows newest first with disabled cards on empty workflows (Bug #4).

---

## 5. Bug-by-bug Acceptance

| Bug | Acceptance criterion | Result |
| --- | --- | --- |
| #1 | Reload `/` after creating two tasks; both task tabs and the active one are restored. URL reflects `?tab=…&task=…`. document.title shows active task. | PASS |
| #2 | Open the page in EN; `<html lang>` should be `en` from first paint, not after locale switch. Toggle to ZH; `<html lang>` becomes `zh-CN`. | PASS |
| #3 | In Admin → Model Settings → Add Provider, click Save once. Network tab shows exactly one POST. Browser autofill suggests "new password" not the saved password. | PASS |
| #4 | Workflows list shows newest first by `updated_at`. Cards with 0 nodes are visually disabled, keyboard-unselectable, hover shows "Add nodes first" hint, and footer text flips to "X workflows ready, Y empty". | PASS |
| #5 | Hovering the brainstorm card on the landing page shows the "Coming Soon" badge AND the title tooltip. Click does nothing. Container fallback page shows the same hint. | PASS |
| #6 | Export button is disabled on empty timeline; aria-label says so; Tab key skips it; pressing Enter/Space when disabled does nothing. | PASS |

---

## 6. Final Status

- ✅ Implementation: matches `fix-plan-reviewed.md` exactly (all 6 modifications applied).
- ✅ Type-check: clean.
- ✅ Tests: 33/33 new pass; 544/546 overall (2 pre-existing unrelated).
- ✅ Commit: `22a055c` (17 files, +2528 / −85).
- ✅ Review report: committed (this file).
- ✅ Deploy: dev server 192.168.1.123 — uvicorn:8000 + next:3010 both 200.
- ⏸ Push to origin/main: held (no user request; matches iter1/iter2 policy).

iter3 step 5 complete.
