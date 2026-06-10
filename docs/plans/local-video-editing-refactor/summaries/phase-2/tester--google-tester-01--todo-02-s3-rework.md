# TESTER Re-Test — TODO 02 Sub-stage S3 (rework)

## Meta
- **Role:** TESTER (Three-Powers)
- **Agent:** google-tester-01
- **Task:** todo-02-s3-rework
- **Phase:** 2
- **Verdict:** **ALL PASS**

Focused re-test of google-dev-01's rework of the three issues I found in S3
acceptance (BUG 1 scrub-while-paused dead guard, BUG 1b transport not driving the
new engine, RISK 2 embedded non-detached audio silent). I judged independently of
the reviewer's PASS: I re-derived each fix from the code, ran every relevant
suite, and ran a mutation experiment proving the scrub test pins the fix (not
edited to pass). All three fixes are correct, complete, test-pinned, with no
regression to the S2 invariants and no weakening of the no-double-audio property.

## Key Decisions (test conclusions)

1. **BUG 1 (scrub-while-paused) is genuinely dead-guard-free.** The scrub effect's
   guard reads a SEPARATE `lastSeekedTimeRef` (`useCompositionPlayback.ts:440`),
   updated ONLY after a seek fires (in `seek()` `:407`, in the scrub effect `:442`,
   and in the facade `setCurrentTime` `:340`). The render-body write
   `currentTimeRef.current = currentTime` (`:307`) can no longer pre-satisfy it.
   **Mutation-proven** (see Execution Flow): reverting the guard to `currentTimeRef`
   makes the "paused scrub past epsilon" probe FAIL with 0 seek calls — exactly the
   bug I originally found. The test is load-bearing, not cosmetic.
2. **BUG 1b (transport) drives the engine prop-driven.** New `isPlaying` option
   (`:226`) + transport effect (`:418-427`): true → `engine.play()`, false →
   `engine.pause()`. Panel passes `isPlaying: isCompositionPlaying`. No imperative
   panel calls. Pinned `probe.test.tsx:333-341`.
3. **RISK 2 (embedded audio) routes per-frame mute through VideoSourcePool.**
   `computeSourcePlan` sets `muteAudio = hit.clip.audioDetached === true` (`:181`),
   idle forces `muteAudio: true` (`:197`); applier sets `el.muted = plan.muteAudio`
   (`:311`), idle `el.muted = true` (`:299`). Non-detached → unmuted (audible);
   detached → muted (paired audio track sounds); idle → muted. `buildAudioSyncGroups`
   now emits ONLY independent `'audio'` groups (dropped the `videoSequences` param +
   `embeddedVideoAudio` construction). Truth table + applier pinned in
   `VideoSourcePool.test.ts:218-389`.
4. **No-double-audio NOT weakened by the routing change — pinned at TWO layers.**
   New live path: VideoSourcePool mutes a detached decode element
   (`VideoSourcePool.test.ts:365-377`). Legacy path retained until S4:
   `MultiTrackPlaybackEngine.test.ts:317-355` + `AudioSyncPool.test.ts:123/252-269`
   still assert a detached video track's embedded audio stays paused. All green.
5. **No regression to S2 invariants.** RC-B compare==assign and the
   `VIDEO_SEEK_TOLERANCE_SEC` de-bounce are independent of `muteAudio` (read nowhere
   in the swap/seek decision) and remain green.

## Per-Fix Behavioral Confirmation

| Fix | Behavior asserted | Evidence | Result |
|-----|-------------------|----------|--------|
| BUG 1 | paused scrub past epsilon → `engine.seek(t)` fires | `probe.test.tsx:275-283` | PASS |
| BUG 1 | scrub within epsilon → no re-seek | `probe.test.tsx:285-292` | PASS |
| BUG 1 | self-originated clock update (engine → currentTime prop) → no re-seek (no clock fight) | `probe.test.tsx:294-306` | PASS |
| BUG 1 | render-body `currentTimeRef` write does NOT pre-satisfy the guard | mutation experiment (revert → FAIL) | PROVEN |
| BUG 1b | `isPlaying` false→play(false)/pause, true→play, false→pause | `probe.test.tsx:333-341` | PASS |
| RISK 2 | non-detached active clip → `muteAudio:false`, applier unmutes | `VideoSourcePool.test.ts:219-223,353-363` | PASS |
| RISK 2 | detached active clip → `muteAudio:true`, applier mutes; paired audio track plays | `VideoSourcePool.test.ts:225-231,365-377` | PASS |
| RISK 2 | idle track → `muteAudio:true`, applier mutes | `VideoSourcePool.test.ts:233-237,379-389` | PASS |
| RISK 2 | `buildAudioSyncGroups` emits independent `'audio'` only | `useCompositionPlayback.ts:110-144` + hook test | PASS |

## Regression-Check Result

- **RC-B compare==assign:** `needsSrcSwap` computed purely from
  `normalizeSrc(currentSrc) !== normalizeSrc(desiredUrl)` (`VideoSourcePool.ts:162`);
  applier assigns exactly `plan.desiredUrl` (`:306`). `muteAudio` is a separate field,
  read nowhere in the swap. Pinned `VideoSourcePool.test.ts:88-132`. **GREEN.**
- **Seek de-bounce (`VIDEO_SEEK_TOLERANCE_SEC`):** `_ensureSeeked` unchanged, called
  with `needsSrcSwap` not mute. Pinned `VideoSourcePool.test.ts:134-164,296-308`.
  **GREEN.**
- **No-double-audio for DETACHED tracks:** `MultiTrackPlaybackEngine.test.ts:355`
  + `AudioSyncPool.test.ts:269` (legacy suppression) + `VideoSourcePool.test.ts:377`
  (new mute). **GREEN — strengthened, not weakened.**

## Tests Run (counts)

| Command | Result |
|---------|--------|
| `vitest run` probe + hook + VideoSourcePool (changed files) | **3 files, 49 passed** |
| `vitest run` multiTrackCompositorS2Boundaries + MultiTrackPlaybackEngine + AudioSyncPool (S2 RC-B regression) | **3 files, 43 passed** |
| `npm run type-check` | **clean** |
| `vitest run src/components/video` (full suite) | **110 files, 930 passed** (≥930, no regression) |
| Mutation experiment: revert guard `lastSeekedTimeRef`→`currentTimeRef`, run probe | **1 FAILED** (paused-scrub seek not called) — confirms fix is real, then restored → 49 passed |

(jsdom "Not implemented: HTMLMediaElement load/pause" lines are environment stubs,
not failures.)

## Execution Flow

1. Read the dev summary `## Rework (S3 fix)`, the reviewer's `## Meta` verdict
   (PASS), spec 02 §2.5, spec 01 §2.4 (audioDetached).
2. Read the changed source (`useCompositionPlayback.ts`, `VideoSourcePool.ts`) and
   the changed tests (`probe`, `VideoSourcePool.test.ts`) — re-derived each fix from
   the code, not from the summary.
3. Ran all four required suites + type-check → 49 / 43 / clean / 930 all green.
4. INDEPENDENT VERIFICATION: backed up the hook, reverted the scrub guard to the
   buggy `currentTimeRef` form, re-ran the probe → "paused scrub past epsilon" FAILED
   with 0 seek calls (the exact dead-code behavior I originally reported). Restored
   the correct version; re-ran the changed suite → 49 passed (no residue).
5. Verified the no-double-audio property is pinned at both the legacy AudioSyncPool
   layer (engine + pool tests) and the new VideoSourcePool mute layer; confirmed the
   routing change did not delete or weaken the legacy suppression (retained until S4).
6. Confirmed RC-B + seek de-bounce green and independent of the new `muteAudio` field.

## Spec Traceability (delta only)

- **Scrub/seek:** spec 02 §2.6 RC-B "比对键==赋值" + the readiness gate; a paused
  prop-driven scrub now repaints via `engine.seek` — matches §2.1 "合成时钟唯一" (the
  parent cursor drives the engine, no clock fight). **Traced.**
- **Transport:** §2.1 single composition clock; `isPlaying` prop drives play/pause
  with no imperative panel calls. **Traced.**
- **Audio routing:** spec 02 §2.5 line 144 "视频轨自带音频：未 detach 时由视频解码源出声；
  已 detach 则静音视频轨、改由音频轨出声（消费 spec 01 audioDetached，避免重复出声）" and spec 01
  §2.4 line 119 "标记原视频 item.audioDetached=true（合成/导出据此对其视频轨静音，避免重复出声）".
  The VideoSourcePool per-frame mute (non-detached unmuted, detached muted) +
  independent-only AudioSyncPool exactly implements this. **Traced.**
- **Desktop-only items unchanged:** §6 cases 6/7 (import MP4 → play, no black screen;
  patch-after-insert) and case 10 audible remain desktop-walkthrough — the routing
  LOGIC is unit-pinned, the actual audible sound / real multi-`<video>` decode-seek /
  on-canvas raster are jsdom-invisible. **No change vs prior S3 residue.**

## Artifacts

- Verified source: `src/components/video/hooks/useCompositionPlayback.ts`,
  `src/components/video/playback/VideoSourcePool.ts`,
  `src/components/video/components/VideoPlayerPanel/PreviewCanvas.tsx` (mute-ownership
  comment), `VideoPlayerPanel.tsx` (`isPlaying` wiring).
- Verified tests: `useCompositionPlayback.probe.test.tsx` (8 tests — scrub correct +
  transport), `useCompositionPlayback.test.tsx`, `VideoSourcePool.test.ts` (muteAudio
  truth table + applier), `MultiTrackPlaybackEngine.test.ts` + `AudioSyncPool.test.ts`
  (no-double-audio regression), `multiTrackCompositorS2Boundaries.test.ts` (RC-B).
- This summary: `…/summaries/phase-2/tester--google-tester-01--todo-02-s3-rework.md`.

## Issues & Risks (remaining desktop-only items)

- **No new issues.** All three fixes are correct, complete, and test-pinned. No new
  stubs/dead code on the live path; the probe test asserts CORRECT behavior (rewritten
  from the BUG-documenting test).
- **Desktop-only residue (accepted, unchanged):** real audible sound, real concurrent
  multi-`<video>` decode/seek/`seeked`, image overlay on-canvas raster remain
  jsdom-invisible — covered by the routing/mute/scrub/transport LOGIC at unit level,
  pending the Electron desktop walkthrough (§6 cases 6/7/10-audible).
- **Carry-forward to S4 (not S3, correctly scheduled):** the `embeddedVideoAudio`
  group kind is dead on the live path (kept until S4 per checklist #9, still directly
  constructed by `MultiTrackPlaybackEngine.test.ts:335-343` — update/drop that test in
  S4); `VideoPlayerPanel.tsx` D10 split + legacy v2-surface/flag deletion; S4 checklist
  item 8 (`useRemoteMaterialPrefetch.ts` calls `isPlaybackV2Enabled()`) is correctly
  recorded.

## Context for Downstream (S4)

- The new compositor path is behaviorally correct on the v2 branch: (1) repaints on a
  paused prop-driven scrub, (2) plays/pauses prop-driven from the panel transport
  state, (3) routes embedded audio through the decode `<video>` per-frame mute
  (non-detached audible, detached muted with the paired audio track sounding). S4 can
  make this the sole path and execute the deletion checklist.
- The S2 invariants (RC-B compare==assign, seek de-bounce) and the no-double-audio
  property are confirmed intact, so export (05) mirroring the z/opacity/transition/
  detach semantics is unaffected by this rework.
- When S4 removes the `embeddedVideoAudio` kind, update
  `MultiTrackPlaybackEngine.test.ts:317-355` (it currently constructs that kind
  directly to pin legacy suppression). The new-path no-double-audio guarantee then
  rests on `VideoSourcePool.test.ts:365-377` + `AudioSyncPool.test.ts` independent
  tracks — both retained.
- The desktop walkthrough must still verify the audible/raster items above before S4
  declares the compositor production-ready.
