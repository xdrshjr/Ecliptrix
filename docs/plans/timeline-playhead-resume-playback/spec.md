# Timeline Playhead Resume Playback — Spec (v2)

**Feature slug:** `timeline-playhead-resume-playback`
**Status:** Reviewed (Subtask #1 — Design Review)
**Owner:** AgentMesh subtask agent
**Date:** 2026-05-11 (v1) → 2026-05-11 (v2 review)

---

## 评审记录 (Review Notes)

Reviewed v1 against the current codebase (`VideoPlayerPanel.tsx` L67–71, L796–881, L1811–1937; `VideoEditingInterface.tsx` L234–237, L384–412, L518, L1516–1522; `useVideoPlayback.ts` L73–94; `videoEditingTypes.ts`; `TimelineRuler.tsx`). Findings, severity, and disposition:

| # | Severity | Concern | Disposition in v2 |
|---|----------|---------|-------------------|
| R1 | **P1** | §4.3 dispatcher reads `isCompositionPlaying` "hoisted on `VideoEditingInterface`", but that state is `useState` inside `VideoPlayerPanel` (around the `setIsCompositionPlaying` calls in L865, L1845, L1915) and is **not** lifted. The dispatcher pseudocode will not compile. | **Fixed.** Expose `isPlaying()` on the ref (`VideoPlayerPanelRef`); the parent calls it. §4.1 and §4.3 rewritten. |
| R2 | **P1** | §4.1 declares `handleCompositionSeek`'s 4th param as `origin?: 'timeline' \| 'player'` (optional). The existing signature at L69 is `source: 'timeline' \| 'player'` (required). The proposed change is a breaking rename + arity change with no migration; nothing in this PR needs it. | **Fixed.** §4.1 keeps the existing `source` parameter name, required, unchanged. |
| R3 | **P1** | §2.4 / §3 row 2 say "when `currentTimelineTime > 0`, write `currentTime = mappedFromTimeline(currentTimelineTime)` instead of `clipStart`." But the bootstrap effect (L826–854) also rewrites `<video>.src` when the URL differs; the browser resets `currentTime` to 0 internally during the load. A synchronous write at effect-run time is silently clobbered by the src-change. | **Fixed.** §2.4 / §3 now specify: when the src changes, defer the `currentTime` write into a `once: true` `canplay` listener (mirroring the pattern at L1881–1892). When the src is unchanged, write synchronously. |
| R4 | **P1** | §2.4 step 3 says "switch sources (existing `canplay` path), then `commitSeekThenPlay(...)`". Ambiguous: does `commitSeekThenPlay` run *inside* the `canplay` handler, or replace it? After a `src` change, awaiting `seeked` alone may resolve before the new frame is decodable and `play()` still stutters. | **Fixed.** §2.4 / §4.2 now explicitly chain: `await canplay → commitSeekThenPlay(video, target)`. `commitSeekThenPlay` is reused as the seek-then-play primitive *inside* the load handler, not in place of it. |
| R5 | **P2** | §3 row 3 (prop-driven drag-time seek, 50 ms throttle, paused-guard) is correct, but during composition playback the timeline cursor *also* updates via `timeupdate → onCurrentTimeChange`. Without an additional guard, the effect could chase its own tail when transitioning from playing → paused. | **Fixed.** §3 row 3 now also gates on `isSeekingRef.current === false` and skips when the delta to `<video>.currentTime` is < 0.05 s (no-op short-circuit). |
| R6 | **P2** | §3 row 6 says "remove the `currentTimelineTime !== currentTime` short-circuit". The replacement is unspecified; strict `setCurrentTime(currentTimelineTime)` when they are already equal is a no-op anyway. The real defect would be a re-entrant assignment causing a re-render loop. | **Fixed.** §3 now specifies: replace strict-inequality with `Math.abs(currentTimelineTime - currentTime) > 0.05`; otherwise no-op. Wording made unambiguous. |
| R7 | **P2** | §6.1 step 6 changes end-of-timeline Space from "restart from 0" to "no-op + log" — a user-facing UX change. The product owner should sign off; it should not be silently changed inside a bug-fix PR. | **Fixed.** §6.1 step 6 demoted to "Behaviour preserved: replay from 0 on end-of-timeline Space"; UX change moved to §8 *Out of scope*. |
| R8 | **P2** | §3 row 7 adds `data-testid="timeline-playhead"` to `TimelineRuler.tsx`. The current file has no such attribute (grep at L76 only finds a comment). Confirmed missing, acceptable as-is. | No change. (Verified.) |
| R9 | **P2** | §3 row 5 modifies the `VideoPlayerPanelRef` interface — this interface is declared in `VideoPlayerPanel.tsx` (L68–71), **not** in `videoEditingTypes.ts`. v1 says the latter. | **Fixed.** §3 corrected to point at `VideoPlayerPanel.tsx`. |
| R10 | **P2** | §6.2 says "Vitest + RTL". Verified: `package.json` has `"test": "vitest run"` and `vitest ^4.1.5`. Existing test file `__tests__/exportButton.test.tsx` confirms RTL idiom. | No change. (Verified.) |
| R11 | **P2** | §6.3 mentions `npm test` — project script is exactly `npm test` → `vitest run`. Verified. | No change. (Verified.) |

No P0 issues found. All P1 concerns resolved in the body below.

---

## 1. Overview

The Video Editing workspace presents a `<video>` preview on top and a multi-track timeline below. The timeline owns a red playhead bar (a "scrub" cursor) that the user drags along `TimelineRuler` to position the play cursor. Pressing **Space** is the universal "play / pause" affordance. Today the contract is broken: after a user adds a clip to a track and drags the playhead to, say, `00:08`, pressing Space restarts playback from `00:00` instead of resuming from the cursor. The bug is consistent and reproducible whenever the user has scrubbed but not yet pressed Play.

The root cause is a synchronization gap between three independent state holders for "current time": the **timeline store** (Zustand) updated by `TimelineRuler` drag; the **VideoEditingInterface** mirror `timelineCurrentTime` plumbed into props; and the **HTMLVideoElement** itself, whose `.currentTime` is only written when an explicit seek path runs. The composition-mode bootstrap effect in `VideoPlayerPanel.tsx` (the one that loads the first sequence into the `<video>`) sets `<video>.currentTime = clipStart` on mount, then nothing updates it again until the user clicks the in-player play button. When Space is pressed, `handlePlayPauseFromTimeline` *does* try to seek but is racy: the seek lock, the canvas snapshot buffer, and the asynchronous `canplay` handler interact such that the `play()` call frequently fires before `currentTime` is committed by the media element — and even when it is committed, the parent's `compositionCurrentTime` is not advanced, so the next `timeupdate` cycle sees a "delta > 0.5s drift" and silently snaps the `<video>` back toward what it believes is the canonical start.

This document specifies the fix as a small, surgical refactor that re-establishes a single, authoritative seek pipeline and removes the start-from-zero regression in all four playback states (paused-fresh, paused-mid-clip, playing, end-of-timeline). It is intended for a downstream engineer to land without further architectural decisions.

## 2. Technical design

### 2.1 Current architecture (relevant pieces)

| Layer | File | Responsibility |
|-------|------|---------------|
| Timeline scrub UI | `src/components/video/timeline/TimelineRuler.tsx` | Mouse drag → `useTimelineStore.setCurrentTime(t)`; keyboard scrub via arrow keys |
| Timeline store | `src/components/video/timeline/store/*` (Zustand slice) | Canonical `currentTime`; emits to subscribers |
| Time propagation | `src/components/video/timeline/TimelinePanel.tsx` (`useEffect` at ~L915) | `useTimelineStore.subscribe(state => state.currentTime, …)` → `onCurrentTimeChange(t)` |
| Parent mirror | `src/components/video/VideoEditingInterface.tsx` (~L130, L231–237, L461–463) | `timelineCurrentTime` state + `timelineCurrentTimeRef` for closure-stable reads |
| Global Space key | `VideoEditingInterface.tsx` (~L385–412) | On `code === 'Space'` calls `videoPlayerRef.current.handlePlayPauseFromTimeline(timelineCurrentTimeRef.current)` |
| Playback router | `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` `handlePlayPauseFromTimeline` (~L1811) | Composition-mode and preview-mode branches; seeks `<video>.currentTime`, calls `play()` |
| Composition seek | Same file, `handleCompositionSeek` (~L1556) | Switch sequence + map timeline-time → video-time + seek-lock |
| Bootstrap effect | Same file, effect at ~L798 | Loads first sequence into `<video>` and writes `currentTime = clipStart` on mount/sequence change |
| Preview hook | `src/components/video/hooks/useVideoPlayback.ts` | `handlePlayPause` honours `currentTimelineTime` only when `currentTimelineTime !== currentTime`; mock interval increments |

### 2.2 Defect analysis

Three independent issues conspire:

1. **Bootstrap clobber.** The composition bootstrap effect re-fires whenever `firstSequenceId` (its memoised dep) or `updateCompositionCurrentTime` (callback identity) changes. After the user drags the playhead, no React state inside `VideoPlayerPanel` has changed yet — but the very next state update that *does* invalidate those deps will reset `<video>.currentTime` to `clipStart` (typically `0`).
2. **Stale `compositionCurrentTime` after a paused seek.** `handlePlayPauseFromTimeline`'s paused → playing branch writes `compositionCurrentTimeRef.current = timelineTime` and calls `updateCompositionCurrentTime(timelineTime)`, but `compositionCurrentTime` (the React state owned by the parent through `compositionPlayback`) is only acknowledged after the first `timeupdate` propagates back up. During the gap, `findSequenceAtCompositionTime` calls elsewhere still see `compositionCurrentTime === 0`, so any concurrent re-entrance into the seek path treats the seek as "snap to start".
3. **`<video>.play()` before `currentTime` commit.** The same-source branch (~L1899–L1907) sets `currentVideo.currentTime = clampedVideoTime` and immediately calls `play()`. Browsers will honour this on most clips, but when the video element has just finished its initial load (a common case right after import), `currentTime` writes are throttled until `seeked` fires. `lockSeekUntilSeeked` registers a one-shot listener but does not gate `play()` itself. The result: play starts at the previous `currentTime` (i.e. `0`), and the awaited `seeked` event arrives milliseconds later — too late to be visible to the user.

### 2.3 Target behavior

A single deterministic pipeline:

```
User scrubs ruler → store.currentTime updated
                 → TimelinePanel emits onCurrentTimeChange
                 → VideoEditingInterface.timelineCurrentTime updated
                 → VideoEditingInterface ALSO calls videoPlayerRef.requestSeekFromTimeline(t)  ← NEW
                       which writes <video>.currentTime synchronously (debounced 50ms while dragging)
User presses Space:
   if (!isPlaying):
       seekAndPlay(timelineCurrentTime)   // single async fn; awaits seeked before play()
   else:
       pauseImmediate()
```

The fix is therefore:

- Introduce `seekAndPlayFromTimeline(t)` and `pauseFromTimeline()` as the **only** entry points wired to Space.
- Make the bootstrap effect at ~L798 *idempotent*: it must skip the `<video>.currentTime = clipStart` write when the timeline cursor is already non-zero. Read the parent-supplied `currentTimelineTime` prop and seed `<video>.currentTime = mappedFromTimeline(currentTimelineTime)` instead of `clipStart`.
- Add an additional ruler-drag side-channel: while the user is dragging the playhead, push the mapped video time into the `<video>` element with a 50 ms trailing throttle, so the preview frame tracks the cursor. This makes Space-resume robust even if the bootstrap effect has not yet run.
- Replace the same-source branch with a unified helper that always awaits a `seeked` event (or a 200 ms timeout) before calling `play()`:

```ts
async function commitSeekThenPlay(video, targetTime) {
  return new Promise<void>((resolve) => {
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done, { once: true });
    video.currentTime = targetTime;
    // Safety: if browser fires no seeked (already there), resolve on next tick.
    setTimeout(done, 200);
  }).then(() => video.play().catch(() => {}));
}
```

- Eliminate the divergence between `compositionCurrentTime` and `timelineCurrentTime` by making the parent (`VideoEditingInterface`) the **single source of truth** for "where the user wants playback to begin" and passing it explicitly into both branches.

### 2.4 Sequence of operations (paused → Space)

1. `keydown` handler in `VideoEditingInterface` reads `videoPlayerRef.current.isPlaying()` (R1 fix — exposed by `useImperativeHandle`); if `false`, calls `videoPlayerRef.current.seekAndPlayFromTimeline(timelineCurrentTimeRef.current)`.
2. `seekAndPlayFromTimeline(t)` resolves `target = findSequenceAtCompositionTime(videoSequences, t)` and computes `mappedVideoTime = mapTimelineTimeToVideoTime(target.sequence, target.offset)`.
3. If `target.sequence.id !== currentSequenceId` → switch sources:
   - Capture canvas snapshot (`captureFrameToCanvas()`); set `<video>.src = newSrc`.
   - Register `{ once: true }` `canplay` listener; **inside** the listener call `commitSeekThenPlay(video, mappedVideoTime)` (R4 fix). This guarantees the seek + `play()` only fires after the new media is decode-ready.
   - Safety timeout (5 s) clears the listener and releases the seek lock (existing pattern at L1893–1898).
4. Else (same source) → call `commitSeekThenPlay(video, mappedVideoTime)` directly.
5. After the promise resolves: `setIsCompositionPlaying(true)`, `syncAudioPlayback(t, true)`, `onCompositionPlayPause()`, and `updateCompositionCurrentTime(t)` so the parent's `compositionCurrentTime` no longer lags.

### 2.5 Sequence of operations (playing → Space → pause)

1. `keydown` handler reads `isPlaying() === true` and calls `videoPlayerRef.current.pauseFromTimeline()`.
2. `pauseFromTimeline()` calls `currentVideo.pause()`, `syncAudioPlayback(currentTime, false)`, `setIsCompositionPlaying(false)`, `onCompositionPlayPause()`. **No seek** — `<video>.currentTime` is preserved exactly.

## 3. File / module change plan

| File | Change | Intent |
|------|--------|--------|
| `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | Refactor `handlePlayPauseFromTimeline` → split into `seekAndPlayFromTimeline`, `pauseFromTimeline`, and `isPlaying()` getter; introduce `commitSeekThenPlay` helper; expose all three via `useImperativeHandle` (R1, R9) | Single authoritative seek-then-play pipeline; parent can ask the panel for its play state |
| `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | Modify bootstrap effect (L796–881): when `currentTimelineTime > 0`, target `mappedFromTimeline(currentTimelineTime)` instead of `clipStart`. **If src is changing**, defer the `currentTime` write into a `{ once: true }` `canplay` listener (R3); if src is unchanged, write synchronously after `pause()` | Prevent bootstrap clobber both at mount and across the src-change race |
| `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | Add prop-driven side-effect: when `currentTimelineTime` prop changes, **and** `isCompositionPlaying === false`, **and** `isSeekingRef.current === false`, **and** `Math.abs(mapped - <video>.currentTime) > 0.05` (R5), write `<video>.currentTime = mapped` (50 ms trailing throttle) | Preview frame tracks ruler while dragging; ensures the seek is already applied when Space fires; no chasing during playback feedback |
| `src/components/video/VideoEditingInterface.tsx` | Update Space key handler: call `videoPlayerRef.current.isPlaying()` (R1) to choose branch — `pauseFromTimeline()` if playing, `seekAndPlayFromTimeline(timelineCurrentTimeRef.current)` if paused | Dispatcher is explicit; parent does not need to mirror composition-play state |
| `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | Extend the in-file `VideoPlayerPanelRef` interface (declared at L68–71, **not** in `videoEditingTypes.ts` — R9) to include `seekAndPlayFromTimeline`, `pauseFromTimeline`, `isPlaying`; keep `handlePlayPauseFromTimeline` for one release with `@deprecated` JSDoc and a thin wrapper | Type-safe ref contract; backward compatibility |
| `src/components/video/hooks/useVideoPlayback.ts` | In `handlePlayPause` (L73–94), replace the strict-inequality short-circuit `currentTimelineTime !== currentTime` with `Math.abs(currentTimelineTime - currentTime) > 0.05` before `setCurrentTime(currentTimelineTime)` (R6) | Preview-mode also resumes from playhead; no re-entrant assignment when already equal |
| `src/components/video/timeline/TimelineRuler.tsx` | No change to scrub math; add `data-testid="timeline-playhead"` on the red bar (verified missing — R8) | Stable test selector |
| `src/components/video/components/VideoPlayerPanel/__tests__/playheadResume.test.tsx` (new) | Unit/integration test using Vitest + React Testing Library + a stubbed `<video>` element | Cover paused-scrub-Space, playing-scrub-Space, end-of-timeline-Space, preview-mode |
| `src/components/video/__tests__/videoEditingInterface.spaceKey.test.tsx` (new) | Directory does not yet exist (verified) — create | Verifies global Space dispatches via `isPlaying()` and respects input-focus blocklist |
| `docs/plans/timeline-playhead-resume-playback/spec.md` | This document | Source of truth for the work |

No backend, no schema, no API surface changes. The `handleCompositionSeek` 4th parameter remains `source: 'timeline' \| 'player'` (required) — unchanged from L69 (R2).

## 4. Interface design

### 4.1 React ref API on `VideoPlayerPanel`

Declared **inline in `VideoPlayerPanel.tsx`** (the current home of `VideoPlayerPanelRef` at L68–71 — R9), not in `videoEditingTypes.ts`.

```ts
export interface VideoPlayerPanelRef {
  /** Unchanged. Switch sequence + seek under a single, awaited pipeline. */
  handleCompositionSeek: (
    compositionTime: number,
    targetSequence: VideoSequenceItem,
    videoTime: number,
    source: 'timeline' | 'player'   // R2: kept as-is, required, name unchanged
  ) => Promise<void>;

  /** NEW. Seek to timeline time and start playback. Idempotent: safe to call when already playing. */
  seekAndPlayFromTimeline: (timelineTime: number) => Promise<void>;

  /** NEW. Pause without seeking. <video>.currentTime is preserved exactly. */
  pauseFromTimeline: () => Promise<void>;

  /**
   * NEW. Synchronous read of the current play state.
   * Returns `true` if composition or preview playback is active.
   * The parent uses this to pick branch in the Space-key handler (R1).
   */
  isPlaying: () => boolean;

  /**
   * @deprecated use seekAndPlayFromTimeline / pauseFromTimeline + isPlaying.
   * Kept for one release. Internally dispatches to the new methods.
   */
  handlePlayPauseFromTimeline: (timelineTime: number) => Promise<void>;
}
```

Implementation note for `isPlaying()`: it returns `playbackMode === 'composition' ? isCompositionPlaying : videoRef.current?.paused === false`. Internally read via a ref-mirrored value so the closure stays stable across renders.

### 4.2 Internal helper

```ts
type CommitSeekOptions = { timeoutMs?: number };
function commitSeekThenPlay(
  video: HTMLVideoElement,
  targetTime: number,
  opts?: CommitSeekOptions,
): Promise<void>;
```

Resolves after either the `seeked` event fires or `opts.timeoutMs` (default `200`) elapses, then calls `video.play()`. Rejections from `play()` are caught and logged but not re-thrown (autoplay-policy noise).

### 4.3 Space-key dispatcher

`VideoEditingInterface` keydown handler (current site: L384–412) becomes:

```ts
if (event.code !== 'Space') return;
// focus-blocklist guards unchanged (INPUT / TEXTAREA / contentEditable)
const ref = videoPlayerRef.current;
if (!ref) return;
event.preventDefault();
if (ref.isPlaying()) {
  void ref.pauseFromTimeline();
} else {
  void ref.seekAndPlayFromTimeline(timelineCurrentTimeRef.current);
}
```

R1 fix: the parent does **not** read `isCompositionPlaying` directly (that state lives in `VideoPlayerPanel` and is not lifted). It calls `ref.isPlaying()` instead. This keeps the panel the single owner of play state and avoids a stale-React-state race between the keydown event and the next render.

## 5. Data model

None changed. The fix is entirely in the React render tree and DOM interaction; no Zustand slice shape, no IndexedDB persistence schema, no backend DTOs, no Alembic migrations.

For reference, the involved in-memory shapes (already defined in `src/components/video/types/`):

- `CompositionPlayback { isCompositionMode, videoSequences[], audioSequences[], currentSequenceIndex, totalCompositionDuration, compositionCurrentTime }`
- `VideoSequenceItem { id, name, src, clipStart, clipEnd, duration, … }`
- Timeline store slice: `{ currentTime, totalDuration, zoomLevel, scrollLeft, tracks[], … }`

The bug is a coherence failure between `Timeline.currentTime`, `CompositionPlayback.compositionCurrentTime`, and `HTMLVideoElement.currentTime`; the fix asserts the invariant: **after any user-driven seek, all three converge to the same mapped value before the next `play()` call.**

## 6. Testing & acceptance criteria

### 6.1 Manual acceptance script

1. Fresh project. Add one local video (≥10 s) to `video-track-1`.
2. Drag the red playhead to ~5 s. Press Space. → Playback **must** start from 5 s (±0.2 s tolerance), audio in sync.
3. While playing, drag the playhead to ~2 s. → Playback should **continue** from 2 s seamlessly.
4. Add a second video clip after the first. Drag the playhead into the second clip's region. Press Space. → Playback starts inside the second clip at the correct intra-clip offset.
5. With playback ongoing, press Space. → Pause without seeking; `<video>.currentTime` stays put.
6. Press End on the ruler (jumps to total duration). Press Space. → Existing behaviour preserved (replay from 0). R7: changing this is a user-facing UX decision that requires PM sign-off and is out of scope for this bug fix.
7. Reload the page (project hydration). Repeat step 2. → Same correct behaviour.

### 6.2 Automated tests (Vitest + RTL)

- `playheadResume.test.tsx`:
  - Stubs `HTMLMediaElement.prototype.play` and patches `currentTime` setter to record writes.
  - Asserts that after a simulated scrub (`store.setCurrentTime(5)`), pressing Space calls `play()` **after** `currentTime` is set to the mapped value.
  - Asserts the `seeked` event is awaited (does not call `play()` until listener resolves or 200 ms elapses).
  - Asserts bootstrap effect does **not** overwrite `currentTime` when `currentTimelineTime > 0` at mount.
- `videoEditingInterface.spaceKey.test.tsx`:
  - Space inside an `<input>` does **not** trigger playback.
  - Space when ref is null is a no-op (no exception).

### 6.3 Definition of done

- All manual acceptance steps pass on Chromium and Firefox.
- New unit tests pass; no existing test regressions (`npm test`).
- `npm run type-check` clean.
- `npm run lint` clean (warnings allowed, no new errors).
- No backend changes; backend tests unaffected.

## 7. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Browsers that don't fire `seeked` when seeking to current position cause the 200 ms safety timeout to dominate, adding a hair of latency | Medium | Low (≤200 ms one-shot, not per frame) | Skip the await when `Math.abs(video.currentTime - target) < 0.01`. |
| Autoplay policy rejects `play()` after a non-trusted event chain | Low (Space is user-trusted) | Medium | Swallow rejection; log debug; UI control button still available as fallback. |
| Throttled drag-time seek floods the media element and causes stutter | Medium | Medium | 50 ms trailing throttle; only seek while paused; pause-state guard inside the prop-driven effect. |
| Source-switch path (different `<video>.src`) still races with `canplay` | Medium | Medium | Reuse existing `canplay` handler but call `commitSeekThenPlay` inside it; cover with test simulating `src` change. |
| Preview mode (no composition sequences) still uses a `setInterval` mock from `useVideoPlayback.ts` that doesn't drive a real `<video>` | High pre-fix | Low post-fix (rarely reached when materials exist) | Out of scope for full rewrite; the spec only fixes the resume-from-playhead invariant inside the existing mock. |
| Deprecation of `handlePlayPauseFromTimeline` breaks an undiscovered caller | Low | Low | Keep wrapper for one release; grep for callers (only `VideoEditingInterface.tsx` known); add `@deprecated` JSDoc + console.warn in dev. |
| Bootstrap effect's new branch reads `currentTimelineTime` prop, which may be `undefined` for early mount | Medium | Low | Default to `0`; existing code already tolerates undefined. |
| Bootstrap effect's deferred `canplay`-listener seed could race with `handleCompositionSeek`'s own `canplay` listener when a sequence switch and a hydration happen back-to-back | Low | Medium | Reuse `transitionIdRef` to invalidate stale listeners (already the pattern at L1879–L1894). |
| Parent calls `ref.isPlaying()` on every Space press; the panel must mirror its state through a ref so the closure returns the freshest value, not a stale render's value | Medium | Medium | Mirror `isCompositionPlaying` through `isCompositionPlayingRef` (parallel to existing `compositionCurrentTimeRef`); `isPlaying()` reads the ref. |

## 8. Out of scope

- Rewriting `useVideoPlayback.ts`'s `setInterval`-based mock to a real `requestAnimationFrame` loop. This is a long-standing tech debt and unrelated to the bug.
- Multi-track audio fade behaviour during seek. Existing `syncAudioPlayback` is reused unchanged.
- Frame-accurate seek precision beyond what `HTMLVideoElement.currentTime` natively provides.
- Touch / mobile playback gestures. Mobile is gated by the existing `showMobileWarning` flow.
- End-of-timeline Space behaviour change (R7). Replay-from-0 is preserved in this PR. Any change requires a separate UX decision.

---

## 评审结论 (Review Verdict)

**通过 (Approved).**

All P1 issues raised during review have been resolved directly in the spec body:

- **R1** — Dispatcher now reads `ref.isPlaying()` rather than the non-existent hoisted state.
- **R2** — `handleCompositionSeek` signature kept compatible with the live code (`source` param, required).
- **R3** — Bootstrap effect now defers `currentTime` writes into a `canplay` listener when src changes; synchronous when src is unchanged.
- **R4** — `commitSeekThenPlay` is invoked *inside* the `canplay` handler for cross-source seeks, not in place of it.

P2 concerns (R5, R6, R7) are likewise addressed in the body. R8 / R9 / R10 / R11 were verification items that confirmed v1 was correct (or trivially adjusted).

No P0 / P1 issues remain unresolved.

The fix is well-scoped (no backend, no schema, single feature surface), grounded in observed defects (verified the three race conditions in §2.2 against the actual code at L798–881, L1811–1937, L73–94), and the implementation steps are concrete enough for the downstream engineer to land without further architectural decisions.

**End of v2 spec — approved for implementation.**
