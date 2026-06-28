# Mid-clip audio silent because the preview audio source is not HTTP-Range-seekable

> Round 3 of the "play from the middle of an audio clip → no sound" bug.
> Rounds 1–2 fixed the **frontend** `AudioSyncPool` `canplay`-retry
> (`3457cfd` "retry audio preview play after canplay", then `fd1057c`
> "restore mid-clip audio by wiring canplay-retry to the real element").
> The symptom is **unchanged** — and that is the decisive clue: two faithful
> frontend fixes changed nothing, so the failing layer is **not** the frontend
> retry. This diagnosis pins the real cause in the **media transport / source
> URL**: the audio element is handed a source that cannot serve byte ranges, so
> a mid-clip seek can never reach a playable state. This is exactly the
> "之前修复过，但没修改好" the task describes.

## Problem description

In the multi-track preview compositor, an independent audio-track clip is
**audible when playback starts at the clip's head** but **silent when playback
starts from the middle of that same clip**.

- Drop the playhead at the clip's timeline start and press play → sound.
- Drop the playhead inside the clip (mid-clip) and press play → the timeline
  advances, the video/canvas plays, but that audio track stays silent.

This is scoped to **preview playback of independent audio tracks** (audio on its
own audio track — typically a TTS narration / 解说 clip, or a music/SFX clip). It
is not an export bug — export reads the composition/audio-sequence data, not the
hidden preview element state machine.

## Why the previous two rounds did not fix it (the key insight)

The "audible from the head, silent from the middle" split is the textbook
signature of a media source that **streams fine from byte 0 but cannot serve a
byte Range**:

- **Head start** assigns `currentTime = clipStart` (typically `0`). No seek is
  needed — the element progressively downloads the file from byte 0 and plays.
  This works for *any* reachable URL, Range-capable or not.
- **Mid-clip start** assigns a **non-zero** `currentTime`. To reach that offset
  the browser must issue an HTTP `Range` request (or treat the resource as
  seekable). If the server answers `200` whole-file with **no** `Accept-Ranges`
  (or the URL is a remote/CORS-blocked source), the element is marked
  **non-seekable**: the seek never lands, the element never reaches a playable
  state at that offset, `canplay`/playback-at-that-position never fires, and the
  track stays silent.

Rounds 1–2 added and then "armed" a rejected-`play()` → `canplay` retry in
`AudioSyncPool`. That retry is **inert against this failure mode** for two
independent reasons:

1. On a cold non-seekable source, `play()` does **not** reject — it returns a
   *pending* promise that simply never resolves (it is waiting for playable data
   at the seeked offset that will never arrive). With no rejection, the
   `.catch(...)` that schedules the retry never runs
   (`src/components/video/playback/AudioSyncPool.ts:389`).
2. Even if it did fire, the retry waits for a `canplay` event at the seeked
   position (`src/components/video/playback/AudioSyncPool.ts:408`) — which never
   arrives, because the source cannot deliver bytes at that offset.

Crucially, round 1's analysis **explicitly dismissed** the transport/URL path
with flawed logic: *"the same clip is audible when playback starts at the clip
head … a missing or bad URL would usually fail both"*
(`docs/diagnoses/audio-midclip-start-silent/analysis.md:99`). That reasoning only
rules out a **missing** URL. It does **not** rule out a URL that is **present and
serves from byte 0 but is not Range-seekable** — which fails *exactly* mid-clip
and *only* mid-clip. That is the gap this round closes.

## Reproduction steps

### Manual reproduction (UI)

1. Start the Ecliptrix frontend + backend (`npm run dev`, backend on `:8000`).
2. Put an audio clip on an independent audio track whose material URL resolves to
   a **non-Range** source. The most common and fully deterministic case is a
   **TTS narration / 解说 audio** clip — its URL is
   `/api/audio/generated/<file>.mp3` (`backend-services/basic-service/app/routers/tts_router.py:529`).
   (A remote, not-yet-cached Freesound/Pexels audio clip reproduces the same way;
   see the second sub-cause below.)
3. Place the clip at a non-zero timeline position with several seconds of content
   (e.g. spans `5.0s → 12.0s`).
4. Move the playhead to the clip start (`5.0s`) and press play → **audio is
   audible** (no seek; progressive download from byte 0).
5. Stop. Move the playhead into the middle of the same clip (e.g. `8.0s`) and
   press play.
6. **Expected:** audio plays from source offset ≈ `3.0s`.
7. **Actual:** the timeline advances but the audio track stays silent.

### Transport-level reproduction (deterministic, no browser)

This proves the source is not Range-seekable, independent of any frontend code:

```bash
# A TTS / generated audio file (served by the StaticFiles mount, NO Range):
curl -i -H "Range: bytes=100000-200000" \
  http://localhost:8000/api/audio/generated/<file>.mp3
#   → HTTP/1.1 200 OK        (whole file, NOT 206)
#   → (no Accept-Ranges header, no Content-Range header)

# The same kind of file served by the custom storage router (HAS Range):
curl -i -H "Range: bytes=100000-200000" \
  http://localhost:8000/api/storage/files/audio/<file>.mp3
#   → HTTP/1.1 206 Partial Content
#   → Accept-Ranges: bytes
#   → Content-Range: bytes 100000-200000/<size>
```

A `200`-whole-file-without-`Accept-Ranges` response makes a browser
`<video>`/`<audio>` element treat the resource as non-seekable — the project
already proved this exact mechanism breaks **video** seeking (black screen):
`docs/diagnoses/preview-blackscreen-no-http-range-seeking/analysis.md` and memory
`project_starlette_version_skew`.

## Root cause analysis

The preview audio element requests a source URL that **cannot serve a byte
Range**, so the mid-clip seek never lands. Two independent code paths produce a
non-seekable source; **both** are present in the tree, and the first one is a
permanent, fully reproducible defect for the most common audio-track content.

### Sub-cause A (primary, permanent): generated/subtitle audio is served by a non-Range `StaticFiles` mount

The backend serves audio from **two different kinds of mount**, only one of which
honours HTTP Range:

| URL prefix | Handler | Range / 206? | Typical content |
| --- | --- | --- | --- |
| `/api/audio/generated` | `StaticFiles` (`app/main.py:655`–`659`) | **NO** | TTS narration, generated audio |
| `/api/audio/subtitles` | `StaticFiles` (`app/main.py:664`–`668`) | **NO** | subtitle / ASR audio |
| `/api/storage/files/*` | custom `storage_files_router` (`app/main.py:694`) | **YES (explicit 206)** | uploaded audio, cached_materials, **all video** |

- The pinned dependency is `starlette==0.27.0`
  (`backend-services/basic-service/requirements.txt:41`, with
  `fastapi==0.104.1` at `:14`). In that version `StaticFiles`/`FileResponse`
  **ignore the `Range` header** — they always return `200` whole-file with no
  `Accept-Ranges`. The project knows this: it is precisely why the
  `/api/storage/files` mount was replaced by a custom router that implements
  single-range `206` by hand
  (`backend-services/basic-service/app/routers/storage_files_router.py:184`–`259`;
  the docstring at `:200`–`:203` states it takes full control of `Range` "so the
  result is identical regardless of the installed Starlette version").
- The two **audio** StaticFiles mounts were **never** given that treatment, so
  any audio served from `/api/audio/generated` or `/api/audio/subtitles` is
  **non-seekable**.
- A TTS narration clip's URL is `/api/audio/generated/<file>.mp3`
  (`app/routers/tts_router.py:529`). Because that is a same-origin *local*
  reference, the composition adapter selects it verbatim (see Sub-cause B) and
  freezes it into the audio sequence. So **every** TTS-narration audio clip is
  permanently silent when started mid-clip — head start works only because it
  needs no seek.

This is also the **true** video-vs-audio asymmetry the previous rounds
misattributed to the frontend wrapper. Video is **not** affected because every
video file is served by the Range-capable `storage_files_router`
(`/api/storage/files/video/...`); the video mid-clip seek lands. The audio
mid-clip seek does not — not because the audio element is "wrapped", but because
the audio **bytes** are served by a mount that cannot seek.

### Sub-cause B (secondary, race/edge): audio preview freezes the export URL and never re-resolves to a same-origin cache

Even setting the mount issue aside, the audio preview path can hand the element a
**remote** URL that the origin server may not Range-serve (or that CORS blocks):

- Audio sequences lock their URL at **extraction** time via
  `selectCanonicalExportReference(material)`
  (`src/components/video/timeline/infrastructure/CompositionAdapter.ts:240`,
  stored at `:251`). That helper is, by its own docstring, identical to
  `selectPlaybackUrl(material, { purpose: 'export' })`
  (`CompositionAdapter.ts:71`–`99`): it prefers a same-origin local ref but falls
  back to the durable **remote** `serverUrl`/`url`, and it **never** emits a
  preview-proxy/cache URL.
- `buildAudioSyncGroups` carries that frozen `seq.url` **verbatim** into the pool
  with **no** playback-time resolution
  (`src/components/video/hooks/useCompositionPlayback.ts:145`).
- **Video does the opposite.** Its `resolveSource` re-resolves **every tick**
  through `resolveSequencePlaybackUrl(...)`
  (`src/components/video/hooks/useCompositionPlayback.ts:401`–`406`), which swaps
  to the live same-origin `cacheUrl` / local reference. So if a material's cache
  lands *after* extraction, video swaps to the Range-capable local URL while
  audio keeps the stale/remote one.
- `AudioSequenceItem` has no `cacheUrl`/preview-swap field at all
  (`src/components/video/types/videoEditingTypes.ts`), confirming the audio path
  was never wired for playback-time cache resolution the way video was.

So a remote audio material whose background cache has not completed by play time
keeps a remote `serverUrl` in `seq.url`; if that origin does not honour Range (or
CORS preflight strips it), the mid-clip seek fails the same way. Because remote
materials are usually pre-cached, this is a narrower race than Sub-cause A, but it
is the same failure class and the same fix family.

### What the frontend actually does on a mid-clip start (confirms the failing path is reached)

For completeness, the audio pool genuinely issues the non-zero seek — the silence
is downstream of it, in the transport:

- On the first playing tick after a mid-clip start, the active clip's `src` is
  empty, so the planner emits a `seek` with a non-zero `targetSourceTime`
  (`src/components/video/playback/AudioSyncPool.ts:194`).
- `_apply('seek')` assigns `src`, then assigns the non-zero `currentTime` through
  the `srcJustSwapped` exception (so a fresh source does not play from 0), sets
  volume, and calls `_ensurePlaying`
  (`src/components/video/playback/AudioSyncPool.ts:315`–`324`,
  `_assignCurrentTime` guard at `:367`–`377`).
- The hidden audio element is a real `<video>` with `preload='auto'`, unmuted
  (`src/components/video/components/VideoPlayerPanel/PreviewCanvas.tsx:135`–`146`,
  resolved/cached per track at `:164`–`175`). It is fully capable of seeking —
  *when the source supports it*. The element is correct; the source is not.

The `fd1057c` adapter change (forward `addEventListener` + memoize) is real and
correctly armed the retry — it simply targets a failure (`play()` rejection) that
this bug does not produce.

## Impact surface

- **Affected:** preview playback of any independent audio track whose source is
  not Range-seekable when playback starts/resumes from inside a clip:
  - **TTS narration / generated audio** (`/api/audio/generated`) — *permanent,
    reproducible* (Sub-cause A). This is the dominant audio-track content in this
    narration-focused app.
  - subtitle/ASR audio (`/api/audio/subtitles`) — same mount, same defect.
  - remote audio whose same-origin cache has not yet landed (Sub-cause B).
- **Not affected:** starting at a clip head (no non-zero seek); uploaded audio and
  cached_materials audio served from `/api/storage/files/*` (Range-capable);
  embedded video-track audio (its decode `<video>` is fed a `/api/storage/files`
  video URL with Range); export (uses composition data, not the preview element).
- **Severity:** functional — the audio is silent for that play session until the
  user re-seeks to the clip head. No data loss.

## Candidate fixes

| # | Fix | Layer | Invasiveness | Risk | Effort | Coverage |
| - | --- | --- | --- | --- | --- | --- |
| 1 | **Serve the audio mounts with Range.** Replace the `/api/audio/generated` + `/api/audio/subtitles` `StaticFiles` mounts with the same explicit-`206` serving used for `/api/storage/files` — either by routing those dirs through `storage_files_router` (they already live under `STORAGE_ROOT`, `app/main.py:643`–`645`), or by extracting `_serve_safe_media`'s Range helper into a shared module a tiny audio router reuses. | Backend | Small–Med | **Low** (reuses the proven `storage_files_router` 206 logic; the silence-detection audio already moved to `/api/storage/files`, `app/main.py:670`–`672`) | Low | Fixes Sub-cause A (the permanent, reproducible case) for **every** consumer (preview + any seek). |
| 2 | **Re-resolve audio URLs at playback time like video.** Make `buildAudioSyncGroups` / the audio facade resolve through `resolveSequencePlaybackUrl(...)` (or `selectPlaybackUrl(purpose:'preview')`) each tick so audio swaps to the same-origin Range-capable `cacheUrl`/local ref. | Frontend | Medium | Medium (must thread live materials + opts into the audio facade; ensure no preview-only blob leaks into export) | Med | Fixes Sub-cause B. Does **not** fix Sub-cause A — a TTS clip's `/api/audio/generated` URL is already same-origin, so re-resolution still points at the no-Range mount. |
| 3 | **Upgrade Starlette to ≥0.37.0** (native `FileResponse`/`StaticFiles` Range). | Backend deps | Small diff, broad blast | **High** (the 0.27.0 pin is deliberate; coupled to `fastapi==0.104.1`; would also make `storage_files_router` double-handle Range) | Low–Med | Fixes all static mounts at once, but is the riskiest change for a shipped desktop bundle. |

## Recommended fix

**Fix 1 (primary): give the audio static mounts the same explicit HTTP-Range
(`206`) serving that `/api/storage/files` already has** — the cleanest path is to
serve generated/subtitle audio *through* `storage_files_router` (they already sit
under `STORAGE_ROOT`) or to factor its `_serve_safe_media` Range helper into a
shared module that a thin audio router reuses.

Justification:

- It targets the **actual failing layer**. Two rounds of frontend retry work did
  nothing precisely because the source bytes are non-seekable; only making the
  source Range-capable lets the existing (already-correct) seek + retry machinery
  succeed — exactly as it already does for video.
- It fixes the **permanent, reproducible** case (TTS narration audio), which is
  the dominant audio-track content in this app, with a **proven, low-risk**
  pattern the codebase already ships and tests for `/api/storage/files`.
- It is independent of the frontend and benefits **every** consumer (preview,
  scrub, and any future seekable use of generated audio).
- It deliberately avoids the risky Starlette upgrade (Fix 3) and the deliberate
  0.27.0 pin stays intact.

**Recommended companion: Fix 2** for parity with the video path, so remote/
not-yet-cached audio (Sub-cause B) also becomes Range-capable by swapping to the
same-origin cache at play time. Fix 2 alone is **insufficient** (it cannot rescue
the `/api/audio/generated` mount), so it must not be done *instead of* Fix 1 — at
most *in addition to* it.

### Verification for the fix node

1. `curl -i -H "Range: bytes=N-M"` against `/api/audio/generated/<file>.mp3`
   returns `206 Partial Content` with `Accept-Ranges: bytes` + `Content-Range`
   (and `416` for an unsatisfiable range), matching `/api/storage/files`.
2. Manual UI repro: a TTS-narration clip at a non-zero timeline position is
   **audible** when play starts mid-clip, not only at the clip head.
3. Regression: head-start audio, uploaded/cached audio, and video mid-clip all
   still play; export is unchanged.

### Out of scope / do not touch

The `AudioSyncPool` `canplay` retry (`3457cfd`/`fd1057c`), the `srcJustSwapped`
seek guard, the material pre-cache, and the composition/export path are not the
cause and should be left as-is — changing them only widens the blast radius.

## Evidence index (file:line)

- `backend-services/basic-service/app/main.py:655`–`659` — `/api/audio/generated` mounted via `StaticFiles` (no Range).
- `backend-services/basic-service/app/main.py:664`–`668` — `/api/audio/subtitles` mounted via `StaticFiles` (no Range).
- `backend-services/basic-service/app/main.py:694` — `/api/storage/files/*` served by the custom `storage_files_router`.
- `backend-services/basic-service/app/main.py:643`–`645`, `:670`–`672` — generated/subtitle dirs live under `STORAGE_ROOT`; silence-detection audio already routed via `/api/storage/files`.
- `backend-services/basic-service/app/routers/storage_files_router.py:184`–`259` — `_serve_safe_media`: explicit `206`/`416`/`Accept-Ranges` Range handling (the pattern to reuse).
- `backend-services/basic-service/requirements.txt:14`,`:41` — `fastapi==0.104.1`, `starlette==0.27.0` (the version whose `FileResponse`/`StaticFiles` ignore Range).
- `backend-services/basic-service/app/routers/tts_router.py:529` — TTS audio URL = `/api/audio/generated/{file_name}`.
- `src/components/video/timeline/infrastructure/CompositionAdapter.ts:71`–`99`,`:240`,`:251` — audio URL frozen via the EXPORT selector `selectCanonicalExportReference` (falls back to remote, never preview-cache).
- `src/components/video/hooks/useCompositionPlayback.ts:145` — audio carries `seq.url` verbatim, no playback-time resolution.
- `src/components/video/hooks/useCompositionPlayback.ts:401`–`406` — video re-resolves via `resolveSequencePlaybackUrl` every tick (the asymmetry).
- `src/components/video/playback/AudioSyncPool.ts:194`,`:315`–`324`,`:367`–`396` — the mid-clip `seek` action, `srcJustSwapped` seek, and the inert rejected-`play()` retry.
- `src/components/video/components/VideoPlayerPanel/PreviewCanvas.tsx:135`–`146`,`:164`–`175` — the hidden audio `<video>` (`preload='auto'`, unmuted) — capable of seeking when the source allows.
- Prior rounds: `docs/diagnoses/audio-midclip-start-silent/analysis.md` (round 1, fix `3457cfd`), `docs/diagnoses/audio-midclip-start-still-silent/analysis.md` (round 2, fix `fd1057c`); the dismissal-with-flawed-logic at `audio-midclip-start-silent/analysis.md:99`.
- Same no-Range mechanism proven for video: `docs/diagnoses/preview-blackscreen-no-http-range-seeking/analysis.md`; memory `project_starlette_version_skew`.

## 评审结论 (Review Verdict)

**Verdict: ACCEPT the root cause. Recommend a single fix — Fix 1, in its
URL-prefix-preserving variant (1b below). Fix 2 is downgraded to an optional,
separate follow-up that is NOT required to close this bug. Fix 3 rejected.**

### Evidence audit — every load-bearing citation independently re-verified

I re-read each cited location against the working tree. All are accurate:

| Claim | Citation | Verified |
| --- | --- | --- |
| `/api/audio/generated` + `/api/audio/subtitles` served by bare `StaticFiles` | `app/main.py:655`–`659`, `:664`–`668` | ✅ exact |
| `/api/storage/files/*` served by custom router with explicit `206` | `app/main.py:694`; `storage_files_router._serve_safe_media` `:184`–`259` (216-OK, 206-slice, 416-unsatisfiable, `Accept-Ranges` always) | ✅ exact |
| Pin is `starlette==0.27.0` / `fastapi==0.104.1` | `requirements.txt:41`,`:14` | ✅ exact |
| `serve_storage_file` itself states the 0.27.0 `FileResponse` "supports neither Range nor `Accept-Ranges`" and delegates to `_serve_safe_media` | `storage_files_router.py:345`–`349` | ✅ (in-tree corroboration of the Starlette claim) |
| Generated/subtitle dirs live under `STORAGE_ROOT` | `local_media_resolver.audio_generated_dir()/audio_subtitle_dir()` = `STORAGE_ROOT/static/audio/{generated,subtitles}` | ✅ — so they ARE reachable through `storage_files_router` |
| TTS narration URL = `/api/audio/generated/<file>.mp3` | `tts_router.py:529` | ✅ exact |
| Audio URL frozen at extraction via the **export** selector | `CompositionAdapter.ts:87`–`99` (`selectCanonicalExportReference`, local→remote fallback, never preview-proxy), used at `:240`, stored at `:251` | ✅ exact |
| Audio carries `seq.url` verbatim, no playback-time re-resolution | `useCompositionPlayback.ts:145` | ✅ exact |
| Video re-resolves **every tick** via `resolveSequencePlaybackUrl` | `useCompositionPlayback.ts:401`–`406` (engine `resolveSource` dep) | ✅ exact |
| `AudioSyncPool` genuinely emits the non-zero `seek`; the rejected-`play()` retry is inert (only fires on `.catch`, then waits for a `canplay` that never arrives) | `AudioSyncPool.ts:194`–`195`, `:315`–`324`, `:367`–`377`, `:389`–`394`, `:408` | ✅ exact |
| Hidden audio is a real `<video>` (`preload='auto'`, unmuted by default — `createHiddenVideo` sets `muted=true`, `createHiddenAudio` does not), cached per track | `PreviewCanvas.tsx:135`–`146`, `:164`–`175` | ✅ exact |
| `AudioSequenceItem` has no `cacheUrl`/preview-swap field | `videoEditingTypes.ts:69`–`83` (only `url: string`) | ✅ exact |
| Both prior fixes were **frontend-only** | `git show --stat`: `3457cfd` touches only `AudioSyncPool.ts`(+test+doc); `fd1057c` touches only `MultiTrackPlaybackEngine.ts`(+test+doc) | ✅ — neither touched the transport layer, confirming "改错层" |
| Round 1 dismissed the URL path with logic that only rules out a *missing* URL | `audio-midclip-start-silent/analysis.md:99` ("a missing or bad URL would usually fail both") | ✅ exact — the dismissal is genuinely flawed |

### Added evidence — the decisive controlled comparison (was implicit; making it explicit)

The single strongest argument for this root cause is a clean controlled
experiment already present in the code, which the report alludes to but does not
state as such. **Video and independent-audio share the same hidden `<video>`
element type, the same `MultiTrackPlaybackEngine`, and mirrored seek code**
(`AudioSyncPool._assignCurrentTime` is annotated "Mirrors `VideoSourcePool`
RC-B / `_ensureSeeked` 方案 B", `AudioSyncPool.ts:356`–`365`). Video mid-clip
seek **works**; audio mid-clip seek **fails**. Holding the element type and seek
logic constant, the **only** variable that differs between the two paths is the
**byte-Range capability of the source** (video → `/api/storage/files` 206;
audio → `/api/audio/generated` 200). Two further would-be differentiators are
ruled out by construction:

- **Volume** cannot be the cause: `computeEffectiveVolume(clip.volume,
  group.volume)` (`AudioSyncPool.ts:186`) is independent of the playhead start
  position, so it is identical for head-start (audible) and mid-start (silent).
- **Target source time** is the *exact* discriminator: `mapTimelineTimeToSourceTime`
  yields `clipStart (≈0)` at the clip head → **no seek** → progressive play from
  byte 0 (works on any reachable URL); and `>0` mid-clip → **a real seek** → which
  on a `200`/no-`Accept-Ranges` source never lands. The symptom (total **silence**,
  not wrong-offset audio and not head-of-clip audio) is consistent only with a
  seek that never reaches a playable state — a clamp-to-0 bug would have produced
  *audible* head-of-clip sound. This positively distinguishes the transport
  hypothesis from every "wrong URL / wrong offset / muted" alternative.

This closes the "alternative explanations" requirement: the report does not miss
a viable competing cause; the controlled comparison eliminates them.

### The one soft spot, and how to harden it

The transport-level reproduction (`curl … Range: …` → expected `200` vs `206`,
`analysis.md:91`–`104`) is written **prescriptively** ("→ HTTP/1.1 200 OK"),
not reported as an observed run. The 0.27.0-`StaticFiles`-ignores-Range fact is
nonetheless strongly corroborated **in-tree** (the `storage_files_router`
docstring at `:345`–`:349` and `:200`–`:203` exist *precisely because* 0.27.0
`FileResponse`/`StaticFiles` ignore Range) and **historically** (the video
black-screen round was actually closed by adding explicit `206` to that router;
memory `project_starlette_version_skew`). Note `StaticFiles` returns a
`FileResponse` internally, so the proven `FileResponse` behaviour transfers
directly to the two audio mounts. The inference is sound; to convert it from
inference to observation, the fix node **must run the two `curl` commands as
verification step 1 (already listed at `analysis.md:265`–`267`)** and confirm the
`200`-vs-`206` split before and after the change. This is the only evidence gap,
and it is procedural, not logical.

### Candidate-fix audit (boundary cases, minimality, regression)

**Fix 1 — serve the two audio mounts with Range.** Correct layer, proven pattern.
Two sub-variants are listed as if interchangeable; **they are not**, and the
distinction is the most important review finding:

- **1a — re-point the content to the `/api/storage/files/...` URL.** ❌ Rejected
  as the primary path. It changes the **public URL** and would regress
  backward-compat in three places: (i) saved project compositions froze
  `/api/audio/generated/...` strings into their audio sequences
  (`CompositionAdapter.ts:251`); (ii) `local_media_resolver.ROUTE_PREFIXES`
  (`:45`–`51`) has dedicated `/api/audio/generated/` + `/api/audio/subtitles/`
  entries that export/ASR resolution depends on (incl. the B2 legacy fallback);
  (iii) every producer emits the `/api/audio/generated/...` form
  (`tts_router.py:529`). Changing the URL is a wide, needless blast radius.
- **1b — keep the URL prefix, swap only the handler.** ✅ **Recommended.** Replace
  the two `StaticFiles` mounts (`main.py:655`–`668`) with a thin router/route
  mounted at the **same** `/api/audio/generated/{path}` and
  `/api/audio/subtitles/{path}` prefixes, serving from the **same** physical
  roots (`audio_generated_dir()` / `audio_subtitle_dir()`), and delegating to the
  `_serve_safe_media` Range helper extracted into a shared module. No URL change →
  zero impact on saved projects, the resolver, producers, or export.

  Boundary cases the fix node MUST cover under 1b:
  - **Path traversal.** `StaticFiles` enforces `..`/escape protection for free; a
    hand-rolled route does **not**. The new route must re-apply a containment
    guard (reuse `storage_service._validate_path` or
    `validate_local_path_for_ffmpeg([root])`, as `serve_storage_file` does at
    `:291`–`:303`). Missing this is the principal regression risk of 1b.
  - **Served root parity.** The current mounts serve **only** the STORAGE_ROOT
    dir (no B2 legacy fallback). The replacement should match that root exactly to
    avoid behaviour change; adding the legacy fallback is an optional improvement,
    not required, and should not expand scope.
  - **404 / 416 / HEAD / non-ASCII filenames.** `_serve_safe_media` already
    returns `416` for unsatisfiable ranges and `200` for absent Range; the route
    must still `404` a missing file (StaticFiles did). Reuse the helper verbatim so
    range/validator-header behaviour is identical to `/api/storage/files`.
  - **Streaming under concurrency.** `_serve_safe_media`'s `206` path streams via
    `aiofiles` (`_iter_file_range`) with no shared mutable state — concurrency-safe;
    no new locking needed.

  Coverage: 1b fixes **Sub-cause A** (the permanent, dominant, reproducible case)
  for **every** consumer (preview + scrub + any future seek), independent of the
  frontend. This is exactly the user's reported repro (TTS narration mid-clip).

**Fix 2 — re-resolve audio URL per tick like video.** Correctly scoped to
**Sub-cause B** only. It **cannot** fix Sub-cause A (a TTS clip's
`/api/audio/generated/...` URL is *already* same-origin, so re-resolution still
lands on the no-Range mount). Sub-cause B is a **narrow race** (remote audio whose
same-origin cache has not yet landed at play time), and remote audio is normally
pre-cached. **Therefore Fix 2 is NOT part of the minimum change that closes the
reported bug** and should be tracked as a separate, optional follow-up (audio/
video parity), not bundled here. Bundling it would (a) violate the task's
"minimum change" criterion, (b) require threading live materials + resolver opts
into the audio facade and growing `AudioSequenceItem` with a cache-swap field, and
(c) add a preview-only-blob-leak-into-export hazard the backend fix does not have.

**Fix 3 — upgrade Starlette.** ✅ Reject (agree with the report). The 0.27.0 pin is
deliberate and coupled to `fastapi==0.104.1`; it would also make
`storage_files_router` double-handle Range. Highest risk for a shipped desktop
bundle, for no benefit over 1b.

### Final recommended fix (single)

> **Implement Fix 1b: extract `storage_files_router._serve_safe_media`'s
> HTTP-Range logic into a shared helper, then replace the two
> `StaticFiles` mounts at `app/main.py:655`–`668` with a thin router/route that
> serves `/api/audio/generated/{path}` and `/api/audio/subtitles/{path}` — same
> URLs, same physical roots (`audio_generated_dir()` / `audio_subtitle_dir()`) —
> through that helper, with explicit `..`-traversal containment.**

Justification:
1. **Right layer.** Two rounds of frontend retry work changed nothing because the
   source bytes are non-seekable; only making the source Range-capable lets the
   already-correct (video-mirrored) seek machinery succeed — proven by the
   controlled video-vs-audio comparison above.
2. **Minimum change that closes the reported symptom.** It targets Sub-cause A,
   which is the user's exact repro and the dominant audio content in this app,
   and nothing more. Fix 2 and Fix 3 are deliberately excluded to keep the blast
   radius minimal.
3. **Proven, low-risk pattern.** It reuses the exact `206` implementation the
   codebase already ships and relies on for all video and `/api/storage/files`
   audio; the URL-stable variant has zero impact on saved projects, the media
   resolver, producers, or export.
4. **Regression-bounded.** The single new risk (traversal guard on a hand-rolled
   route) is explicitly called out above and is satisfied by reusing the existing
   `_validate_path` guard.

### Incidental finding (out of scope — NOT this bug, do not fix here)

While tracing the TTS write path I noticed the `clone_tts` endpoint writes to
`STORAGE_ROOT/audio/generated` (`tts_router.py:520`) whereas the mount and the
resolver anchor to `STORAGE_ROOT/static/audio/generated`
(`local_media_resolver.audio_generated_dir()`). If a real divergence, that would
be a *file-not-found / write-vs-serve mismatch* — but it would silence a clip at
**both** the head and the middle, which contradicts the observed symptom
(head-start is audible). It is therefore **not** the cause of this bug and must
**not** be touched by the fix node; logged here only so it is not mistaken for
in-scope work.
