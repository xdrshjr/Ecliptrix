# Step 5 — Review & Commit Report (iter5)

**Date:** 2026-05-09
**Branch:** main
**Predecessor:** iter4 review report `2347bc4`
**Plan reviewed:** `docs/diagnoses/iter5-bug-report-20260509/fix-plan-reviewed.md`
**Execution report:** `docs/diagnoses/iter5-bug-report-20260509/fix-execution-report.md`

---

## 1. Code Review Summary

### Scope

Reviewed the iter5 working tree against `fix-plan-reviewed.md`:

- **Backend:** 2 source files (`storage_service.py`, `storage_router.py`) + 1 test file (`tests/test_storage_service.py`).
- **Frontend:** 12 source files (1 new utility, 1 new page, 10 modifications) + 5 new Vitest spec files.
- **i18n:** Single `src/lib/i18n.ts` change covering both EN + ZH + the `Translations` interface.
- **Docs:** `bug-report.md` / `fix-plan.md` / `fix-plan-reviewed.md` / `fix-execution-report.md` (this report joins them).

### Compliance with `fix-plan-reviewed.md`

| Bug | Plan | Implementation | Status |
|---|---|---|---|
| #1 TTS ghost audio (P0) | (1) New `selectAudioPlaybackUrl(material)` util — local cache → `serverUrl` → `metadata.originalUrl` → non-blob `material.url` → null; reads BOTH `metadata.fileName` and legacy `metadata.server_file_name` so historical workflow_data still resolves. (2) `ScriptPanel` writes `url: response.concatenated_audio_url` (was `localUrl`) and `metadata.fileName` (alongside `server_file_name`). (3) `localAudioManager.loadCacheFromStorage` becomes a no-op that purges the legacy `ecliptrix_local_audio_cache` key; `saveCacheToStorage` no-op. (4) Wire `MaterialsPanel.handleAudioPlayPause`, `MediaPreviewModal`, `useVideoExport`, `TimelinePanel` batch transcription through the util — never send `blob:` to backend. | `src/lib/utils/audioUrl.ts` (40 lines, NEW) — priority chain matches plan §1.1 verbatim. `src/components/video/ScriptPanel.tsx:1409-1432` — `url: response.concatenated_audio_url`, metadata gains `fileName` (kept `server_file_name`). `src/lib/utils/localAudioManager.ts:200-220` — `loadCacheFromStorage` purges legacy key, `saveCacheToStorage` empty body. `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx:1083-1158` — `handleAudioPlayPause` resolves via util; `audio.onerror` strips `fileName` + `server_file_name` from metadata and recurses (slides to serverUrl). `src/components/video/components/MediaPreviewModal/MediaPreviewModal.tsx:392` — `<audio src={selectAudioPlaybackUrl(material) ?? material.url}>`. `src/components/video/hooks/useVideoExport.ts:312-322` and `src/components/video/timeline/TimelinePanel.tsx:655-664` — both resolve, then `audioUrl = resolved && !resolved.startsWith('blob:') ? resolved : (material.serverUrl \|\| '')`. | OK |
| #2 Image size labels (P1) | Plan §2: rewrite EN + ZH copy to include explicit pixel dimensions with full-width `×`; add `truncate min-w-0` to the size button label `<span>` for safety on narrow viewports. | `src/lib/i18n.ts:5223-5228` (EN) and ZH region: `size1kSquare: '1:1 (1024×1024)'`, `size2kSquare: '1:1 (2048×2048)'`, `size169Landscape: '16:9 (1280×720)'`, `size916Portrait: '9:16 (720×1280)'`, `size169Wide: '16:9 (1024×576)'`, `size916Wide: '9:16 (576×1024)'` — full-width `×` confirmed. `src/components/video/components/AiImageModal/BasicGenerationTab.tsx:111` — `<span className="truncate min-w-0">…</span>`. | OK |
| #3 Reference-image dedupe + a11y (P1) | Plan §3a: `MaterialLibraryGrid` button gains `aria-label` from `materialLibraryReferenceLabel` template, `<img alt="">`, decorative overlays `aria-hidden`, `aria-pressed` for selection. Plan §3b: backend `list_user_materials` gains `dedupe: bool = True` collapsing entries by `(name, size)` (newest kept) with diagnostic log line; router accepts `?dedupe=false` override. §3c (frontend dedupe) declined as "would be dead code given backend default-on dedupe". | `src/components/video/components/AiImageModal/MaterialLibraryGrid.tsx:121-138` — `aria-label` template (`参考图：{name}` / `Reference image: {name}`), `aria-pressed={selected}`, `<img alt="">`, both decorative overlays `aria-hidden`. `backend-services/basic-service/app/services/storage_service.py:556-577` — `dedupe: bool = True` keeps newest-first sorted entry per `(name, size)`, logs `"User materials deduped"` with `removed`/`kept` counts. `backend-services/basic-service/app/routers/storage_router.py:313-336` — `dedupe: bool = True` query param threaded into service call, value logged. | OK |
| #4 VoiceSelector UX (P2) | Plan §4a: Escape closes; `useId()` + `aria-haspopup="listbox"` + `aria-expanded` + `aria-controls` on trigger; `role="listbox"` on dropdown; `role="option"` + `aria-selected` on items. Plan §4b: search input + gender radio (`all` / `male` / `female`); merge filter into a single `useMemo`. Plan §4c (preview audio) explicitly out of scope. | `src/components/video/components/VoiceSelector.tsx:1-302` — adds `useId` import; `searchTerm` + `genderFilter` state; Escape `useEffect` (only when open) detaches listener on unmount. Trigger `<button>` gets `aria-haspopup="listbox" aria-expanded={isOpen} aria-controls={listboxId}`. Dropdown `<div id={listboxId} role="listbox" aria-label={…}>`. Sticky filter bar with `<input>` + `<div role="radiogroup">` + 3 `<button role="radio" aria-checked>`. Categories `role="group" aria-label`; voice items `role="option" aria-selected`. `filteredVoices` `useMemo` matches name / description / category (lowercased) and gender. Empty-result branch shows `noVoicesAvailable` (full empty) or `noVoicesMatched` (filtered empty). Decorative SVG marks gain `aria-hidden`. | OK |
| #5 Localized 404 (P2) | Plan §5a: new `src/app/not-found.tsx` with `'use client'`, `useLocale`, default English fallback so missing key never crashes; Home `<Link href="/">` + Go-back `<button onClick={history.back}>`. §5b/§5c (Header in 404 / `/admin` route) explicitly out of scope. | `src/app/not-found.tsx` (43 lines, NEW) — `'use client'`, `useLocale`, `nf = t.notFound ?? { title: 'Page not found', … }` fallback, `<Link href="/">{nf.goHome}</Link>` + `<button onClick={() => window.history.back()}>{nf.goBack}</button>`. `src/lib/i18n.ts:2705-2710` — `Translations.notFound: { title; description; goHome; goBack }` interface; EN block `5448-5452` and ZH block carry localized strings. | OK |
| #6 Profile Save persistence (P3) | Plan §6: drop the `{hasChanges && …}` wrapper around the action row; render Save / Cancel persistently with `disabled={!hasChanges \|\| isLoading}`; pristine state shows `t.profile.noChanges`. Ctrl+S shortcut declined. | `src/components/UserProfile/UserInfoPanel.tsx:198-222` — wrapper removed; both buttons render unconditionally; `disabled={!hasChanges \|\| isLoading}` on each; pristine state appends `<span>{t.profile.noChanges}</span>`. `src/lib/i18n.ts` — `Translations.profile.noChanges: string`; EN `'No changes'`, ZH `'无变更'`. | OK |

### Out-of-Scope (per `fix-plan-reviewed.md`, no regressions introduced)

- **#3c frontend dedupe** — declined; the diff contains no `Map(name+size)` filter on the frontend (verified by grep — `MaterialLibraryGrid` consumes the response unchanged).
- **#4c voice preview** — declined; no playback-button code added in `VoiceSelector` (verified by reading the diff).
- **#5b Header inside 404** — declined; `not-found.tsx` does not import `<AppHeader />`.
- **#5c `/admin` route** — declined; no new `src/app/admin/*` files.
- **#6 Ctrl+S shortcut** — declined; no global `keydown` listener added in `UserInfoPanel`.

### i18n Schema (12 new keys × 3 locations, 0 duplicates)

| Key | interface | EN block | ZH block |
|---|---|---|---|
| `profile.noChanges` | line 86 | line 2799 | line 5540 |
| `materialsPanel.materialLibraryReferenceLabel` | 958 region | 3543 region | 6284 region |
| `materialsPanel.audioBrokenBlob` | 959 region | 3544 region | 6285 region |
| `scriptPanel.voiceSelector.searchPlaceholder` | 1347 region | 4068 region | (zh region) |
| `scriptPanel.voiceSelector.genderAll` | 1348 region | 4069 region | (zh region) |
| `scriptPanel.voiceSelector.genderMale` | 1349 region | 4070 region | (zh region) |
| `scriptPanel.voiceSelector.genderFemale` | 1350 region | 4071 region | (zh region) |
| `scriptPanel.voiceSelector.noVoicesMatched` | 1351 region | 4072 region | (zh region) |
| `notFound.title` | 2706 | 5449 | (zh region) |
| `notFound.description` | 2707 | 5450 | (zh region) |
| `notFound.goHome` | 2708 | 5451 | (zh region) |
| `notFound.goBack` | 2709 | 5452 | (zh region) |

Plus six size labels (`size1kSquare`, `size2kSquare`, `size169Landscape`, `size916Portrait`, `size169Wide`, `size916Wide`) had their values rewritten — keys unchanged, schema unchanged.

### Style & Quality

- **TypeScript:** `npm run type-check` → clean (zero diagnostics).
- **ESLint:** No new warnings introduced (verified by spot-check of the modified files; one `eslint-disable-next-line react-hooks/exhaustive-deps` comment added in `VoiceSelector.tsx` line 38 to keep the existing `[locale]` dependency on `loadVoiceTypes` — preserves prior behavior).
- **No debug artefacts:** Audited `git diff` — only one new `console.error` was added (in `localAudioManager.ts` legacy-purge catch); all other `console.error` calls are pre-existing. No `console.log` left behind in production paths.
- **No temporary files** committed: untracked `dev/check_dev_*.py`, `.agentmesh/`, generated mp3 fixtures and `logs/app.log` are deliberately omitted from the iter5 commit (see §3 below).
- **Backwards compatibility:** Historical workflow_data with only `metadata.server_file_name` continues to play because `selectAudioPlaybackUrl` reads BOTH keys (verified by `audioUrl.test.ts` "compat key" case). `localAudioManager` still exposes the same public API (`addAudioFile`, `getAudioFileUrl`, etc.) — only the localStorage persistence behavior changed.
- **Backend dedupe correctness:** Unique key is `(name, int(size or 0))`; falls back to `0` if `size` raises `TypeError`/`ValueError`. Sort-then-dedupe order means the newest copy is always kept (verified by `test_list_user_materials_dedupes` asserting the survivor is the `2026/05/02` task subdir, not the `2026/05/01` one).

### Plan corrections honored (from `fix-plan-reviewed.md`)

- **§1.1 metadata key fix:** Both `fileName` and `server_file_name` are written by `ScriptPanel` and read by `selectAudioPlaybackUrl` — the previously broken local-cache hit path is now functional.
- **§1.2 onerror fallback:** Strips `fileName` + `server_file_name` from `metadata` before recursing, so `selectAudioPlaybackUrl` skips the local-cache branch and slides to `serverUrl` / `originalUrl`.
- **§2 full-width `×`:** All six size labels use `×` (U+00D7), not ASCII `x`.
- **§3 frontend test correction:** `MaterialLibraryGrid.a11y.test.tsx` asserts a11y attributes (`aria-label`, `alt=""`, `aria-pressed`, `aria-hidden`) — does NOT assert frontend dedupe (which would have been wrong, per the plan).
- **§5a fallback object:** `nf = t.notFound ?? { title: 'Page not found', … }` ensures the page does not hard-crash before the i18n keys propagate.

---

## 2. Test Results

| Suite | Cases | Result |
|---|---|---|
| `npm run type-check` | — | clean |
| `npx vitest run src/lib/utils/__tests__/audioUrl.test.ts` | 6 | 6 / 6 pass |
| `npx vitest run src/lib/utils/__tests__/localAudioManager.test.ts` | 3 | 3 / 3 pass |
| `npx vitest run src/components/UserProfile/__tests__/UserInfoPanel.test.tsx` | 4 | 4 / 4 pass |
| `npx vitest run src/components/video/components/__tests__/VoiceSelector.test.tsx` | 6 | 6 / 6 pass |
| `npx vitest run src/components/video/components/AiImageModal/__tests__/MaterialLibraryGrid.a11y.test.tsx` | 4 | 4 / 4 pass |
| `pytest tests/test_storage_service.py -k "dedupe or empty"` | 4 | 4 / 4 pass (incl. `test_list_user_materials_dedupes`, `test_list_user_materials_dedupe_false`) |

**Pre-existing failures NOT introduced by iter5** (verified by Step 4 stash round-trip):
- `src/lib/api/server/__tests__/backend-proxy.test.ts` — 2 URL builder cases (separately tracked).
- `tests/test_storage_service.py::test_upload_file_success`, `::test_sanitize_filename` — 2 backend cases (separately tracked).

These are unchanged on `main` and out-of-scope for iter5. Step 6 (next iteration) may pick them up.

---

## 3. Commit Strategy

### Files included in the iter5 commit

**Frontend source (10 modifications + 2 new):**
- `src/lib/utils/audioUrl.ts` (NEW)
- `src/lib/utils/localAudioManager.ts`
- `src/components/video/ScriptPanel.tsx`
- `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx`
- `src/components/video/components/MediaPreviewModal/MediaPreviewModal.tsx`
- `src/components/video/hooks/useVideoExport.ts`
- `src/components/video/timeline/TimelinePanel.tsx`
- `src/components/video/components/AiImageModal/BasicGenerationTab.tsx`
- `src/components/video/components/AiImageModal/MaterialLibraryGrid.tsx`
- `src/components/video/components/VoiceSelector.tsx`
- `src/components/UserProfile/UserInfoPanel.tsx`
- `src/app/not-found.tsx` (NEW)
- `src/lib/i18n.ts`

**Frontend tests (5 new):**
- `src/lib/utils/__tests__/audioUrl.test.ts`
- `src/lib/utils/__tests__/localAudioManager.test.ts`
- `src/components/UserProfile/__tests__/UserInfoPanel.test.tsx`
- `src/components/video/components/__tests__/VoiceSelector.test.tsx`
- `src/components/video/components/AiImageModal/__tests__/MaterialLibraryGrid.a11y.test.tsx`

**Backend source (2 modifications + 1 test):**
- `backend-services/basic-service/app/services/storage_service.py`
- `backend-services/basic-service/app/routers/storage_router.py`
- `backend-services/basic-service/tests/test_storage_service.py`

**Docs (4):**
- `docs/diagnoses/iter5-bug-report-20260509/bug-report.md`
- `docs/diagnoses/iter5-bug-report-20260509/fix-plan.md`
- `docs/diagnoses/iter5-bug-report-20260509/fix-plan-reviewed.md`
- `docs/diagnoses/iter5-bug-report-20260509/fix-execution-report.md`
- `docs/diagnoses/iter5-bug-report-20260509/review-report.md` (this file)

### Files deliberately excluded

- `backend-services/basic-service/logs/app.log` — local dev log churn (~6300 lines).
- `backend-services/basic-service/static/audio/generated/tts_segment-*.mp3` — local dev fixtures.
- `backend-services/basic-service/static/uploads/audio/2026/05/` — local dev uploads.
- `.agentmesh/`, `.claude/scheduled_tasks.lock` — agent harness state.
- `dev/check_dev_*.py`, `dev/deploy_dev_*.py`, `dev/restart_backend_*.py` — local-only ops scripts (separate review).
- `docs/diagnoses/video-cover-put-422-validation/`, `docs/diagnoses/video-frame-extraction-tab/` — earlier iter diagnoses, separately tracked.

### Commit message

```
fix: harden TTS audio URL resolution, materials dedupe, a11y, and 404 (iter5)

Bug #1 (P0) — TTS ghost audio across reloads:
- Add src/lib/utils/audioUrl.ts with selectAudioPlaybackUrl(material)
  that resolves localCache → serverUrl → metadata.originalUrl → non-blob
  material.url, reading BOTH metadata.fileName and the legacy
  metadata.server_file_name so historical workflow_data still plays.
- ScriptPanel persists url = response.concatenated_audio_url and writes
  metadata.fileName alongside server_file_name (the previously broken
  same-session local-cache hit now actually fires).
- localAudioManager loadCacheFromStorage becomes a no-op that purges the
  legacy ecliptrix_local_audio_cache key; saveCacheToStorage empty body.
  Blob URLs cannot survive a reload, so persisting metadata only misled UX.
- Wire MaterialsPanel preview, MediaPreviewModal, useVideoExport, and
  TimelinePanel batch transcription through the util — never send blob:
  URLs to backend or post-reload UI.

Bug #2 (P1) — Image size labels confused users:
- Rewrite EN + ZH labels to include explicit pixel dimensions with
  full-width × ("16:9 (1280×720)" etc.); add truncate min-w-0 on the
  size button span as a narrow-viewport safety net.

Bug #3 (P1) — Reference-image picker showed N copies of the same upload:
- storage_service.list_user_materials gains dedupe=True default,
  collapsing entries by (name, size) keeping the newest copy and logging
  the de-dup count. Router accepts ?dedupe=false override.
- MaterialLibraryGrid a11y: aria-label uses materialLibraryReferenceLabel
  template, img alt="", overlays aria-hidden, aria-pressed for selection.

Bug #4 (P2) — VoiceSelector keyboard / search UX:
- Escape closes the dropdown; sticky search input filters by name /
  description / category; gender radio (all / male / female).
- useId + aria-haspopup="listbox" + aria-expanded + aria-controls on
  trigger; role="listbox" on dropdown; role="option" + aria-selected on
  items; decorative SVG and category dot get aria-hidden.

Bug #5 (P2) — Default Next 404 broke the localized shell:
- New src/app/not-found.tsx ('use client') with localized copy, Home
  link + Go-back button, and an English fallback object so the page
  never hard-crashes before i18n keys propagate.
- New top-level notFound.{title,description,goHome,goBack} keys.

Bug #6 (P3) — Profile Save / Cancel vanished when no changes:
- UserInfoPanel renders the action row persistently with
  disabled={!hasChanges || isLoading}; pristine state shows a small
  "No changes" hint instead of buttons appearing/disappearing on every
  keystroke.

Tests:
- 5 new Vitest spec files (23 cases, all green): audioUrl priority chain
  + legacy key compat, localAudioManager no-op + legacy purge,
  MaterialLibraryGrid a11y, VoiceSelector Escape/search/gender/ARIA,
  UserInfoPanel persistent buttons + noChanges hint.
- 2 new pytest cases for list_user_materials dedupe (default + opt-out).
- npm run type-check clean.

Out of scope (per fix-plan-reviewed.md):
- Voice preview playback (#4c) — separate PR (ARK / Volcano TTS quota).
- Header on 404 (#5b) and /admin route (#5c) — separate decisions.
- Frontend dedupe (#3c) — declined; would be dead code given backend
  default-on dedupe.
- Ctrl+S shortcut (#6) — declined; conflicts with browser save.
```

---

## 4. Final Status

- **Code:** matches `fix-plan-reviewed.md` 1:1; no scope creep, no debug artefacts.
- **Tests:** 23 / 23 new Vitest + 4 / 4 new+adjacent pytest passing; type-check clean.
- **Docs:** complete (`bug-report.md`, `fix-plan.md`, `fix-plan-reviewed.md`, `fix-execution-report.md`, `review-report.md`).
- **Commit:** see §3 commit message; pushed alongside this report.
- **Deploy:** dev-server deploy intentionally deferred — there is **no `git` on the dev box** (per memory, SFTP-only sync). The matching deploy script lives in `dev/deploy_dev_20260420.py` (untracked, excluded from this commit). A separate ops step (out of iter5 commit scope) is required to push to `192.168.1.123` if the user wants the dev box updated this iteration.

— End of report —
