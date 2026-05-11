# Timeline Playhead Resume Playback — v3 Spec (Follow-up Fix)

**Feature slug:** `timeline-playhead-resume-v3`
**Status:** Reviewed — v2 (review pass complete; ready for implementation)
**Owner:** AgentMesh subtask agent
**Date:** 2026-05-11
**Document version:** v2 (post-review)
**Predecessors:** `docs/plans/timeline-playhead-resume-playback/spec.md` (v2) — implemented in commit `b83ad1a`.

---

## 评审记录

Senior-reviewer pass against feasibility / completeness / consistency / right-sizing. Severity legend: **P0** must-fix-blocking; **P1** must-fix-before-implementation; **P2** nice-to-have / observational.

| # | Severity | Dimension | Concern | Resolution in this v2 |
|---|----------|-----------|---------|------------------------|
| R1 | P1 | Consistency / Feasibility | §6.2 prescribes RTL-style tests that mock `videoPlayerRef.current.handleCompositionSeek` and patch `HTMLMediaElement.prototype.currentTime`. The two existing test files (`playheadResume.test.tsx`, `videoEditingInterface.spaceKey.test.tsx`) explicitly document — quoting `playheadResume.test.tsx:7` — that **"the project's Vitest config (tsconfig jsx: 'preserve') cannot mount React components"** and therefore use source-level regex assertions. The proposed RTL mocks cannot be executed under the current test infrastructure. Setting up jsdom + a parallel tsconfig is out of scope for a localized bugfix. | §6.2 rewritten to source-level regex assertions that mirror the v2 convention (assert the *presence* of the gate code in `VideoEditingInterface.tsx` and the short-circuit in `VideoPlayerPanel.tsx`). Runtime behavior is covered by §6.1 manual acceptance. |
| R2 | P1 | Completeness | Reset of `playbackDrivenTimeUpdateRef` to `−∞` on Space-key transitions appears only in §7 Risks-Mitigations and is **not** in the §3 change plan. Without it, after a pause-and-later-scrub to within 0.05 s of the last playback-driven tick, the user scrub is silently dropped. | Promoted to a first-class entry in §3 change plan; §4.1 code listing now shows the reset wired into the Space-key handler at `VideoEditingInterface.tsx` L406–409. |
| R3 | P1 | Completeness / Correctness | The `isCompositionPlayingRef.current` mirror lives in a `useEffect([isCompositionPlaying])` at `VideoPlayerPanel.tsx` L687. There is a one-tick delay between `setIsCompositionPlaying(true)` and the ref reflecting `true`. During the synchronous tail of `seekAndPlayFromTimeline`, any code that reads `isCompositionPlayingRef.current` sees the **stale** prior value. Although the 0.05 s gate in `handleTimelineTimeChange` already breaks the primary loop, the defence-in-depth short-circuit in `handleCompositionSeek` also reads the ref — and the *first* `timeupdate` after `seekAndPlayFromTimeline` can race the effect. | Added to §3 / §4.2: `seekAndPlayFromTimeline` and `pauseFromTimeline` now write `isCompositionPlayingRef.current` **synchronously** before relinquishing the call stack. The `useEffect` mirror remains as a backstop. |
| R4 | P1 | Consistency | §2.2.1 Defect-A analysis describes the stale `currentSequenceIndex` mechanism but does **not** acknowledge that v2 already shipped two pre-emptive sync writes: `VideoPlayerPanel.tsx` L1661–1677 (synchronous `onSequenceIndexUpdate(targetSequenceIndex)` before any `<video>.currentTime` write) and `useTimelineComposition.ts` L144–148 (synchronous `setCompositionPlayback({...currentSequenceIndex})` before `await onVideoSeekRequired`). The omission obscures the rationale and risks a future reader thinking v3 duplicates v2. | §2.2.1 amended with a "Why v2's index-sync isn't enough" paragraph explaining that the wrong-index reverse-map is a *consequence* of the feedback loop, not its root cause — and that breaking the loop in `handleTimelineTimeChange` is the surgical fix. |
| R5 | P1 | Right-sizing | §3 says `handleCompositionSeek` dep-list should drop `isCompositionPlaying`. But `compositionCurrentTime` is still read at L1701 (logged), and `useCallback` stability for the imperative ref handle is desirable. The plan as written invites a churned dep-list that may either fail `react-hooks/exhaustive-deps` or destabilise the imperative handle when `compositionCurrentTime` ticks at 4 Hz. | §3 amended: drop `isCompositionPlaying` from deps **and** drop `compositionCurrentTime` (move the logged value to a `compositionCurrentTimeRef` read instead; the ref already exists at L1669). This is consistent with the v2 ref-getter pattern. |
| R6 | P2 | Right-sizing | §6.1 step 8 makes the acceptance test gate on grepping debug logs for specific strings. Brittle if log wording is reworded later. | §6.1 step 8 demoted to "diagnostic aid (optional)". |
| R7 | P2 | Right-sizing | The 0.3 s defence-in-depth window in `handleCompositionSeek`'s short-circuit is wider than needed: the playback-echo gate in `handleTimelineTimeChange` already filters anything within 0.05 s, so the only echoes that reach `handleCompositionSeek` are at sub-frame precision. | §3 / §4.2: shrunk the short-circuit window from 0.3 s to 0.1 s. Still wider than the 0.05 s gate (so it catches sub-gate residuals) but narrow enough to allow legitimate small scrubs (≥ 6 frames at 60 fps) to take effect during playback. |
| R8 | P2 | Completeness | §3 mentions resetting the ref on `pauseFromTimeline()` and `seekAndPlayFromTimeline()` but only inside `VideoEditingInterface.tsx`'s Space-key handler. Manual ruler scrubs also reach `handleTimelineTimeChange` directly via the store subscription; they do not pass through the Space-key handler. | Confirmed: for ruler scrubs the user-driven path is *itself* the producer (it does not need the ref reset). The reset is only required at Space transitions and when the player programmatically jumps (e.g., end-of-timeline → 0). §3 wording tightened accordingly. |

---

## 1. Overview

The Video Editing workspace lays a `<video>` preview on top of a multi-track timeline. The timeline owns a red playhead bar (the "scrub cursor") that the user drags along `TimelineRuler` to position playback. **Space** is the global play/pause shortcut. The product contract is simple: after the user adds a clip to the timeline and drags the playhead to, e.g. `00:08`, pressing Space must resume playback **from `00:08`** and never from `00:00` (or from the start of the clip the cursor is currently over).

A prior fix shipped in commit `b83ad1a` (v2 spec) that introduced `seekAndPlayFromTimeline`, `pauseFromTimeline`, an `isPlaying()` ref-getter, a `commitSeekThenPlay` helper, a deferred-`canplay` bootstrap seed, and a 50 ms-throttled drag-time seek effect. Those changes fixed the most direct race (between `play()` and the `currentTime` write). However, the user reports the bug still manifests: pressing Space after a scrub causes the cursor to **snap to the start of the current clip** and playback begins there, instead of resuming from the cursor. The visible symptom — cursor jumping — is the giveaway that the fix is incomplete: something is writing the timeline cursor or the video `currentTime` back to the start of the clip *after* `seekAndPlayFromTimeline` has correctly positioned both.

This v3 spec identifies two remaining defects that the v2 fix did not address and prescribes a tight, surgical remediation:

1. **A re-entrant timeline ↔ player feedback loop** that fires every `timeupdate` (~4 Hz) during playback. It re-invokes the heavyweight `handleCompositionSeek` from the playback-driven branch, repeatedly writing `<video>.currentTime` to a mapped time derived from a possibly-stale `compositionPlayback.currentSequenceIndex`. The seek lock briefly suppresses the next `timeupdate`, but the storm continues, and the wrong-index reverse-map produces values that *correctly look like* the start of the wrong clip — explaining the user's observation.
2. **A stale-closure read of `wasPlayingBefore`** inside `handleCompositionSeek`'s same-source branch. When the feedback loop fires during the *very first* playback tick (just after `seekAndPlayFromTimeline` has called `setIsCompositionPlaying(true)` but before React has flushed the resulting render), `wasPlayingBefore = isCompositionPlaying` reads the *previous* render's `false`. Consequently the seek-and-no-resume branch executes: `<video>.currentTime` is rewritten and `play()` is **not** re-issued. Combined with (1), this can latch playback at the start-of-clip mapping.

The fix is to (a) break the re-entry by gating the playback-driven `handleCompositionSeek` call out of `handleTimelineTimeChange` so playback feedback no longer triggers a "seek the player to its own time" round-trip, and (b) read play-state from a ref inside `handleCompositionSeek` for any "should I resume after the seek?" decision, ensuring the call always sees freshly-committed state. The v3 fix is local to two files — `VideoEditingInterface.tsx` and `VideoPlayerPanel.tsx` — plus a defensive epsilon-guard inside `handleCompositionSeek` that turns the second-and-later playback-driven re-entries into a no-op even if the gate is somehow bypassed.

## 2. Technical design

### 2.1 Current architecture (relevant pieces, post-v2)

| Layer | File | Role |
|-------|------|------|
| Timeline scrub UI | `src/components/video/timeline/TimelineRuler.tsx` | Pointer drag → `useTimelineStore.setCurrentTime(t)` |
| Timeline store | `src/components/video/timeline/store/*` | Canonical `currentTime`; `subscribe` emits on every write |
| Time → parent | `TimelinePanel.tsx` L915–922 | `store.subscribe(currentTime)` → `onCurrentTimeChange(t)` |
| External time → store | `TimelinePanel.tsx` L259–266 | `externalCurrentTime` prop change → `store.setCurrentTime(t)` (with 0.01 s epsilon) |
| Parent mirror | `VideoEditingInterface.tsx` L130, L234–237, L469–471 | `timelineCurrentTime` state + `timelineCurrentTimeRef`; `handleVideoTimeUpdate` writes `setTimelineCurrentTime(t)` from playback |
| Time → seek | `VideoEditingInterface.tsx` L1516–1530 | `handleTimelineTimeChange(t)` runs `setTimelineCurrentTime(t)` **and** `timelineComposition.handleCompositionSeek(t)` |
| Composition seek | `useTimelineComposition.ts` L132–163 | Maps `t` → `(sequence, offset)`, mutates `compositionPlayback`, awaits `onVideoSeekRequired(...)` |
| Player seek | `VideoPlayerPanel.tsx` `handleCompositionSeek` L1648–1839 | Locks seek, switches `<video>.src` if needed, writes `currentTime`, optionally resumes |
| Space-key path | `VideoEditingInterface.tsx` L384–420 + `VideoPlayerPanel.tsx` `seekAndPlayFromTimeline` L1976–2111 | Reads `ref.isPlaying()`, branches to `pauseFromTimeline()` or `seekAndPlayFromTimeline(...)` |
| Time update sink | `VideoPlayerPanel.tsx` `handleTimeUpdate` L1203–1467 | Maps `<video>.currentTime` back to timeline time; writes `onCompositionTimeUpdate`, `onTimelineTimeUpdate`; gated by `isSeekingRef` |

### 2.2 Defect analysis

#### Defect A — Playback-driven re-seek feedback loop

The chain executes *every `timeupdate`* during composition playback:

```
<video>.timeupdate
  → handleTimeUpdate (VideoPlayerPanel)              [guarded by isSeekingRef]
  → onTimelineTimeUpdate(accumulatedTime)            [callback prop]
  → handleVideoTimeUpdate (VideoEditingInterface)
  → setTimelineCurrentTime(accumulatedTime)          [React state]
  → re-render, externalCurrentTime prop = accumulatedTime
  → TimelinePanel useEffect on externalCurrentTime   [|delta| > 0.01]
  → useTimelineStore.setCurrentTime(accumulatedTime)
  → store.subscribe emits
  → onCurrentTimeChange(accumulatedTime)
  → handleTimelineTimeChange(accumulatedTime)
     ├── setTimelineCurrentTime(accumulatedTime)      [idempotent]
     └── timelineComposition.handleCompositionSeek(accumulatedTime)   ★
         └── onVideoSeekRequired(clampedTime, targetSequence, targetVideoTime)
             → videoPlayerRef.current.handleCompositionSeek(...)
                 → lockSeekUntilSeeked + <video>.currentTime = mappedVideoTime
                 → if wasPlayingBefore && paused: play()
```

The ★ call is the bug: the playback feedback path re-asks the player to seek to its own time. The seek lock (`isSeekingRef`) then suppresses the *next* `timeupdate` for up to 1000 ms (`lockSeekUntilSeeked`'s fallback), masking the storm but not removing it. Three concrete failure modes that cause the visible cursor jump:

1. **Wrong-index reverse map.** `useTimelineComposition.handleCompositionSeek` recomputes `target = findSequenceAtCompositionTime(seqs, clampedTime)` each call, so it sees the *correct* sequence index. But it then `setCompositionPlayback({ ..., currentSequenceIndex })`. Until React flushes, `compositionPlayback.currentSequenceIndex` is stale anywhere else that reads it (e.g., `handleTimeUpdate`'s "verify state-sequence URL match" fast path at L1247). If the URL fast-path matches but the time-range check fails because the *state* index lags, the fallback URL-match loop (L1300–1316) picks the **first** URL-matching sequence (typical when the user has duplicated the same material), pinning `actualSequenceIndex` to clip #0. Reverse-mapping `<video>.currentTime` through clip #0's `clipStart` produces `accumulatedTime` ≈ `0` — the cursor jumps to the start of clip #0 (which the user, who placed the duplicate later, perceives as "the start of the current clip"). This matches the user's report verbatim.

   **Why v2's index-sync isn't enough (R4).** v2 already shipped two pre-emptive sync writes designed to close this race: `VideoPlayerPanel.tsx` L1661–1677 calls `onSequenceIndexUpdate(targetSequenceIndex)` *synchronously* before the `<video>.currentTime` mutation, and `useTimelineComposition.ts` L144–148 writes `setCompositionPlayback({...currentSequenceIndex})` *synchronously* before `await onVideoSeekRequired`. These do reduce the race window for the *first* seek. But the playback-feedback loop fires `handleCompositionSeek` on **every** `timeupdate` (~4 Hz), and each round-trip recomputes the index from the *playback-driven* `accumulatedTime` — which is itself reverse-mapped through whatever `actualSequenceIndex` the player resolved on the previous tick. The wrong-index latch is therefore self-reinforcing once it occurs. v2's writes synchronise the *first* seek but do nothing for the storm. Killing the feedback loop in `handleTimelineTimeChange` (this v3 fix) removes the storm, after which v2's pre-emptive sync writes are sufficient for the remaining first-seek case. v3 does **not** duplicate v2's index-sync logic — it removes the trigger that defeats it.
2. **Re-entered seek vs. ongoing play.** `handleCompositionSeek`'s same-source branch writes `<video>.currentTime = mappedVideoTime` unconditionally and only calls `play()` when `wasPlayingBefore && videoRef.current.paused`. The browser's behaviour when assigning `currentTime` to a playing video varies: many browsers briefly pause buffering, fire `seeking`, then `seeked`, then continue play. Some throttle the assignment when the new value is within frame quantization of the current value, dropping the seek silently. In either case the constant re-seek storm produces audible/visible stutter and *can* leave the element paused if `play()` is not re-issued in time, which it isn't in this branch.
3. **Audio resync hammering.** Each round-trip ends in `syncAudioPlayback(compositionTime, wasPlayingBefore)`. With `wasPlayingBefore = true` and `drift > 0.5`, audio elements have their `currentTime` rewritten on every storm tick. Combined with (1), audio can briefly latch at clip #0's start while video tries to continue, producing the perceived "rewind".

#### Defect B — Stale-closure `wasPlayingBefore` at the first playback tick

`seekAndPlayFromTimeline`'s tail sequence is `commitSeekThenPlay → updateCompositionCurrentTime(t) → setIsCompositionPlaying(true) → onCompositionPlayPause()`. Between `commitSeekThenPlay`'s internal `video.play()` and the React render that flushes `isCompositionPlaying = true`, the `<video>` element has *already started playing* and is firing `timeupdate`. If the playback feedback loop (Defect A) round-trips at that exact moment, the version of `handleCompositionSeek` invoked is the one created with `isCompositionPlaying = false` in its closure (because React has not yet re-rendered). It reads `wasPlayingBefore = false`, performs the seek, but does **not** call `play()`. If the seek happens to coincide with the browser's internal play state (e.g., it briefly pauses during the seek), the `<video>` element latches paused. Subsequent ticks fire from the *playing-true* render's `handleCompositionSeek` — but by then `<video>.currentTime` has been rewritten to a wrong-index mapped value (Defect A), so even when `play()` is re-issued, playback resumes from the wrong place.

Although `useCallback`'s dep-list includes `isCompositionPlaying`, the call into `handleCompositionSeek` arrives via `videoPlayerRef.current.handleCompositionSeek(...)` (set inside `useImperativeHandle` whose dep-list **does** include the latest callback). The race is not in closure capture — `useImperativeHandle` does re-publish the latest callback — but in React's *scheduling*: the parent's state update that drives the feedback round-trip is scheduled before the child's `setIsCompositionPlaying(true)` is committed to the rendered tree, so the imperative handle for *that microtask* still points at the prior callback. The fix is to stop reading play state from a render-scoped closure and instead read it from a ref that the player mirrors synchronously (the v2 spec already introduced `isPlayingForRefRef`; we extend it to all internal play-state reads).

### 2.3 Target behaviour

A single deterministic invariant for the playback ↔ timeline feedback edge:

> **The playback feedback path (`handleTimeUpdate → setTimelineCurrentTime → store.setCurrentTime → handleTimelineTimeChange`) must never trigger a player-side seek.**

When the user *manually* scrubs the ruler (pointer drag or keyboard arrow on the ruler), `handleTimelineTimeChange` should continue to forward the seek to the player. When the player itself drives the time, the parent should mirror it (so other UI updates) but skip the seek round-trip.

The implementation discriminator is a small ref, `playbackDrivenTimeUpdateRef`, stamped with the latest time written via `handleVideoTimeUpdate`. `handleTimelineTimeChange` compares its incoming `time` against this ref; if within a 0.05 s epsilon, the update is treated as playback-driven and the composition seek is **skipped**.

For Defect B, all "is the player currently playing?" reads inside `handleCompositionSeek` switch from the closure-scoped `isCompositionPlaying` to a ref-scoped read (`isCompositionPlayingRef.current`, already present), so that even if a re-entry slips past the gate, the seek decisions are coherent.

A third belt-and-braces guard: inside `handleCompositionSeek`'s same-source branch, if `Math.abs(currentVideo.currentTime - mappedVideoTime) < 0.3` **and** `isCompositionPlayingRef.current === true` **and** `source === 'timeline'`, the call short-circuits before touching `<video>.currentTime`. This makes any residual re-entry a strict no-op.

### 2.4 Sequence of operations (after v3)

#### Manual scrub → Space (paused → playing)

```
User drags ruler → store.setCurrentTime(8)
   → subscribe emits → handleTimelineTimeChange(8)
       ├── playbackDrivenTimeUpdateRef.current ≈ 0 → |8 - 0| > 0.05 → user-driven
       ├── setTimelineCurrentTime(8)
       └── timelineComposition.handleCompositionSeek(8)     [seeks <video>, no play]

User presses Space:
   → seekAndPlayFromTimeline(8)
       → commitSeekThenPlay(<video>, mappedVideoTime)
       → setIsCompositionPlaying(true), updateCompositionCurrentTime(8)

<video>.timeupdate fires (e.g., t=8.25 in timeline terms)
   → handleTimeUpdate → onTimelineTimeUpdate(8.25)
   → handleVideoTimeUpdate(8.25)
       ├── playbackDrivenTimeUpdateRef.current = 8.25
       └── setTimelineCurrentTime(8.25)
   → externalCurrentTime effect → store.setCurrentTime(8.25)
   → subscribe → handleTimelineTimeChange(8.25)
       ├── |8.25 - 8.25| ≤ 0.05 → playback-driven → SKIP composition seek
       └── setTimelineCurrentTime(8.25)  [idempotent]
```

#### Manual scrub while playing

```
User drags ruler from 8.25 → 12.0 (jump forward 3.75 s in mid-playback)
   → store.setCurrentTime(12.0) → subscribe → handleTimelineTimeChange(12.0)
       ├── playbackDrivenTimeUpdateRef.current = 8.25
       ├── |12.0 - 8.25| = 3.75 > 0.05 → user-driven
       ├── setTimelineCurrentTime(12.0)
       └── timelineComposition.handleCompositionSeek(12.0)  [valid scrub-while-playing]
```

This preserves the user-facing scrub-while-playing affordance.

#### Stop edge case (end-of-timeline)

`handleVideoEnded` and the clip-end branch in `handleTimeUpdate` are unchanged — they don't go through `handleTimelineTimeChange`. End-of-timeline Space remains "replay from 0".

## 3. File / module change plan

| File | Change | Intent |
|------|--------|--------|
| `src/components/video/VideoEditingInterface.tsx` | Add `playbackDrivenTimeUpdateRef = useRef<number>(Number.NEGATIVE_INFINITY)`. In `handleVideoTimeUpdate(currentTime)`, set `playbackDrivenTimeUpdateRef.current = currentTime` **before** calling `setTimelineCurrentTime`. | Stamp every playback-driven time write so the timeline-change handler can recognise it. |
| `src/components/video/VideoEditingInterface.tsx` | In `handleTimelineTimeChange(time)` (L1516–1530), early-return-after-mirror when `Math.abs(time - playbackDrivenTimeUpdateRef.current) < 0.05`: do `setTimelineCurrentTime(time)` but **skip** the `timelineComposition.handleCompositionSeek(time)` (composition mode) and `videoPlayback.handleTimeSeek(time)` (preview mode) calls. | Break the playback-driven re-seek feedback loop without affecting user-driven scrubs. Note: preview mode is also fixed by the same gate. |
| `src/components/video/VideoEditingInterface.tsx` | **(R2)** In the Space-key handler (L406–409), reset `playbackDrivenTimeUpdateRef.current = Number.NEGATIVE_INFINITY` immediately **before** invoking `ref.pauseFromTimeline()` *and* before invoking `ref.seekAndPlayFromTimeline(...)`. This guards against the case where playback paused at time `t`, the user later scrubs to a numerically-equal `t`, and the user-driven scrub would otherwise be misread as a playback echo. | Eliminates the stale-stamp footgun called out in §7 Risks #2; promotes the mitigation from documented-risk to coded-invariant. |
| `src/components/video/VideoEditingInterface.tsx` | Log discriminator decision at `debug` level (one line: `source: 'user'\|'playback'`, the timestamp deltas) so the loop can be diagnosed from logs if it ever returns. | Observability. |
| `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | In `handleCompositionSeek` (L1648–1839), replace every `wasPlayingBefore = isCompositionPlaying` read with `wasPlayingBefore = isCompositionPlayingRef.current`. There are three sites (line ~1709 same-source branch, the `loadeddata` listener at ~1738, and the audio sync at ~1812). Also replace the *logged* `wasPlayingBefore: isCompositionPlaying` at L1702 with the ref read. | Eliminate stale-closure reads so re-entry coherence does not depend on React render flushes. |
| `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | **(R3)** In `seekAndPlayFromTimeline` (L1976–2111), write `isCompositionPlayingRef.current = true` **synchronously** at the point where `setIsCompositionPlaying(true)` is currently called (in `commitSeekThenPlay`'s tail). Symmetrically, in `pauseFromTimeline`, write `isCompositionPlayingRef.current = false` synchronously alongside `setIsCompositionPlaying(false)`. The existing `useEffect([isCompositionPlaying])` mirror at L687 remains as a backstop for any other call site that mutates `isCompositionPlaying` directly. | Eliminates the one-tick `useEffect` delay that left the ref stale during the synchronous tail of Space-key dispatch. Required for the defence-in-depth short-circuit to be coherent on the very first `timeupdate`. |
| `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | **(R7)** In `handleCompositionSeek`'s same-source branch (L1776–1807), add a leading short-circuit: `if (source === 'timeline' && isCompositionPlayingRef.current && Math.abs(videoRef.current.currentTime - mappedVideoTime) < 0.1) { releaseSeekLock(); return; }`. | Defence-in-depth: any residual re-entry from the timeline side during playback is a strict no-op. The 0.1 s window is wider than the 0.05 s gate in `handleTimelineTimeChange` (so it catches sub-gate residuals) but narrow enough that legitimate user scrubs of ≥ 6 frames at 60 fps take effect. |
| `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | **(R5)** In `handleCompositionSeek`'s dep-list (currently L1839), remove **both** `isCompositionPlaying` and `compositionCurrentTime` since all relevant reads now go through refs (`isCompositionPlayingRef`, `compositionCurrentTimeRef` — the latter already exists at L1669). The logged `previousCompositionTime` at L1701 changes to `compositionCurrentTimeRef.current.toFixed(2)`. Verify the dep-list compiles under `react-hooks/exhaustive-deps` (use `// eslint-disable-next-line` only for ref-only reads, never for the actual deps). | Stability: callback identity stops thrashing on every play/pause and on every 4 Hz `timeupdate`; removes a class of micro-races where `useImperativeHandle` re-publishes mid-tick. |
| `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | (Optional, low-risk) In `seekAndPlayFromTimeline` (L1976–2111), at the very top, add `if (isCompositionPlayingRef.current) { /* idempotent: already playing → behave as scrub-while-playing via handleCompositionSeek path */ }`. Re-use the existing seek code, but ensure `setIsCompositionPlaying(true)` is **not** issued again (cheap state churn). | Make the public API safe to call when already playing. |
| `src/components/video/components/VideoPlayerPanel/__tests__/playheadResume.test.tsx` (existing, extend — **source-level regex assertions per R1**) | Append three `it()` cases that read `VideoPlayerPanel.tsx` source and assert: (a) `isCompositionPlayingRef.current = true` appears **synchronously** inside `seekAndPlayFromTimeline` (regex anchored on the function body slice), and `isCompositionPlayingRef.current = false` appears inside `pauseFromTimeline`; (b) the `handleCompositionSeek` body contains the short-circuit pattern `source === 'timeline'` && `isCompositionPlayingRef.current` && `Math.abs(...currentTime - mappedVideoTime) < 0.1`; (c) every occurrence of `wasPlayingBefore` inside `handleCompositionSeek` is sourced from `isCompositionPlayingRef.current`, not from `isCompositionPlaying` (assert via slice + regex). | Regression tests for the v3 gates, written in the existing `readFileSync + match` style. |
| `src/components/video/__tests__/videoEditingInterface.spaceKey.test.tsx` (existing, extend — **source-level regex assertions per R1**) | Append two `it()` cases that read `VideoEditingInterface.tsx` source and assert: (a) `handleVideoTimeUpdate` writes `playbackDrivenTimeUpdateRef.current = currentTime` *before* `setTimelineCurrentTime`; (b) `handleTimelineTimeChange` body contains the `Math.abs(time - playbackDrivenTimeUpdateRef.current) < 0.05` gate **before** the `handleCompositionSeek` / `handleTimeSeek` dispatches; (c) the Space-key handler resets `playbackDrivenTimeUpdateRef.current = Number.NEGATIVE_INFINITY` before invoking `pauseFromTimeline` / `seekAndPlayFromTimeline`. | Lock the v3 invariants into the regex test suite. |
| `docs/plans/timeline-playhead-resume-v3/spec.md` | This document (v2 post-review). | Source of truth for v3. |

No backend changes, no database changes, no public API changes. The internal `VideoPlayerPanelRef` shape is unchanged — only the **behaviour** of `handleCompositionSeek` under `source === 'timeline'` shifts.

## 4. Interface design

No public interface change. Two internal behavioural contracts are tightened:

### 4.1 `handleTimelineTimeChange` (internal)

```ts
// VideoEditingInterface.tsx
const playbackDrivenTimeUpdateRef = useRef<number>(Number.NEGATIVE_INFINITY);

const handleVideoTimeUpdate = useCallback((currentTime: number) => {
  playbackDrivenTimeUpdateRef.current = currentTime;   // ★ stamp BEFORE setState
  setTimelineCurrentTime(currentTime);
}, []);

const handleTimelineTimeChange = useCallback((time: number) => {
  setTimelineCurrentTime(time);
  const isPlaybackEcho =
    Math.abs(time - playbackDrivenTimeUpdateRef.current) < 0.05;
  if (isPlaybackEcho) {
    logger.debug('Timeline change is playback echo — skipping seek round-trip', {
      time: time.toFixed(2),
      lastPlaybackDrivenTime: playbackDrivenTimeUpdateRef.current.toFixed(2),
    });
    return;
  }
  // User-driven scrub: forward to the player.
  if (timelineComposition.compositionPlayback?.isCompositionMode) {
    timelineComposition.handleCompositionSeek(time);
  } else {
    videoPlayback.handleTimeSeek(time);
  }
}, [timelineComposition, videoPlayback, logger]);

// R2: Space-key handler resets the stamp so a user scrub to a value that
// happens to equal the last playback-driven tick is not misread as an echo.
useEffect(() => {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'Space') return;
    // ...existing input-field guard / ref guard unchanged...
    const isPlayingNow = ref.isPlaying?.() ?? false;
    playbackDrivenTimeUpdateRef.current = Number.NEGATIVE_INFINITY;   // ★ reset
    if (isPlayingNow) {
      void ref.pauseFromTimeline();
    } else {
      void ref.seekAndPlayFromTimeline(timelineCurrentTimeRef.current);
    }
  };
  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, [/* unchanged deps */]);
```

Notes:
- `playbackDrivenTimeUpdateRef` is mutated synchronously inside the React event handler, before any `setState`, so by the time the store subscription fires its async emit, the ref already holds the value to compare against.
- The 0.05 s epsilon mirrors the same value used by the drag-seek throttle (`VideoPlayerPanel.tsx` L965) and `useVideoPlayback.handlePlayPause` (R6 fix), keeping the codebase consistent.

### 4.2 `handleCompositionSeek` (internal)

Same signature; new leading short-circuit and ref-based `wasPlayingBefore`:

```ts
const handleCompositionSeek = useCallback(async (
  compositionTime: number,
  targetSequence: VideoSequenceItem,
  videoTime: number,
  source: 'timeline' | 'player' = 'player',
) => {
  if (!compositionPlayback || !videoRef.current) { /* existing early-out */ }

  const mappedVideoTime = mapTimelineTimeToVideoTime(targetSequence, videoTime);

  // v3 defence (R7): drop redundant playback echoes from the timeline side.
  // 0.1 s window — wider than the 0.05 s gate in handleTimelineTimeChange, narrower
  // than legitimate user scrubs (≥ 6 frames at 60 fps).
  if (
    source === 'timeline' &&
    isCompositionPlayingRef.current &&
    Math.abs(videoRef.current.currentTime - mappedVideoTime) < 0.1
  ) {
    logger.debug('handleCompositionSeek: timeline echo dropped', {
      delta: Math.abs(videoRef.current.currentTime - mappedVideoTime).toFixed(3),
      compositionTime: compositionTime.toFixed(2),
    });
    return;
  }

  // ...existing lockSeekUntilSeeked path unchanged...
  const wasPlayingBefore = isCompositionPlayingRef.current;   // ★ was: isCompositionPlaying
  // ...
}, [/* deps: drop isCompositionPlaying AND compositionCurrentTime — R5 */]);
```

The `wasPlayingBefore` read inside the `loadeddata` callback at L1738 and the audio resync at L1812 changes identically: read from the ref. The logged `previousCompositionTime` at L1701 reads from `compositionCurrentTimeRef.current` instead of `compositionCurrentTime` so that `compositionCurrentTime` can be dropped from the dep-list.

### 4.2a Synchronous ref writes in play/pause (R3)

```ts
// VideoPlayerPanel.tsx — seekAndPlayFromTimeline tail
isCompositionPlayingRef.current = true;     // ★ synchronous — closes the 1-tick window
setIsCompositionPlaying(true);
updateCompositionCurrentTime(timelineTime);
onCompositionPlayPause?.();

// VideoPlayerPanel.tsx — pauseFromTimeline body
isCompositionPlayingRef.current = false;    // ★ synchronous — symmetric
setIsCompositionPlaying(false);
```

The existing `useEffect([isCompositionPlaying])` at L687 remains as a backstop for any code path that mutates `isCompositionPlaying` without touching the ref (e.g., end-of-timeline auto-pause inside `handleVideoEnded`).

### 4.3 No change to `VideoPlayerPanelRef`

The public ref API (`handleCompositionSeek`, `seekAndPlayFromTimeline`, `pauseFromTimeline`, `isPlaying`, `handlePlayPauseFromTimeline`) is unchanged. Callers see no signature or semantic difference for user-driven seeks.

## 5. Data model

None. The fix is entirely in the React render tree, callback identity, and one new `useRef`. No Zustand slice shape changes, no IndexedDB persistence schema changes, no backend DTOs touched, no Alembic migrations.

For clarity, the involved in-memory shapes (defined in `src/components/video/types/`, unchanged):

- `CompositionPlayback { isCompositionMode, videoSequences[], audioSequences[], currentSequenceIndex, totalCompositionDuration, compositionCurrentTime }`
- `VideoSequenceItem { id, name, src, clipStart, clipEnd, duration, materialId, originalDuration, … }`
- Timeline store slice: `{ currentTime, totalDuration, zoomLevel, scrollLeft, tracks[], … }`

Invariant strengthened by v3: **after any user-driven seek (ruler scrub, end/home key, click-to-seek), `Timeline.currentTime`, `CompositionPlayback.compositionCurrentTime`, and `<video>.currentTime` converge to the same mapped value before the next `play()` call; once `play()` is in flight, only the `<video>` element drives the cursor — the timeline store is a slave, never a driver.**

## 6. Testing & acceptance criteria

### 6.1 Manual acceptance script

Reproduce on Chromium and Firefox. The original v2 acceptance script (`docs/plans/timeline-playhead-resume-playback/spec.md` §6.1) still applies; v3 adds:

1. Fresh project. Add one local video ≥ 10 s to `video-track-1`.
2. Drag the playhead to ~5 s. Press Space. → Playback **must** start from 5 s ±0.2 s, audio in sync, **and** the cursor must visibly tick forward from 5 s — it must **not** snap to 0 or to the start of the clip.
3. Add a second video clip immediately after the first (so total duration ≈ 20 s). Drag the cursor to ~12 s (mid-second-clip). Press Space. → Playback starts inside the second clip at the correct intra-clip offset; cursor advances from 12 s.
4. **Duplicate-material regression** (the specific failure mode of Defect A): add the *same* video file as clip #2 (so both clips share the same `src`/`materialId`). Drag the cursor into clip #2 (e.g., 13 s, given clip #1 = 0–10, clip #2 = 10–20). Press Space. → Playback starts at 13 s in clip #2, not at 10 s (clip #2 start) and not at 0 s (clip #1 start).
5. While playing, drag the cursor to a different time. → Cursor seeks correctly; playback continues from the new position (scrub-while-playing).
6. Press Space again. → Pause without seeking; `<video>.currentTime` is preserved exactly (verify in browser devtools).
7. Reload the project (forces hydration). Repeat step 2. → Same behaviour.
8. **(R6 — diagnostic aid, optional)** If the bug appears to recur, inspect dev logs during step 2 playback. Expect to see the `Timeline change is playback echo — skipping seek round-trip` debug line firing on every `timeupdate`. Expect `handleCompositionSeek: timeline echo dropped` to fire **zero or near-zero** times (it is defence-in-depth, not the primary gate; nonzero counts indicate the gate is leaking and warrant investigation). This step is *diagnostic*, not gating: acceptance pass/fail is decided by steps 1–7.

### 6.2 Automated tests (Vitest — source-level regex assertions, per R1)

The project's Vitest config sets `tsconfig.json` `jsx: 'preserve'` for the test target, which disables JSX-mounted React Testing Library. Every existing test file in `src/components/video/components/VideoPlayerPanel/__tests__/` and `src/components/video/__tests__/` uses the `readFileSync(...) + match(regex)` pattern; v3 follows the same convention. Runtime feedback-loop behaviour is verified via §6.1 manual acceptance.

Extend the two existing test files created in v2:

- **`playheadResume.test.tsx`** — append `describe('v3 follow-up fix', ...)` containing:
  - **(new)** Assert `seekAndPlayFromTimeline`'s body contains a synchronous `isCompositionPlayingRef.current = true` write (regex against the function-body slice between the `seekAndPlayFromTimeline = useCallback` line and its closing `}, [...])`); symmetrically `isCompositionPlayingRef.current = false` inside `pauseFromTimeline`.
  - **(new)** Assert `handleCompositionSeek`'s body contains the v3 short-circuit pattern: a conditional that checks `source === 'timeline'`, `isCompositionPlayingRef.current`, and `Math.abs(videoRef.current.currentTime - mappedVideoTime) < 0.1`, followed by an early `return`.
  - **(new)** Assert every `wasPlayingBefore` *initialization* inside `handleCompositionSeek` reads `isCompositionPlayingRef.current` (no occurrence of `wasPlayingBefore = isCompositionPlaying;` — the bare-state read — remains in the function body slice). Use regex `wasPlayingBefore\s*=\s*isCompositionPlayingRef\.current`.
  - **(new)** Assert `handleCompositionSeek`'s `useCallback` dep-list (the trailing `], )` of its definition) does **not** include `isCompositionPlaying` or `compositionCurrentTime` as bare identifiers.
  - **(existing v2 cases)** All continue to pass (no regression).
- **`videoEditingInterface.spaceKey.test.tsx`** — append `describe('v3 follow-up fix', ...)` containing:
  - **(new)** Assert `VideoEditingInterface.tsx` source contains `const playbackDrivenTimeUpdateRef = useRef<number>(Number.NEGATIVE_INFINITY)`.
  - **(new)** Assert `handleVideoTimeUpdate`'s body writes `playbackDrivenTimeUpdateRef.current = currentTime` *before* `setTimelineCurrentTime`. Verify ordering by `indexOf('playbackDrivenTimeUpdateRef.current = currentTime') < indexOf('setTimelineCurrentTime(currentTime)')` within the function-body slice.
  - **(new)** Assert `handleTimelineTimeChange`'s body contains the 0.05 s playback-echo gate: regex `Math\.abs\(\s*time\s*-\s*playbackDrivenTimeUpdateRef\.current\s*\)\s*<\s*0\.05`, and that the body's `return` for the echo branch appears *before* the `handleCompositionSeek(time)` and `handleTimeSeek(time)` dispatch lines.
  - **(new)** Assert the Space-key handler resets the stamp: within the keydown-handler slice, `playbackDrivenTimeUpdateRef.current = Number.NEGATIVE_INFINITY` appears before both `pauseFromTimeline()` and `seekAndPlayFromTimeline(`.

Slicing convention: locate each function definition by a unique anchor comment / identifier (e.g., `// 全局键盘事件处理` for the Space-key handler — same anchor used in v2's `spaceKey.test.tsx:27`); slice from anchor to the next sibling-level comment / identifier. Apply regex / `indexOf` to the slice, not the whole file.

### 6.3 Definition of done

- All manual acceptance steps pass on Chromium and Firefox.
- All v2 tests still pass.
- New v3 tests pass.
- `npm test` clean.
- `npm run type-check` clean.
- `npm run lint` clean (warnings allowed, no new errors).
- No backend test changes; backend untouched.
- Manual smoke: open a project with ≥ 3 clips, scrub-and-Space ten times across different cursor positions including duplicate-material positions; observe no cursor jumps.
- Browser performance: with devtools Performance panel recording during playback, the `handleCompositionSeek` callstack should fire **once per user scrub**, not on every `timeupdate`. The flame chart should show idle gaps between `timeupdate` events, not a sustained call storm.

## 7. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| The 0.05 s epsilon in `handleTimelineTimeChange` mis-identifies a *user* scrub that lands within 0.05 s of the last playback-driven time as a playback echo, silently dropping a legitimate seek. | Low (requires the user to drag to within 50 ms of where playback already is) | Low (the seek that drops is a no-op anyway — `<video>.currentTime` is already there) | Documented behaviour; epsilon kept consistent with the other 0.05 s guards in the codebase (drag throttle, `useVideoPlayback` short-circuit). |
| `playbackDrivenTimeUpdateRef` is never reset, so after a long playback session and a subsequent user scrub to the *same* numerical time, the scrub is misread as playback. | Low | Low (same as above — seek is no-op) | **Resolved (R2)** — reset wired into `VideoEditingInterface.tsx`'s Space-key handler before invoking `pauseFromTimeline()` / `seekAndPlayFromTimeline()`; see §3 change plan and §4.1 code listing. |
| `isCompositionPlayingRef.current` read inside `handleCompositionSeek` is stale relative to a `setIsCompositionPlaying(true)` that has not yet propagated through `useEffect`. | Low | Low | **Resolved (R3)** — `seekAndPlayFromTimeline` and `pauseFromTimeline` now write `isCompositionPlayingRef.current` **synchronously** before relinquishing the call stack (§3 change plan, §4.2a code listing). The `useEffect([isCompositionPlaying])` mirror at L687 remains as a backstop. |
| Defence-in-depth short-circuit (now 0.1 s window per R7) hides a legitimate timeline-source seek that lands very close to the current play position (e.g., automated agent-driven seek for highlight-jump). | Low | Low | Confine to `source === 'timeline'`. The `'player'` source path is unaffected. Agents that need to force a seek from any source can use `source === 'player'` or call `seekAndPlayFromTimeline` directly. Window tightened to 0.1 s in R7 to allow ≥ 6-frame user scrubs at 60 fps. |
| Removing `isCompositionPlaying` from `handleCompositionSeek`'s dep list inadvertently leaves another stale read elsewhere (audit risk). | Low | Medium | Code search for `isCompositionPlaying` inside the callback body before landing the dep change. The only reads are the three `wasPlayingBefore` sites listed in the change plan; the dep-list change is a no-op once those are migrated to the ref. |
| Existing v2 tests assume `handleCompositionSeek` is invoked on every `timeupdate` round-trip and now begin to fail. | Very Low (v2 tests assert ordering, not echo counts) | Low | Inspect v2 tests first; the v2 spec (§6.2) only asserts `play()` is called *after* `currentTime` is set, not the echo count. If any test does assert echo count, update it to the v3 contract. |
| Browsers that fire `timeupdate` at higher rates (e.g., requestVideoFrameCallback-backed) produce sub-0.05 s deltas that the epsilon still catches, but the loop is now bounded by `setState` (no leak). | Low | Low | Confirmed by the React `setState` skip-equal-value heuristic plus the epsilon in TimelinePanel's `externalCurrentTime` effect. |
| Future contributor adds a third path that calls `handleCompositionSeek` from the timeline side without going through `handleTimelineTimeChange`. | Medium (architectural drift) | Medium | Add a top-of-file JSDoc to `handleTimelineTimeChange` and `handleCompositionSeek` documenting the contract: "the `'timeline'` source is reserved for *user-initiated* scrubs; do not use for playback feedback." Plus the defence-in-depth no-op makes accidental misuse a silent no-op rather than a regression. |

## 8. Out of scope

- Replacing the `setInterval`-based mock in `useVideoPlayback.ts` with `requestAnimationFrame`. Long-standing tech debt; unrelated.
- Rewriting `handleTimeUpdate`'s sequence-resolution heuristic. Defect A's wrong-index reverse map is masked by v3's loop break; a deeper rewrite (e.g., letting the player carry a `currentSequenceId` ref) is a separate refactor. The v3 fix removes the *trigger*; the heuristic stays.
- End-of-timeline Space behaviour change (replay from 0). Unchanged (R7 from v2).
- Touch/mobile gestures. Mobile gated by `showMobileWarning`.
- Frame-accurate seek beyond `HTMLVideoElement.currentTime` native precision.

---

## 评审结论

**结论：通过 (approved)**

v3 设计正确诊断了 b83ad1a (v2) 修复未能根除的两个缺陷——播放反馈环 (Defect A) 与 `wasPlayingBefore` 闭包陈旧读取 (Defect B)——并以最小修改面 (`VideoEditingInterface.tsx` + `VideoPlayerPanel.tsx`，无后端 / 数据库变更) 给出收敛方案。审阅中识别的 5 个 P1 问题 (R1 测试约定不一致、R2 ref 重置遗漏在 §3、R3 ref 同步写、R4 与 v2 已有 index-sync 的关系阐释、R5 dep-list 完整去除) 与 3 个 P2 问题 (R6 日志硬依赖、R7 0.3 s 窗口过宽、R8 重置位置澄清) 已在本 v2 文档体内逐项落实：

- **§2.2.1** 已补充 v2 既有 `onSequenceIndexUpdate` / `setCompositionPlayback` 同步写为何在播放反馈环存在时仍不足以闭合竞态的论述 (R4)；
- **§3 文件 / 模块变更计划**补全 `playbackDrivenTimeUpdateRef` 在 Space 键处置时的重置入口 (R2)、`isCompositionPlayingRef` 的同步写入 (R3)、依赖列表中同时去除 `isCompositionPlaying` 与 `compositionCurrentTime` (R5)、防御窗口收紧至 0.1 s (R7)；
- **§4.1 / §4.2a** 新增对应的 TypeScript 代码片段；
- **§6.2** 完整重写为与项目 Vitest "源码正则" 测试约定一致的源码切片断言 (R1)；
- **§6.1** 第 8 步降级为可选诊断步骤 (R6)；
- **§7 Risks** 表已标注三条对应风险的状态为 "Resolved (R#)"。

无残留 P0 / P1 问题。实施时请按 §3 改动清单的精确文件 / 行号顺序施工，并按 §6.2 在两个既有 `*.test.tsx` 文件追加 v3 用例后跑 `npm test` / `npm run type-check` / `npm run lint` 验证 (§6.3 Definition of done)。

— Senior reviewer, 2026-05-11

---

**End of v3 spec (v2 post-review) — ready for implementation.**
