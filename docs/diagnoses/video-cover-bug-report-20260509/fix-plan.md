# Video Cover (视频封面) — Fix Plan

- **Date**: 2026-05-09
- **Source bug report**: [`bug-report.md`](./bug-report.md) (8 bugs, P0–P3)
- **Code under fix**: `src/components/video/components/VideoCoverModal/`
- **Author of plan**: round 2 of agent-mesh fix loop (code exploration + fix design)

This document maps each bug in the report to a precise code location and a concrete fix strategy. Implementation proceeds in the recommended order from the bug report (P0 → P3). Every fix is local to `VideoCoverModal/` except Bug #2/#3, which also touch `src/lib/i18n.ts` to add new accessible-name strings.

---

## Bug #1 — Downloaded cover differs from preview (Critical / P0)

### Code locations

| File | Lines | Function / role |
|------|-------|-----------------|
| `hooks/useCoverRender.ts` | 56–78 (`tryRender`) | calls `htmlToImage.toBlob` |
| `components/CoverPreview.tsx` | 44–74 | sets `--cover-px = stageWidth / nativeW` on the stage |
| `components/EditableTextLayer.tsx` | 87 | `fontSize: calc(${layer.fontSize} * var(--cover-px, 0.001))` |
| `components/DecorationLayer.tsx` | 74 | `fontSize: calc(40 * var(--cover-px, 0.001))` |

### Root cause

`html-to-image` clones the live DOM, sets the clone's outer size to `width × height` (1920×1080 for 16:9), and serializes it. During serialization the cloned stage's `clientWidth` is still observed as the original on-screen value (~867px) because the **`stageWidth` React state** that drove the `--cover-px` calculation is captured by React's render at on-screen scale and *baked into the inline style of the cloned subtree*. Result: text/decoration layers compute `fontSize ≈ layer.fontSize × (867 / 1920) ≈ 0.45·layer.fontSize` px, then render at that absolute pixel size on the larger 1920-px canvas — i.e. shrunk to ~45% (the report measured ~33% which matches once you account for the bold weight metrics + line-height).

The bug is therefore a **scale-coupling** bug: layers are sized in *on-screen pixels* through a JS-computed CSS variable rather than in *canvas-relative units*. When the canvas dimension changes between preview (867px) and export (1920px), all layers retain their preview-px sizes and look small.

### Fix strategy (preferred: container query units)

Replace the JS-computed `--cover-px` with the CSS-native **container query unit `cqw`** (Container Query Width). 1 `cqw` = 1% of the nearest container's width, so `1920 * 0.001 cqw = 1.92px` on a 1920-wide container and `867 * 0.001 cqw = 0.867px` on an 867-wide container — exactly the scaling we want, with zero JS coordination.

**Steps**

1. `CoverPreview.tsx` — set the stage as a CSS containment context:
   ```tsx
   const ratioStyle: React.CSSProperties = {
     aspectRatio: aspectRatio.replace(':', ' / '),
     containerType: 'inline-size',     // NEW — enables cqw inside subtree
     backgroundImage: ...,
     backgroundSize: 'cover',
     backgroundPosition: 'center',
     backgroundColor: '#0f172a',
   };
   ```
   - Drop `--cover-px`, `stageWidth` state, and the `ResizeObserver` entirely.
2. `EditableTextLayer.tsx:87` — convert the font size to cqw against the canvas's native short-side (1080 px):
   ```tsx
   // 1080 native short-side px == 100 cqh on a 16:9 stage with containerType:inline-size
   // Use cqw against native width so text scales with the canvas, not the viewport.
   fontSize: `calc(${layer.fontSize} / ${nativeShortSide} * 100cqw)`,
   ```
   - Pass `nativeShortSide` (or just the full `aspectRatioToSize` width) into `EditableTextLayer` as a prop, OR have `CoverPreview` set a `--native-px` custom property = `${100 / nativeW}cqw` on the stage and have layers consume `var(--native-px)` directly. The latter keeps the change confined.
3. `DecorationLayer.tsx:74` — same swap (`var(--native-px, 0.001px)`).
4. `useCoverRender.ts` — remove the `pixelRatio` scaling math; with cqw the clone serializes at the right dimensions naturally. Keep `width`/`height` as the export size and `pixelRatio: 1` (since cqw is canvas-relative).

### Fallback strategy (if cqw availability is a concern)

Browsers we support (Chrome 105+ / Edge / Safari 16+ / Firefox 110+) all ship cqw; if a constraint is added later, the fallback is to **temporarily resize the stage to native dimensions inside `useCoverRender.render()`**:

```ts
const stage = previewRef.current!;
const prev = { width: stage.style.width, height: stage.style.height };
stage.style.width = `${full.width}px`;
stage.style.height = `${full.height}px`;
// Force layout so ResizeObserver fires synchronously.
void stage.offsetHeight;
await new Promise(r => requestAnimationFrame(r));   // give React a frame to re-render
try {
  return await tryRender(full.width, full.height);
} finally {
  stage.style.width = prev.width;
  stage.style.height = prev.height;
}
```

This is uglier (visible flicker if not hidden) and only kept as a fallback.

### Risks

- `containerType: inline-size` introduces a containing block for absolutely-positioned descendants. The current absolute layers are already positioned against the stage, so behavior should be identical — verify the toolbar's selection outline still aligns.
- Some `html-to-image` versions strip `@container` rules; we are using `cqw` *units*, not `@container` rules, so this is fine. Confirm with a unit test (see below).

### Tests

- Add a Playwright export-vs-preview pixel-ratio assertion: render the cover, decode the PNG, sample N points where text is expected, assert non-background colour at those positions.
- Add a Vitest test in `__tests__/coverRender.test.tsx`: mount `CoverPreview` at two sizes (400px and 1920px wide) and assert that `getComputedStyle(layer).fontSize` scales linearly with width within ±1px tolerance.

---

## Bug #2 — Frame scrubber has no accessible name (P1)

### Code location

`components/FrameScrubber.tsx:62-80` — the bare `<input type="range">`.

### Root cause

No `aria-label` / `aria-labelledby` on the slider input. The visible `<span>` above ("Drag to pick a frame") is not associated.

### Fix

```tsx
const tooltipId = useId();   // import from React
...
<span id={tooltipId}>{locked ? labels.noVideoItems : labels.tooltip}</span>
...
<input
  type="range"
  aria-labelledby={tooltipId}
  aria-valuetext={locked ? labels.noVideoItems : labels.atTime.replace('{time}', formatTime(draftSec))}
  min={0}
  max={max}
  step={0.05}
  value={Math.min(max, Math.max(0, draftSec))}
  ...
/>
```

`aria-valuetext` is added because the raw value (seconds as a float) is not human-friendly; "At 00:42" is.

### Risks / Tests

- Negligible risk. Add a Playwright snapshot assertion `slider "Drag to pick a frame"` instead of `slider "0"`.

---

## Bug #3 — Editable text layers have no accessible name / placeholder (P1)

### Code location

`components/EditableTextLayer.tsx:102-148` — the contenteditable `<div>`.

### Root cause

`role="textbox"` is set but no `aria-label`. The layer's `key` ('badge' / 'title' / 'subtitle' / etc.) is the only identifying signal and is not localized for screen readers.

### Fix

1. **Localize**. Add an `a11yNames` map to `videoCoverModal` in `src/lib/i18n.ts`:
   ```ts
   videoCoverModal: {
     ...,
     a11y: {
       layerBadge: 'Badge text',
       layerTitle: 'Title text',
       layerSubtitle: 'Subtitle text',
       layerEyebrow: 'Eyebrow text',
       layerCta: 'Call-to-action text',
       layerGeneric: '{key} text',
       frameSlider: 'Drag to pick a frame',
     },
   }
   ```
   Add Chinese + English translations at lines 3793 and 6474 (the two locale blocks).
2. **Pass-through**. `CoverPreview.tsx` passes `t.videoCoverModal?.a11y` into `EditableTextLayer` (or, simpler: import `useLocale` directly inside `EditableTextLayer`).
3. **Apply**. In `EditableTextLayer.tsx`:
   ```tsx
   const a11yLabel = a11y[`layer${capitalize(layer.key)}`] ?? a11y.layerGeneric.replace('{key}', layer.key);
   ...
   <div
     role="textbox"
     aria-label={a11yLabel}
     aria-multiline="true"
     data-placeholder={layer.text === '' ? a11yLabel : undefined}
     ...
   ```
4. CSS for the empty-state placeholder (one-liner): in the same file's style object, add a sibling rule via styled-jsx or a class (the project doesn't use styled-jsx, so add a class `.cover-text-layer[data-placeholder]:empty::before { content: attr(data-placeholder); opacity: 0.4; }` to `globals.css`).

### Risks / Tests

- Localization keys are net-new; verify by switching locale.
- Add a Playwright assertion: every `[contenteditable]` inside the cover modal has a non-empty `aria-label`.

---

## Bug #4 — Invalid color silently reverts (P2)

### Code location

`components/TextStyleToolbar.tsx:91-100` — the `<input type="color">`.

### Root cause

`<input type="color">` rejects non-hex input *at the browser level* and never fires a `change` event — there is no JS-side validation we can hook into. The user typed a value into what Playwright reports as a textbox; in real Chromium this is the picker's expanded "Custom colour" input, which is browser-internal.

### Fix

Replace the lone color picker with a **swatch + hex text input pair**, both visible at all times. The text input is fully validatable.

```tsx
const [colorDraft, setColorDraft] = useState<string>(layer?.color ?? '#ffffff');
const [colorError, setColorError] = useState<string | null>(null);

useEffect(() => { setColorDraft(layer?.color ?? '#ffffff'); setColorError(null); }, [layer?.color]);

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const commitColor = (raw: string) => {
  const v = raw.trim();
  if (HEX_RE.test(v)) {
    setColorError(null);
    onChange({ color: v.toLowerCase() });
  } else {
    setColorError(labels.colorInvalid ?? 'Use #fff or #ffffff');
  }
};

<label className="block">
  <span className="block mb-1 text-muted-foreground">{labels.color}</span>
  <div className="flex gap-1">
    <input
      type="color"
      aria-label={labels.colorSwatch}
      value={HEX_RE.test(colorDraft) ? colorDraft : '#ffffff'}
      disabled={disabled}
      onChange={(e) => { setColorDraft(e.target.value); onChange({ color: e.target.value }); setColorError(null); }}
      className="h-7 w-10 rounded-sm border border-border bg-background disabled:opacity-50"
    />
    <input
      type="text"
      aria-label={labels.color}
      value={colorDraft}
      disabled={disabled}
      onChange={(e) => setColorDraft(e.target.value)}
      onBlur={(e) => commitColor(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') commitColor((e.target as HTMLInputElement).value); }}
      className="flex-1 px-2 py-1 rounded-sm bg-background border border-border disabled:opacity-50 font-mono"
      maxLength={7}
      spellCheck={false}
    />
  </div>
  {colorError && <p role="alert" className="mt-1 text-[11px] text-destructive">{colorError}</p>}
</label>
```

Add `colorSwatch` and `colorInvalid` to the `videoCoverModal.textTools` i18n bag.

### Risks / Tests

- Two-input controls are slightly more state to manage; cover with a Vitest test that asserts `commitColor('#XYZ')` shows `colorError` and does NOT call `onChange`.

---

## Bug #5 — Size spinbutton silently clamps (P2)

### Code location

`components/TextStyleToolbar.tsx:74-89` — the `<input type="number">`.

### Root cause

The `onChange` handler runs `Math.min(400, Math.max(8, v))` and stores the clamped result without telling the user.

### Fix

Add a transient "clamp toast" that announces the override:

```tsx
const [sizeDraft, setSizeDraft] = useState<string>(String(layer?.fontSize ?? 72));
const [clampedFrom, setClampedFrom] = useState<number | null>(null);
const clampTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

useEffect(() => {
  setSizeDraft(String(layer?.fontSize ?? 72));
}, [layer?.fontSize]);

const commitSize = () => {
  const v = Number.parseInt(sizeDraft, 10);
  if (!Number.isFinite(v)) return;
  const clamped = Math.min(400, Math.max(8, v));
  if (clamped !== v) {
    setClampedFrom(v);
    if (clampTimerRef.current) clearTimeout(clampTimerRef.current);
    clampTimerRef.current = setTimeout(() => setClampedFrom(null), 3000);
    setSizeDraft(String(clamped));
  } else {
    setClampedFrom(null);
  }
  onChange({ fontSize: clamped });
};

<input
  type="number" min={8} max={400} step={1}
  className="w-full px-2 py-1 ..." disabled={disabled}
  value={sizeDraft}
  onChange={(e) => setSizeDraft(e.target.value)}
  onBlur={commitSize}
  onKeyDown={(e) => { if (e.key === 'Enter') commitSize(); }}
/>
{clampedFrom !== null && (
  <p role="status" className="mt-1 text-[11px] text-muted-foreground">
    {(labels.sizeClamped ?? 'Clamped {from} → {to}')
      .replace('{from}', String(clampedFrom))
      .replace('{to}', sizeDraft)}
  </p>
)}
```

Add `sizeClamped` to the i18n bag.

### Risks / Tests

- Don't lose the keystroke that the user is in the middle of typing — that's why we keep a `sizeDraft` string until commit.
- Vitest: type "999", blur, expect `clampedFrom = 999`, `sizeDraft = '400'`, and assert the helper text is rendered.

---

## Bug #6 — Programmatic events on the frame scrubber are ignored (P2)

### Code location

`components/FrameScrubber.tsx:62-80`.

### Root cause

This is the well-known **React controlled-input rejection** of native `input.value = X; dispatchEvent(new Event('input'))` mutations. React's synthetic event system tracks the last value it set; when the next render runs, the stale React state overwrites the DOM value.

### Fix

Two complementary tactics, both low-risk:

1. **Stop using `value=`; use `defaultValue=` + a ref + a useEffect that mirrors prop changes.** This makes the `<input>` *uncontrolled* internally and accepts native dispatch:
   ```tsx
   const inputRef = useRef<HTMLInputElement | null>(null);
   useEffect(() => {
     const el = inputRef.current;
     if (!el) return;
     const next = String(Math.min(max, Math.max(0, draftSec)));
     if (el.value !== next) el.value = next;
   }, [draftSec, max]);
   ...
   <input ref={inputRef} type="range" defaultValue={...} onChange={...} />
   ```
2. **Expose an imperative `setFrameSec(sec)` via `useImperativeHandle`** so tests / parent code can drive the scrubber without DOM dispatch:
   ```tsx
   export interface FrameScrubberHandle { setFrameSec(sec: number): void; }
   export const FrameScrubber = forwardRef<FrameScrubberHandle, FrameScrubberProps>(...);
   ```
   Inside, `setFrameSec` calls the same code path as the `onChange` handler.

The first tactic alone fixes the bug; the second future-proofs against new automation needs.

### Risks / Tests

- Going uncontrolled in this small component is safe because `draftSec` is the single source of truth and the parent debounces commits — there's no second writer racing the input value.
- Add a Vitest jsdom test that asserts the React state updates after dispatching a native `input` event with `Object.getOwnPropertyDescriptor(...).set`.

---

## Bug #7 — Switching to Upload wipes the preview (P2)

### Code location

`VideoCoverModal.tsx:171-185` (`handleSourceChange`).

### Root cause

`setBackgroundUrl(null)` runs unconditionally inside `handleSourceChange`. The intended behaviour was probably "clear when switching back to frame-mode the user manually picks a different source". The cleanup is too eager for the upload branch.

### Fix

Only clear the background when:
- The user switches **to `frame`** AND `frameVirtualTimeMs` differs, OR
- The user switches **to `upload`** AND a `uploadedImageUrl` already exists in state (i.e. they're going back to a previously-uploaded image — show that one).

Otherwise keep the last extracted frame as a "ghost" background until the user actually uploads.

```ts
const handleSourceChange = useCallback((source: ImageSource) => {
  setState((prev) => {
    if (!prev) return prev;
    if (source === 'frame') {
      return { ...prev, imageSource: 'frame', uploadedImageUrl: null,
               frameVirtualTimeMs: prev.frameVirtualTimeMs ?? 0 };
    }
    return { ...prev, imageSource: 'upload', frameVirtualTimeMs: null };
  });
  // Critical fix: do NOT setBackgroundUrl(null). Let the existing background
  // remain as a ghost until either:
  //   (a) the user uploads a file (handleUploaded sets it), or
  //   (b) the user switches back to frame and the extraction effect fires.
  if (source === 'upload') {
    setState((prev) => {
      if (prev?.uploadedImageUrl) {
        setBackgroundUrl(prev.uploadedImageUrl);
      }
      return prev;
    });
  }
}, []);
```

Note: The `setState` re-call inside `handleSourceChange` is awkward; cleaner is to read the previous `state` from a ref kept in sync via `useEffect`. The simplest implementation is just to delete the `setBackgroundUrl(null)` line and let the re-extraction effect at line 109 handle the frame branch.

### Risks / Tests

- Slight visual confusion possible if the user goes Frame → Upload → drops a non-image; the ghost frame would still show. We mitigate by showing the ghost at 60% opacity behind the upload dropzone (CSS-only).
- Playwright test: switch to Upload without uploading, assert the preview's `background-image` is still the data URL it was before the toggle.

---

## Bug #8 — Empty-timeline state lacks tooltip / explanation (P3)

### Code locations

- `VideoCoverModal.tsx:127-132` — auto-flip to `upload` when `totalVirtualDurationSec === 0`.
- `components/SourceToggle.tsx:36-54` — the `RadioPill` for `frame` is `disabled` but has no tooltip.
- `components/ImageUploadInput.tsx` — needs a one-line helper at the top when `frame` is locked.

### Root cause

The auto-flip preempts the disabled-tooltip path; user never sees `noVideoItems` from `FrameScrubber.tsx:57` because the section isn't rendered.

### Fix

1. **Add a tooltip** to the disabled "Frame" pill in `SourceToggle.tsx`:
   ```tsx
   <RadioPill
     label={labels.frame}
     active={value === 'frame'}
     disabled={!!frameDisabled}
     title={frameDisabled ? (labels.frameDisabledHint ?? 'Add a video clip to pick a frame') : undefined}
     onClick={() => onChange('frame')}
   />
   ```
   `RadioPill` then forwards the `title` attribute to its inner `<button>`.
2. **Add a helper banner** in `VideoCoverModal.tsx`'s upload branch, conditionally rendered when `frameExtraction.totalVirtualDurationSec <= 0`:
   ```tsx
   {frameExtraction.totalVirtualDurationSec <= 0 && (
     <p className="text-xs text-muted-foreground italic">
       {t.videoCoverModal?.source?.noFramesAvailable ?? 'No frames available — upload an image instead.'}
     </p>
   )}
   ```
3. Add `frameDisabledHint` and `noFramesAvailable` to the locale bag.

### Risks / Tests

- Pure additive; no risk to existing flows.
- Playwright: open cover on a brand-new project, hover the disabled Frame pill, assert tooltip is present.

---

## Cross-cutting: i18n additions

Append the following to `videoCoverModal` in `src/lib/i18n.ts` (interface at line ~1132, English at line ~3793, Chinese at line ~6474):

```ts
a11y: {
  layerBadge: 'Badge text' / '徽章文字',
  layerTitle: 'Title text' / '标题文字',
  layerSubtitle: 'Subtitle text' / '副标题文字',
  layerEyebrow: 'Eyebrow text' / '眉头文字',
  layerCta: 'Call-to-action text' / '行动号召文字',
  layerGeneric: '{key} text' / '{key} 文字',
  frameSlider: 'Drag to pick a frame' / '拖动以选取一帧',
},
textTools: {
  ...,
  colorSwatch: 'Color picker' / '颜色选择器',
  colorInvalid: 'Use a hex like #fff or #ffffff' / '请输入十六进制颜色，如 #fff 或 #ffffff',
  sizeClamped: 'Clamped {from} → {to}' / '已自动调整：{from} → {to}',
},
source: {
  ...,
  frameDisabledHint: 'Add a video clip to your timeline to pick a frame' / '请先在时间线添加视频片段，再选取封面帧',
  noFramesAvailable: 'No frames available — upload an image instead.' / '暂无可用帧 —— 请上传一张图片',
},
```

---

## Implementation order (P0 → P3)

| Step | Bug(s) | PR scope | Estimated diff size |
|------|--------|----------|---------------------|
| 1 | #1 | Render-pipeline rewrite using `cqw` | ~80 LoC across 4 files |
| 2 | #6 | Uncontrolled `<input type="range">` + imperative handle | ~20 LoC |
| 3 | #2 + #3 | a11y bundle (aria-labels + i18n keys) | ~40 LoC |
| 4 | #4 + #5 | Input-feedback bundle (color + size) | ~80 LoC |
| 5 | #7 + #8 | UX polish (ghost background + tooltip + helper) | ~30 LoC |

Each step is independently testable and shippable. Step 1 unblocks the rest because automated visual regression for the cover feature was meaningless before it landed.

---

## Verification checklist before merging each step

- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm test -- VideoCoverModal` passes (existing + new Vitest cases)
- [ ] Manual: open the cover modal on a 16:9 project, pick the Tutorial template, click Download, open the PNG and visually compare to the preview.
- [ ] Manual: open the cover modal on a brand-new (empty timeline) project, hover the disabled "Frame" pill, confirm tooltip.
- [ ] Manual: type `#XYZ` in the color text input, blur, see the inline error.
- [ ] Manual: type `999` in the Size input, blur, see the clamp helper.
- [ ] Manual: drive the frame scrubber via DevTools `setter.call(input, '50')` + `dispatchEvent(new Event('input'))` and confirm the preview frame updates.
