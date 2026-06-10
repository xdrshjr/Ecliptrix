# REVIEWER Re-Review — TODO 02 Sub-stage S3 (rework)

## Meta
- **Role:** REVIEWER (Three-Powers)
- **Agent:** google-reviewer-01
- **Task:** todo-02-s3-rework
- **Phase:** 2
- **Verdict:** **PASS**

This is the focused re-review of google-dev-01's rework of the three issues the
tester found (BUG 1 scrub-while-paused, BUG 1b transport, RISK 2 embedded audio).
In the first review I returned PASS WITH FIXES and missed the scrub-while-paused
dead guard; this pass re-verifies each fix against the code, the spec, and the
tests, and re-checks the S2 invariants for regression.

## Key Decisions (review conclusions)

1. **All three fixes are correct, complete, and test-pinned.** No half-fix, no new
   dead code, no new stubs/TODO/FIXME, no empty catches on critical paths.
2. **No regression to S2 invariants.** The `muteAudio` addition is an independent
   per-frame property; it does not touch RC-B (compare==assign) nor the
   `VIDEO_SEEK_TOLERANCE_SEC` de-bounce.
3. **Scope preserved.** Nothing deleted; v1 byte-unchanged; the `embeddedVideoAudio`
   group kind retained (dead only on the live path, kept until S4 per checklist #9).
4. **S4 checklist correction (item 8 — `useRemoteMaterialPrefetch.ts`) is present**
   and the code reference it names genuinely exists.

## Per-Fix Verification (with evidence)

### BUG 1 — scrub-while-paused dead guard — CORRECT
- The render body still writes `currentTimeRef.current = currentTime`
  (`useCompositionPlayback.ts:307`), but the scrub guard now reads a SEPARATE
  `lastSeekedTimeRef` (`:279`, guard at `:440-441`). The render-body write can no
  longer pre-satisfy the guard — root cause eliminated.
- `lastSeekedTimeRef` is updated ONLY after a seek fires: in `seek()` (`:407`), in
  the scrub effect itself (`:442`), and in the facade `setCurrentTime` (`:340`).
- **Prop-driven PAUSED scrub past epsilon → `engine.seek(t)`**: guard
  `last !== null && |last - currentTime| < 1e-6` is false → seek fires. Pinned:
  `useCompositionPlayback.probe.test.tsx:275-283` (`seek(5)`).
- **Within epsilon → no seek**: pinned `probe.test.tsx:285-292`.
- **Self-originated clock update does NOT re-seek (no clock fight)**: the engine's
  `setCurrentTime` marks `lastSeekedTimeRef` so the same value flowing back as the
  `currentTime` prop is short-circuited. Pinned `probe.test.tsx:294-306`.
- `MultiTrackPlaybackEngine.seek()` (`MultiTrackPlaybackEngine.ts:186-200`)
  preserves phase (`wasPlaying` → restart clock + 'playing'; else paint paused),
  so the single scrub effect correctly serves both paused-scrub and playing-scrub.

### BUG 1b — transport did not drive the new engine — CORRECT
- New prop-driven `isPlaying` option (`useCompositionPlayback.ts:226`) + transport
  effect (`:418-427`): `isPlaying` true → `engine.play()`, false → `engine.pause()`.
- Panel passes `isPlaying: isCompositionPlaying` (`VideoPlayerPanel.tsx:551`) —
  reuses the existing transport state; **no new imperative play/pause calls** to the
  new engine. `engine.play()` is idempotent (`MultiTrackPlaybackEngine.ts:167`).
- Pinned: `probe.test.tsx:333-341` (false→paused, true→playing, false→paused).

### RISK 2 — embedded (non-detached) video audio was silent — CORRECT
- **Per-frame mute is pool-owned.** `computeSourcePlan` sets
  `muteAudio: hit.clip.audioDetached === true` (`VideoSourcePool.ts:181`); idle plan
  forces `muteAudio: true` (`:197`). Applier sets `el.muted = plan.muteAudio`
  (`:311`) on the active path and `el.muted = true` on idle (`:299`).
- (a) **Non-detached video track → decode element UNMUTED** (embedded audio audible):
  truth-table `VideoSourcePool.test.ts:219-223` (plan false) + applier `:353-363`.
- (b) **Detached video track → decode element MUTED and paired independent audio
  plays → no double audio:** plan `:225-231` (true) + applier `:365-377`. The audio
  side: `buildAudioSyncGroups` now emits ONLY independent `'audio'` groups
  (`useCompositionPlayback.ts:110-144`); the detached audio sequence is an
  independent track that the AudioSyncPool plays. No live path produces double audio.
- (c) **Idle/no-clip → muted:** plan `:233-237` + applier `:379-389`.
- `buildAudioSyncGroups` no longer takes `videoSequences` and no longer emits
  `embeddedVideoAudio` groups (diff confirmed; facade call updated at `:326-327`).
  Matches spec 02 §2.5 and spec 01 §2.4: detached → video silent + audio track
  sounds; not-detached → video's own decode source carries the audio.

## S2-Invariant Regression Check — PASS (no entanglement)

- **RC-B compare==assign:** `needsSrcSwap` is still computed purely from
  `normalizeSrc(currentSrc) !== normalizeSrc(desiredUrl)` (`VideoSourcePool.ts:162`)
  and the applier assigns exactly `plan.desiredUrl` only when `needsSrcSwap`
  (`:304-307`). `muteAudio` is computed/applied as a SEPARATE field (`:181`, `:311`)
  and is read nowhere in the swap or seek decision. Pinned `VideoSourcePool.test.ts:266-281`.
- **`VIDEO_SEEK_TOLERANCE_SEC` de-bounce:** `needsSeek` (`:167-169`) and
  `_ensureSeeked` (`:331-346`) are unchanged; `_ensureSeeked` is still called with
  `plan.needsSrcSwap`, not the mute. Pinned `:296-308` (no re-seek within tolerance).
- `muted?` is added as an OPTIONAL field on `VideoElementLike` (`:50-57`) so existing
  fakes/real elements remain structurally valid (type-check clean).

## Completeness / Scope / Standards

- **Files ≤ 800 / methods ≤ 50:** hook 448, VideoSourcePool 371, PreviewCanvas 248 —
  all within budget. `VideoPlayerPanel.tsx` is 3412 lines (over 800) but is the
  pre-existing v1 file; the D10 split is explicitly S4 (spec §2.8 / dev checklist
  #2). The rework added only ~3 lines (`isPlaying:` prop) to it — not a new debt.
- **No stubs / TODO / FIXME / empty catch:** none in the hook; every catch in
  VideoSourcePool / the hook attach path is scoped + commented (benign jsdom/decode
  or interrupted-play() promise). Acceptable per clean-code §五.
- **Probe test asserts CORRECT behavior:** the BUG-documenting test was rewritten
  into three correctness tests (`probe.test.tsx:251-307`) — it now fails if the
  paused scrub stops seeking, exactly the regression the tester caught.
- **Scope = S3, nothing deleted, v1 untouched:** VideoPlayerPanel diff is the v2
  branch only (imports, `MOUNT_LEGACY_V2_SURFACE=false`, hook call, render swap).
  `embeddedVideoAudio` kind retained in `AudioSyncPool.ts:53,136` + `types.ts` and
  still directly constructed by `MultiTrackPlaybackEngine.test.ts:335-343` — dead on
  the live path only, kept until S4 (checklist #9). Confirmed not deleted now.
- **S4 checklist item 8:** `useRemoteMaterialPrefetch.ts` does call
  `isPlaybackV2Enabled()` (`:43`, `:435`); the dev correctly added it to the S4
  checklist (summary items 8 + the "Corrected S4 checklist line").

## Verification Commands Run

- `npm run type-check` → clean.
- `npx vitest run useCompositionPlayback.probe.test.tsx useCompositionPlayback.test.tsx VideoSourcePool.test.ts`
  → **3 files, 49 tests passed.**
- `npx vitest run AudioSyncPool.test.ts MultiTrackPlaybackEngine.test.ts`
  → **2 files, 27 tests passed** (audio routing + detached-no-double-audio regression intact).

## Issues & Risks

- **No new issues found.** All three fixes are correct and complete.
- **Desktop-only residue (unchanged, accepted):** actual audible sound, real
  multi-`<video>` decode/seek, and on-canvas raster remain jsdom-invisible; the
  routing LOGIC (mute truth table, no-double-audio, scrub→seek, transport) is
  unit-pinned. These stay desktop-walkthrough items, as the dev's summary states.
- **Carry-forward (not S3):** `VideoPlayerPanel.tsx` D10 split + deletion of the
  `embeddedVideoAudio` kind and the legacy v2 surface are S4 work, correctly
  scheduled.

## Context for Downstream

- The new compositor path now correctly: (1) repaints on a paused prop-driven
  scrub, (2) plays/pauses prop-driven from the panel transport state, and (3) routes
  embedded audio through the decode `<video>` mute (non-detached audible, detached
  muted with the paired audio track sounding). S4 can proceed to make this the sole
  path and execute the deletion checklist (including the corrected item 8 and the
  item-9 `embeddedVideoAudio` removal once its engine test is updated).
- The S2 invariants (RC-B compare==assign, seek de-bounce) are confirmed intact, so
  the export (05) filtergraph mirroring the z/opacity/transition/detach semantics is
  unaffected by this rework.

## SUMMARY

PASS. The rework correctly fixes all three issues with no regression to the S2
invariants and no scope creep. BUG 1 is genuinely dead-guard-free (separate
`lastSeekedTimeRef`, render-body write can no longer pre-satisfy it, self-originated
clock updates do not re-seek); BUG 1b drives the engine prop-driven with no
imperative panel calls; RISK 2 routes embedded audio through the decode element's
per-frame mute, keeping "no double audio" for detached tracks while making
non-detached embedded audio audible. The probe test asserts the corrected behavior.
type-check clean; 76 relevant tests green.
