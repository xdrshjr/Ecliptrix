# Image Overlay Remains Visible After Clip End

Bug slug: `image-overlay-visible-after-clip-end`

## Problem description

After the previous fixes, an image material can be moved, resized, and confirmed
in the video composition preview. The remaining bug is playback-time visibility:
when the playhead has already moved past the image clip's time range on the
image track, the preview still shows that image on top of the composition.

Expected behavior: the image should be visible only while the composition time
is inside that image timeline item's `[startTime, startTime + duration)` range.

Observed behavior: during playback, the image can remain visible after the
playhead/cursor has passed the image item's region on the timeline.

## Reproduction steps

Manual repro:

1. Start the app from the repository root:

   ```bash
   npm run dev
   ```

2. Open the video editor and create or open a project.
3. Add at least one video item to the video timeline so composition playback has
   a visible base layer.
4. Upload or select an image material, then add it to an image track.
5. Make the image item short and early on the timeline, for example
   `startTime = 0s`, `duration = 2s`.
6. In the playback composition panel, select the image, drag or resize it, and
   click the confirm control.
7. Click play and let the playhead pass `2s`.

Expected: once the playhead is at or after `2s`, the image disappears from the
preview.

Actual: the image can remain visible over the video after the playhead has left
the image item's timeline region.

Minimal state repro model:

```ts
// Timeline contains one image item active only on [0, 2).
const imageItem = {
  id: 'img-1',
  originalMaterialType: 'image',
  materialId: 'mat-1',
  startTime: 0,
  duration: 2,
  imagePosition: { x: 0.1, y: 0.1, width: 0.8, height: 0.8, zIndex: 10 },
};

// During playback the parent timeline clock advances to 3s, but
// VideoPlayerPanel's local compositionCurrentTime can still be 0.
const currentTimelineTime = 3;
const compositionCurrentTime = 0;

// Current code calls selectActiveImageOverlays with compositionCurrentTime,
// so it still selects img-1 even though currentTimelineTime is outside the clip.
```

## Root cause analysis

Primary root cause: the React interaction overlay uses a stale local composition
time instead of the parent timeline/playback time, so it can keep rendering the
selected image after the canvas compositor has moved past the image clip.

Evidence:

1. `VideoPlayerPanel` receives the authoritative composition time from the
   parent as `currentTimelineTime`, and passes it into `useCompositionPlayback`
   as the engine time source:
   `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:162`
   and
   `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:168`.
   The parent wires this prop from `timelineCurrentTime` at
   `src/components/video/VideoEditingInterface.tsx:2766` to
   `src/components/video/VideoEditingInterface.tsx:2768`.

2. Playback ticks do update the parent timeline clock:
   `VideoPlayerPanel` calls `onTimelineTimeUpdate(time)` at
   `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:170`
   to
   `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:174`,
   and the parent writes that value into `timelineCurrentTime` at
   `src/components/video/VideoEditingInterface.tsx:503` to
   `src/components/video/VideoEditingInterface.tsx:511`.

3. The React image overlay selector ignores `currentTimelineTime`. It calls
   `selectActiveImageOverlays(...)` with
   `compositionCurrentTime ?? currentTime` at
   `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:228`
   to
   `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:237`.
   Because `compositionCurrentTime` is a number state initialized at `0`
   (`src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:122`
   to
   `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:129`),
   the nullish fallback to `currentTime` never helps during composition mode.

4. The selected React overlay list is on the failing render path. In composition
   mode, `VideoPlayerPanel` renders `getCurrentImageOverlays().map(...)` into
   `<ImageOverlay />` at
   `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:516`
   to
   `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:529`.
   The non-composition placeholder/preview branch also reuses the same getter at
   `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:567`
   to
   `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:580`,
   so the fix must be mode-aware: use the timeline clock for composition mode,
   but keep ordinary preview mode on `currentTime`.

5. `compositionCurrentTime` is updated on explicit seeks, not on every playback
   tick. `useCompositionTransport` calls `updateCompositionCurrentTime(...)`
   during composition seek / scrub / seek-and-play paths at
   `src/components/video/components/VideoPlayerPanel/useCompositionTransport.ts:214`,
   `src/components/video/components/VideoPlayerPanel/useCompositionTransport.ts:229`,
   and
   `src/components/video/components/VideoPlayerPanel/useCompositionTransport.ts:277`.
   The playback tick callback in `VideoPlayerPanel` updates only a ref and parent
   callbacks, not this local state.

6. The stale React overlay sits above the canvas. The canvas host is rendered
   with `zIndex: 2` at
   `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:502`
   to
   `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:511`,
   while each `ImageOverlay` div uses `safePosition.zIndex || 10` at
   `src/components/video/components/VideoPlayerPanel/ImageOverlay.tsx:271`
   to
   `src/components/video/components/VideoPlayerPanel/ImageOverlay.tsx:281`.
   Therefore a stale React handle/image can visually cover the correctly
   composited canvas frame.

7. The canvas path already has correct time filtering. `MultiTrackPlaybackEngine`
   assembles layers with the live composition time `comp` at
   `src/components/video/playback/MultiTrackPlaybackEngine.ts:337` to
   `src/components/video/playback/MultiTrackPlaybackEngine.ts:346`, passes that
   time into `assembleLayers(...)` at
   `src/components/video/playback/MultiTrackPlaybackEngine.ts:374` to
   `src/components/video/playback/MultiTrackPlaybackEngine.ts:385`, and
   `assembleLayers` calls `buildImageLayersAt(input.imageItems, input.t, ...)`
   at `src/components/video/playback/internal/assembleLayers.ts:160` to
   `src/components/video/playback/internal/assembleLayers.ts:166`.
   `ImageOverlayLayer.activeImageItemsAt` enforces the half-open interval at
   `src/components/video/playback/ImageOverlayLayer.ts:101` to
   `src/components/video/playback/ImageOverlayLayer.ts:114`.

8. The compositor fills the whole canvas before drawing each frame, so a canvas
   image layer that is no longer active would not persist by itself:
   `src/components/video/playback/CanvasCompositor.ts:220` to
   `src/components/video/playback/CanvasCompositor.ts:230`.

Local validation:

```bash
npm exec vitest run src/components/video/components/VideoPlayerPanel/__tests__/imageOverlays.test.ts src/components/video/playback/__tests__/ImageOverlayLayer.test.ts src/components/video/playback/__tests__/assembleLayers.test.ts
```

Result: 3 test files passed, 28 tests passed. These tests confirm the pure
selector/layer code drops image overlays outside the image item's time window,
which supports the conclusion that the bug is in `VideoPlayerPanel`'s time
source wiring for the React interaction layer.

Historical context:

- `201b29a` introduced centered 80 percent default image overlay placement and
  canvas image drawing.
- `a1ec016` added manual resize handles.
- `761b66f` repainted the paused canvas when image overlay transforms changed.
- `cb37212` added confirm/cancel controls and persisted confirmed image overlay
  transforms.

Those commits addressed placement, resizing, paused repaint, and persistence.
They did not make the React interaction overlay select active images from the
same playback time used by the compositor.

## Impact surface

- Affects users editing image materials on image tracks in the video composition
  preview.
- Most visible after selecting or adjusting an image overlay, then playing past
  that image item's timeline segment.
- The actual exported/video-compositor data path is less likely to be affected by
  this specific stale React overlay, because the canvas image layer and export
  paths use item time ranges. The user-facing preview remains misleading.
- Regular video/audio track scheduling is not implicated; the issue is isolated
  to the React `ImageOverlay` interaction layer over the preview canvas.

## Candidate fixes

| Fix | Idea | Invasiveness | Risk | Effort | Trade-off |
|---|---|---:|---:|---:|---|
| A. Use the parent timeline clock for React overlay selection | In `VideoPlayerPanel`, derive one overlay selection time from `currentTimelineTime ?? compositionCurrentTime ?? currentTime`, then pass it to `selectActiveImageOverlays`. | Low | Low | Low | Best targeted fix. Makes the React overlay use the same clock already driving `useCompositionPlayback` and `TimelinePanel`. |
| B. Update `compositionCurrentTime` from the playback tick callback | Call `updateCompositionCurrentTime(time)` in the `useCompositionPlayback.onTimeUpdate` callback. | Low-Medium | Medium | Low | Also fixes stale local state, but duplicates parent clock state and adds another React state update path during playback. |
| C. Hide the React `ImageOverlay` handles while composition playback is active | Render draggable React overlays only when paused; rely on canvas while playing. | Low | Medium | Low | Stops the visible leak during play, but does not fix stale selection time when paused/scrubbed outside the image clip. It also changes interaction behavior. |

Review notes:

- Fix A covers the observed failure because it changes the only wrong input to
  the already-correct `selectActiveImageOverlays` half-open interval check. It
  also preserves the previous confirm/cancel and persisted transform work,
  because `overlay.position` still comes from the timeline item and only the
  selection time changes.
- Fix A should be implemented as a derived local value, not by mutating
  `compositionCurrentTime`, to avoid adding another state writer during
  playback. The parent `currentTimelineTime` is already the prop used to drive
  `useCompositionPlayback`, so using it keeps the React interaction layer and
  canvas compositor on the same authority.
- Fix A must branch on `playbackMode`. The fallback/placeholder preview branch
  also renders `getCurrentImageOverlays()`, and ordinary preview transport still
  owns `currentTime`; using `currentTimelineTime` unconditionally there could
  regress non-composition preview behavior.
- Fix B is not preferred because it creates two React clocks for the same
  composition time (`compositionCurrentTime` and parent `timelineCurrentTime`),
  increasing the chance of echo/seek feedback in code that already has explicit
  playback-echo guards.
- Fix C is insufficient as the final fix: it masks the symptom while playing,
  but the stale selection can still be wrong after a paused scrub outside the
  image clip, and it removes the user's ability to see/select handles during
  playback.

## Recommended fix

Implement Fix A.

Recommended implementation shape:

```ts
const imageOverlayPlaybackTime =
  playbackMode === 'composition'
    ? (currentTimelineTime ?? compositionCurrentTime)
    : currentTime;

const getCurrentImageOverlays = useCallback(
  () =>
    selectActiveImageOverlays(
      timelineState,
      materials,
      imageOverlayPlaybackTime,
      (info) => logger.warn('image material missing or no URL', info),
    ),
  [timelineState, materials, imageOverlayPlaybackTime, logger],
);
```

Why this is preferred:

- It fixes the actual clock mismatch between the canvas compositor and the React
  interaction layer.
- It is a small, local change in `VideoPlayerPanel`.
- It preserves the previous confirm/cancel and transform persistence work.
- It avoids adding a second ticking state update path during playback.

Suggested verification for the implementation node:

1. Add a regression test for `VideoPlayerPanel` or a focused extracted helper:
   with `currentTimelineTime = 3`, `compositionCurrentTime = 0`, and an image
   item active on `[0, 2)`, the rendered React `ImageOverlay` list should be
   empty.
2. Keep the existing pure tests passing:

   ```bash
   npm exec vitest run src/components/video/components/VideoPlayerPanel/__tests__/imageOverlays.test.ts src/components/video/playback/__tests__/ImageOverlayLayer.test.ts src/components/video/playback/__tests__/assembleLayers.test.ts
   ```

3. Manual verification: reproduce the steps above. After the playhead passes the
   image item's end, the preview should show the underlying video only, with no
   image handle or image bitmap left over.

## 评审结论

Verdict: the root-cause evidence is sufficient. The stale image is not explained
by canvas persistence: the multi-track engine passes the live composition time
into `assembleLayers`, image layers are filtered by `[startTime, startTime +
duration)`, and `CanvasCompositor.renderFrame` repaints the full canvas every
frame. The failing path is the React interaction overlay rendered above the
canvas; it selects active images with `compositionCurrentTime`, which is only
advanced by explicit seek paths and remains stale during normal composition
playback.

Final recommended fix: implement Fix A exactly as a mode-aware selection-time
derivation in `VideoPlayerPanel`:

```ts
const imageOverlayPlaybackTime =
  playbackMode === 'composition'
    ? (currentTimelineTime ?? compositionCurrentTime)
    : currentTime;
```

Then pass `imageOverlayPlaybackTime` to `selectActiveImageOverlays` and include
`playbackMode` and `currentTimelineTime` in the callback dependencies. This is
the minimum change because it changes only the React overlay's clock source,
keeps the canvas/export paths untouched, preserves confirmed transform
persistence, and avoids a second ticking React state update path. The next
implementation should add a focused regression test for the clock mismatch
(`currentTimelineTime = 3`, `compositionCurrentTime = 0`, image active on
`[0, 2)`) so the React overlay list is empty in composition mode while preview
mode still uses `currentTime`.
