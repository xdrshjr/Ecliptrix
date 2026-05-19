# VideoPlayerPanel — "未找到任何匹配的视频序列" repeated console.error

**Bug slug:** `video-player-panel-no-matching-sequence`
**Reported on:** Production (Singapore-01, `47.245.126.128`), 2026-05-20
**Reporter symptom:** "生产环境，打开之前的项目，报这个错，需要修复"
**Severity:** P2 — playback continues via the state-index fallback, but every `timeupdate`
event (multiple per second per playing video) emits a heavy `console.error`. The log
spam drowns out real errors in DevTools, and the serialised payload (URL slices,
sequence names, composition times) measurably costs CPU in long sessions.

---

## 1. Problem description

When the user opens an existing video-editing project that contains one or more
remote (e.g. Pexels) video sequences and the playhead enters composition playback,
`VideoPlayerPanel`'s `handleTimeUpdate` handler logs the following on every
`timeupdate` event:

```text
[VideoPlayerPanel] 未找到任何匹配的视频序列，使用状态索引作为最后后备
{
  taskId: 'task-1778502165366-video-koinbj13l',
  currentVideoSrc: 'https://videos.pexels.com/video-files/8059029/8059...',
  fallbackIndex: 0,
  …
}
```

The error fires from
`src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:1325` (the
"absolute fallback" branch of the sequence lookup inside `handleTimeUpdate`).

---

## 2. Reproduction steps

The bug requires that:
* `<video>.src` carries the **original remote URL** (e.g. `https://videos.pexels.com/...`),
* but every `seq` in `compositionPlayback.videoSequences` has its
  `cacheUrl` populated (so `getSequencePreviewSrc(seq)` returns the same-origin
  `/api/storage/files/cached_materials/...` URL).

Concrete repro on the production build (Next.js prod, port `3010`):

1. Sign in with any user that has `OSS_ENABLED=true` disabled, so the prefetch
   path is the local `cached_materials/` flow.
2. Create a new editing task. From the Materials → "Pexels 搜索" modal, add at
   least one Pexels clip to the video track. Save the project.
3. **Important — let the prefetch finish** so that `material.cacheUrl` is filled
   in (the `MaterialCacheBadge` switches to "已缓存"). At this point the project
   is saved both with the original Pexels `url` *and* with `material.cacheUrl`.
4. Reload the page (or pick the project from the project list, so a new
   `VideoEditorContainer` mounts the saved content).
5. Hit ▶ Play. Within ~250 ms the DevTools console starts spamming the error
   above at the `timeupdate` cadence.

A faster, in-session repro that exercises the same code path:

1. Drag any Pexels clip onto the timeline.
2. Without waiting for the cache badge, click Play. Playback begins (because
   `<video>.src` was set to the bare Pexels URL inside the bootstrap effect at
   `VideoPlayerPanel.tsx:820,882`).
3. Once `useRemoteMaterialPrefetch` lands `cacheUrl` on the material
   (`useMaterialManagement.ts:1133-1146`), make any timeline change that flips
   the `audioSequencesChanged` or `durationChanged` predicate inside
   `useTimelineComposition.ts:78-90` — e.g. trim a clip, add a TTS audio item.
4. Resume playback. The fallback error fires.

---

## 3. Root-cause analysis

### 3.1 Where the error is raised

`handleTimeUpdate` performs a three-tier search to map the playing `<video>.src`
back to a `VideoSequenceItem` in `compositionPlayback.videoSequences`
(`VideoPlayerPanel.tsx:1217-1331`):

* Tier 1 — match the state's `currentSequenceIndex` if its preview src
  matches and the composition time is inside its range
  (`:1247-1261`).
* Tier 2 — scan all sequences and pick the one whose preview src matches AND
  whose accumulated time range contains `lookupCompositionTime`
  (`:1266-1296`).
* Tier 3 — URL-only match anywhere (`:1300-1318`).
* Tier 4 — **absolute fallback**, fire the `logger.error` and just trust
  `state.currentSequenceIndex` (`:1322-1331`).

All three real tiers compare URLs via:

```ts
normalizeVideoUrl(currentVideoSrc) === normalizeVideoUrl(getSequencePreviewSrc(sequence))
```

— see `:1248, 1273, 1302`. `normalizeVideoUrl` reduces a URL to its `pathname`
(`:270-276`).

### 3.2 Why the comparison can never succeed

`getSequencePreviewSrc(seq)` is

```ts
selectPlaybackUrl(seq, { purpose: 'preview' }) || seq.url
```

(`VideoPlayerPanel.tsx:282-286`). For `purpose: 'preview'`,
`selectPlaybackUrl` prefers `cacheUrl` (absolutised against
`window.location.origin`) over `serverUrl||url`
(`src/components/video/lib/selectPlaybackUrl.ts:60-69`). So once a sequence
carries `cacheUrl`, `getSequencePreviewSrc` returns
`http://<origin>/api/storage/files/cached_materials/<source>/<id>.mp4`,
whose `pathname` is `/api/storage/files/cached_materials/...`.

Meanwhile the production log shows the live `<video>.src` is

```
https://videos.pexels.com/video-files/8059029/8059…
```

whose `pathname` is `/video-files/8059029/...`. The two pathnames have **no
overlap**, so every tier of the lookup fails and Tier 4 always fires.

### 3.3 How `<video>.src` ends up holding the original URL while `seq` has `cacheUrl`

There are three independent code paths that allow the live `<video>` element
to keep the bare remote URL after `seq.cacheUrl` is populated:

1. **Bootstrap effect deps ignore `cacheUrl`**
   `VideoPlayerPanel.tsx:811-927` is the effect responsible for setting
   `videoRef.current.src` on the first sequence. Its dependency array is

   ```ts
   [playbackMode, compositionPlayback?.videoSequences.length, firstSequenceId, updateCompositionCurrentTime]
   ```

   (`:927`). `firstSequenceId` is derived from `videoSequences[0]?.id` only
   (`:379-381`). When `cacheUrl` arrives later, the `id` and `length` don't
   change, so the effect does not re-fire and `<video>.src` is never
   re-synchronised to `selectPlaybackUrl(firstSeq, { purpose: 'preview' })`.

2. **`useTimelineComposition` change-detection is id-only**
   `src/components/video/hooks/useTimelineComposition.ts:78-90` decides
   whether to overwrite `compositionPlayback.videoSequences` with freshly
   extracted sequences. It compares only

   ```ts
   prev.videoSequences.length !== videoSequences.length ||
   JSON.stringify(prev.videoSequences.map(s => s.id)) !==
     JSON.stringify(videoSequences.map(s => s.id))
   ```

   plus the audio-id list and the total duration. A pure `cacheUrl` patch
   doesn't change any of those, so the state stays stale UNTIL something
   unrelated (trim, audio add, item move that changes total duration) flips
   one of those predicates. At that moment the new `videoSequences` array
   (carrying `cacheUrl`) replaces the old one — but the bootstrap effect
   above still doesn't re-fire.

3. **`onTimelineCompositionChange` is only emitted by store mutations**
   `src/components/video/timeline/TimelinePanel.tsx:226-254` subscribes to
   `useTimelineStore` and emits `onTimelineCompositionChange` only when the
   timeline shape JSON changes. Material-list patches (from
   `useRemoteMaterialPrefetch`) do not touch the timeline store, so the
   composition state is not rebuilt purely on `cacheUrl` arrival — but the
   moment the user touches the timeline for any other reason, point (2)
   kicks in and the stale `<video>.src` from point (1) is exposed.

The path during the user's flow ("open previous project" → play) is the
"reopen with cacheUrl persisted but no concurrent re-set of `<video>.src`"
variant: `content.materials` is persisted to `video_projects.project_data`
including `cacheUrl`
(`backend-services/basic-service/app/models/db_models.py:194`), so on reopen
the materials hydrate with `cacheUrl` set. Initial sequence extraction *does*
include `cacheUrl`, and the bootstrap effect *does* set `<video>.src` to the
same-origin cache URL — UNLESS at mount time `compositionPlayback.videoSequences`
is still empty (timeline emit ordering: `TimelinePanel`'s initial emit at
`TimelinePanel.tsx:213-218` happens before the persisted timeline data is
imported by `hydrateTimelineFromProjectData`). When the persisted timeline is
imported a few ticks later, the second emit fires with the real tracks but
`firstSequenceId` is now non-null and `length>0` simultaneously — the effect
fires once and sets `<video>.src`. If the materials prop didn't have
`cacheUrl` yet (because the prefetch poll is in flight), the effect picks
`seq.url` (the bare Pexels URL). After the prefetch lands, point (2)
eventually replaces the state with cacheUrl-bearing sequences while point (1)
prevents the bootstrap effect from re-running. From that point onward, every
`timeupdate` hits Tier 4.

### 3.4 Evidence summary (code citations)

| Concern | File:line |
|---|---|
| Tier-4 fallback error | `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:1322-1331` |
| `getSequencePreviewSrc` prefers `cacheUrl` | `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:282-286` |
| `selectPlaybackUrl` preview-path logic | `src/components/video/lib/selectPlaybackUrl.ts:60-76` |
| `normalizeVideoUrl` reduces to pathname | `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:270-276` |
| Bootstrap effect deps (omit `cacheUrl`) | `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:811-927` (esp. `:820, 879-882, 927`) |
| `firstSequenceId` memo (id-only) | `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:379-381` |
| Composition-state change detection (id-only) | `src/components/video/hooks/useTimelineComposition.ts:71-107` |
| Composition-change emit gated on store-shape change | `src/components/video/timeline/TimelinePanel.tsx:226-254` |
| `cacheUrl` field on `VideoSequenceItem` | `src/components/video/types/videoEditingTypes.ts:12-36` |
| Composition adapter forwards `material.cacheUrl` into sequence | `src/components/video/timeline/infrastructure/CompositionAdapter.ts:114-135` |
| Remote prefetch patches `material.cacheUrl` | `src/components/video/hooks/useMaterialManagement.ts:1127-1147` |

### 3.5 Direct log evidence

The error payload in the user's report ties the live `<video>.src` to a
cross-origin Pexels CDN URL while the playing task is in
composition mode (Tier 4 is only reachable when `playbackMode === 'composition'`
— see `:1210`). That combination is only possible when the sequences
in state carry `cacheUrl` (otherwise Tier 3's URL-only match would
succeed against `seq.url`). Concretely:

```
currentVideoSrc: 'https://videos.pexels.com/video-files/8059029/8059...',
fallbackIndex: 0
```

— `fallbackIndex: 0` is `state.currentSequenceIndex`. The video has
been playing (the stack trace shows the error is invoked from a
`timeupdate` listener via `cs/nz/i4` in the React renderer chunk), so
`<video>.src` was successfully assigned in the bootstrap effect. The
only way `<video>.src` can still be `videos.pexels.com` while
`seq.cacheUrl` is set is the scenario described in §3.3.

---

## 4. Impact surface

* **Who is affected:** any user opening an existing project that contains
  remote video sources (Pexels search results, ARK / Seedream generated
  videos, Storyboard videos) once `cached_materials` has filled in
  `cacheUrl`. Local uploads are unaffected (their `url` is already
  same-origin under `/api/storage/files/`).
* **Scope:** every `timeupdate` event during composition playback — i.e.
  several times per second per playing clip — emits a heavyweight
  `console.error` with formatted payload. Playback itself does not break
  (Tier 4 keeps `state.currentSequenceIndex`), but the error spam
  obscures real diagnostics and adds CPU pressure in long editing
  sessions.
* **Adjacent breakage risk:** because `actualSequenceIndex` is forced to
  `state.currentSequenceIndex` in Tier 4, any feature that relies on the
  reverse-mapped sequence index (preload progress at `:1434-1438`,
  audio sync at `:1454+`) silently uses the wrong sequence whenever the
  state's index lags behind real playback (e.g. multiple clips share the
  same materialId). The reverse map is the very thing the Tier 1/2 logic
  was added to harden — see the comment block at `:1227-1244`.

---

## 5. Candidate fixes

| # | Strategy | Invasiveness | Risk | Effort |
|---|---|---|---|---|
| F1 | Re-key the URL comparison off `materialId` instead of URL strings | Low–Medium | Low (materialId is the cross-cutting identity already used by `videoCache`) | ~0.5 day |
| F2 | Re-sync `<video>.src` to `getSequencePreviewSrc(seq)` whenever the live element's `src` and `seq.cacheUrl` diverge | Medium | Medium (potential `play()` / `seeked` race during re-load) | ~1 day |
| F3 | Propagate `cacheUrl` changes through the composition state and bootstrap effect (add a `cacheUrl`-aware predicate to `useTimelineComposition.ts:78-90` and extend the bootstrap deps) | Low | Low | ~0.5 day |
| F4 | Suppress the Tier-4 `logger.error` (downgrade to `warn` and rate-limit) without fixing the comparison | Trivial | High (papers over the real reverse-map breakage at `§4 adjacent breakage`) | <2 hrs |

Notes on each:

* **F1** — Add a `seq.materialId` check in `handleTimeUpdate` and prefer it
  over URL matching. The `<video>` element already carries the source URL,
  but `materialId` is invariant whether the src is the bare URL, the cached
  URL, a blob URL, or the cached-element's frozen URL. Implementation can
  be additive: try `materialId` first, fall back to the existing URL
  comparison for compatibility. Trim/clip overlap on the same materialId is
  the historical wrinkle (`:1227-1229`), so we must still consult the time
  range when multiple sequences share a materialId.

* **F2** — When `handleTimeUpdate` detects mismatch on the state sequence,
  treat it as a stale-src signal and reassign `videoRef.current.src` to
  `getSequencePreviewSrc(stateSequence)` (with a `seeked`-lock to avoid
  thrashing). This fixes the immediate symptom but reintroduces the
  src-churn risk the existing code is explicitly defending against (see the
  comment at `:278-286`).

* **F3** — Fix the root invariant: any time `material.cacheUrl` changes,
  both `compositionPlayback.videoSequences[i].cacheUrl` AND
  `<video>.src` should be updated. Concretely:
  * In `useTimelineComposition.ts:71-107`, extend `videoSequencesChanged` to
    also detect per-sequence `cacheUrl` deltas (`prev[i].cacheUrl !==
    next[i].cacheUrl`).
  * In `VideoPlayerPanel.tsx:811-927`, add a `firstSequenceCacheKey` memo
    (e.g. `${firstSeq.id}:${firstSeq.cacheUrl ?? ''}`) and put it on the
    dep array so the bootstrap re-syncs the live element when cacheUrl
    arrives.
  * Make `useRemoteMaterialPrefetch` ALSO bump the timeline store (e.g.
    via a no-op `updateMaterialCache` action) so existing
    `onTimelineCompositionChange` subscriptions fire and the rebuild runs.

* **F4** — Quick-and-dirty silencer. Acceptable as a hotfix to clear the
  production console, but leaves the silent index-mis-mapping bug in
  place.

---

## 6. Recommended fix

**F3 + F1 combined**, applied in that order:

1. **F3 first** — fix the actual invariant. The bug exists because the
   playback state and the live `<video>.src` are allowed to drift
   independently of each other. Tying their lifecycle to `cacheUrl`
   transitions removes the divergence at the source. Without this, F1
   alone would still let the Tier-1 state-sequence URL match silently
   succeed against the wrong sequence in multi-clip-same-material
   scenarios (see `:1227-1244`).

2. **F1 as a defence-in-depth follow-up** — once invariants are correct,
   make the lookup itself robust to URL drift (cached-element src, blob
   URLs from future caching layers, etc.) by preferring `materialId`. This
   reduces blast radius if a future caching change reintroduces a
   transient mismatch.

F2 is rejected because the explicit comment block on `getSequencePreviewSrc`
(`:278-286`) warns that re-assigning `<video>.src` outside the seek path
caused a regression in commit `da056df` (AbortError churn on
`play()` / `pause()`). F4 is rejected as it hides the real bug; we should
treat the error spam as load-bearing diagnostic signal until F3 lands.

After F3 + F1, the Tier-4 `logger.error` should remain in place but
become genuinely unreachable in normal usage — at which point it can be
left as a guard-rail for unforeseen future regressions, or converted to a
`logger.warn` with a clearer "stale-state guard" message.

---

## 7. 评审结论 (Review Verdict)

### 7.1 Root-cause evidence — audit result

**Verified against code at HEAD:**

* §3.1 — the Tier-4 `logger.error` at `VideoPlayerPanel.tsx:1322-1331`
  is reachable only when `foundSequence === false`, which requires all
  three preceding tiers (`:1247-1261`, `:1266-1296`, `:1300-1318`) to
  miss. All three tiers compare `normalizeVideoUrl(currentVideoSrc)
  === normalizeVideoUrl(getSequencePreviewSrc(sequence))`. ✔ Confirmed.
* §3.2 — `selectPlaybackUrl` with `purpose: 'preview'` returns the
  absolutised `cacheUrl` when present (`selectPlaybackUrl.ts:60-69`).
  `normalizeVideoUrl` returns `pathname` only (`:270-276`). The two
  pathnames (`/api/storage/files/cached_materials/...` vs.
  `/video-files/...`) cannot collide. ✔ Confirmed.
* §3.3.1 — `firstSequenceId` memo at `:379-381` derives from
  `videoSequences[0]?.id` only; the bootstrap effect dependency
  array at `:927` is
  `[playbackMode, compositionPlayback?.videoSequences.length,
   firstSequenceId, updateCompositionCurrentTime]` — no `cacheUrl`
  derivative. ✔ Confirmed.
* §3.3.2 — `useTimelineComposition.ts:78-90` only compares lengths +
  id arrays + total duration. A pure `cacheUrl` patch on a
  `MaterialItem` does not change any of those. ✔ Confirmed.
* §3.3.3 — `TimelinePanel.tsx:226-254` subscribes to
  `useTimelineStore` and emits only when `computeShapeJson(...)`
  differs. `useMaterialManagement.ts:1133-1146` patches the React
  `materials` state and the `videoEditingStore` `materialSlice`, but
  does **not** touch `useTimelineStore`. ✔ Confirmed.

**One additional load-bearing observation, not called out in §3 but
worth recording for the implementer:**

* `VideoPlayerPanel.tsx:862-882` — even when the bootstrap effect
  *does* fire, it short-circuits through `videoCache.getCachedVideo(
  firstSequence.materialId)` and assigns `targetSrc = cachedVideo.src`.
  If a previously-cached `HTMLVideoElement` was warmed up with the
  bare remote URL (i.e. before `cacheUrl` arrived), the cached
  element's `src` is frozen at the old URL. So even a hypothetical
  fix that only adds `cacheUrl` to the bootstrap deps would not
  unstick the live `<video>.src` unless the cache layer is also
  invalidated when `cacheUrl` changes. Any candidate fix that relies
  on re-firing the bootstrap effect must take this into account.

**Alternative explanations considered and ruled out:**

* "Tier 3 should still match against `seq.url`" — false. Tier 3
  compares against `getSequencePreviewSrc(seq)`, which goes through
  the same `selectPlaybackUrl({purpose:'preview'})` path and prefers
  `cacheUrl`. There is no tier that compares against the bare
  `seq.url`. The bug is therefore structural, not a missing tier.
* "Maybe the live `<video>.src` is being rewritten by an external
  flow (autoplay, recovery handler)" — `videoRef.current.src` is
  only written from inside this component (bootstrap effect at
  `:882`, `seekAndPlayFromTimeline`, and `handleCompositionSeek`).
  All other writes go through `selectPlaybackUrl`. If any of those
  ran after `cacheUrl` arrived, the bug would self-heal — so the
  reproduction must be the steady-state "playing the first sequence
  with no further seek/transition triggers" case, matching
  `fallbackIndex: 0` in the log.

### 7.2 Candidate fixes — audit result

**F3 is over-scoped and re-introduces the regression risk the
existing code explicitly defends against.**

The §F3 proposal adds a `firstSequenceCacheKey` to the bootstrap
effect's dep array (`VideoPlayerPanel.tsx:927`). Re-firing that
effect while a video is mid-playback causes `currentVideo.src =
targetSrc` at `:882` — exactly the kind of mid-playback src
reassignment that the documented comment block at `:278-286`
forbids ("详见 da056df 回归"). The §F3 text appeals to F3 vs F2 by
saying "F3 differs because it goes through the bootstrap" but the
*mechanism* is identical: both reassign `<video>.src` while the
element is playing. The bootstrap's `transitionIdRef`/`canplay`
guard mitigates the AbortError on `play()`, but the user-visible
seek/reload during playback (when `cacheUrl` arrives after the
prefetch poll completes) is still a regression in its own right.

Additionally, §F3's plan to make `useRemoteMaterialPrefetch` "bump
the timeline store" couples a material-cache concern to the
timeline-shape store, which is the wrong layering — the timeline
store models user-authored timeline shape, not derived material
state.

**F1 (materialId-based lookup) is the minimum change that
resolves the reported symptom without any of these risks.**

* It is purely a read-side change inside `handleTimeUpdate`. No
  `<video>.src` reassignment, no store changes, no dep-array
  churn, no race surface.
* `materialId` is invariant across `url` / `serverUrl` / `cacheUrl`
  / cached-element `src` / future blob URLs, because it is the
  primary key on the upstream `MaterialItem` (sourced via
  `CompositionAdapter.ts:126` from `item.materialId`).
* The historical wrinkle "same materialId used by multiple
  sequences" (`:1227-1244`) is already solved by the existing
  time-range gate; F1 only needs to keep that gate and swap the
  URL equality for a materialId equality at Tier 1 and Tier 2.
  Tier 3 (URL-only) stays as a back-compat fallback for sequences
  that genuinely lack a `materialId`.
* The current Tier-4 `logger.error` would stop firing in the
  reproduced scenario, AND the silent "wrong index" risk called
  out in §4 (preload `:1434-1438`, audio sync `:1454+`) is
  resolved by the same change, since the reverse map now lands on
  the correct sequence.

**Boundary cases for F1, confirmed safe:**

| Case | Behaviour |
|---|---|
| sequence has `materialId`, `<video>.src` is `cacheUrl` | Tier 1 succeeds via `materialId` + time range. |
| sequence has `materialId`, `<video>.src` is bare URL | Tier 1 succeeds via `materialId` + time range. |
| sequence has no `materialId` (legacy / future codepath) | Falls through to URL match (Tier 3), same as today. |
| two sequences share `materialId`, overlapping clips | Time-range gate at `:1239-1244` and `:1274-1277` disambiguates — identical guarantee as today. |
| `<video>.src` is a blob: from a cache layer | Tier 1 succeeds via `materialId` (URL would have failed). Net improvement. |

**F4 remains rejected** — it papers over the silent reverse-map
breakage (§4 "Adjacent breakage risk").

### 7.3 最终推荐 (Final recommended fix)

**Adopt F1 alone.** Specifically, in
`src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx`
`handleTimeUpdate` (`:1203-1331`):

1. At Tier 1 (`:1247-1261`), change the predicate from
   `normalizeVideoUrl(currentVideoSrc) === normalizeVideoUrl(
   getSequencePreviewSrc(stateSequence))` to
   "match `materialId` if both `stateSequence.materialId` and
   the current `<video>` element have one available, else fall
   back to the existing URL comparison". The `<video>` element
   itself doesn't carry `materialId`, so the natural source of
   the "currently playing materialId" is
   `compositionPlayback.videoSequences[stateSequenceIndex].materialId`
   — i.e. trust the state-side identity when the time-range gate
   (`stateInRange`) also agrees. The URL comparison becomes a
   defence-in-depth secondary check, not the primary one.
2. At Tier 2 (`:1266-1296`), apply the same materialId-preferred
   predicate, still gated by the existing
   `accumulatedTime`/`sequenceEndTime` window so multi-clip /
   same-material scenarios disambiguate correctly.
3. At Tier 3 (`:1300-1318`), keep the URL-only fallback unchanged.
   It is the only path that handles sequences without a
   `materialId` (and is a safety net if Tier 1/2 ever miss).
4. Keep the Tier-4 `logger.error` (`:1322-1331`) in place as a
   tripwire; after F1 it should be genuinely unreachable in
   production.

**Why this is the minimum change:**

* Surface area: one function, ~20 lines edited. No store changes,
  no dependency-array changes, no `<video>.src` writes, no
  invalidation of `videoCache`.
* Blast radius: the change is read-only relative to the playback
  pipeline; failures degrade to today's behaviour (URL match), so
  the worst-case regression is "no improvement", not "new bug".
* Resolves both the reported symptom (console-error spam) AND the
  silent secondary bug (`preload` / `audioSync` mis-indexing in
  multi-clip / cache-mismatch scenarios).

**Explicitly deferred / out-of-scope for this fix:**

* The `cacheUrl` → composition-state → `<video>.src` propagation
  invariant (F3) is a legitimate cleanup but is **not required**
  to resolve this bug. It can be tracked as a separate task —
  ideally implemented by making `CompositionAdapter` re-extract
  on a `cacheUrl`-aware predicate, AND by invalidating any cached
  `HTMLVideoElement` whose source URL no longer matches the
  current `selectPlaybackUrl(seq, { purpose: 'preview' })`. Do
  **not** bundle this into the F1 patch.
* Downgrading or rate-limiting the Tier-4 log (F4) is unnecessary
  once F1 lands; keep the error as a tripwire.

**Verification plan for the implementer (next node):**

1. Reproduce per §2: open an existing project containing a Pexels
   clip whose `cacheUrl` is persisted; hit ▶ Play; confirm the
   Tier-4 error fires at the `timeupdate` cadence on `main`.
2. Apply the F1 patch.
3. Confirm Tier 1 (`logger.info '使用状态中的序列索引（验证匹配）'`)
   now fires on the first `timeupdate` and Tier 4 never fires.
4. Stress-test the multi-clip-same-materialId scenario (place the
   same Pexels clip on the timeline twice, back-to-back) and
   confirm `actualSequenceIndex` advances correctly across the
   boundary — this is the historical regression the time-range
   gate was added for, and the F1 change must preserve it.
