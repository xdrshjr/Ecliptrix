# TESTER Summary — TODO 02 Sub-stage S4 (G3 delete v1 + flag, sole compositor path, D10 split)

## Meta
- **Agent:** google-tester-01
- **Role:** TESTER
- **Task:** todo-02-s4
- **Phase:** 2
- **Verdict:** ALL PASS

S4 is the FINAL, irreversible G3 deletion: it removes the v1 inline `<video>`
player + ALL playback-v2 feature-flag machinery, makes PreviewCanvas +
useCompositionPlayback + MultiTrackPlaybackEngine the SOLE preview path (no v1
fallback), and splits VideoPlayerPanel.tsx (3412 → 697 lines) along three clean
seams. I independently ran the full + scoped suites, type-check, the residue
greps, and read the panel + the three extracted modules + usePreviewTransport +
the parent Ref call site. I confirm the deletion is complete, the KEEP-list is
intact, the sole-path mount + Ref contract are correct, Phase B is a faithful
pure refactor, and the only findings are the SAME LOW-severity dead-code residue
the reviewer flagged (non-blocking, out of the strict §2.7 table).

## Key Decisions (test stance)

1. **The 2 failing tests are genuinely pre-existing + branch-unrelated — independently
   confirmed, not taken on faith.** `git --no-pager diff --name-only main...HEAD --
   src/lib/api/server` returns EMPTY (exit 0) ⇒ that directory is byte-identical to
   main ⇒ the 2 `backend-proxy.test.ts` failures (query-string preserved on the
   forwarded URL) cannot originate from this branch. Zero playback coupling.
2. **`isPlaybackV2Enabled` is fully eradicated from runtime.** The only `src/` hit
   is the `not.toMatch(/isPlaybackV2Enabled/)` NEGATIVE assertion in
   `VideoPlayerPanel.solePath.test.tsx`. Spec 02 §6 case 11 = VERIFIED NOW.
3. **Dead-code residue is real but non-blocking.** 8 constants in
   `playback/internal/constants.ts` (`KILL_SWITCH_LS_KEY` +
   `VISIBILITY_RESUME_MAX_MS` / `DRIFT_SOFT_MS` / `DRIFT_HARD_MS` /
   `DRIFT_SOFT_RATE_DELTA` / `DRIFT_HARD_TRIP_COUNT` / `DRIFT_SAMPLE_INTERVAL_MS` /
   `PREPARING_TIMEOUT_MS`) + 4 type-only orphans in `types.ts`/`index.ts`
   (`IPlaybackEngine` / `IKillSwitchMonitor` / `PlaybackEngineAttachDeps` /
   `PlaybackTimelineFacade`) have ZERO non-definition refs. Their consumers
   (PlaybackEngine / killswitchMonitor) were deleted. The strict §2.7 deletion
   table names `playbackFlags.ts` (clean) — NOT `constants.ts` — so this is
   cleanliness, not incomplete deletion. Reviewer flagged it; DEV disclosed the
   type orphans. Classify: CLEANLINESS, defer to Phase-3/06 tidy-up.
4. **proxyHitMeter KEEP is spec-correct even though it is now runtime-orphaned.**
   `proxyHitMeter.ts` is PRESENT, still barrel-exported (`index.ts:51`), and has
   its own passing test. Its only `selectPlaybackUrl.ts` reference is now a COMMENT
   (its live consumer `PlaybackEngine.attachActiveMaterial` was deleted). The
   spec/global-context MANDATE is "勿删 proxyHitMeter.ts" → satisfied. Not a
   KEEP-list violation; it is the disclosed runtime-orphan state.

## Execution Flow (verification)

1. Read S4 dev + global-context + the reviewer ## Meta verdict + spec 02 §2.7/§6.
2. **Full `npx vitest run src`** → 160 files, **1213 passed / 2 failed (1215)**.
   The 2 failures are BOTH `backend-proxy.test.ts` (T2 + T18, query-string on the
   forwarded URL). No other failure ⇒ no S4 regression.
3. **`git diff main...HEAD -- src/lib/api/server`** → empty ⇒ backend-proxy
   unchanged vs main ⇒ failures predate S4. Confirmed.
4. **`npx vitest run src/components/video`** → 100 files, **825 passed / 0 failed**.
5. **`npm run type-check`** → exit 0, clean.
6. **grep `isPlaybackV2Enabled` over `src/`** → 1 hit = the negative assertion only.
7. Dangling-ref greps (`useVideoPlayback|PlaybackVariantSwitcher|killswitchMonitor|
   KillSwitchMonitor|PreviewSurface|tripPlaybackV2KillSwitch`, `PlaybackEngine`,
   `embeddedVideoAudio`, `ecliptrix-playback-v2|*_KEY`) → all hits are
   comments/docstrings, negative test assertions, type-only re-exports, or the
   disclosed dead `constants.ts` key. ZERO live runtime imports of a deleted thing.
8. Read VideoPlayerPanel.tsx (697), useCompositionTransport.ts (345),
   aspectRatios.ts (47), imageOverlays.ts (72), usePreviewTransport.ts (114),
   playbackFlags.ts (98), AudioSyncPool.ts (241), playback/index.ts (78),
   solePath.test.tsx, and VideoEditingInterface.tsx spacebar handler (L379-393).
9. File-size sweep: every S4-touched file ≤800; methods ≤50; no TODO/FIXME/
   @ts-ignore/empty-catch introduced.

## Findings

### TESTS — PASS
- Full `src`: **1213 / 2** (the 2 = pre-existing `backend-proxy.test.ts`, dir
  unchanged vs main — independently confirmed via git diff).
- `src/components/video`: **825 / 0**.
- type-check: **clean (exit 0)**.

### Dangling refs — PASS (no live ref to any deleted symbol)
- `isPlaybackV2Enabled` → only the negative `not.toMatch` guard.
- `useVideoPlayback` / `PreviewSurface` / `PlaybackVariantSwitcher` /
  `killswitchMonitor` / `tripPlaybackV2KillSwitch` → only comments/docstrings,
  negative assertions, and type-only `IKillSwitchMonitor` (orphan, §below).
- `PlaybackEngine` (the deleted class) → no `import { PlaybackEngine }`; remaining
  hits are `MultiTrackPlaybackEngine` (live), comments, and type-only
  `IPlaybackEngine`/`PlaybackEngineAttachDeps` re-exports.
- `index.ts` line 11 exports `MultiTrackPlaybackEngine` (not the deleted
  PlaybackEngine); lines 57-78 are `export type {...}` only — type-check passing
  proves they resolve from the surviving `types.ts`.

### Sole-path wiring — PASS
- `useCompositionPlayback({ ..., enabled: true })` — unconditional, no flag fork.
- `<PreviewCanvas ref={compositionPreview.hostRef}>` bound unconditionally inside
  the composition branch. The only gate (`playbackMode === 'composition' &&
  videoSequences.length > 0` vs placeholder) is the legitimate empty-timeline path.
- No `<video>` element, no `isPlaybackV2Enabled`, no PreviewSurface in the panel.
- Editor type-checks; full video suite mounts green.

### KEEP-list — PASS
- `proxyHitMeter.ts` present + barrel-exported + tested (now comment-only
  referenced from selectPlaybackUrl — disclosed runtime-orphan, spec mandates keep).
- `isPreviewProxyEnabled` / `isLocalPreviewEnabled` + their keys
  (`ecliptrix-preview-proxy` / `ecliptrix-local-preview`) intact, default-ON,
  decoupled; consumed by the locked resolver options + the prefetch trigger; their
  surviving tests (`playbackFlags.{previewProxy,localPreview}.test.ts`,
  `selectPlaybackUrl.previewProxy`, `resolveSequencePlaybackUrl` pp-cases) PASS.

### Split-behavior preservation — PASS
- `aspectRatios.ts`: identical 5-entry table; `aspectRatioToNumber → number |
  undefined` matches the hook's `aspectRatio?: number` contract.
- `imageOverlays.ts`: identical selection (visible track, `[start,start+duration)`,
  material-URL check); verbose logger replaced by an `onMissing` callback — not
  behavior.
- `useCompositionTransport.ts`: the **readiness gate** (`computeMediaReadiness`,
  pure + exported) and the **spacebar-bypass guard** are BOTH preserved — line 270-273
  re-enforces `if (!gatePlay()) return;` on the imperative `seekAndPlayFromTimeline`
  entry with the explicit "BYPASSING the play button" comment. Methods ≤50 lines.
- `usePreviewTransport.ts`: returns the full `UseVideoPlaybackReturn` shape incl.
  cursor-seed-on-play; the ONLY dropped behavior is the v1 mock 1s-tick simulator
  (ran only on the removed v1 path). Faithful.

### VideoPlayerPanelRef contract — PASS
- `useImperativeHandle(ref, ...)` exposes exactly the 5 declared methods
  (`handleCompositionSeek` / `seekAndPlayFromTimeline` / `pauseFromTimeline` /
  `isPlaying` / `handlePlayPauseFromTimeline`). Parent (VideoEditingInterface
  L379-393) drives `ref.isPlaying()` then `pauseFromTimeline` /
  `seekAndPlayFromTimeline` — unchanged. solePath.test.tsx 2nd describe pins this.

### AudioSyncPool — PASS
- `AudioSyncGroup.kind` narrowed to `'audio'` only; no dead `'embeddedVideoAudio'`
  member; no `audioDetached` field on `AudioSyncClip`. Detach routing documented
  (decode-`<video>` mute + paired independent audio carries sound) — matches the
  export-parity invariant for Phase-3/05.

### Dead-code residue — CLEANLINESS (non-blocking)
- 8 dead constants in `playback/internal/constants.ts` (incl. the
  `'ecliptrix-playback-v2-killswitch'` key) + 4 type-only orphans
  (`IPlaybackEngine`/`IKillSwitchMonitor`/`PlaybackEngineAttachDeps`/
  `PlaybackTimelineFacade`). Zero non-definition refs. Out of the strict §2.7
  table (which names `playbackFlags.ts`, verified clean). Same as reviewer's LOW
  findings; not incomplete deletion. → defer to Phase-3/06 tidy-up.

### Completeness — PASS
- No stub/TODO/FIXME/@ts-ignore introduced. The 2 `catch {}` in playbackFlags.ts
  carry explanatory comments (legitimate localStorage-unavailable handling), not
  silent swallows. All S4-touched files ≤800; methods ≤50; VideoPlayerPanel = 697.

## Spec Traceability (spec 02 §6)

| Case | Behavior | Status |
| --- | --- | --- |
| 6 | import local MP4 → play, `/api/storage/files/...` same-origin, no black, no ingest/proxy/blob | Deferred to desktop (no fallback now) — walkthrough #1 |
| 7 | patch-after-insert → no manual reload (RC-A/RC-B) | Deferred to desktop — walkthrough #2 |
| 8 | multi-track overlap, upper opacity<1 → lower visible | Deferred to desktop — walkthrough #3 |
| 9 | subtitle/image renders to canvas | Deferred to desktop — walkthrough #4 |
| 10 | audio sync; detach → video muted + audio track sounds, no double | Deferred to desktop — walkthrough #5 |
| 11 | no `isPlaybackV2Enabled` refs, single preview path | **VERIFIED NOW** |

Cases 6-10 are inherently desktop-only after S4 (jsdom `drawImage` is a spy, no
real `seeked`, no GPU compositing, no N-concurrent `<video>` decode). The dev's
8-case DESKTOP WALKTHROUGH covers ALL at-risk behaviors — cases 6-10 map 1:1 to
walkthrough #1-#5, and it ADDS #6 (transport: play/pause/progress-seek/timeline-
scrub/Space), #7 (readiness-gate toast), #8 (export gating + aspect/cover) which
cover the transport-semantics shape-change + the readiness gate that unit tests
can only pin at the WIRING level. Coverage is complete.

## Issues & Risks

- **NO v1 fallback exists (load-bearing).** Every preview path now goes through the
  compositor; there is no flag to roll back. Everything jsdom CANNOT verify — real
  GPU canvas compositing, N-concurrent `<video>` decode, real `seeked` A/V sync,
  on-canvas image/subtitle raster, embedded-vs-detached audio routing (decode-
  `<video>` mute), the felt behavior of spacebar/scrub/progress-seek driving the
  prop-driven engine, patch-after-insert refresh, and the readiness-gate toast — is
  now ONLY verifiable by the desktop walkthrough. Unit/source tests pin the WIRING;
  they cannot pin the PIXELS or the AUDIO. The desktop walkthrough is MANDATORY
  before this ships.
- **Transport semantics changed shape** (prop-driven seek vs the old imperative
  `<video>` seek-lock). Wiring is pinned by tests; the felt behavior is a desktop
  check (walkthrough #6).
- **Dead-code residue** (constants.ts keys + types.ts orphans) — non-blocking
  cleanliness; bundle into Phase-3/06.

## Context for Downstream

- **Phase 3 / 05 (export parity):** S4 did not alter transition / z-order /
  opacity / audio-detach semantics. The export filtergraph must mirror the SAME
  routing the compositor now uses as its SOLE path — a detached video track is
  muted at the decode element and its paired independent `'audio'` sequence
  carries sound (AudioSyncPool owns `kind:'audio'` ONLY). Cross-check
  preview-vs-export there.
- **Phase 3 / 06 (persistence + cache GC):** the editor now mounts ONLY the
  compositor — no v1 audio pool / videoCache window prefetch to persist/GC around.
  Three doc/code-sync items belong here or in standalone commits: (a) the CLAUDE.md
  playback-v2 paragraph still describes the removed flag (orchestrator-owned; DEV
  did NOT edit CLAUDE.md); (b) the backend `/api/config/playback-flag` route is now
  unconsumed by the frontend; (c) the LOW-sev dead `constants.ts` keys + `types.ts`
  type orphans.
- **THE USER DESKTOP WALKTHROUGH (8 cases) is the sole end-to-end gate** — there is
  no v1 fallback to diff against. It must be run on the real Electron shell before
  ship.

## Verdict

**ALL PASS.** Deletion complete + correct (v1 player + ALL v2 flag machinery gone,
`isPlaybackV2Enabled` eradicated from runtime). KEEP-list fully intact
(proxyHitMeter + decoupled preview-proxy/local-preview flags + their tests).
Sole-path mount unconditional (`enabled: true`, PreviewCanvas bound to hostRef, no
flag fork). VideoPlayerPanelRef contract byte-for-byte preserved + parent drives
it unchanged. Phase-B split is a faithful pure refactor (readiness gate +
spacebar-bypass guard preserved). Tests: full src 1213/2 (the 2 = pre-existing
backend-proxy, dir unchanged vs main — independently confirmed); video 825/0;
type-check clean. The ONLY findings are the SAME LOW-severity dead-code residue
the reviewer flagged (out of the strict §2.7 table, one disclosed by the DEV) —
non-blocking, defer to Phase-3/06. No correctness, contract, sole-path, or
incomplete-deletion issue. The desktop walkthrough remains the sole end-to-end
gate (no v1 fallback exists).
