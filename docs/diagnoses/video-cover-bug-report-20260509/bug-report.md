# Video Cover (视频封面) Feature — Bug Report

- **Date**: 2026-05-09
- **Tester**: web-superuse exploratory session (Edge / Playwright)
- **Environment**: Dev (http://192.168.1.123:3010), backend on `:8000`
- **Build**: `main` branch, head `e6259c2 feat: support appending and removing single frames in a frame pack`
- **Test account**: `admin` / `admin`
- **Test project**: `华强` (existing, with one 1:51.31 video clip) + `BugTest` (empty timeline)
- **Source under test**: `src/components/video/components/VideoCoverModal/`

## Summary

8 bugs were reproduced. The most damaging finding is **Bug #1 — Downloaded Cover Layout Differs From Preview**, which makes the entire feature produce incorrect output. The remainder are a mix of accessibility, UX/feedback, and minor regressions that compound into a feature that is hard to trust and inaccessible to keyboard / screen-reader users.

| #  | Title                                                                  | Severity   | Priority |
|----|------------------------------------------------------------------------|------------|----------|
| 1  | Downloaded cover image does not match the on-screen preview (WYSIWYG broken) | Critical   | P0 |
| 2  | Frame scrub `<input type="range">` has no accessible name / label      | High       | P1 |
| 3  | Three editable text layers (badge / title / subtitle) have no a11y name or placeholder | High       | P1 |
| 4  | Invalid color hex is silently reverted to `#ffffff` with no user feedback | Medium     | P2 |
| 5  | "Size" spinbutton silently clamps out-of-range values without feedback | Medium     | P2 |
| 6  | Programmatic `input` / `change` events on the frame scrubber are ignored (only keyboard / pointer move it) | Medium     | P2 |
| 7  | Switching to **Upload** source clears the preview background even when no file is uploaded yet | Medium     | P2 |
| 8  | Empty-timeline state shows generic "—" with no explanation that "Frame" is disabled because the timeline has no video items | Low–Medium | P3 |

Reference screenshots and accessibility-tree snapshots referenced below are stored under `.web-debugger/screenshots/` and `.web-debugger/snapshots/` respectively (gitignored).

---

## Bug #1 — Downloaded cover image does not match the on-screen preview (WYSIWYG broken)

- **Severity**: Critical
- **Priority**: P0
- **Component**: `src/components/video/components/VideoCoverModal/hooks/useCoverRender.ts` + `components/CoverPreview.tsx`

### Description

The downloaded PNG produced by **Download Cover** has a layout that is dramatically different from the preview the user sees and just approved. Text and decoration layers shrink to roughly 1/3 of their preview proportion, while the background frame fills the entire output.

### Repro steps

1. Sign in as `admin / admin`, open the Video Editing module and open the existing project `华强` (1 video clip on the timeline).
2. Click **Cover** on the toolbar above the preview.
3. Pick the **Tutorial** template.
4. Click into the title text and replace `教程标题` with `我的封面 Test 123`.
5. Click **Download Cover**.
6. Open the downloaded `cover-<uuid>.png`.

### Expected

The downloaded PNG matches the preview pixel-for-proportion: the orange "5" badge occupies the left ~22% of width and the title text fills the right ~60% in large bold white type.

### Actual

In the downloaded PNG the orange "5" badge and the entire title block render at a tiny scale, packed into the top-left corner. The video frame shows through correctly but covers ~95% of the canvas because the overlaid template elements collapsed.

- Preview screenshot: `.web-debugger/screenshots/16-preview-vs-download.png`
- Downloaded image: `.web-debugger/screenshots/15-downloaded-cover.png` (saved from `.playwright-cli/cover-95d77660-…png`)

### Root cause hypothesis

`CoverPreview.tsx` sizes every text / decoration layer in `--cover-px` units that are computed as `stageWidth / nativeW` where `stageWidth = stageRef.current.clientWidth` (the on-screen px width, ~867 in my session) and `nativeW = aspectRatioToSize(aspectRatio).width` (1920 for 16:9). With `--cover-px ≈ 0.4515px`, on-screen layers compute correctly.

`useCoverRender.ts` then calls `htmlToImage.toBlob(node, { width: 1920, height: 1080, pixelRatio: 1920 / 867, canvasWidth: 1920, canvasHeight: 1080 })`. `html-to-image` resizes the cloned node to 1920px wide for serialization, which causes the `ResizeObserver` in `CoverPreview` to recompute `--cover-px` to `1920/1920 = 1px` *but only inside the cloned subtree's getComputedStyle pass*. In practice the cloned layers serialize with the **original** pixel-sized properties (the `99.34px` font-size, the `0.4515px` --cover-px) frozen into inline style, so they render at the original on-screen pixel size on the larger 1920×1080 canvas — i.e. ~1/2.2 of the intended size.

### Suggested fix direction

Either:

1. Force a synchronous reflow of the preview at native (1920×1080 for 16:9) dimensions inside an off-screen clone before calling `html-to-image`, so all `--cover-px`-derived layout values resolve at the native scale. After capture, restore the on-screen size.
2. Render the cover via an `OffscreenCanvas` / `<canvas>` 2D pipeline that reads layer geometry from the normalized `(x, y, width)` already stored in `CoverConfig` (range `[0, 1]`) and the unit-less `fontSize` from each `CoverTextLayer`. That removes the DOM-pixel coupling entirely.

The second approach is preferred because it also makes the export deterministic across zoom level, devicePixelRatio, and font fallback.

---

## Bug #2 — Frame scrub `<input type="range">` has no accessible name / label

- **Severity**: High (a11y)
- **Priority**: P1
- **Component**: `src/components/video/components/VideoCoverModal/components/FrameScrubber.tsx`

### Description

The frame-picker range slider is announced by the snapshot accessibility tree as `slider [ref=e1280]: "0"` — no name, no description. Compare with the editor's own scrubber (`slider "Seek within video"`) and the volume slider (`slider "Preview Volume"`), both of which have proper labels.

### Repro steps

1. Open Video Cover modal on a project that has video on the timeline.
2. Inspect the third `<input type="range">` in the modal (the one inside the **Source: Frame** subsection).

### Expected

The range input exposes an accessible name such as `Seek frame for cover` (or the localized equivalent of "Drag to pick a frame").

### Actual

Render is `<input type="range" min={0} max={max} step={0.05} … />` with no `aria-label`, `aria-labelledby`, or wrapping `<label>`. Screen readers will announce it as just "slider, 0".

Source: `FrameScrubber.tsx:62-80`.

### Suggested fix

Add `aria-label={labels.tooltip}` on the `<input type="range">` (the same string used in the visible `<span>` above it), or wire `aria-labelledby` to the `<span>`'s id.

---

## Bug #3 — Editable text layers (badge / title / subtitle) have no accessible name or placeholder

- **Severity**: High (a11y)
- **Priority**: P1
- **Component**: `src/components/video/components/VideoCoverModal/components/EditableTextLayer.tsx`

### Description

The contenteditable layers inside the preview show up in the a11y tree as:

```
- textbox [ref=e2612] [cursor=pointer]
- textbox [ref=e2613] [cursor=pointer]
- textbox [ref=e2614] [cursor=pointer]
```

i.e. three textboxes with no name. A screen-reader user has no way to know which is the badge, which is the title, and which is the subtitle.

### Repro

1. Open Video Cover modal.
2. Pick **Tutorial** template (has 3 layers: badge `5`, title, subtitle).
3. Run `[...document.querySelectorAll('[contenteditable]')].map(el => el.getAttribute('aria-label'))`.

### Expected

Each `[contenteditable]` exposes an `aria-label` derived from the layer key (e.g. `Badge text`, `Title text`, `Subtitle text`), localized.

### Actual

All three textboxes report `null` aria-label. `placeholder` is also unset.

### Suggested fix

In `EditableTextLayer.tsx`, set `aria-label` on the editable element using `layer.key` (mapped through the existing `t.videoCoverModal` i18n bag). Bonus: also expose `aria-multiline="false"` if single-line and add `data-placeholder` for visual-empty state.

---

## Bug #4 — Invalid color hex is silently reverted to `#ffffff` with no user feedback

- **Severity**: Medium
- **Priority**: P2
- **Component**: `src/components/video/components/VideoCoverModal/components/TextStyleToolbar.tsx` (color textbox)

### Description

Typing an invalid value into the **Color** textbox (e.g. `garbage` or `#XYZ123`) and pressing **Tab** silently discards the input and snaps the value back to the previous valid color (`#ffffff` in my session). No error message, no toast, no inline warning. Users cannot distinguish "I typed a non-hex" from "I typed an unrecognized but valid color name".

### Repro

1. Open the modal, select the Tutorial template, click into the title to enable the toolbar.
2. Click the Color textbox, `Ctrl+A`, type `#XYZ123`, press `Tab`.
3. Snapshot shows `textbox "Color" [ref=e1252]: "#ffffff"` — original value, no message.

### Expected

Either accept the bad input and display an inline validation message ("Invalid color"), or ignore the bad input and surface a small banner so the user knows their typed value was rejected.

### Actual

Silent revert — easy to miss, the user thinks the change was saved.

### Suggested fix

In the color-input change handler, store the raw string in local state. On blur, run `/^#[0-9a-f]{3}([0-9a-f]{3})?$/i`. If invalid, keep the textbox value but render a small red helper text below ("Use a hex like `#fff` or `#ffffff`") and do NOT call the upstream layer-update.

---

## Bug #5 — "Size" spinbutton silently clamps out-of-range values

- **Severity**: Medium
- **Priority**: P2
- **Component**: TextStyleToolbar.tsx — Size `<input type="number">` (min=8, max=400, step=1)

### Description

Typing a value beyond the bounds (e.g. `999`) clamps to the boundary (`400`) without telling the user. Typing `0` clamps to `8`. The user typed an explicit number and the system silently saved a different one.

### Repro

1. Open modal → click into title → focus Size input.
2. `Ctrl+A`, type `999`, lose focus.
3. Input now shows `400`.

### Expected

Either (a) display an inline helper "Clamped to 400 (max)" for ~3 s after the change, or (b) show a tooltip on hover explaining the bounds and only clamp on commit, leaving the typed value visible until commit.

### Actual

Pure silent clamp.

### Suggested fix

On commit, if the typed value differed from the stored value, set a transient `clampedFrom: number` flag in the toolbar's local state and render `Was {raw} → clamped to {min/max}` for 3 s.

---

## Bug #6 — Programmatic `input` / `change` events on the frame scrubber are ignored

- **Severity**: Medium (UX / scriptability — also breaks E2E test reliability)
- **Priority**: P2
- **Component**: `FrameScrubber.tsx`

### Description

Setting `input.value = "50"` and dispatching a bubbling `input` and `change` event on the frame scrubber's `<input type="range">` does **not** update the preview frame ("At 00:00" stays). Pressing `End` (with the input focused) instantly jumps to `01:51` correctly, so the React handler is wired — but it's listening to React-synthetic input events and ignoring native dispatch from a non-React source.

### Repro (reproduces in any console)

```js
const s = [...document.querySelectorAll('input[type=range]')].find(s => !s.getAttribute('aria-label'));
s.value = '50';
s.dispatchEvent(new Event('input',{bubbles:true}));
s.dispatchEvent(new Event('change',{bubbles:true}));
// Snapshot still shows "At 00:00". The slider's React state did not update.
```

### Expected

The change registers (or, at minimum, the `<input type="range">` has its value driven from React state so that DOM-set values are simply overwritten on the next render rather than appearing to take effect).

### Actual

DOM-side `value` is `"50"` but the React state holds `0`, so on next render `value={Math.min(max, Math.max(0, draftSec))}` reverts the DOM to 0. There is no way to set a frame programmatically — important for automated cover regeneration / scripted tests.

### Suggested fix

Use the React-compatible value-setter pattern that also fires React's synthetic event listeners:

```js
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
setter.call(input, '50');
input.dispatchEvent(new Event('input', { bubbles: true }));
```

Or, more cleanly, accept an imperative `setFrameSec(sec)` exposed via a ref so the parent (or tests) can drive the scrubber without going through DOM events at all.

---

## Bug #7 — Switching to **Upload** source clears the preview background even when no file is uploaded yet

- **Severity**: Medium
- **Priority**: P2
- **Component**: `VideoCoverModal.tsx` source-mode toggle effect

### Description

Toggling the **Source** toggle from `Frame` to `Upload` immediately replaces the extracted-frame background with a flat dark blue (`#0f172a`, the `backgroundColor` placeholder set in `CoverPreview.tsx:73`). The user has not uploaded anything yet, so a destructive change happened with zero confirmation. Toggling back to `Frame` *does* restore the background, but only after re-extraction; users perceive a regression and reach for "Cancel".

### Repro

1. Open modal on a project with video → Tutorial template → frame visible behind text.
2. Click **Upload**.
3. Preview now shows only the dark-blue checkerboard placeholder + template overlay, even though no upload occurred.

### Expected

Switching to Upload should keep the previously-extracted frame visible as a "ghost" background until the user actually drops or browses a file. Only commit the swap once a file is selected.

### Actual

Background is wiped immediately on toggle.

### Suggested fix

In the Upload-source branch, fall back to `frameBackgroundUrl` (last extracted frame) until `uploadedBackgroundUrl !== null`. Only set the upload background as the active layer once the file has been validated.

---

## Bug #8 — Empty-timeline cover shows "—" without explaining that **Frame** mode is disabled

- **Severity**: Low–Medium (UX / discoverability)
- **Priority**: P3
- **Component**: `FrameScrubber.tsx` + `SourceToggle.tsx`

### Description

On a brand-new project with no video clips, opening the cover modal disables the **Frame** toggle and forces **Upload** mode. The frame scrubber section shows `— —` and "Drag to pick a frame" gets replaced by `noVideoItems = "No video clips on the timeline"` only when the section is visible — but since the toggle has *already* flipped to Upload, the user never sees that message. The disabled **Frame** button has no tooltip explaining why it's disabled.

### Repro

1. **New project** → name it anything → **Create**.
2. Editor opens with empty timeline.
3. Click **Cover**.
4. Modal opens with Source = Upload (forced); Frame button is greyed-out with no tooltip.

### Expected

Hovering disabled **Frame** shows a tooltip: "Add at least one video clip to your timeline to pick a frame." The Upload section shows a small explanatory line at the top: "No frames available — upload an image instead."

### Actual

Disabled button with no tooltip; user must guess.

### Suggested fix

Set a `title=` attribute (or the project's existing tooltip wrapper) on the disabled `Frame` button, plus a one-line helper banner at the top of the Upload region when `totalDurationSec === 0`.

---

## Console / Network observations during the session

- No new JS errors or warnings were raised over the baseline (`Total messages: 1, Errors: 0, Warnings: 0`) during the entire 30+ interaction sequence. The bugs are pure state/visual mismatches, not crashes.
- Background image loads use `data:` URLs (extracted frames), so no extra network traffic was triggered when scrubbing.

## Reproduction artifacts

All artifacts are under the project root, in `.web-debugger/` (gitignored):

- Snapshots: `.web-debugger/snapshots/cover-modal.txt`, `cover-after-tutorial.txt`, `cover-after-clickbait.txt`, `upload-mode.txt`, `empty-cover.txt`, `reopen.txt`
- Screenshots: `01-cover-modal-initial.png`, `04-tutorial-template.png`, `05-clickbait-template.png`, `06-tutorial-retry.png`, `08-size-200.png`, `10-color-garbage.png`, `12-frame-end.png`, `13-upload-mode.png`, `15-downloaded-cover.png`, `16-preview-vs-download.png`, `19-reopen.png`, `22-cover-empty-project.png`
- Downloaded cover (Bug #1 evidence): `.playwright-cli/cover-95d77660-5933-4f07-a8e3-2f29939ab36c.png`

## Recommended fix order

1. **Bug #1** (Critical — feature is unusable). Land first; this is the blocker.
2. **Bug #6** (also a render-pipeline reliability issue — fixing it helps automated coverage of #1).
3. **Bugs #2 / #3** (a11y — bundle into one PR).
4. **Bugs #4 / #5** (input feedback — bundle into one PR).
5. **Bugs #7 / #8** (UX polish — last).
