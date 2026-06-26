# Problem description

After the remote audio cache fix, an independent audio-track clip can still be silent in preview when playback starts from the middle of that clip. Starting playback at the clip's timeline start makes the same audio audible.

This diagnosis is scoped to preview playback for independent audio tracks, for example audio placed on track 2. The inspected export/material-cache path now carries a local/cacheable URL into the composition, so the remaining failure is in the preview audio element startup path.

# Reproduction steps

Manual reproduction:

1. Start the Ecliptrix frontend/backend as usual.
2. Add an audio material from search or upload, wait for it to become available in the editor, then place it on an independent audio track such as audio track 2.
3. Put the audio clip at a non-zero timeline position, for example clip starts at `5.0s`, and make sure it has several seconds of content.
4. Move the playhead to the clip start (`5.0s`) and press play. The audio track is audible.
5. Stop playback, move the playhead into the same clip, for example `8.0s`, and press play.
6. Expected: the audio starts at the corresponding source offset.
7. Actual: the timeline advances, but the audio track can remain silent.

Minimal code-level reproduction shape:

1. Create an `AudioSyncPool` with a fake `AudioElementLike` that supports `src`, `currentTime`, `readyState`, `seeking`, `paused`, `play()`, and `pause()`.
2. Make the first `play()` call return a rejected promise, matching a cold media element whose source was just assigned and immediately seeked into the middle.
3. Call `tick()` with `isPlaying = true`, `compositionTime` inside a clip, and an `AudioSyncClip` containing a non-empty `url`.
4. Current behavior: `AudioSyncPool` assigns `src`, assigns `currentTime`, calls `play()`, catches the rejected promise, and registers no retry listener. Dispatching `canplay` or changing `readyState` later does not cause another `play()` call unless a future tick happens to re-enter the paused path.
5. The equivalent video path does register a one-shot `canplay` retry after a rejected `play()`.

# Root cause analysis

The audio URL/cache plumbing is present in the current composition path:

- `src/components/video/timeline/infrastructure/CompositionAdapter.ts:203` extracts independent audio-track items into audio sequences, and `src/components/video/timeline/infrastructure/CompositionAdapter.ts:251` stores the selected playable URL on each `AudioSequenceItem`.
- `src/components/video/hooks/useCompositionPlayback.ts:114` builds `AudioSyncGroup` objects from those sequences, and `src/components/video/hooks/useCompositionPlayback.ts:145` carries `seq.url` into each clip.
- `src/components/video/playback/AudioSyncPool.ts:33` includes `url?: string` on `AudioSyncClip`, and `src/components/video/playback/AudioSyncPool.ts:195` emits a `seek` action when the active clip source changes.

The failing path is the first preview tick after starting playback from the middle of an audio clip:

- `src/components/video/playback/MultiTrackPlaybackEngine.ts:225` starts the preview clock immediately from the current composition time.
- `src/components/video/playback/MultiTrackPlaybackEngine.ts:337` enters the shared per-frame render pipeline, and `src/components/video/playback/MultiTrackPlaybackEngine.ts:348` then calls `this._audioPool.tick(...)`.
- `src/components/video/playback/AudioSyncPool.ts:299` handles the `seek` action by ensuring `src`, assigning the target source time, setting volume, and calling `_ensurePlaying()`.
- `src/components/video/playback/AudioSyncPool.ts:350` skips non-fresh seeks while a media element is still seeking or not ready, but fresh source swaps are allowed through so the mid-clip `currentTime` assignment happens immediately.
- `src/components/video/playback/AudioSyncPool.ts:362` calls `el.play()` and only swallows a rejected play promise.

The hidden preview element used for independent audio is created lazily as a media element, so mid-clip playback can hit a cold-load plus immediate-seek sequence:

- `src/components/video/components/VideoPlayerPanel/PreviewCanvas.tsx:135` creates the hidden audio element as a `<video>` with `preload = 'auto'`.
- `src/components/video/components/VideoPlayerPanel/PreviewCanvas.tsx:164` resolves one hidden element per independent audio track.

This is asymmetric with the main video source pool. The video path already handles rejected `play()` calls by retrying once the element can play:

- `src/components/video/playback/VideoSourcePool.ts:455` documents the rejected-`play()` retry case, and `src/components/video/playback/VideoSourcePool.ts:468` catches the rejection and calls `_scheduleCanplayRetry(...)`.
- `src/components/video/playback/VideoSourcePool.ts:473` implements the retry scheduler, and `src/components/video/playback/VideoSourcePool.ts:488` installs a one-shot `canplay` listener that calls `play()` again.

That retry behavior is missing from the independent audio path. `AudioSyncPool._ensurePlaying()` catches the rejection and does nothing else. The likely browser-level sequence is:

1. Starting at the clip head can play from source time `0` or near `0`, so the media element can progress through load/play in the common order.
2. Starting in the middle forces `src` assignment, a non-zero `currentTime` seek, and `play()` in the same tick.
3. The browser can reject or abort that first `play()` while loading/seeking.
4. Because `AudioSyncPool` does not retry on `canplay`, the track may remain paused/silent while the timeline clock continues.

The recent audio-specific guard in `AudioSyncPool` reduced repeated seek churn while a media element is loading/seeking, but it did not add the play-retry mechanism that already exists for video. Existing `AudioSyncPool` tests cover seek/ready-state behavior around `src/components/video/playback/__tests__/AudioSyncPool.test.ts:421`, but there is no corresponding rejected-`play()`/`canplay` retry coverage.

# Impact surface

- Affects preview playback for independent audio tracks.
- Most visible when starting playback from inside an audio clip after a scrub or manual playhead move.
- Applies to both remote-cached audio and local/uploaded audio once the URL reaches `AudioSyncPool`; the cache fix only determines which URL is assigned to `src`.
- Does not appear to be an export bug, because export uses the composition/audio sequence data rather than this hidden preview element state machine.
- Does not primarily affect embedded video audio routed through `VideoSourcePool`, because that path already has the `canplay` retry behavior.

# Candidate fixes

| Option | Fix | Pros | Cons / risk |
| --- | --- | --- | --- |
| 1 | Mirror `VideoSourcePool`'s one-shot `canplay` retry in `AudioSyncPool._ensurePlaying()` after rejected `play()` promises. Use an audio-specific dedupe marker and keep the current silent catch fallback for non-DOM test fakes. | Smallest change; aligns audio preview with proven video behavior; directly targets cold source plus mid-clip seek startup; easy to cover with unit tests. | Adds event-listener logic to `AudioSyncPool`; must avoid stacking retries on every tick. |
| 2 | Add an audio start-readiness handshake in `MultiTrackPlaybackEngine`, similar in spirit to video start reanchor, so playback does not advance/audibility is not assumed until active audio elements are ready. | Stronger synchronization model for audio and video starts. | More invasive; changes engine transport behavior; higher regression risk for preview responsiveness. |
| 3 | Preload/prime independent audio elements on scrub before play, then call `play()` only after `canplay`/`loadeddata`. | Can reduce startup misses and latency once primed. | More moving parts; may fetch/play too aggressively; still needs rejection handling as a fallback. |

# Recommended fix with justification

Implement option 1 first: add a one-shot `canplay` retry path to `AudioSyncPool._ensurePlaying()`, modeled after `VideoSourcePool._scheduleCanplayRetry()`.

Recommended test coverage:

1. A fake event-target audio element whose first `play()` rejects should receive exactly one `canplay` retry listener.
2. Dispatching `canplay` should call `play()` again without stacking duplicate listeners across ticks.
3. A non-event-target fake should preserve the current behavior of swallowing rejected `play()` promises without throwing.
4. A mid-clip fresh-source seek should still assign `currentTime` immediately, preserving the fix that made audio survive mid-clip seeks.

This fix is the best first change because the code already proves the project needed the same retry for preview video playback, and the current symptom is the audio-only version of that missing readiness retry. It leaves the material cache/export pipeline untouched and limits the blast radius to independent preview audio playback.

## 评审结论

Verdict: accept the root-cause direction and recommend a single fix: implement option 1 in `AudioSyncPool._ensurePlaying()`, but make the retry audio-safe rather than a blind copy of the video retry.

Evidence audit:

- The cited code is on the failing path. The composition adapter emits audio sequences with `url`, `buildAudioSyncGroups()` carries that URL into `AudioSyncClip`, `MultiTrackPlaybackEngine._renderAt()` calls `AudioSyncPool.tick()` every playing frame, and the audio pool's `seek` branch performs `src` assignment, `currentTime` assignment, volume update, then `_ensurePlaying()`.
- The mid-clip-only symptom is explained by the fresh-source seek exception in `AudioSyncPool._assignCurrentTime()`: a new `src` can immediately receive a non-zero `currentTime` even when `readyState < 2`, then `_ensurePlaying()` calls `play()` during that cold seek/load window. If that promise rejects, the current audio path only attaches `.catch(() => undefined)` and has no readiness-event retry.
- The cache/URL path is an unlikely remaining root cause. Commit `2be8ad6c84766f75405ae10bb663f4a951e3205b` moved remote audio materials into the shared cache/local URL flow, and the same clip is audible when playback starts at the clip head. A missing or bad URL would usually fail both the clip-head and mid-clip start cases before reaching the `play()` retry distinction.
- The strongest working-counterexample is the video pool: `VideoSourcePool` already handles this same rejected-`play()` class with a deduped one-shot `canplay` retry, and its tests cover the eventful retry and non-EventTarget fake paths. `AudioSyncPool` has seek/readiness guard tests, but no rejected-`play()`/`canplay` retry test.
- One boundary case must be added to the original recommendation: independent audio is audible, while the video retry starts muted. A stale audio `canplay` retry must not call `play()` after an intentional pause, a timeline gap, or a source swap. The implementation should therefore dedupe and disarm retries, not merely add an unconditional one-shot listener.

Final recommended fix:

Add an audio-specific canplay retry scheduler used only from the rejected-promise branch of `AudioSyncPool._ensurePlaying()`. The scheduler should use an optional structural `addEventListener` check, a per-element retry token/marker to avoid listener stacking, and a source/intention guard so stale handlers are ignored after `_apply('pause')` or `_ensureSrc()` changes the element source. The retry handler should clear its marker, call `play()` only if the token is still current, and swallow the retry promise rejection just like the current code.

This is the minimum safe change because it addresses the exact cold-load plus non-zero seek failure without changing timeline clock behavior, export/material-cache code, or the existing in-flight seek guard. Option 2 is too broad for this symptom, and option 3 may improve latency later but still would not replace rejected-`play()` handling.

Required coverage for the next node:

1. EventTarget-like audio fake: first `play()` rejects, exactly one `canplay` listener is armed, and dispatching `canplay` calls `play()` again.
2. Repeated rejected ticks do not stack additional listeners.
3. Plain non-EventTarget fake still swallows the rejected promise and does not throw.
4. Pending retry is disarmed when the pool applies `pause` for user pause/gap.
5. Pending retry is ignored or replaced after a source swap, so an old `canplay` cannot start the wrong clip.
6. Existing fresh-source mid-clip seek behavior remains unchanged: the initial non-zero `currentTime` assignment still lands even while `readyState < 2`.
