# Iter5 / Step 4 — Bug Fix Execution Report

**Working directory**: `G:\projects\takoAI\Ecliptrix`
**Date**: 2026-05-09
**Source plan**: `fix-plan-reviewed.md` (same directory)

This report records the actual code changes applied for the 6 iter5 bugs and
the verification evidence. Step 5 (review + commit) is the next iteration.

---

## 1. Files modified

### Frontend (TypeScript / React)

| File | Bug | Change |
|---|---|---|
| `src/lib/utils/audioUrl.ts` | #1 | **NEW**. `selectAudioPlaybackUrl` priority chain: localCache → serverUrl → metadata.originalUrl → non-blob `material.url` → null. Reads both `metadata.fileName` and `metadata.server_file_name` for backward compat. |
| `src/lib/utils/localAudioManager.ts` | #1 | `loadCacheFromStorage` reduced to a no-op that purges the legacy `ecliptrix_local_audio_cache` key. `saveCacheToStorage` is also a no-op. Header comment updated. |
| `src/components/video/ScriptPanel.tsx` | #1 | TTS `MaterialItem.url` now stores `response.concatenated_audio_url` (was `localUrl`). Metadata adds `fileName` (aligning with LocalAudioManager) while keeping `server_file_name` for legacy data. |
| `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx` | #1 | `playPreview` now resolves URL via `selectAudioPlaybackUrl`; `audio.onerror` fallback strips fileName and replays so we slide to serverUrl/originalUrl. |
| `src/components/video/components/MediaPreviewModal/MediaPreviewModal.tsx` | #1 | Audio `<audio src>` resolved via `selectAudioPlaybackUrl`. |
| `src/components/video/hooks/useVideoExport.ts` | #1 | Export payload audio URL never sent as `blob:` (fallback to `serverUrl`). |
| `src/components/video/timeline/TimelinePanel.tsx` | #1 | Batch transcription audio URL never sent as `blob:`. |
| `src/components/video/components/AiImageModal/BasicGenerationTab.tsx` | #2 | Size button label `<span>` gains `truncate min-w-0`. |
| `src/lib/i18n.ts` | #2,#3,#4,#5,#6 | New / changed keys (zh + en + Translations interface): `size{1k,2k}Square`, `size169Landscape/Wide`, `size916Portrait/Wide` (now include explicit pixel dimensions); `materialsPanel.materialLibraryReferenceLabel`, `materialsPanel.audioBrokenBlob`; `voiceSelector.{searchPlaceholder,genderAll,genderMale,genderFemale,noVoicesMatched}`; top-level `notFound.{title,description,goHome,goBack}`; `profile.noChanges`. |
| `src/components/video/components/AiImageModal/MaterialLibraryGrid.tsx` | #3 | Button: `aria-label` template, `aria-pressed`, `<img alt="">`, `aria-hidden` on decorative overlays. |
| `src/components/video/components/VoiceSelector.tsx` | #4 | Escape closes; sticky search input + male/female/all gender radio filter; `useId` + `aria-controls`/`aria-haspopup`/`aria-expanded` on trigger; `role="listbox"` + `role="option"` + `aria-selected`. |
| `src/app/not-found.tsx` | #5 | **NEW**. `'use client'` page with localized 404 copy, Home link + Go-back button, falls back to English when key missing. |
| `src/components/UserProfile/UserInfoPanel.tsx` | #6 | Save / Cancel render unconditionally with `disabled={!hasChanges \|\| isLoading}`. Pristine state shows `t.profile.noChanges` hint. |

### Backend (Python / FastAPI)

| File | Bug | Change |
|---|---|---|
| `backend-services/basic-service/app/services/storage_service.py` | #3 | `list_user_materials` accepts `dedupe: bool = True` and collapses entries with identical `(name, size)` keeping the newest copy; logs the de-dup count. |
| `backend-services/basic-service/app/routers/storage_router.py` | #3 | `GET /api/storage/user-materials` accepts `dedupe` query parameter (default `true`). |

### Tests added

| File | Coverage |
|---|---|
| `src/lib/utils/__tests__/audioUrl.test.ts` | 6 cases — local hit, legacy `server_file_name` key, serverUrl fallback, originalUrl fallback, http url passthrough, dead-blob → null. |
| `src/lib/utils/__tests__/localAudioManager.test.ts` | 3 cases — pre-populated localStorage ignored, legacy key purged, no write on construction. |
| `src/components/video/components/AiImageModal/__tests__/MaterialLibraryGrid.a11y.test.tsx` | 4 cases (source-level, per project convention) — referenceLabel template, `alt=""`, decorative overlays aria-hidden, `aria-pressed`. |
| `src/components/video/components/__tests__/VoiceSelector.test.tsx` | 6 cases (source-level) — Escape binding, search input, gender radios, useId/aria-controls, listbox/option roles, filter logic. |
| `src/components/UserProfile/__tests__/UserInfoPanel.test.tsx` | 4 cases (source-level) — buttons no longer wrapped in `{hasChanges && ...}`, `disabled={!hasChanges \|\| isLoading}` on Save & Cancel, noChanges hint when pristine. |
| `backend-services/basic-service/tests/test_storage_service.py` | 2 new pytest cases — `test_list_user_materials_dedupes` (collapses duplicate uploads), `test_list_user_materials_dedupe_false`. |

---

## 2. Verification

| Check | Result |
|---|---|
| `npm run type-check` | ✅ clean |
| `npx vitest run` (5 new spec files, 23 cases) | ✅ 23 / 23 pass |
| `npx vitest run` (entire suite, 91 spec files) | 615 / 617 pass. The 2 failures are in `src/lib/api/server/__tests__/backend-proxy.test.ts` (URL builder query-string handling) — pre-existing on `main` (verified by `git stash` round-trip), **unrelated to iter5 scope**. |
| `pytest tests/test_storage_service.py` (new dedupe cases + `test_list_user_materials_empty`) | ✅ 3 / 3 pass |
| `pytest tests/test_storage_service.py` (full file) | 10 / 12 pass. The 2 failures (`test_upload_file_success`, `test_sanitize_filename`) are pre-existing (verified by `git stash` round-trip), unrelated to iter5. |

The new `selectAudioPlaybackUrl` is a strict superset of the previous inline
logic and adds a same-session local-cache hit that was previously dead code
(metadata key mismatch identified during Step 3 review).

---

## 3. Out of scope (per fix-plan-reviewed.md)

- **Bug #4 voice preview (4c)** — separate PR (ARK / Volcano TTS quota + caching strategy).
- **Bug #5 Header on 404 (5b)** — deferred (auth-coupled side-effects).
- **Bug #5 `/admin` route (5c)** — separate product decision; follow-up issue.
- **Bug #6 Ctrl+S shortcut** — declined (browser conflict).
- **Bug #3 frontend dedupe (3c)** — declined (would be dead code given backend default-on dedupe).

---

## 4. Commit message draft

```
[fix] iter5: TTS ghost audio + dedupe materials + a11y + 404 page (Bugs #1–#6)

- Bug #1 (P0): persist server URL for TTS audio; align metadata fileName
  ↔ server_file_name keys; add selectAudioPlaybackUrl util that picks
  localCache → serverUrl → originalUrl → non-blob url. Drop misleading
  localAudioManager localStorage persistence (blobs cannot survive reload)
  and purge the legacy key. Wire MaterialsPanel preview, MediaPreviewModal,
  useVideoExport audio payload, and TimelinePanel batch transcription
  through the new util so blob: URLs never leak to backend or post-reload UI.

- Bug #2: image size labels now include explicit pixel dimensions
  ("16:9 (1280×720)" etc.) and span gains truncate min-w-0 for safety.

- Bug #3: storage_service.list_user_materials gains dedupe=True default
  collapsing entries by (name, size); router accepts ?dedupe=false override.
  MaterialLibraryGrid a11y: aria-label uses materialLibraryReferenceLabel
  template, img alt="", overlays aria-hidden, aria-pressed for selection.

- Bug #4: VoiceSelector closes on Escape; sticky search input filters by
  name/description/category; gender radio (all/male/female); useId +
  aria-controls/aria-haspopup/aria-expanded on trigger; listbox/option
  roles + aria-selected on options.

- Bug #5: localized src/app/not-found.tsx with home + back actions and
  English fallback; new top-level notFound i18n keys (zh + en).

- Bug #6: UserInfoPanel renders Save/Cancel persistently with
  disabled={!hasChanges || isLoading}; pristine state shows "No changes"
  hint instead of vanishing buttons.

Tests: 5 new Vitest spec files (23 cases) + 2 new pytest cases for
list_user_materials dedupe. type-check clean.
```

---
End of report.
