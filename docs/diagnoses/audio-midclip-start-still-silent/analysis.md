# Audio mid-clip start still silent (canplay retry never wired to the real element)

> Round 2 of the "play from the middle of an audio clip → no sound" bug.
> The previous round added a `canplay` play-retry to `AudioSyncPool`
> (commit `3457cfd` "fix: retry audio preview play after canplay"). The retry
> is **dead code in production**, so the symptom is unchanged — this is the
> "之前修复过，但没修改好" the task describes.

## Problem description

In the multi-track preview compositor, an independent audio-track clip is
**audible when playback starts at the clip's head** but **silent when playback
starts from the middle of that same clip**.

- Drop the playhead at the clip's timeline start and press play → sound.
- Drop the playhead inside the clip (mid-clip) and press play → the timeline
  advances, the video/canvas plays, but that audio track stays silent.

The user's mental model is exactly right: there is a "load-from-the-front then
play" path that produces sound, and a "jump straight into the middle" path that
does not. This diagnosis confirms that intuition and pins the failing path.

This is scoped to **preview playback of independent audio tracks** (audio placed
on its own audio track, e.g. track 2). It is not an export bug — export reads
the composition/audio-sequence data, not the hidden preview element state
machine.

## Reproduction steps

### Manual reproduction

1. Start the Ecliptrix frontend + backend as usual (`npm run dev`, backend on
   `:8000`).
2. Add an audio material (search or upload), wait for it to be available, and
   place it on an independent audio track (e.g. audio track 2).
3. Put the clip at a non-zero timeline position with several seconds of content
   (e.g. clip spans timeline `5.0s → 12.0s`).
4. Move the playhead to the clip start (`5.0s`) and press play → **the audio is
   audible** (this is the "load from the front" path).
5. Stop. Move the playhead into the middle of the same clip (e.g. `8.0s`) and
   press play.
6. **Expected:** audio starts from the corresponding source offset.
7. **Actual:** the timeline advances but the audio track stays silent.

### Code-level reproduction (no browser needed — demonstrates the dead path)

The defect is observable purely from the wiring, without a running browser:

1. `AudioSyncPool` only arms its rejected-`play()` recovery when the element it
   was given exposes `addEventListener`
   (`src/components/video/playback/AudioSyncPool.ts:400`).
2. In production the engine never hands the pool a real `EventTarget`: it wraps
   the real `<video>` in `toAudioElement(...)`, a **plain object literal with no
   `addEventListener`** (`src/components/video/playback/MultiTrackPlaybackEngine.ts:643`).
3. Therefore `_scheduleCanplayRetry`'s `typeof target.addEventListener !==
   'function'` guard is always true → it returns immediately → the retry is
   never armed.
4. The existing unit tests pass anyway because the test fake `eventfulAudio`
   **does** implement `addEventListener` / `removeEventListener` /
   `dispatchEvent` (`src/components/video/playback/__tests__/AudioSyncPool.test.ts:421`).
   The tests exercise a path that the production adapter does not reproduce —
   the source of the false "fixed" signal.

## Root cause analysis

### Why the head vs. middle difference exists

Starting at the clip head assigns `currentTime = clipStart` (typically `0`),
which is a no-op seek on a fresh `<video>` — the element simply loads and plays
from the start, so `play()` resolves normally.

Starting in the middle forces, in one tick, a cold `src` assignment + an
**immediate non-zero seek** + `play()`:

- The active-clip planner emits a `seek` action carrying the url + target source
  time (`src/components/video/playback/AudioSyncPool.ts:194`).
- `_apply('seek')` assigns `src`, then assigns the non-zero `currentTime` even
  while the element is cold-loading (the `srcJustSwapped` exception is required
  so a mid-clip clip does not play from source 0), then calls `_ensurePlaying`
  (`src/components/video/playback/AudioSyncPool.ts:315`–`325`).
- On a cold element that just received a new `src` and an immediate mid-clip
  seek, the browser can **reject/abort that first `play()`** while it is still
  loading/seeking. After the rejection `el.paused` returns to `true`.

The previous round added the recovery for exactly this: re-issue `play()` once
the element fires `canplay`. That is what makes the head-start path and the
proven video path work.

### The actual defect: the recovery is never wired to the real element

`AudioSyncPool._ensurePlaying` catches the rejected `play()` and calls
`_scheduleCanplayRetry`:

```
// src/components/video/playback/AudioSyncPool.ts:398
private _scheduleCanplayRetry(el: AudioElementLike, epoch: number, src: string): void {
  const target = el as AudioCanplayRetryTarget;
  if (typeof target.addEventListener !== 'function' || target.__ecliptrixAudioPlayKick) {
    return;   // ← production always returns here
  }
  ...
  target.addEventListener('canplay', () => { ... el.play() ... }, { once: true });
}
```

The `el` handed to the pool is built here:

```
// src/components/video/playback/MultiTrackPlaybackEngine.ts:195
this._audioPool = new AudioSyncPool((trackId) => {
  const el = deps.resolveAudioElement(trackId);
  return el ? toAudioElement(el) : null;   // ← wraps the real <video>
});
```

and `toAudioElement` returns a **plain object** that forwards only
`src`/`currentTime`/`volume`/`paused`/`readyState`/`seeking`/`play`/`pause` —
**no `addEventListener`/`removeEventListener`**:

```
// src/components/video/playback/MultiTrackPlaybackEngine.ts:643
function toAudioElement(el: VideoElementLike): AudioElementLike {
  return {
    get src() { return el.src; }, set src(v) { el.src = v; },
    get currentTime() { ... }, set currentTime(v) { ... },
    get volume() { ... }, set volume(v) { ... },
    get paused() { ... },
    get readyState() { return el.readyState; },
    get seeking() { return el.seeking; },
    play: () => el.play(),
    pause: () => el.pause(),
    // NOTE: no addEventListener / removeEventListener
  };
}
```

So in production `target.addEventListener` is `undefined` → the guard short-
circuits → the `canplay` retry is **never armed**. When the first mid-clip
`play()` rejects, nothing ever re-issues `play()` on `canplay`, so the element
stays paused and the track stays silent.

The real source element IS a full `HTMLVideoElement` created by the host
(`document.createElement('video')`,
`src/components/video/components/VideoPlayerPanel/PreviewCanvas.tsx:140`), so it
*does* have `addEventListener` — the adapter just doesn't expose it.

### Why the video path is not affected (the asymmetry)

The video pool receives the **raw** decode `<video>` element, unwrapped:

```
// src/components/video/playback/MultiTrackPlaybackEngine.ts:191
return { active: els.active, prewarm: els.prewarm };   // raw HTMLVideoElement
```

so `VideoSourcePool._scheduleCanplayRetry`
(`src/components/video/playback/VideoSourcePool.ts:482`) finds a real
`addEventListener` and arms the same retry successfully. The video mid-clip
black-screen fix works; the byte-for-byte equivalent audio fix does not — purely
because the audio element is wrapped and the video element is not.

### Compounding defect: the wrapper is rebuilt on every resolve

Even if `addEventListener` were naively added to the wrapper, the fix would
still be fragile: `toAudioElement(el)` is invoked on **every** `_resolve` call,
and the pool resolves the element multiple times per tick — once in `tick()` to
read live state (`AudioSyncPool.ts:287`) and again in `_apply` for the action
(`AudioSyncPool.ts:308`). Each call returns a **brand-new wrapper object**, so
the per-element retry markers the pool stashes on the element
(`__ecliptrixAudioPlayKick`, `__ecliptrixAudioPlayRetryEpoch`,
`AudioSyncPool.ts:407`/`429`) never persist — the dedupe and epoch guard would
break (stacked listeners / lost disarm). The video path avoids this because the
raw element is a single stable object whose markers live across ticks.

A correct fix therefore must (a) expose the event surface of the underlying
real element to the pool AND (b) give the pool a **stable** element identity so
its markers persist.

### Backend Range support is NOT the cause this round

A non-zero seek requires HTTP Range (206) support, and an earlier round fixed
that (`docs/diagnoses/preview-blackscreen-no-http-range-seeking/analysis.md`).
The audio static route now serves explicit single-range `206`
(`backend-services/basic-service/app/routers/storage_files_router.py:190`–`254`),
and remote audio is pre-cached to a same-origin local URL (commit `2be8ad6`), so
the mid-clip seek itself can land. The remaining failure is the un-armed
play-retry on the frontend, not the byte-range transport.

## Impact surface

- **Affected:** preview playback of independent audio tracks (music / SFX /
  detached-video audio on their own track) whenever playback is started or
  resumed from inside a clip rather than at the clip head — the common case
  after a scrub or a manual playhead move.
- **Not affected:** starting playback at a clip head (no non-zero cold seek, so
  the first `play()` resolves); embedded video-track audio (routed through
  `VideoSourcePool`, whose retry is correctly wired to the raw element); export
  (uses composition data, not the preview element).
- **Severity:** functional — the audio is permanently silent for that play
  session until the user re-seeks to the clip head, which is the user-reported
  behavior. No data loss.

## Candidate fixes

| # | Fix | Invasiveness | Risk | Effort |
| - | --- | --- | --- | --- |
| 1 | In `toAudioElement`, forward `addEventListener`/`removeEventListener` to the underlying `el`, **and memoize the wrapper per real element** (stash it on `el.__ecliptrixAudioAdapter` so the same wrapper — and thus its retry markers — is returned every resolve). | Small, localized to `MultiTrackPlaybackEngine.toAudioElement` + the `AudioElementLike` interface. | Low — restores the already-reviewed retry on the real element; memoization keeps marker state stable. | Low |
| 2 | Stop wrapping: pass the raw `HTMLVideoElement` (cast to `AudioElementLike`) straight into the pool, like the video pool does. A real element already satisfies `src`/`currentTime`/`volume`/`paused`/`readyState`/`seeking`/`play`/`pause`/`addEventListener`. | Small but removes the adapter that commit `fdbd725` introduced. | Medium — must re-confirm the original reason the adapter was added (it bridged `VideoElementLike` → writable `src`/`volume`); could regress structural-fake call sites. | Low–Med |
| 3 | Make `AudioSyncPool` resilient without the event surface: when an element is logically "playing" (`paused === false`) but has made no progress and is below `readyState 2` for N ticks, force a `pause()`+`play()` re-kick from the tick loop. | Medium — new stall-detection state in the pure-ish pool. | Medium — heuristic timing, risk of churn/AbortError; duplicates the browser's own `canplay` signal. | Medium |

## Recommended fix

**Option 1.** Forward `addEventListener`/`removeEventListener` through
`toAudioElement` to the underlying real `<video>`, and memoize the adapter on the
element so the pool sees one stable object across resolves (markers persist).

Justification:

- It directly un-deads the recovery the previous round already built and
  reviewed; the change is the missing two-line passthrough plus a one-line
  memo, not new behavior.
- It restores exact parity with the **proven** `VideoSourcePool` retry, which
  fixes the identical mid-clip cold-seek case for video — the project has
  already validated this mechanism, just not on the audio element.
- It leaves the seek guard, the export/material-cache pipeline, the byte-range
  backend, and the clock transport untouched — minimal blast radius.
- Memoizing the wrapper additionally fixes the compounding "fresh wrapper every
  resolve" defect, so the retry's dedupe (`__ecliptrixAudioPlayKick`) and epoch
  disarm (`__ecliptrixAudioPlayRetryEpoch`) actually work.

Option 2 is attractively simple but reopens whatever `fdbd725` was guarding when
it introduced the adapter; prefer it only if review confirms the adapter is
purely a type-bridge. Option 3 reinvents the `canplay` signal the browser
already provides and adds heuristic risk.

### Required test coverage for the fix node

1. **Adapter forwards the event surface** — `toAudioElement(realLikeEl)` exposes
   `addEventListener`/`removeEventListener` that delegate to the underlying
   element (a fake `<video>`-like with an event registry receives the listener).
2. **Stable identity** — resolving the same track id twice returns the same
   adapter object (or markers otherwise persist), so a rejected-`play()` arms
   exactly one `canplay` listener across multiple resolves in a tick.
3. **End-to-end retry through the adapter** — drive `AudioSyncPool.tick` through
   a `toAudioElement`-wrapped fake whose first `play()` rejects; dispatching
   `canplay` on the underlying element re-issues `play()` and clears the
   listener (the production analogue of the existing
   `AudioSyncPool.test.ts:557` test, but exercised *through the adapter*).
4. **No regression** — head-start (zero seek) and the in-flight seek guard
   behavior remain unchanged.

## Evidence index (file:line)

- `src/components/video/playback/AudioSyncPool.ts:398`–`424` — `_scheduleCanplayRetry`, the `typeof target.addEventListener !== 'function'` short-circuit.
- `src/components/video/playback/AudioSyncPool.ts:379`–`396` — `_ensurePlaying` schedules the retry on rejected `play()`.
- `src/components/video/playback/AudioSyncPool.ts:287`,`308` — element resolved multiple times per tick.
- `src/components/video/playback/MultiTrackPlaybackEngine.ts:195`–`198` — audio resolver wraps the element in `toAudioElement`.
- `src/components/video/playback/MultiTrackPlaybackEngine.ts:643`–`679` — `toAudioElement` plain object with no `addEventListener`.
- `src/components/video/playback/MultiTrackPlaybackEngine.ts:191` — video pool receives the raw, unwrapped element (the asymmetry).
- `src/components/video/playback/VideoSourcePool.ts:462`–`500` — the working video `canplay` retry on the raw element.
- `src/components/video/components/VideoPlayerPanel/PreviewCanvas.tsx:135`–`146` — the real hidden `<video>` audio element (has `addEventListener`).
- `src/components/video/playback/__tests__/AudioSyncPool.test.ts:421`–`479`,`556`–`648` — the `eventfulAudio` fake (has `addEventListener`) under which the retry tests pass, masking the production gap.
- Prior round: `docs/diagnoses/audio-midclip-start-silent/analysis.md`; fix commit `3457cfd` "fix: retry audio preview play after canplay".

## 评审补充证据 (Reviewer-added evidence)

Added during review to make the evidence chain airtight. Each item was
re-verified against the working tree at review time.

1. **The previous fix never touched the adapter — direct proof of the dead
   wiring.** `git show --stat 3457cfd` lists exactly three files:
   `docs/diagnoses/audio-midclip-start-silent/analysis.md`,
   `src/components/video/playback/AudioSyncPool.ts`, and
   `src/components/video/playback/__tests__/AudioSyncPool.test.ts`. It does **not**
   touch `src/components/video/playback/MultiTrackPlaybackEngine.ts`, where
   `toAudioElement` lives. So the `canplay` retry was added to the pool but the
   only production object handed to the pool (the wrapper) was never given an
   `addEventListener`. This is the mechanical confirmation of "之前修复过，但没修改好".

2. **The production path has ZERO test coverage — the false-green is structural,
   not incidental.** Two independent reasons the suite stays green:
   - The pool's own `eventfulAudio` fake (`AudioSyncPool.test.ts:432`–`479`) is
     injected via `new AudioSyncPool(() => el)`, returning the **same** object on
     every resolve. So the test never reproduces production's *rebuilt-wrapper*
     defect either — markers persist on the stable fake. The test is doubly
     unrepresentative: the fake has `addEventListener` **and** stable identity;
     production has neither.
   - The engine-level fake `fakeAudioEl()`
     (`MultiTrackPlaybackEngine.test.ts:106`–`121`) is a plain object with **no
     `addEventListener`** and a `play()` that **never rejects** (`el.paused =
     false; return undefined`). So the engine test cannot exercise the
     rejected-`play()` → `canplay`-retry path at all; the `canplay`/event
     assertions in that file (`:462`–`486`, `:764`–`767`) are all on the **video**
     element. No existing test wires a rejecting `play()` *through*
     `toAudioElement`.

3. **The memo target is already stable — Option 1 is a natural fit, not a new
   invention.** `resolveAudioElement`
   (`PreviewCanvas.tsx:164`–`175`) lazily creates one hidden `<video>` per track
   and **caches it in `audioPoolRef`**, returning the same underlying element on
   every resolve. The instability is introduced *only* by `toAudioElement`
   re-wrapping that stable element each call. Memoizing the adapter on the
   underlying element (e.g. `el.__ecliptrixAudioAdapter`) therefore needs no new
   lifecycle plumbing — the stable key already exists.

4. **Backend Range transport confirmed present (rules out the seek itself
   failing).** `storage_files_router.py` implements explicit single-range `206`
   with `Accept-Ranges: bytes` / `Content-Range` and `416` for unsatisfiable
   ranges (`:190`–`:256`; header constants `:218`,`:233`–`:234`,`:248`,`:256`).
   A mid-clip non-zero seek can therefore land at the byte level; the residual
   failure is purely the un-armed frontend play-retry, exactly as the report
   states.

5. **The action emitted on a mid-clip cold start is genuinely `seek`+`play`
   (the failing path is reached).** Trace through `computeAudioSyncActions`: a
   freshly-created element has `src === ''`, so `srcChanged` is `true`
   (`AudioSyncPool.ts:188`–`189`) → action `'seek'` with a non-zero
   `targetSourceTime` (`:194`–`195`). `_apply('seek')` swaps src
   (`srcJustSwapped = true`), assigns the non-zero `currentTime` through the
   `srcJustSwapped` exception (`:319`–`322`), then calls `_ensurePlaying`
   (`:324`), whose `play()` is the one that rejects on a cold element. The
   head-start case differs only in `targetSourceTime` (≈ `clipStart`, typically
   `0`), so its no-op `currentTime` write does not provoke the rejecting cold
   seek. This confirms the head-vs-middle asymmetry the user reports is produced
   by this exact code path, not an unrelated one.

## 评审结论 (Review Verdict)

**Verdict: the root-cause diagnosis is CONFIRMED and the evidence chain is now
airtight. Adopt Recommended fix Option 1, with the three implementation
constraints below made mandatory for the fix node.**

### Final recommended fix

In `toAudioElement` (`MultiTrackPlaybackEngine.ts:643`): **forward
`addEventListener` (and, for symmetry, `removeEventListener`) to the underlying
real `<video>`, and memoize the adapter on that underlying element** so the
`AudioSyncPool` is handed one stable object across every resolve. No change to
`AudioSyncPool`, the seek guard, the export path, the material cache, or the
backend.

### Why Option 1 over Options 2 and 3

- **Minimum change that restores a PROVEN mechanism.** The `canplay` retry is
  not new code under review — it is the byte-for-byte twin of
  `VideoSourcePool._scheduleCanplayRetry` (`VideoSourcePool.ts:473`–`500`), which
  already ships and fixes the identical mid-clip cold-seek black screen for
  video. The only defect is that the audio element is *wrapped* and the video
  element is *raw*. Re-exposing the event surface restores exact parity; it does
  not introduce a new strategy.
- **Option 2 (pass the raw element) is viable at runtime but has the larger
  blast radius.** A real `HTMLVideoElement` does structurally satisfy
  `AudioElementLike` (it has `volume`/`paused`/`addEventListener`), and the
  `toAudioElement` docstring itself states the adapter exists only as a
  *type bridge* — `VideoElementLike` declares `volume?`/`paused?` as **optional**
  (`VideoSourcePool.ts:67`,`:77`) while `AudioElementLike` requires them, and the
  adapter supplies `volume ?? 1` / `paused ?? true` defaults. So Option 2 is not
  reopening a hidden runtime guard. However, it deletes the adapter that other
  call sites and tests assume, forces an `as unknown as AudioElementLike` cast
  that drops those safe defaults, and changes the resolver contract — more
  surface for a regression than the two-method passthrough. Prefer Option 1.
- **Option 3 (stall-detection re-kick) reinvents the browser's `canplay`
  signal** with heuristic timing and AbortError churn risk. Reject.

### Mandatory implementation constraints for the fix node (do NOT skip)

1. **Bind `this` when forwarding.** `addEventListener`/`removeEventListener` must
   be invoked on the underlying element, e.g.
   `addEventListener: (type, listener, opts) => el.addEventListener(type, listener, opts)`.
   Assigning the unbound method (`addEventListener: el.addEventListener`) throws
   *Illegal invocation* at call time — silently turning the "fix" into a crash on
   the first rejected `play()`.
2. **Memoization is REQUIRED, not optional polish.** Forwarding the event surface
   *alone* would un-silence the single-rejection case (the `canplay` listener
   lands on the stable underlying element and the arming closure captures its own
   wrapper), but because the pool stashes its dedupe/epoch markers
   (`__ecliptrixAudioPlayKick` / `__ecliptrixAudioPlayRetryEpoch`,
   `AudioSyncPool.ts:407`,`:429`) on the **wrapper**, a per-resolve fresh wrapper
   makes `_ensurePlaying`'s epoch read always `0` and re-arms a new `canplay`
   listener on every rejecting tick → **stacked listeners** and a defeated
   `_disarmCanplayRetry`. Memoizing the adapter on the underlying element keeps
   those guards working exactly as the existing pool tests assert. Store the memo
   on the **underlying** element (which `resolveAudioElement` already keeps
   stable), never on a value recomputed per call.
3. **Add a test that fails before the fix and passes after, exercised THROUGH the
   adapter.** The current suite is green on broken production code precisely
   because no test drives a rejecting `play()` through `toAudioElement`. The fix
   MUST add coverage where (a) `toAudioElement(realLikeEl)` exposes an
   `addEventListener` that delegates to the underlying element's registry, (b)
   resolving the same track twice yields markers that persist (stable identity),
   and (c) a `toAudioElement`-wrapped fake whose first `play()` rejects re-issues
   `play()` exactly once on `canplay` and arms exactly one listener across
   repeated rejecting ticks. Strictly, only `addEventListener` is required by the
   retry (`removeEventListener` is currently unused by the pool); forwarding both
   is acceptable and future-proof but the test must assert `addEventListener`
   delegation specifically.

### Out of scope / do not touch

The seek guard (`_assignCurrentTime` `srcJustSwapped` exception), the byte-range
backend, the material pre-cache, and the composition/export path are all correct
and unrelated to this symptom. Changes there would only widen the blast radius.
