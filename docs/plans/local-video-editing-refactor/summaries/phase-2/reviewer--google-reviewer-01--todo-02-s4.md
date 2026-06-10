# REVIEWER Summary — TODO 02 Sub-stage S4 (G3 delete v1 + flag, sole compositor path, D10 split)

## Meta
- **Role:** REVIEWER
- **Task:** todo-02-s4
- **Phase:** 2
- **Verdict:** PASS WITH FIXES (low-severity cleanup only; no blocker)

S4 is the FINAL, irreversible G3 deletion: it removes the v1 inline `<video>`
player + ALL playback-v2 feature-flag machinery, makes PreviewCanvas +
useCompositionPlayback + MultiTrackPlaybackEngine the SOLE preview path (no v1
fallback), and splits VideoPlayerPanel.tsx (3412 → 697 lines) along three clean
seams. I verified deletion completeness, KEEP-list integrity, the sole-path
mount, the unchanged Ref contract, the Phase-B pure-refactor fidelity, and
test-deletion appropriateness with grep + type-check + targeted vitest.

## Key Decisions (review stance)

1. **Sole-path mount is correct and unconditional.** PreviewCanvas mounts inside
   the composition branch bound to `compositionPreview.hostRef`;
   `useCompositionPlayback({ enabled: true })` is called with no flag fork. The
   only remaining UI gate (`playbackMode === 'composition' && videoSequences.length > 0`
   vs the placeholder) is the legitimate empty-timeline path, NOT a v1/v2 fork.
2. **Ref contract is byte-for-byte preserved.** Old and new `useImperativeHandle`
   expose the identical 5 methods with identical deps; the parent
   (`VideoEditingInterface` spacebar L374-393 + timeline-click L431) drives them
   unchanged. Verified at both ends.
3. **Phase B is a true pure refactor.** I diffed the three extractions against the
   deleted inline originals (HEAD blob): aspectRatios identical 5-entry table;
   imageOverlays identical selection logic (only verbose logger.debug calls
   replaced by an `onMissing` callback — not behavior); transport preserves the
   readiness gate (incl. the spacebar-bypass-hole guard) and prop-driven seek.
4. **usePreviewTransport faithfully replaces useVideoPlayback.** The ONLY dropped
   behavior is the v1 mock 1s-tick simulator, which ran `if (playbackV2Enabled) return;`
   — i.e. only on the now-removed v1 path, against `mockVideoPreview.duration`
   fixture data. Real state (volume/play/seek/quality/fullscreen/formatTime +
   cursor-seed-on-play) is all retained. Dropping the simulator is correct.

## Execution Flow (verification)

1. Read S3 + S4 dev summaries, spec §2.7 (delete vs KEEP table) / §2.8 (split),
   global-context 勿删 list.
2. Confirmed 5 source modules deleted (`git status`): PlaybackEngine.ts,
   killswitchMonitor.ts, PlaybackVariantSwitcher.tsx, PreviewSurface.tsx,
   useVideoPlayback.ts (+ the matching v1/flag test files).
3. Deletion-completeness grep across `src/` for every removed symbol — all hits
   are negative test assertions / comments / orphaned type-only decls.
4. Read VideoPlayerPanel.tsx (697) + the 3 extracted modules + usePreviewTransport,
   diffed extractions against HEAD inline originals.
5. Diffed playbackFlags.ts, useRemoteMaterialPrefetch.ts, AudioSyncPool.ts,
   playback/index.ts, hooks/index.ts, VideoEditingInterface.tsx.
6. `npx tsc --noEmit` → exit 0. Targeted vitest (10 files / 80 tests) green;
   full `src/components/video` (100 files / 825 tests) green.
7. Verified file caps (all ≤800) + no introduced TODO/FIXME/stub.

## Findings

### Deletion completeness — PASS (with one low-sev residue)
- grep `isPlaybackV2Enabled|tripPlaybackV2KillSwitch|PlaybackVariantSwitcher|killswitchMonitor|KillSwitchMonitor|useVideoPlayback|PreviewSurface`
  over `src/` → only `not.toMatch` guards in solePath.test.tsx, doc/comment
  mentions in usePreviewTransport/useCompositionPlayback, and orphaned type-only
  decls in types.ts/index.ts. ZERO live runtime refs.
- grep `ecliptrix-playback-v2|STORAGE_KEY|SESSION_REMOTE_KEY|KILL_SWITCH_KEY|VARIANT_OVERRIDE_KEY|playback-flag`
  → all unrelated (`useTasks`, `localAudioManager`, settings) EXCEPT one residue
  (below). No flag-key string lingers in playbackFlags.ts.
- VideoPlayerPanel: no `v2OverlaysProvider|playbackEngineRef|killSwitchMonitorRef|MOUNT_LEGACY_V2_SURFACE|OverlayPayload|<video` — all gone.

### KEEP-list (勿删) — PASS (fully intact)
- `proxyHitMeter.ts` present; still referenced (comment + barrel + types + own
  test). NOTE its only live runtime consumer was `PlaybackEngine.attachActiveMaterial`,
  now deleted, so it is currently runtime-orphaned — but the spec/global-context
  MANDATE keeping it ("勿删"), so leaving it is spec-correct (cleanup is a future
  call "after confirming no refs").
- `PREVIEW_PROXY_FLAG_KEY` (`ecliptrix-preview-proxy`) + `LOCAL_PREVIEW_FLAG_KEY`
  (`ecliptrix-local-preview`) + `isPreviewProxyEnabled` / `isLocalPreviewEnabled`
  intact and working; consumed by the locked resolver options + the prefetch
  preview-proxy trigger (decoupled, untouched).
- `selectPlaybackUrl`, `resolveSequencePlaybackUrl`, `useTimelineComposition`,
  `CompositionAdapter`, MultiTrackPlaybackEngine + all S1/S2/S3 compositor
  modules untouched. `useVideoCache`/`VideoCacheAdapter` correctly left intact
  (thumbnail/timeline-cache concern, not v1-player) — only the dead window
  prefetch wiring in useRemoteMaterialPrefetch was removed.

### Sole-path mount + Ref contract — PASS
- `enabled: true` unconditional; PreviewCanvas bound to `compositionPreview.hostRef`;
  no flag gate. Editor type-checks + the full video suite mounts green.
- VideoPlayerPanelRef shape unchanged; parent drives it identically (spot-checked
  both call sites). No parent-facing regression.

### Phase-B pure refactor — PASS (no drift detected)
- aspectRatios.ts / imageOverlays.ts / useCompositionTransport.ts each match the
  deleted inline logic; dropped content is debug-logging + the v1 `<video>` path,
  not behavior. `aspectRatioToNumber` → `number | undefined` matches the
  hook's `aspectRatio?: number` viewport contract.

### useRemoteMaterialPrefetch / AudioSyncPool — PASS
- v2 branch + dead `preloadSequenceWindow` removed; preview-proxy trigger
  preserved. `'embeddedVideoAudio'` kind fully removed — no live emitter/consumer
  remains (only comments).

### Test-deletion appropriateness — PASS
- Deleted tests were all v1/flag-only (PlaybackEngine.*, killswitchMonitor,
  PreviewSurface.v2, v2.smoke, featureFlagBranch, playheadResume, reentry,
  localPreview/previewProxy panel tests pinning deleted v1 internals,
  playbackFlags.{test,killswitch,variantOverride}). Confirmed the deleted
  `playbackFlags.test.ts` tested only `isPlaybackV2Enabled`.
- SURVIVING preview-proxy/local-preview coverage KEPT, not silently dropped:
  `playbackFlags.{previewProxy,localPreview}.test.ts`, `selectPlaybackUrl.previewProxy`,
  `useRemoteMaterialPrefetch.previewProxy`, `useTimelineComposition.localPreview`,
  `CompositionAdapter.localPreview`, `VideoCutModal.localPreview`. The two updated
  flag tests dropped ONLY the v2-killswitch-independence case (referenced deleted
  fns); all proxy/local default-ON/override/key cases retained.
- solePath.test.tsx is a substantive invariant guard (unconditional mount, no
  residue, KEEP flags, handle delegation, 800-line cap), not a rubber-stamp.

## Issues & Risks

| Sev | File:line | Issue | Fix |
| --- | --- | --- | --- |
| LOW | `src/components/video/playback/internal/constants.ts:47` (+ `VISIBILITY_RESUME_MAX_MS:11`, `DRIFT_SOFT_MS:14`, `DRIFT_HARD_MS:17`, `DRIFT_SOFT_RATE_DELTA:20`, `DRIFT_HARD_TRIP_COUNT:23`, `DRIFT_SAMPLE_INTERVAL_MS:26`, `PREPARING_TIMEOUT_MS:29`) | `KILL_SWITCH_LS_KEY = 'ecliptrix-playback-v2-killswitch'` + several v1/v2-engine drift constants are now fully dead (0 non-definition refs — their only consumers were the deleted PlaybackEngine/killswitchMonitor). This is exactly the "removed flag key" string the S4 checklist asks to grep for, left in a different file than playbackFlags.ts. ADAPTIVE_* in the same file are still live (CanvasCompositor) — keep those. | Prune the dead constants (zero runtime/type impact). Out of the strict §2.7 deletion table (which names playbackFlags.ts, not constants.ts), so non-blocking; bundle into the 06 tidy-up or a standalone cleanup commit. |
| LOW | `src/components/video/playback/types.ts` + `playback/index.ts:64,58-77` | Type-only orphans `IKillSwitchMonitor`, `IPlaybackEngine`, `PlaybackEngineAttachDeps`, `PlaybackTimelineFacade` have 0 refs anywhere (DEV decision 5 claims they're "still referenced by surviving AbBufferController/CanvasCompositor tests" — that is true ONLY for `PlaybackSequenceResolver`/`OverlayPayload`, which ARE still used and correctly kept; it is NOT true for these four). | DEV explicitly scoped this out + disclosed it in S4 Issues. Prune in the future tidy-up once it carries no risk. Non-blocking. |
| INFO | `src/components/video/lib/selectPlaybackUrl.ts:236-238` | Comment cites `PlaybackEngine.attachActiveMaterial` as "the single canonical point for proxy-tier hit-rate accounting" — now a dangling doc ref (PlaybackEngine deleted). Pre-existing, file unchanged by S4 (out of scope). | Doc-rot; fix opportunistically. |

### The no-fallback reality (load-bearing for downstream)
There is NO v1 path to diff against or roll back to. Everything jsdom CANNOT
verify is now ONLY verifiable by the desktop walkthrough: real GPU canvas
compositing, N-concurrent `<video>` decode, real `seeked` A/V sync, on-canvas
image raster, embedded-vs-detached audio routing (decode-`<video>` mute), the
felt behavior of spacebar/scrub/progress-seek driving the prop-driven engine,
patch-after-insert refresh, and the readiness-gate toast. The dev's §"Desktop
walkthrough" (8 cases) is mandatory before this ships. Unit/source tests pin the
WIRING; they cannot pin the PIXELS or the AUDIO.

## Context for Downstream (Phase 3)

- **05 (export parity):** S4 did not alter the transition / z-order / opacity /
  audio-detach semantics. The export filtergraph must mirror the SAME routing the
  compositor now uses as its sole path: a detached video track is muted at the
  decode element and its paired independent `'audio'` sequence carries the sound
  (AudioSyncPool owns `kind:'audio'` ONLY). Cross-check preview-vs-export here.
- **06 (persistence + cache GC):** the editor now mounts ONLY the compositor — no
  v1 audio pool / videoCache window prefetch to persist/GC around. Three doc/code
  sync items belong here (or standalone commits): (a) the CLAUDE.md playback-v2
  paragraph still describes the removed flag (orchestrator-owned; DEV did NOT edit
  CLAUDE.md per task split); (b) the backend `/api/config/playback-flag` route is
  now unconsumed by the frontend — taking it down is a 06 call; (c) the LOW-sev
  dead `constants.ts` keys + `types.ts` type orphans above.

## Verdict

**PASS WITH FIXES.** The deletion is complete and correct, the KEEP-list is fully
intact, the sole-path mount + Ref contract are verified, Phase B is a faithful
pure refactor with no behavior drift, and test deletions are appropriate with
preview-proxy/local-preview coverage preserved. type-check clean; video suite
825/825 green. The only findings are LOW-severity dead-code residue in
`constants.ts`/`types.ts` (out of the strict §2.7 table, one of them disclosed by
the DEV) — non-blocking, defer to the 06 tidy-up. No correctness, contract, or
sole-path issue. The desktop walkthrough remains the sole end-to-end gate (no v1
fallback exists).
