# Step 5 — Review & Commit Report (iter4)

**Date:** 2026-05-09
**Branch:** main
**Commit:** `4a5209c fix: workflow save/run gate, materials empty hint, timeline coming-soon, log hygiene (iter4)`
**Predecessor:** iter3 review report `9abd7a7`

---

## 1. Code Review Summary

### Scope
Reviewed 25 files in `4a5209c`: 12 source modifications (3 backend, 9 frontend), 6 new Vitest test files (48 cases), 2 new pytest files (6 cases), 3 diagnosis docs (bug-report / fix-plan / fix-plan-reviewed). Net: **+2721 / −241**.

### Compliance with `fix-plan-reviewed.md`

| Bug | Plan | Implementation | Status |
| --- | ---- | -------------- | ------ |
| #1 Workflow save 500 + SQLAlchemy URL leak (P0) | (1) `agent_workflow_service.save_workflow`: `await db.refresh(record, attribute_names=['created_at','updated_at'])` after each `flush` so `_record_to_model` reads ISO strings; (2) catch-branch returns sanitized `"Failed to save workflow"` (no `str(e)` interpolation) — full error stays in logger only; (3) `workflow_router` 500 fallback drops f-string `detail`; (4) frontend `sanitizeErrorMessage` util drops `sqlalche.me` / `greenlet` / `asyncpg` / `>240ch` strings, applied to `WorkflowInterface` save/load/delete catches | `backend-services/basic-service/app/services/agent_workflow_service.py` lines 110–117 (insert-branch flush+refresh) and 130–137 (update-branch flush+refresh); 152–159 catch returns `message: "Failed to save workflow"`. `app/routers/workflow_router.py` line 65 passes `result.get('message')` (now sanitized) and line 88 fallback uses fixed string. `src/lib/sanitizeError.ts` (22 lines) defines `SENSITIVE_PATTERNS` (sqlalche.me / greenlet_spawn / SQLAlchemy / asyncpg / psycopg2? / `at 0x…` / `Traceback …`) + `>240` length cap → `fallback`. `src/components/workflow/WorkflowInterface.tsx` save/load/delete catches use `sanitizeErrorMessage(error, t.workflow.…)`. | OK |
| #2 Run button + executor guard for 0-Start workflows (P1) | `isRunDisabled` `useMemo` based on `hasStartNode` + `activeWorkflow`; Run button gains `disabled` + `title` + `aria-label` hints from `t.workflow.…runDisabledHint`. `WorkflowExecutor.execute()` soft-returns with `dwarn` log when no Start node, instead of `throw new Error('No Start node found')` (which previously surfaced as `console.error` + toast). | `src/components/workflow/WorkflowInterface.tsx`: `hasStartNode` derived from `activeWorkflow.nodes`, `isRunDisabled` gates the Run button (lines around 1024–1046), title/aria-label flips through 3 states (running / disabled / ready). `src/components/workflow/WorkflowExecutor.ts` lines 86–91 changed from `throw` to early-return with `dwarn(…)` and graceful state cleanup. | OK |
| #3 Materials library empty state — "image" tab on audio-only project shows blank grid (P1) | Empty branch keys off **filtered visible set** (`visibleMaterials` + `visiblePacks`), not `materials.length === 0 && allPacks.empty`. Add `isFilteredEmpty` + `emptyHint` `useMemos`. 17 new `materialsPanel.empty.*` keys in EN + ZH + interface (image / audio / video / framePack tab-specific copy + global hint). | `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx`: `visibleMaterials` `useMemo` filters by current filter type; `visiblePacks` `useMemo` keys off pack-tab match; `isFilteredEmpty = visibleMaterials.length === 0 && visiblePacks.length === 0`; `emptyHint` resolves to `t.materialsPanel.empty.image / .audio / .video / .framePack` per active filter. `src/lib/i18n.ts` adds 17 `materialsPanel.empty.*` keys (interface @ line 826, EN @ 3389, ZH @ 6116). | OK |
| #4 Timeline effects/transitions Coming Soon (P2) | `comingSoon: true` flag on toolbar entries; `renderIconButton` swaps `tooltip` / `aria-label` to existing `t.timeline.messages.featureComingSoon` (no new key per `fix-plan-reviewed §C7`); `TimelinePanel.handleAddEffect/handleAddTransition` unified on `featureComingSoon` toast. | `src/components/video/timeline/TimelineToolbar.tsx` lines 179–200: effects/transitions entries gain `comingSoon: true`; `renderIconButton` (224–258) reads the flag and uses `t.timeline.messages.featureComingSoon` (an existing key) for both tooltip and `aria-label`. `src/components/video/timeline/TimelinePanel.tsx` 625–631: handlers unified on `featureComingSoon` toast (no new keys added). | OK |
| #5 User stats vs list consistency — admin caller saw legacy admin/root rows in totals (P2) | `get_user_stats(db, current_user)` reuses the same permission filter as `get_all_users` so admin callers exclude admin/root rows; super-admin still sees raw totals. | `backend-services/basic-service/app/services/user_service.py` 783–840: extracted permission filter helper, applied to `User.user_role.in_(...)` in the stats select; signature stable (`current_user: Optional[User] = None`); `pytest tests/test_user_stats_consistency.py` confirms admin sees totals matching the list view. | OK |
| #6 Top-bar Brainstorm dead-end (P2) | Taskbar entry becomes `aria-disabled` with `comingSoon` badge + toast on click; Container brainstorm placeholder gains the same badge. New `tasks.brainstormingComingSoon` key (toast text); reuses existing `landing.comingSoonBadge` per `fix-plan-reviewed §C6` (no new badge key). | `src/components/Taskbar.tsx`: brainstorm `MenuItem` becomes `aria-disabled="true"` with comingSoon badge `<span>` and toast handler firing `t.tasks.brainstormingComingSoon`. `src/components/Container.tsx` brainstorm placeholder gets the same badge. `src/lib/i18n.ts` adds `tasks.brainstormingComingSoon` (interface line 516, EN 3215, ZH 5942); `landing.comingSoonBadge` (already at EN 2736 / ZH 5463 from iter3) is reused — no duplicate key. | OK |
| #7 Workflow log hygiene — 180+ console calls leaking into production (P2) | `console.log/info → dlog`, `console.warn → dwarn` (both gated by `NODE_ENV === 'development'` ∨ `window.__ECLIPTRIX_DEBUG__`) across `WorkflowInterface`, `WorkflowSidebar`, `WorkflowCanvas`, `WorkflowExecutor`. **`console.error` preserved everywhere** per `fix-plan-reviewed §C3` — prod must keep real failure signals. No `dlog.log` / `dlog.error` subscript calls (would crash at runtime per `§C2`). Imports use `@/lib/utils/debugLog` (the actual path) per `§C1`. | `src/components/workflow/WorkflowInterface.tsx` (132 lines net change): `import { dlog, dwarn } from '@/lib/utils/debugLog'`; render/state logs converted to `dlog(…)`, intermittent warnings to `dwarn(…)`, all `console.error` retained. `WorkflowSidebar.tsx`, `WorkflowCanvas.tsx`, `WorkflowExecutor.ts` follow the same pattern. `console-hygiene.test.ts` asserts no `dlog.log` / `dlog.error` patterns and that `console.error` count stays positive. | OK |

### i18n Schema (20 new keys × 3 locations, 0 duplicates)

| Key | interface | EN block | ZH block |
| --- | --- | --- | --- |
| `tasks.brainstormingComingSoon` | 516 | 3215 | 5942 |
| `materialsPanel.empty.image` | 826 region | 3389 region | 6116 region |
| `materialsPanel.empty.audio` | 826 region | 3389 region | 6116 region |
| `materialsPanel.empty.video` | 826 region | 3389 region | 6116 region |
| `materialsPanel.empty.framePack` | 826 region | 3389 region | 6116 region |
| `materialsPanel.empty.uploadHint` | 826 region | 3389 region | 6116 region |
| `materialsPanel.empty.searchHint` | 826 region | 3389 region | 6116 region |
| `materialsPanel.empty.aiGenerateHint` | 826 region | 3389 region | 6116 region |
| `materialsPanel.empty.recordHint` | 826 region | 3389 region | 6116 region |
| (plus 9 sub-variants under `materialsPanel.empty.*`) | … | … | … |

All 20 new keys verified against `git show 4a5209c -- src/lib/i18n.ts`. **No duplicates** with existing `landing.comingSoonBadge` / `landing.comingSoonHint` / `timeline.messages.featureComingSoon` (corrections C6/C7 from `fix-plan-reviewed.md` honored).

### Style & Quality
- **TypeScript:** `npm run type-check` → clean (no diagnostics).
- **ESLint:** No new warnings.
- **No debug artefacts:** `console.error` preserved in workflow modules (Bug #7 strict scope per `§C3`); no top-level `console.log` / module-init logs in modified files.
- **`dlog` API correctness:** Verified — no `dlog.log` / `dlog.info` / `dlog.error` subscript calls anywhere (would have failed `tsc --noEmit`); all imports use `@/lib/utils/debugLog` (correct path per `§C1`).
- **Backend error sanitization is complete:** Fixed in **both** service layer (catch-branch returns plain message) and router layer (`HTTPException(detail=...)` no longer formats `str(e)`). `pytest tests/test_agent_workflow_service.py` includes a regression test asserting the response message is exactly `"Failed to save workflow"` when the underlying flush raises `IntegrityError` with a SQLAlchemy URL.
- **Empty-state filter coverage:** `MaterialsPanel.emptyHint.test.ts` covers the original missed scenario (image tab on a project with audio-only materials → shows the right hint, not a blank grid).

### Modifications Applied (C1–C9 from `fix-plan-reviewed.md`)
- **C1:** `dlog` imports use `@/lib/utils/debugLog` (verified by grep — 0 occurrences of `@/lib/debugLog`). ✅
- **C2:** No `dlog.log` / `dlog.info` / `dlog.error` patterns (verified by `console-hygiene.test.ts`). ✅
- **C3:** `console.error` preserved everywhere — `git show 4a5209c -- src/components/workflow/WorkflowInterface.tsx` retains all original `console.error` lines unchanged. ✅
- **C4:** Service layer catch-branch returns `"Failed to save workflow"` (no `str(e)` interpolation). ✅
- **C5:** Empty-state condition keys off `visibleMaterials` + `visiblePacks` (filtered set), not raw `materials.length`. ✅
- **C6:** No `tasks.comingSoonBadge` introduced — `tasks.brainstormingComingSoon` is the toast text only; badge reuses existing `landing.comingSoonBadge`. ✅
- **C7:** No new `timeline.toolbar.comingSoonHint` key — reused existing `timeline.messages.featureComingSoon`. ✅
- **C8:** `VerticalTaskbar` not modified — only `Taskbar.tsx` and `Container.tsx` changed for Bug #6. ✅
- **C9:** `console.error` retained in `WorkflowExecutor.ts` for unexpected failures (only the `'No Start node'` throw was eliminated by replacing it with a soft return). ✅

### Risks / Gaps
- None blocking.
- Pre-existing 2 `backend-proxy.test.ts` failures (T2, T18 — query-string drift) remain out of scope; confirmed unrelated since iter1 (`28d6ce8`), iter2 (`711ef28`), and iter3 (`22a055c`).

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
 Test Files  1 failed | 85 passed (86)
      Tests  2 failed | 592 passed (594)
   Duration  20.28s
```

The 2 failures (`backend-proxy.test.ts > T2`, `T18`) are pre-existing query-string assertion drift, unrelated to iter4. Confirmed at `28d6ce8` (iter1), `711ef28` (iter2), and `22a055c` (iter3).

### New Vitest tests for iter4 (all 48 passing)

| File | Cases | Coverage |
| --- | --- | --- |
| `src/lib/__tests__/sanitizeError.test.ts` | 9 | Sensitive pattern detection (sqlalche.me / greenlet / asyncpg / 0x… / Traceback / >240 chars), Error vs string vs unknown input, fallback path |
| `src/components/__tests__/Taskbar.brainstorm.test.ts` | 9 | aria-disabled state, comingSoon badge render, toast firing on click, no navigation |
| `src/components/video/components/MaterialsPanel/__tests__/MaterialsPanel.emptyHint.test.ts` | 11 | image-tab on audio-only project, audio-tab on video-only, framePack tab on empty packs, hints localized |
| `src/components/video/timeline/__tests__/TimelineToolbar.comingSoon.test.ts` | 6 | comingSoon flag swaps tooltip/aria-label to featureComingSoon, button still enabled but toast-only |
| `src/components/workflow/__tests__/WorkflowInterface.runGate.test.ts` | 7 | isRunDisabled when no start node, when no activeWorkflow, when running, title/aria-label propagation |
| `src/components/workflow/__tests__/console-hygiene.test.ts` | 6 | no `dlog.log`/`dlog.error` subscript calls, `console.error` count > 0, dlog import path is `@/lib/utils/debugLog` |

### Pytest (backend, new in iter4)
```
$ pytest tests/test_agent_workflow_service.py tests/test_user_stats_consistency.py -v
====================== 6 passed, 37 warnings in 6.49s ======================
```

| File | Cases | Coverage |
| --- | --- | --- |
| `tests/test_agent_workflow_service.py` | 3 | save_workflow with refresh returns ISO timestamps; insert-branch and update-branch both refresh; catch-branch sanitizes SQLAlchemy URL out of message field |
| `tests/test_user_stats_consistency.py` | 3 | admin caller stats exclude admin/root rows; super-admin sees full totals; matches list-view permission filter |

---

## 3. Commit Record

```
$ git log --oneline -5
4a5209c fix: workflow save/run gate, materials empty hint, timeline coming-soon, log hygiene (iter4)
9abd7a7 docs: add step-5 review report for web app shell fixes (iter3)
22a055c fix: harden web app shell — task persistence, locale sync, form semantics, empty-state UX (iter3)
6100984 docs: add step-5 review report for web-auth/settings/log-hygiene fixes (iter2)
711ef28 fix: harden web auth, settings validation, and log hygiene (iter2)
```

`4a5209c` covers:
- 3 backend source modifications (`agent_workflow_service.py`, `workflow_router.py`, `user_service.py`)
- 9 frontend source modifications (`Container.tsx`, `Taskbar.tsx`, `MaterialsPanel.tsx`, `TimelinePanel.tsx`, `TimelineToolbar.tsx`, `WorkflowCanvas.tsx`, `WorkflowExecutor.ts`, `WorkflowInterface.tsx`, `WorkflowSidebar.tsx`)
- 1 new utility (`src/lib/sanitizeError.ts`)
- 6 new Vitest test files (48 cases)
- 2 new pytest files (6 cases)
- i18n update (`src/lib/i18n.ts`, +58 lines, 20 new keys)
- 3 diagnosis docs (bug-report / fix-plan / fix-plan-reviewed)
- Total: **25 files, +2721 / −241**

This review report is committed separately to keep the source-only and docs-only histories clean (matching iter1 `28d6ce8`/`ca1bf2d`, iter2 `711ef28`/`6100984`, iter3 `22a055c`/`9abd7a7` cadence).

### Push status
Branch is ahead of `origin/main` by 41 commits (after this report). **No push performed** — user has not requested it; iter1 / iter2 / iter3 likewise held back. Awaiting explicit "push" instruction.

---

## 4. Deployment

Deployed to dev server (192.168.1.123) via `dev/deploy_dev_20260420.py`:
- SFTP mirror of source tree (excluding venv / .next / .idea / __pycache__)
- `npm run build` on remote (Node 18.x)
- `pip install -r requirements.txt` (UTF-8 conversion applied per memory `project_requirements_utf16`)
- Restart `uvicorn app.main:app :8000` and `next start :3010` via `(setsid nohup … &)` per memory `feedback_paramiko_detach`
- Health checks: `curl http://192.168.1.123:8000/docs` → 200; `curl http://192.168.1.123:3010/` → 200

Live at <http://192.168.1.123:3010/>. Smoke checked: workflow save no longer leaks SQLAlchemy URLs in error toasts (Bug #1), Run button is disabled with hover hint when no Start node (Bug #2), materials image tab on audio-only project shows the right hint (Bug #3), timeline effects/transitions show featureComingSoon toast (Bug #4), top-bar Brainstorm shows badge + toast (Bug #6), workflow console is quiet in production-build preview (Bug #7).

---

## 5. Bug-by-bug Acceptance

| Bug | Acceptance criterion | Result |
| --- | --- | --- |
| #1 | Trigger workflow-save 500 (e.g. duplicate name); error toast shows "Failed to save workflow" — no `sqlalche.me` / `greenlet` / `asyncpg` strings; underlying error still appears in backend logs. | PASS |
| #2 | Open a workflow with no Start node; Run button is disabled, hover shows "Add a Start node first" hint; pressing Enter or programmatic call to `executor.execute()` warns and returns without throwing. | PASS |
| #3 | Open a project that has only audio materials; switch to the image tab → hint reads "No images yet — upload, search, or generate" (not a blank grid). | PASS |
| #4 | In timeline toolbar, hover effects/transitions → tooltip is "Feature coming soon"; clicking surfaces the same toast and does not crash. | PASS |
| #5 | Admin user stats endpoint returns totals that match the admin user list (admin/root rows excluded). Super-admin sees raw totals. | PASS |
| #6 | Top-bar Brainstorm entry shows "Coming Soon" badge, is `aria-disabled`, click fires toast with "Brainstorming is coming soon"; Container fallback page mirrors. | PASS |
| #7 | Production build (`NODE_ENV=production`, `__ECLIPTRIX_DEBUG__` unset): no `dlog`/`dwarn` output in console while editing a workflow. `console.error` still fires when a node-execution throw bubbles out. | PASS |

---

## 6. Final Status

- ✅ Implementation: matches `fix-plan-reviewed.md` exactly (all 9 corrections C1–C9 applied).
- ✅ Type-check: clean.
- ✅ Tests: 48/48 new vitest pass; 6/6 new pytest pass; 592/594 vitest overall (2 pre-existing unrelated).
- ✅ Commit: `4a5209c` (25 files, +2721 / −241).
- ✅ Review report: committed (this file).
- ✅ Deploy: dev server 192.168.1.123 — uvicorn:8000 + next:3010 both 200.
- ⏸ Push to origin/main: held (no user request; matches iter1/iter2/iter3 policy).

iter4 step 5 complete.
