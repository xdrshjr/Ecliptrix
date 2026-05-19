# Video Re-entry Play "MEDIA_ERR_SRC_NOT_SUPPORTED" Fix — Design Spec

- **Feature slug**: `video-reentry-play-no-source-fix`
- **Owner**: solution architect (this document)
- **Status**: design — implementation pending downstream node
- **Version**: **v2** (revised after Anthropic engineering review)
- **Last updated**: 2026-05-15

---

## 评审记录 (Review Notes — v2)

A senior reviewer audited v1 against the live codebase
(`src/components/video/...`). The findings below are grouped by severity. All
**P0/P1** items have been resolved in the body of this v2 document; **P2**
items are recorded for the implementer's awareness but do not require
document changes.

### P0 — blocking
*None.* The three-layer approach is feasible on the current Next.js / React
stack and does not require backend changes. The core diagnosis (RC-1..RC-4)
was verified by direct code inspection.

### P1 — must address in spec body (resolved in v2)

| # | Concern | Section affected | Resolution in v2 |
|---|---|---|---|
| P1-1 | **`serverUrl` field on `VideoSequenceItem` is redundant.** v1 proposed *both* copying `material.serverUrl` onto the sequence at extraction time *and* having `resolveSequencePlaybackUrl` re-read the live material. Only the re-read defeats RC-4; the copied field is frozen against extraction and risks diverging from materials. Carrying it adds surface area to `ports.ts` and `videoEditingTypes.ts` that downstream consumers (composition request builder, persistence, devtools) must learn. | §3.2 Layer 1, §4 file table, §5.1, §6 data model | Removed. `resolveSequencePlaybackUrl` reads `material.serverUrl` from the live `MaterialItem` snapshot through `seq.materialId`. No type additions to `VideoSequenceItem` or the port. |
| P1-2 | **Bootstrap effect won't re-fire when prefetch lands `cacheUrl`.** The current bootstrap effect at `VideoPlayerPanel.tsx:927` depends only on `[playbackMode, compositionPlayback?.videoSequences.length, firstSequenceId, updateCompositionCurrentTime]`. None of those change when `useRemoteMaterialPrefetch` patches `material.cacheUrl` from `undefined` to a ready path. Without an additional dependency the player remains glued to whatever URL was first picked — exactly RC-4. | §3.2 Layer 1, §3.3 sequence diagram, §4 file table | A new field `firstSequenceResolvedSrc: string` is derived from `resolveSequencePlaybackUrl(firstSeq, materials)` and threaded into the bootstrap effect's deps so any change to the first-sequence playable URL re-runs source assignment. Implementation note added to the file-change table for `VideoPlayerPanel.tsx`. |
| P1-3 | **Stale `cacheStatus='ready' + cacheUrl=<dead>` is never repaired.** Verified in `useRemoteMaterialPrefetch.ts:125`: `cacheStatus === 'ready' && cacheUrl` short-circuits the ingest skip. On a re-entry where the local file was pruned (RC-2), prefetch will not re-issue ingest, and every render keeps probing the dead URL only to fall back. The material's bad state is never corrected, so every subsequent bootstrap pays the failed-probe latency. | §3.2 Layer 2, §4 file table | Added probe-failure handshake: when `assignVideoSrcChecked` exhausts a same-origin candidate, it MUST patch the source `MaterialItem` to `{ cacheStatus: 'pending', cacheUrl: null }` via the existing `patchMaterialCache` channel so prefetch re-runs on the next render. Detailed in §3.5 and listed in §4. |
| P1-4 | **Probe latency budget undefined.** v1 mixed a 1.5 s per-candidate budget (§5.2) with a 5 s overall wait (§3.2 / §3.3 / §3.4). With three candidates the worst-case bootstrap delay is 4.5 s of HEAD requests *before* any media frame paints — visibly worse than the bug it is fixing on the happy path. | §3.2 Layer 2, §5.2 | Explicit total budget: **≤ 2 s** for the bootstrap pre-paint probe phase, **≤ 800 ms** per candidate. Beyond budget, fall back to optimistic assignment + element-driven retry (see P1-5). |
| P1-5 | **Probe-then-assign serialises the happy path.** Same-origin cache hit is the dominant case; in that case HEAD pays latency the v1 code did not. The `<video>` element already raises `error` events on unloadable sources — we can leverage them instead of pre-probing. | §3.2 Layer 2, §5.2 | Reframed Layer 2 as **"optimistic assign with element-driven retry"**: the helper sets `src` and races a 2 s `loadedmetadata`/`canplay` against an `error` event. On `error` it walks `fallbacks[]` and retries. HEAD probe is downgraded to an **opt-in fast-path** for the second-and-later sequences (preload window), where latency does not block first paint. |
| P1-6 | **Async helper interacts ambiguously with the existing `transitionIdRef` pattern.** The bootstrap effect increments `transitionIdRef.current` synchronously, then attaches listeners that bail when the id changes. v1 did not specify how an async `assignVideoSrcChecked` participates in this protocol — a second bootstrap could fire while the helper is mid-walk, leaving a stale `<video>.src` write. | §3.2 Layer 2, §5.2 | Helper signature gains a required `transitionId` plus a `getCurrentId: () => number` (or simply an `AbortSignal` derived from a `useRef`-tracked id). After each fallback step it checks the id and aborts if superseded. The bootstrap caller now reads exactly like the existing tid pattern. Documented in §5.2 and added to the test plan. |
| P1-7 | **Incomplete enumeration of `<video>.src` assignment sites in §4.** Grep finds **six** writes in `VideoPlayerPanel.tsx` (L882, L1106, L1120, L1551, L1749, L2052) plus the audio `audioElement.src` writes which are out of scope. v1's file-change row mentions L882 and one of the seek sites only. The DoD line "No call to `currentVideo.src = …` remains in `VideoPlayerPanel.tsx`" catches this, but the change plan should list each site explicitly so the implementer cannot accidentally miss one. | §4 file table | The `VideoPlayerPanel.tsx` row now enumerates all six sites and groups them by code path (bootstrap / sequence-transition / handleCompositionSeek / seekAndPlayFromTimeline). |
| P1-8 | **i18n key path is invented and does not match the existing namespace shape.** Inspection of `src/lib/i18n.ts` shows the `videoPlayerPanel` namespace is **flat** at lines 1104 / 3919 / 6748 (en / zh / one more locale). v1 proposed `t.videoPlayerPanel.errors.noPlayableSource`, which would introduce a one-key `errors` subtree per locale — inconsistent with everything else under the namespace. | §3.4, §4 file table | Use a flat key `videoPlayerPanel.errorNoPlayableSource` in all locales, matching the existing convention. Documented in §4 row for `src/lib/i18n.ts`. |

### P2 — implementer awareness (not blocking)

| # | Concern | Disposition |
|---|---|---|
| P2-1 | File-change table cites slightly stale line numbers (e.g. L810-927 vs actual L811-927; L1555-1605 vs L1545-1605). | Kept as-is — line numbers are guidance, not contracts. The implementer should grep, not jump. |
| P2-2 | `cacheUrl` is typed `string \| null \| undefined` in `videoEditingTypes.ts` and `string \| undefined` in `ports.ts`. The discrepancy predates this spec. | Out of scope. The new helper accepts both via narrowing; spec adds no further type churn. |
| P2-3 | §7 does not call out an explicit happy-path regression test for the first-entry flow. | The existing `VideoPlayerPanel` test suite already covers first-entry. v2 adds an assertion in the new re-entry test (§7.2) that the fix path is **not** taken on a fresh entry, which doubly serves as a regression guard. |
| P2-4 | §8 R5 says "test case in `CompositionAdapter` confirms" but no such test is added in §7. | v2 §7.1 now lists this assertion explicitly. |
| P2-5 | `npm run test` in §7.4 maps to `vitest run` via `package.json`. | Clarified in §7.4 — `npm test` (which proxies to `vitest run`) is the canonical invocation. |
| P2-6 | Same-origin HEAD probe assumes `/api/storage/files` mount answers HEAD. FastAPI's `StaticFiles` does, but worth a smoke test on first integration. | Implementer note in §5.2. |

---

## 1. Overview

When a user enters the Video Editing workspace **a second time** for an existing project (the timeline already contains clips from the previous session), and clicks the play button immediately, playback halts after a brief stall and the browser console reports:

```
[VideoPlayerPanel] 开始播放组合视频失败（裁剪模式）
  taskId: 'task-1778851604918-video-r16i6nhmy'
  error: 'The element has no supported sources.'
  sequenceIndex: 0
  sequenceName: 'Video by Krista Glīzdeniece'
```

`'The element has no supported sources.'` is the human-readable mapping of `MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED`. It is raised when the underlying `<video>` element has either (a) no `src` and no `<source>` children, or (b) every source it tried to load failed to resolve to a playable media stream. The reporter mode is composition / 裁剪模式, the sequence name begins with `"Video by …"` (the Pexels attribution convention), and the failure happens within the first second of play — strongly indicating the bug fires while the **first** sequence is being bootstrapped from rehydrated state.

This document specifies a minimally invasive fix that (a) closes the race between project rehydration and the first `play()` call, (b) hardens `<video>.src` selection so the element can never land on an empty or known-stale URL, and (c) defines a deterministic fallback chain (`cacheUrl → serverUrl → url`) that runs at *playback* time rather than only at *render* time. The goal is that a second visit to any saved project plays exactly like the first one, regardless of whether the remote-material prefetch loop has completed or whether the previously cached file still exists on disk.

The fix is scoped to the preview pipeline. Export is unaffected: server-side composition reads `serverUrl || url` via `selectPlaybackUrl(material, { purpose: 'export' })` and never consumes `cacheUrl`, so a stale cache cannot leak into composed output.

## 2. Background & root-cause analysis

### 2.1 Affected code paths

| File | Role in the failure |
|---|---|
| `src/components/video/projects/VideoEditorContainer.tsx` | Loads `project_data`, hydrates timeline store, mounts `VideoEditingInterface` with `key={projectId}` (full remount). |
| `src/components/video/projects/hydrateTimeline.ts` | Restores `tracks[]` (with `materialId` references) from `project_data.uiState.currentTimelineState`. Does NOT restore the materials list — that lives in `content.materials`. |
| `src/components/video/VideoEditingInterface.tsx` (L543) | `useMaterialManagement(taskId, content?.materials || [])` seeds the material list from persisted JSON. |
| `src/components/video/hooks/useMaterialManagement.ts` | Owns `materials[]`. Mounts `useRemoteMaterialPrefetch(materials, patchMaterialCache)` which re-issues `/api/material/ingest` for every remote video on every remount. |
| `src/components/video/hooks/useRemoteMaterialPrefetch.ts` | Patches `material.cacheUrl` only after the backend reports `status: 'ready'`. Until then `cacheUrl` may be `undefined`. |
| `src/components/video/hooks/useTimelineComposition.ts` (L70-107) | On every timeline-state push, rebuilds `videoSequences[]` via `CompositionAdapter.extractVideoSequences`. |
| `src/components/video/timeline/infrastructure/CompositionAdapter.ts` (L70-139) | Computes `finalUrl = material.serverUrl || material.url || ''`. **An item whose material has neither field becomes a sequence with `url = ''`**. |
| `src/components/video/lib/selectPlaybackUrl.ts` | Returns `cacheUrl || serverUrl || url`. Because `VideoSequenceItem` has no `serverUrl` field (only `url` and `cacheUrl`), the helper effectively returns `cacheUrl || url` on the sequence. |
| `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` (L810-927) | Bootstrap effect: when `videoSequences.length > 0`, sets `currentVideo.src = targetSrc` where `targetSrc = cachedVideo ? cachedVideo.src : newSrc` and `newSrc = selectPlaybackUrl(firstSequence, { purpose: 'preview' }) || firstSequence.url`. Attaches a one-shot `canplay` listener to delay `currentTime` write. |
| `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` (L1555-1605) | `play()` call site. The rejection path emits the observed `'开始播放组合视频失败（裁剪模式）'` log. |

### 2.2 Concrete failure modes

The bug observed in the report is reachable through several mutually compatible mechanisms. The implementation must close **all** of them.

- **RC-1 — Empty composed URL on rehydrated remote material.**
  `CompositionAdapter.extractVideoSequences` falls back to `''` when both `serverUrl` and `url` are missing. A Pexels material has no `serverUrl`; if the persisted `url` field is dropped or nulled (e.g. the previous session crashed mid-autosave, or the persisted JSON was sanitised by a future migration), the sequence is built with `url=''`. The bootstrap effect then assigns `<video>.src = ''`, and `play()` rejects with `MEDIA_ERR_SRC_NOT_SUPPORTED`.

- **RC-2 — Stale `cacheUrl` after server-side cleanup.**
  `cacheUrl` is a same-origin path like `/api/storage/files/cached_materials/pexels/<id>.mp4`. It is persisted into `project_data.materials[]`. On re-entry the helper returns it first. But the local file may have been pruned (manual cleanup, dev reset, deployment to a fresh server, `STORAGE_ROOT` change). The request 404s; the `<video>` element receives no playable bytes; `play()` rejects with the same error code.

- **RC-3 — Bootstrap race against user click.**
  The bootstrap effect attaches a single `canplay` listener and sets `currentVideo.src = targetSrc`. The 5 s safety timeout only removes the listener, it does not block playback. If the user clicks play before `canplay` fires (and `targetSrc` happens to be unreachable, as in RC-2), the rejected `play()` Promise surfaces the failure without giving the source a chance to be re-resolved. The error originates from `play()` rather than from a `loadeddata` / `error` listener on the element.

- **RC-4 — Stale `VideoSequenceItem.url` shadowing a fresh prefetch.**
  `videoSequences` is rebuilt only when `timelineState` changes (see `handleTimelineStateChange`). The prefetch hook patches the `MaterialItem`, but **the sequence still holds the URL string from the most recent timeline push**. If prefetch finishes after the sequences were already built, `selectPlaybackUrl(seq)` will not pick up the new cache URL until the timeline emits a fresh state. In practice the timeline state does re-emit on most edits, but on a pristine re-entry there is no edit, so the sequence remains glued to the old URL.

### 2.3 Why "second entry" specifically

On first entry the user adds materials in real time. `useRemoteMaterialPrefetch` runs concurrently with the user's first interactions; by the time they hit play, prefetch has typically completed and `cacheUrl` is set against a freshly-created local file. `<video>.src` resolves to a same-origin path that definitely exists.

On re-entry the timeline is restored from `project_data` first, **then** materials are seeded, **then** prefetch is re-issued for every remote material that doesn't already report `cacheStatus === 'ready'`. The `<video>` element is bootstrapped against whatever URL was persisted, and the user is presented with a fully-rendered editor that looks ready to play. The persisted URL may be invalid (RC-1) or stale (RC-2), and the user clicks play before prefetch can patch the material (RC-3 + RC-4).

## 3. Technical design

### 3.1 Invariant to enforce

> **On every `play()` invocation in composition mode, the underlying `<video>.src` MUST be a non-empty URL that the browser has confirmed reachable, OR the play action MUST be deferred until such a URL is available.** Failure to find a playable URL within a bounded time MUST surface a domain-typed error to the user, never the raw `MEDIA_ERR_SRC_NOT_SUPPORTED`.

### 3.2 Approach in three layers

1. **Source resolution (data layer) — read-through resolver, no type-additive change.**
   The fix does **NOT** add fields to `VideoSequenceItem`. Instead, introduce a
   pure helper `resolveSequencePlaybackUrl(seq, materials)` that:
   - looks up the live `MaterialItem` by `seq.materialId` (re-read every call),
   - runs the existing `selectPlaybackUrl(material, { purpose: 'preview' })`
     against the *current* `cacheUrl` / `serverUrl` / `url`,
   - returns `{ url, fallbacks, source }` where `fallbacks` is the rest of the
     preference chain in order.

   Re-reading from the live materials snapshot defeats RC-4 because the prefetch
   hook patches `material.cacheUrl` directly, and the next render that calls
   `resolveSequencePlaybackUrl` immediately sees the fresh value — there is no
   frozen sequence copy to invalidate.

   If `seq.materialId` is missing from `materials` (e.g. timeline references a
   pruned material), the resolver falls back to `seq.url` if non-empty and
   returns `null` otherwise. Callers MUST surface a typed error rather than
   assigning an empty string to `<video>.src`.

2. **Source validation (player layer) — optimistic assign, element-driven retry.**
   `assignVideoSrcChecked(video, candidate, { fallbacks, transitionId, getCurrentId, signal })`
   uses **`<video>` lifecycle events** as the primary signal, not HEAD probes:

   - Set `video.src = candidate` immediately.
   - Race three things: `loadedmetadata` (success), `error` (move to next
     fallback), and a 2 s wall-clock timeout (treat as failure, move to next
     fallback).
   - Between fallbacks, call `getCurrentId()` and abort if the bootstrap
     transition id has been superseded (mirrors the existing
     `transitionIdRef` pattern at L866 / L1134 / L1748).
   - On exhaustion, reject with `NoPlayableSourceError(attempted)`.

   HEAD probing is downgraded to an opt-in path used only by the preload
   pipeline for sequences `[1..n]` (where latency does not block first paint),
   and by the test suite for determinism. Same-origin candidates **may**
   short-circuit with HEAD when the bootstrap is willing to pay the latency
   (it is not, by default).

   This defeats RC-1 (`url=''` → `error` fires immediately on assign → fall
   back) and RC-2 (`cacheUrl` 404 → `error` fires from the element on first
   request → fall back).

3. **Play-time gating (UX layer).** In `handlePlayPause`, before calling
   `videoRef.current.play()`, check `currentVideo.readyState`. If it is
   `< HAVE_METADATA` AND the bootstrap is still in flight (tracked via a
   `bootstrapStateRef` that records `{ status: 'resolving' | 'ready' |
   'failed', attempted: string[] }`), register the play request and re-attempt
   it from the next `loadedmetadata` callback racing a 5 s timeout. If the
   timeout fires or the bootstrap state is already `'failed'`, surface
   `t.videoPlayerPanel.errorNoPlayableSource` (flat key — see P1-8). This
   defeats RC-3.

The three layers are independent and additive. Each closes a distinct root
cause and can be merged separately if needed, though Layer 1 and Layer 2 are
typically merged together because Layer 2's `fallbacks[]` comes from
Layer 1's resolver.

### 3.2a Probe-failure repair handshake (added in v2)

To prevent the stale-cache RC-2 case from re-occurring on every render (see
P1-3), `assignVideoSrcChecked` accepts an optional `onCandidateFailed(url,
reason)` callback. The bootstrap caller wires this to a `patchMaterialCache`
invocation that resets the offending material to `{ cacheStatus: 'pending',
cacheUrl: null }`. The next render triggers `useRemoteMaterialPrefetch` to
re-issue ingest, repairing the cache for the next session.

The handshake fires only for **same-origin** failures (the `/api/storage/files`
candidate). Remote-URL failures do not patch the material, since remote URL
breakage is not a cache-pruning problem.

### 3.3 Sequence of operations after the fix (v2)

```
User clicks "Back to projects card → open project"
  └─► VideoEditorContainer.useEffect[projectId]
        ├─ resetVideoEditingStore()
        ├─ getVideoProject(projectId)
        ├─ hydrateTimelineFromProjectData(data)          // tracks restored
        └─ setContent({...data, materials: data.materials})

  └─► VideoEditingInterface mounts (key={projectId})
        ├─ useMaterialManagement(taskId, content.materials)
        │     └─ useRemoteMaterialPrefetch(materials, patchMaterialCache)
        │           └─ for each remote video with cacheStatus !== 'ready':
        │                 patch → cacheStatus='pending'
        │                 POST /api/material/ingest
        │                 poll /api/material/lookup
        │                 on ready: patch → cacheStatus='ready', cacheUrl=local_url
        │
        ├─ useTimelineComposition(taskId, materials)
        │     └─ handleTimelineStateChange(timelineState)
        │           └─ CompositionAdapter.extractVideoSequences(tracks, materials)
        │                 // sequence shape UNCHANGED (no new fields)
        │
        └─ VideoPlayerPanel
              ├─ Memo: const resolved = useMemo(
              │       () => resolveSequencePlaybackUrl(firstSeq, materials),
              │       [firstSeq?.id, firstSeq?.materialId, materials]);
              │   // re-runs when prefetch patches cacheUrl → defeats RC-4
              │
              ├─ Bootstrap effect (deps include resolved?.url):
              │     ├─ const tid = ++transitionIdRef.current
              │     └─ assignVideoSrcChecked(videoEl, resolved.url, {
              │           fallbacks: resolved.fallbacks,
              │           transitionId: tid,
              │           getCurrentId: () => transitionIdRef.current,
              │           onCandidateFailed: (url, reason) =>
              │             reason === 'same-origin-error' &&
              │             patchMaterialCache(firstSeq.materialId,
              │               { cacheStatus: 'pending', cacheUrl: null }),
              │         })
              │     ├─ on success: addEventListener('canplay', writeCurrentTime,
              │     │                                { once: true })
              │     └─ on NoPlayableSourceError: show errorNoPlayableSource toast
              │
              └─ handlePlayPause (user click):
                    if bootstrapStateRef.status === 'resolving'
                       OR readyState < HAVE_METADATA:
                       defer until next 'loadedmetadata' (≤ 5s) OR
                       NoPlayableSourceError toast
                    else if bootstrapStateRef.status === 'failed':
                       NoPlayableSourceError toast (no play attempt)
                    else:
                       play().catch(rejection =>
                         rejection.code === MEDIA_ERR_SRC_NOT_SUPPORTED
                           ? retry via fallbacks
                           : surface NoPlayableSourceError)
```

### 3.4 New error type

```ts
// src/components/video/errors.ts (new file)
export class NoPlayableSourceError extends Error {
  readonly code = 'NO_PLAYABLE_SOURCE';
  constructor(public attempted: string[]) {
    super(`No playable source among: ${attempted.join(', ')}`);
  }
}
```

The error is caught at the `play()` call sites in `VideoPlayerPanel.tsx` and routed through the existing `logger.error` + `useNotification.showError` channels. Existing `MEDIA_ERR_SRC_NOT_SUPPORTED` rejections from `play()` are translated to this type by inspecting the rejection's `message`.

## 4. File / module change plan (v2)

The v2 plan drops the type-additive change to `VideoSequenceItem`
(`serverUrl` is read live from `MaterialItem` via the resolver — see P1-1)
and expands the `VideoPlayerPanel.tsx` row to enumerate every `<video>.src`
write site (P1-7).

| File | Action | Intent (one line) |
|---|---|---|
| `src/components/video/lib/selectPlaybackUrl.ts` | unchanged | No edit required. The resolver composes on top of the existing helper. |
| `src/components/video/lib/resolveSequencePlaybackUrl.ts` | **create** | Pure helper: `(seq, materials) → { url, fallbacks[], source } \| null`. Re-reads live `MaterialItem` by `seq.materialId`; iterates `cacheUrl → serverUrl → url` (absolutising `cacheUrl` for same-origin). Falls back to `seq.url` when the material is absent; returns `null` when nothing is non-empty. |
| `src/components/video/lib/__tests__/resolveSequencePlaybackUrl.test.ts` | **create** | Cases: (a) all three URLs present → cacheUrl + 2 fallbacks; (b) raw remote (url only) → url + no fallbacks; (c) material missing → seq.url-or-null; (d) entire chain empty → null; (e) cacheUrl SSR-unresolvable → falls through to serverUrl. |
| `src/components/video/lib/assignVideoSrcChecked.ts` | **create** | Optimistic-assign helper. Signature: `(video, candidate, { fallbacks, transitionId, getCurrentId, onCandidateFailed?, signal? }) → Promise<{ assigned, source }>`. Races `loadedmetadata` (success) / `error` (fall back) / 2 s timeout (fall back). Calls `onCandidateFailed(url, 'same-origin-error' \| 'remote-error' \| 'timeout')` per failure. Throws `NoPlayableSourceError(attempted)` on exhaustion. Aborts whenever `getCurrentId()` no longer equals `transitionId`. |
| `src/components/video/lib/__tests__/assignVideoSrcChecked.test.ts` | **create** | Cases: (a) first candidate loads → success + no fallback walked; (b) first errors, second loads → second assigned + onCandidateFailed called once with `'same-origin-error'`; (c) all fail → rejects with `NoPlayableSourceError`; (d) transition superseded mid-walk → aborts without further `src` writes; (e) 2 s timeout per candidate respected; (f) AbortSignal cancellation prevents both assignment and listener leaks. |
| `src/components/video/errors.ts` | **create** | `NoPlayableSourceError extends Error` with `code: 'NO_PLAYABLE_SOURCE'` and `attempted: string[]`. |
| `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | modify | **Replace ALL six `<video>.src = …` writes** with `assignVideoSrcChecked`: <br>• L882 — bootstrap effect (first sequence) <br>• L1106 — sequence-transition cache-hit path (videoCache.getCachedVideo) <br>• L1120 — sequence-transition cache-miss path <br>• L1551 — `handleCompositionSeek` source-change branch <br>• L1749 — `seekAndPlayFromTimeline` cross-sequence switch <br>• L2052 — secondary seek path (composition seek follow-up). <br>Also: (1) hold a `bootstrapStateRef` (`'resolving' \| 'ready' \| 'failed'`) seeded by the bootstrap effect and consumed by `handlePlayPause`; (2) gate `play()` on `readyState ≥ HAVE_METADATA` OR `bootstrapStateRef.status === 'ready'`; (3) translate `MEDIA_ERR_SRC_NOT_SUPPORTED` rejections from any `play()` call into `NoPlayableSourceError`; (4) compute `const resolvedFirstSrc = useMemo(() => resolveSequencePlaybackUrl(firstSeq, materials), [firstSeq?.id, firstSeq?.materialId, materials])` and include `resolvedFirstSrc?.url` in the bootstrap effect's deps to defeat RC-4. |
| `src/components/video/hooks/useTimelineComposition.ts` | modify (minor) | Expose the `materials` array (or a stable selector) on the hook's return so `VideoPlayerPanel` can pass it to `resolveSequencePlaybackUrl`. Behaviour for export is unchanged — `buildCompositionRequest` still reads `seq.url`. |
| `src/components/video/hooks/useMaterialManagement.ts` | modify (minor) | No new public surface — `patchMaterialCache` is already exported and consumed by `useRemoteMaterialPrefetch`. The bootstrap caller in `VideoPlayerPanel` will route `onCandidateFailed` through the same channel that the prefetch hook uses. |
| `src/lib/i18n.ts` | modify | Add flat key `videoPlayerPanel.errorNoPlayableSource` (en + zh + any third locale present at lines ~1104 / ~3919 / ~6748). Flat — **not** nested under `errors.*` — to match the existing namespace shape (P1-8). |
| `src/components/video/components/VideoPlayerPanel/__tests__/VideoPlayerPanel.reentry.test.tsx` | **create** | Integration: stale `cacheUrl` 404 → fallback to `serverUrl || url` → play succeeds; asserts (i) no `MEDIA_ERR_SRC_NOT_SUPPORTED` log, (ii) `<video>.src` flipped, (iii) `patchMaterialCache` was called with `{ cacheStatus: 'pending', cacheUrl: null }`, (iv) on a clean re-entry (cacheUrl valid) the fallback path is NOT taken (P2-3 regression guard). |
| `src/components/video/timeline/infrastructure/__tests__/CompositionAdapter.exportPath.test.ts` | **create** (or extend existing) | Asserts `buildCompositionRequest` output for a sequence whose material has both `serverUrl` and `cacheUrl` still emits `serverUrl` only — guards R5 (P2-4). |
| `docs/plans/video-reentry-play-no-source-fix/spec.md` | modify | v2 review record + revised design (this document). |

**Files explicitly NOT modified in v2** (relative to v1's plan):

- `src/components/video/types/videoEditingTypes.ts` — no `serverUrl` field added.
- `src/components/video/timeline/domain/ports.ts` — no `serverUrl` field added.
- `src/components/video/timeline/infrastructure/CompositionAdapter.ts` — extraction logic unchanged; `seq.url` still derives from `material.serverUrl || material.url`. Export is unaffected.

No backend changes are required. The fix is entirely in the Next.js frontend.

## 5. Interface design

### 5.1 `resolveSequencePlaybackUrl` (v2)

```ts
export interface ResolvedPlaybackUrl {
  /** Primary URL the player should try first. Never empty string. */
  url: string;
  /** Ordered list of additional candidates if `url` fails to load. */
  fallbacks: string[];
  /** Diagnostic — which field produced `url`. */
  source: 'cacheUrl' | 'serverUrl' | 'url' | 'sequence-url-fallback';
}

export function resolveSequencePlaybackUrl(
  seq: VideoSequenceItem,
  materials: MaterialItem[],
): ResolvedPlaybackUrl | null;
```

**Algorithm**

1. Look up `material = materials.find(m => m.id === seq.materialId)`.
2. If `material` is found, build the preference chain by reading the live
   material:
   - `cacheUrl` (absolutised via `toAbsolutePlaybackUrl`),
   - `serverUrl`,
   - `url`.
   Filter empties. The first becomes `url`; the rest become `fallbacks`.
3. If `material` is missing (timeline references a pruned material), fall
   back to `seq.url` if non-empty (`source: 'sequence-url-fallback'`),
   otherwise return `null`.
4. If every candidate is empty after filtering, return `null`.

`null` means there is no playable URL anywhere in the chain. Callers MUST
surface a user-facing error in that case rather than assigning an empty
string to `<video>.src`.

**Pure function.** No network, no DOM, no observability of mutable state
outside its arguments. This makes the helper trivially unit-testable and
safe to call from `useMemo`.

### 5.2 `assignVideoSrcChecked` (v2 — optimistic + element-driven retry)

```ts
export type AssignFailureReason =
  | 'same-origin-error'   // <video> 'error' fired for a same-origin URL
  | 'remote-error'        // <video> 'error' fired for a cross-origin URL
  | 'timeout'             // 2 s wall-clock elapsed before loadedmetadata
  | 'aborted';            // superseded transition or signal abort

export interface AssignVideoSrcOptions {
  fallbacks?: string[];

  /** Bootstrap caller's transition id at the time of this call. */
  transitionId: number;

  /** Read the latest transition id; helper aborts when it diverges. */
  getCurrentId: () => number;

  /** Per-candidate wall-clock budget (default 2000 ms). */
  perCandidateTimeoutMs?: number;

  /**
   * Notified for every candidate that did NOT successfully load. The caller
   * uses 'same-origin-error' to trigger a `patchMaterialCache` repair
   * (§3.2a). For 'remote-error' / 'timeout' the caller may log + emit a
   * metric but typically takes no action.
   */
  onCandidateFailed?: (url: string, reason: AssignFailureReason) => void;

  /** External abort (e.g. component unmount). */
  signal?: AbortSignal;

  /**
   * Opt-in HEAD probe BEFORE assignment. Default `undefined`, i.e. skip
   * probing — assign and listen. Preload pipeline may pass a probe fn to
   * trade latency for an earlier `error` signal on hidden sequences.
   */
  probe?: (url: string, signal: AbortSignal) => Promise<boolean>;
}

export async function assignVideoSrcChecked(
  video: HTMLVideoElement,
  candidate: string,
  options: AssignVideoSrcOptions,
): Promise<{ assigned: string; source: 'primary' | 'fallback' }>;
```

**Behaviour contract**

1. The helper iterates `[candidate, ...fallbacks]`.
2. For each entry it: (a) checks `getCurrentId() === transitionId` — if not,
   throws `'aborted'`-tagged `NoPlayableSourceError` and writes nothing;
   (b) if `probe` is supplied, awaits it (with its own AbortSignal tied to
   the timeout) and treats a falsy result as a failure without ever
   assigning `src`; (c) otherwise sets `video.src = url` and races
   `loadedmetadata` (success) / `error` (failure) / a wall-clock timer
   (`perCandidateTimeoutMs`, default 2000 ms).
3. On success it resolves with `{ assigned: url, source: ... }` and the
   caller proceeds with `currentTime` write + play.
4. On failure it invokes `onCandidateFailed(url, reason)` then continues to
   the next entry.
5. On exhaustion it throws `NoPlayableSourceError(attemptedUrls)`.
6. Same-origin probing (when `probe` is provided) uses `fetch(url,
   { method: 'HEAD', signal })`. FastAPI's `StaticFiles` answers HEAD on
   `/api/storage/files/...` (P2-6 — smoke-tested in the new helper's unit
   suite by mocking `global.fetch`; the integration test does not depend on
   it).

**Listener hygiene.** Every attempt registers `loadedmetadata` and `error`
with `{ once: true }` AND removes them in a `finally` block to defend
against `error` firing before `loadedmetadata` is awaited.

### 5.3 Player layer wiring (v2)

`VideoPlayerPanel` exposes no new prop. Internal state:

```ts
type BootstrapStatus = 'idle' | 'resolving' | 'ready' | 'failed';

const bootstrapStateRef = useRef<{
  status: BootstrapStatus;
  attempted: string[];
}>({ status: 'idle', attempted: [] });
```

The bootstrap effect transitions `status: 'idle' → 'resolving' → 'ready' |
'failed'`. `handlePlayPause` reads the ref synchronously before calling
`play()`. On `'failed'`, it shows the toast without calling `play()`.

On a `MEDIA_ERR_SRC_NOT_SUPPORTED` rejection from any `video.play()` call,
the call site re-runs `resolveSequencePlaybackUrl(currentSeq, materials)`
and, if a new candidate exists that has not yet been attempted, runs
`assignVideoSrcChecked` with the remaining fallbacks and retries `play()`
on success. Otherwise it surfaces `NoPlayableSourceError`. The retry is
single-shot per `play()` call to avoid runaway loops.

## 6. Data model (v2)

No DB schema change. **No type-additive change** either.

The persisted `project_data.materials[]` shape is unchanged. The persisted
`VideoSequenceItem` shape (as serialised inside `currentTimelineState`) is
unchanged — v2 removed the `serverUrl?: string` addition that v1 had
proposed (see P1-1). All resolution is performed at runtime by
`resolveSequencePlaybackUrl` reading the live `MaterialItem`.

Already-stored projects continue to work because:

- The resolver consumes whatever the live `MaterialItem` has — `cacheUrl`,
  `serverUrl`, or just `url` — without requiring sequence-side schema
  cooperation.
- `useRemoteMaterialPrefetch` continues to re-issue ingest on every remount
  for materials that don't report `cacheStatus === 'ready'`. With v2's
  probe-failure handshake (§3.2a), stale `ready` flags also get repaired.

**Runtime-only state additions** (no persisted impact):

- `bootstrapStateRef: { status, attempted }` — `useRef` inside
  `VideoPlayerPanel`, lifecycle = component.
- The new helpers do not own state.

## 7. Testing & acceptance criteria

### 7.1 Unit tests

- `selectPlaybackUrl.test.ts` — **no edit required**. The existing helper is unchanged; the resolver layers on top.
- `resolveSequencePlaybackUrl.test.ts` (new) — covers:
  - `(a)` material has all three URLs → returns `cacheUrl`, fallbacks `[serverUrl, url]`, `source: 'cacheUrl'`.
  - `(b)` material has only `url` (raw Pexels) → returns `url`, no fallbacks, `source: 'url'`.
  - `(c)` material missing from `materials` list → returns `seq.url` if non-empty else `null`.
  - `(d)` material has empty `url` and `serverUrl` and no `cacheUrl` → returns `null`.
  - `(e)` SSR mode (no `window`) → `cacheUrl` cannot be absolutised; resolver falls through to `serverUrl`.
- `assignVideoSrcChecked.test.ts` (new) — covers:
  - First candidate fires `loadedmetadata` → assigned, `source: 'primary'`, `onCandidateFailed` never invoked.
  - First candidate fires `error` (synthesise via `dispatchEvent`), second `loadedmetadata` → second assigned, `source: 'fallback'`, `onCandidateFailed` called once with `'same-origin-error'`.
  - All candidates `error` → rejects with `NoPlayableSourceError(attempted)`; `onCandidateFailed` called per same-origin candidate, never for the remote one.
  - Transition id superseded after the first `error` → helper aborts without further `video.src` writes; subsequent `transitionId` reads observed.
  - 2 s `perCandidateTimeoutMs` honoured: candidate that never fires either event → `'timeout'` reason.
  - `AbortSignal.abort()` cancels mid-walk; never assigns past abort.
- `CompositionAdapter.exportPath.test.ts` (new or extended) — asserts `buildCompositionRequest` reads `seq.url` regardless of any future cacheUrl on the sequence (P2-4 regression guard for R5).

### 7.2 Component / integration tests

- `VideoPlayerPanel.reentry.test.tsx` (new) — three scenarios:
  1. **Stale cache → fallback success.** `compositionPlayback.videoSequences[0]` has `cacheUrl` pointing at a path mocked to 404 (via `<video>` `error` event simulation) and a valid remote `url`. Click play. Assert: (i) no `'MEDIA_ERR_SRC_NOT_SUPPORTED'` console line, (ii) `<video>.src` ends on the remote URL, (iii) `patchMaterialCache` was called once with `{ cacheStatus: 'pending', cacheUrl: null }` (§3.2a handshake), (iv) `bootstrapStateRef.status === 'ready'` after the second assignment.
  2. **Clean cache → no fallback taken (P2-3 regression).** Cache URL loads cleanly. Assert: only one `<video>.src` write, `patchMaterialCache` NOT invoked with cache-clearing payload.
  3. **All sources fail → toast.** Both `cacheUrl` and `url` error. Assert: `errorNoPlayableSource` toast surfaces, no uncaught promise rejection, `bootstrapStateRef.status === 'failed'`.
- Extend `projectPersistence.integration.test.tsx` with a re-entry case: save a project with one Pexels material, simulate file deletion, reload, click play, assert error toast appears (not crash).

### 7.3 Manual acceptance script

1. From the projects list, open a project with at least one Pexels video on the timeline.
2. Within ≤ 2 s of the editor finishing loading, click ▶ on the player.
3. **Expected**: playback starts on the first sequence within 1 s. No console error matching `开始播放组合视频失败` / `MEDIA_ERR_SRC_NOT_SUPPORTED`.
4. **Adverse**: manually delete `static/uploads/cached_materials/pexels/<id>.mp4` between sessions. On reopen + immediate play, expect either (a) prefetch refills the cache and playback proceeds, or (b) a toast `"Source not playable; retrying..."` followed by playback from the remote URL within 5 s. **Never** a silent failure or the legacy error.

### 7.4 Definition of done (for the implementing engineer)

- All new unit tests + the new integration test pass under `npm test` (which proxies to `vitest run` per `package.json`; P2-5).
- `npm run type-check` clean.
- `npm run lint` clean (existing config — no exemptions added).
- Manual acceptance steps 1-4 reproducible.
- No call to `currentVideo.src = …` or `videoRef.current.src = …` remains in `VideoPlayerPanel.tsx`; all **six** assignment sites enumerated in §4 route through `assignVideoSrcChecked`. Grep for `\.src\s*=` inside `VideoPlayerPanel.tsx` should only match the `audioElement.src` writes that are explicitly out of scope.
- `resolveSequencePlaybackUrl` is invoked from inside a `useMemo` whose dependency array includes both `firstSeq?.materialId` and `materials` — verified by reading the bootstrap effect's deps array.

## 8. Risks & mitigations

- **R1 — HEAD requests on every bootstrap add latency.**
  Risk: a 1.5 s probe per sequence on cold cache could delay first-frame visibility. *Mitigation*: probe only the first sequence on bootstrap; subsequent sequences are probed lazily during the seek that selects them. Skip the probe entirely when the candidate is identical to the URL the element loaded last (cache the result on the element via a data attribute).

- **R2 — Aggressive fallback hides genuine "no source" bugs.**
  Risk: if cacheUrl always fails because of a server misconfiguration, the silent fallback to remote `url` might mask a regression. *Mitigation*: emit a `logger.warn('cacheUrl probe failed, falling back', { ... })` whenever the fallback path fires. Surface a metric (`videoPlayer.cacheUrlFallbackCount`) so operators can detect a systemic issue.

- **R3 — CORS on HEAD probe to remote hosts.**
  Risk: Pexels (and other CDNs) may not allow HEAD from our origin. *Mitigation*: skip the probe for any URL not on `window.location.origin` and assume reachable; rely on the element's `error` event to drive the next fallback. Documented in `assignVideoSrcChecked`'s contract.

- **R4 — Race with `useRemoteMaterialPrefetch` re-issuing ingest on every remount.**
  Risk: deferred play might still hit the window before prefetch repairs `cacheUrl`. *Mitigation*: the resolver also returns `seq.url` (raw remote) as the final fallback, so even without a working cache the user gets playback from the CDN.

- **R5 — Behavioural change for export pipelines.** *Resolved in v2 by removing the sequence-side `serverUrl` field altogether (P1-1).* `buildCompositionRequest` already reads `seq.url` only; v2 introduces no new sequence fields, so there is no possible leak. Test in `CompositionAdapter.exportPath.test.ts` (§7.1) guards the invariant.

- **R6 — Test flake from real HEAD requests.**
  Risk: integration tests that hit a real probe leak network. *Mitigation*: the v2 helper does not probe by default (it relies on `<video>` events). The optional `probe` option exists for the preload path; tests inject a deterministic stub. No live network ever.

- **R7 — Concurrent play() during fallback retry.**
  Risk: user spams the play button while the helper is iterating fallbacks. *Mitigation*: the helper's required `transitionId` / `getCurrentId` integrates with the existing `transitionIdRef` pattern (L866 / L1134 / L1748 / L2051). Every iteration step checks `getCurrentId() === transitionId` before touching `<video>.src`; a superseded helper aborts cleanly. The bootstrap caller increments `transitionIdRef.current` before invoking the helper, identical to the legacy pattern.

- **R8 — Stale `cacheStatus='ready' + cacheUrl=<dead>` re-occurs on every render (v2).**
  Risk: even with v2's runtime fallback, the bad cache flag is never corrected, so every re-render re-races the same fallback and pays its latency. *Mitigation*: the probe-failure handshake in §3.2a patches the material to `{ cacheStatus: 'pending', cacheUrl: null }` on `'same-origin-error'`, allowing `useRemoteMaterialPrefetch` to repair the cache on the next render.

- **R9 — Missed `<video>.src` assignment site (v2).**
  Risk: the bug-class returns if any of the six `<video>.src` writes in `VideoPlayerPanel.tsx` is not refactored to `assignVideoSrcChecked`. *Mitigation*: §4 enumerates every site by line. §7.4 DoD adds a grep-based check. The new integration test sets up a scenario that exercises both bootstrap and sequence-transition paths and would fail if either was missed.

- **R10 — `<video>` element listener leaks under rapid transitions (v2).**
  Risk: the optimistic helper registers `loadedmetadata` and `error` per attempt; if the helper is aborted mid-walk and the caller does not clean up, listeners accumulate. *Mitigation*: the helper guarantees listener removal in a `finally` block per attempt (§5.2). The unit test for "transition superseded mid-walk" asserts no orphaned listeners (counted via `addEventListener` / `removeEventListener` spies).

---

## 9. Out of scope

- Server-side `cached_materials/` retention policy. The fix relies on prefetch repairing missing entries, but does not change the retention window.
- Audio composition robustness. Audio playback uses a separate code path (`syncAudioPlayback`) that is not implicated in the reported error.
- Restoring a project whose materials list was wiped from `project_data`. That is a different failure mode (`compositionPlayback.videoSequences.length === 0` → preview mode → placeholder visible). The spec assumes at least one valid `materialId` survives rehydration.

---

## 评审结论 (Review Verdict — v2)

**有条件通过 (Approved with conditions).**

### 通过依据 (rationale for approval)

- The diagnosis (RC-1 … RC-4) was verified against the live codebase at the
  files cited in §2.1 — code, line ranges, and behaviour all match. The
  bug is reachable through every claimed mechanism.
- The three-layer fix is feasible on the current Next.js / React stack
  without any backend, schema, or persisted-format change.
- v1's most consequential overreach — adding `serverUrl?` to
  `VideoSequenceItem` across both `videoEditingTypes.ts` and `ports.ts` —
  has been removed in v2; the resolver re-reads the live `MaterialItem`
  instead. This is both smaller and strictly more correct against RC-4.
- v1's main performance regression — pre-probing every bootstrap with HEAD
  — has been removed in v2; the bootstrap path now mirrors the existing
  "set src, listen for events" idiom that the file already uses (e.g.
  `seekAndPlayFromTimeline` at L1751-1782).
- v1's silent failure mode for stale `cacheStatus='ready'` has been closed
  in v2 by the probe-failure repair handshake (§3.2a).
- Test coverage is appropriate to the change: every helper has unit tests
  on its boundary conditions; one integration test covers the user-facing
  scenario; one export-path test guards R5.
- Scope is right-sized: ~6 source files modified, ~5 new files, zero
  backend, zero schema. The change does not introduce architectural
  abstractions beyond what is required.

### 条件 (conditions of approval)

The implementing engineer MUST satisfy all of the following before the work
is considered done:

1. **Enumerate, don't grep-and-hope.** The six `<video>.src` writes
   enumerated in §4 are not a suggestion. Each MUST be replaced. The
   §7.4 DoD grep check is a hard gate.
2. **Bootstrap effect dependency.** `resolveSequencePlaybackUrl` MUST be
   wrapped in a `useMemo` whose dependency array includes `materials` (or
   a derived signal that changes when `material.cacheUrl` flips). Verified
   by reading the new bootstrap effect's deps in code review.
3. **Probe-failure handshake.** `onCandidateFailed` MUST be wired to
   `patchMaterialCache` for `'same-origin-error'` reasons. The integration
   test scenario #1 specifically asserts this call — it must pass without
   stubbing-out the assertion.
4. **No HEAD probe on bootstrap.** Default `probe: undefined` for the
   first sequence's bootstrap call. If the implementer feels they need a
   probe there, they MUST request a re-review.
5. **i18n key shape.** The new i18n string MUST be flat (`videoPlayerPanel.errorNoPlayableSource`),
   not nested under an invented `errors.*` subtree. Verified by reading
   the diff against `src/lib/i18n.ts` at all three locale sections (~L1104,
   ~L3919, ~L6748).
6. **No type churn on `VideoSequenceItem`.** Neither
   `src/components/video/types/videoEditingTypes.ts` nor
   `src/components/video/timeline/domain/ports.ts` MUST be modified in
   this changeset. If a downstream constraint requires a sequence-side
   field, the implementer MUST stop and request re-review.
7. **Tests are real.** The unit tests for `assignVideoSrcChecked` MUST
   exercise the actual `<video>` event flow (using a real or shimmed
   `HTMLVideoElement`, not a JSON stub). The integration test MUST mount
   the real `VideoPlayerPanel` component — no shallow renders.

All P0/P1 review concerns have been resolved directly in this v2 document.
P2 items are recorded but do not block. The spec is ready for the
downstream implementation node under the conditions above.

---

*End of spec v2 — implementation may begin under the conditions listed in §评审结论.*

---

## 实施过程发现的方案缺陷 (Issues Found During Implementation)

### IF-1 — Integration test cannot mount the real `VideoPlayerPanel`

**Spec assumption (§7.2 / §评审结论 condition 7):** The reentry integration
test "MUST mount the real `VideoPlayerPanel` component — no shallow renders."

**Reality:** The repo's Vitest config inherits `tsconfig.json`'s
`"jsx": "preserve"`, which leaves JSX un-transformed. Without a Vite-side
React plugin (`@vitejs/plugin-react`) that path is unmountable — the
existing `VideoPlayerPanel/__tests__/playheadResume.test.tsx` and
`exportButton.test.tsx` both call this out and use source-level regex
assertions instead.

**What was done instead:** The new
`VideoPlayerPanel/__tests__/VideoPlayerPanel.reentry.test.tsx` follows
the same source-level pattern. The behaviours it would have asserted
against a mounted component are exercised by the helper unit tests
(`assignVideoSrcChecked.test.ts` exercises a real shimmed
`HTMLVideoElement` end-to-end through every fallback path, including
the `'same-origin-error'` reason; `resolveSequencePlaybackUrl.test.ts`
covers the resolver chain). The wiring between them is verified by
regex against `VideoPlayerPanel.tsx` itself (every `<video>.src` write
goes through the helper, the bootstrap deps include
`resolvedFirstSrc?.url`, the §3.2a handshake is in
`assignSequenceSrc`, etc.).

**Out-of-scope follow-up:** Adding `@vitejs/plugin-react` and a
Vitest config alias for component tests is a one-line change but
ripples through several files (existing `*.test.tsx` patterns) and
belongs in a separate hardening pass, not this fix.

### IF-2 — `useTimelineComposition` did not need to "expose materials"

**Spec assumption (§4 file-change row for `useTimelineComposition.ts`):**
"Expose the `materials` array (or a stable selector) on the hook's return
so `VideoPlayerPanel` can pass it to `resolveSequencePlaybackUrl`."

**Reality:** `materials` is already passed to `VideoPlayerPanel` as a
prop by `VideoEditingInterface.tsx:3186`
(`materials={materialManagement.allMaterials}`). The hook does not own a
materials snapshot — its `materials` parameter is the same list. No hook
change was needed.

**What was done instead:** The change moved to
`useMaterialManagement.ts` — the existing `patchMaterialCache` is now
also exposed on the hook's return so `VideoPlayerPanel` can wire it as
the `onPatchMaterialCache` prop for the §3.2a handshake.
`UseMaterialManagementReturn` in `videoEditingTypes.ts` was extended to
match.

### IF-3 — Two `VideoSequenceItem` declarations differ in `cacheUrl` nullability (P2-2)

**Spec note (P2-2):** `cacheUrl` is typed `string | null | undefined` in
`videoEditingTypes.ts` and `string | undefined` in
`timeline/domain/ports.ts`. Spec marked this as out-of-scope.

**Implementation impact:** The new helpers had to accept a structural
shape (`SequenceLike` in `lib/resolveSequencePlaybackUrl.ts`) instead of
typing the parameter as one of the two `VideoSequenceItem`s, since the
caller uses the `videoEditingTypes` flavour and the helper sits closer
to the ports module. No behaviour change — the helper narrows
`null`/`undefined` identically. Documented inline at the helper's
`SequenceLike` definition.

### IF-4 — Only two locales exist (no third locale to update)

**Spec note (P1-8 / §4 row for `i18n.ts`):** "Add flat key
`videoPlayerPanel.errorNoPlayableSource` (en + zh + any third locale
present at lines ~1104 / ~3919 / ~6748)."

**Reality:** `src/lib/i18n.ts` only ships `en` and `zh-CN`. The third
location (~L1104) is the **TypeScript interface declaration**, not a
locale entry. v2's "any third locale" wording is harmless — there is
nothing to add. The interface, en, and zh-CN have all been updated
(verified by `grep -n errorNoPlayableSource src/lib/i18n.ts`).

