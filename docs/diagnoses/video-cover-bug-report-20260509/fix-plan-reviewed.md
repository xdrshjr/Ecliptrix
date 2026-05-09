# Video Cover (视频封面) — Fix Plan (Reviewed & Corrected)

- **Date**: 2026-05-09
- **Source plan**: [`fix-plan.md`](./fix-plan.md) — round-2 draft
- **Source bug report**: [`bug-report.md`](./bug-report.md)
- **Reviewer**: round-3 agent-mesh fix loop (check-and-fix)
- **Status**: ✅ Approved for execution after the corrections in this document

This document is the **executable** version of the fix plan. The original draft is technically right in direction for every bug, but five spots needed corrections before code can land. Each section below states what the original plan got right, what was wrong / under-specified, and the final corrected approach.

---

## Summary of corrections vs. the original plan

| Bug | Original plan defect | Severity | Correction |
|-----|----------------------|----------|------------|
| #1 | Used `cqh` math against `nativeShortSide`; `containerType: inline-size` does NOT enable `cqh` | High — would not compile / would produce 0 size | Use `cqw` against the canvas's **native width** (`nativeW`), not short-side. |
| #1 | Did not specify what happens to existing `--cover-px` consumers in the same render pass | Medium | Replace `--cover-px` with a single CSS-derived custom property `--cover-px: calc(100cqw / ${nativeW});` set on the stage. No JS, no `ResizeObserver`, no prop drilling. |
| #1 | Did not call out the html-to-image foreignObject containment risk | Medium | Add a defensive verification step to the test plan; if container queries fail in the foreignObject, a documented one-line fallback (synchronous stage resize) is provided. |
| #4 / #5 / #8 | TypeScript interface for `videoCoverModal` (i18n.ts:1132) was not updated, only the two locale blocks | Will fail `npm run type-check` | Adds the four missing keys + the new `a11y` sub-object to the interface. |
| #5 | Empty / non-numeric size field on blur silently keeps the prior value but leaves the input visually empty | Minor UX bug | On commit, if `sizeDraft` is empty or NaN, snap back to the current `layer.fontSize`. |
| #6 | `useImperativeHandle` half of the fix adds complexity without bug-relevant payoff | Scope creep | Drop the `forwardRef` half; the uncontrolled-input fix is sufficient and is what fixes the bug. Re-add the imperative handle only when a future caller actually needs it. |
| #7 | The proposed nested `setState` to read `prev.uploadedImageUrl` is a side-effecting reducer | Anti-pattern; React in dev mode will run reducers twice and double-call `setBackgroundUrl` | Replace with a two-line fix: (a) **delete** the unconditional `setBackgroundUrl(null)` call, (b) update the existing `useEffect` so it does not clear the background when `imageSource === 'upload' && uploadedImageUrl == null`. |
| #8 | `RadioPill` was assumed to forward a `title` prop, but the current implementation does not | Compile / no-op tooltip | Extend `RadioPillProps` and forward `title` to the inner `<button>`. |

Everything else in the original plan is technically sound and proceeds unchanged.

---

## Bug #1 — Downloaded cover differs from preview (Critical / P0) — CORRECTED

### Diagnosis (unchanged)

`html-to-image` clones the live DOM and serializes it at the export size (1920 × 1080). The cloned subtree carries `--cover-px` baked in at the **on-screen** value (≈867 / 1920 ≈ 0.45 px). All text/decoration `font-size` calc() expressions therefore evaluate against a stale on-screen scale on the larger export canvas — text shrinks to ~45% of intended size.

### Final fix (corrected)

Replace the JS-driven `--cover-px` with a **container-query-derived** value computed by CSS, so the same custom-property value is correct at any container width — including the export size.

#### Step 1 — `components/CoverPreview.tsx`

Set `containerType: inline-size` on the stage and define `--cover-px` purely in CSS as a function of container width:

```tsx
const { width: nativeW } = aspectRatioToSize(aspectRatio);

const ratioStyle: React.CSSProperties = {
  aspectRatio: aspectRatio.replace(':', ' / '),
  // CSS containment context — enables cqw inside this subtree.
  containerType: 'inline-size',
  // 1 cqw == 1% of the stage's content width. Dividing by the canvas's
  // *native* width (e.g. 1920 for 16:9) yields a per-px scale factor that
  // is correct at ANY rendered width, including html-to-image's 1920px
  // export size. No JS state, no ResizeObserver, no React render dependency.
  ['--cover-px' as unknown as string]: `calc(100cqw / ${nativeW})`,
  backgroundImage: backgroundUrl ? `url(${cssUrl(backgroundUrl)})` : undefined,
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  backgroundColor: '#0f172a',
};
```

**Delete** these (no longer needed):
- The `stageWidth` `useState`.
- The `useEffect` with the `ResizeObserver`.
- The bridging `useImperativeHandle` for `stageRef` (the `forwardRef` already exposes the node via the assignment in the existing `useImperativeHandle`; keep the bridge but it no longer needs to coordinate with the deleted observer).

#### Step 2 — `components/EditableTextLayer.tsx`

No change needed at the layer level — `fontSize: calc(${layer.fontSize} * var(--cover-px, 0.001))` already resolves correctly because `--cover-px` is now CSS-derived.

> **Important**: The fallback constant `0.001` (px) inside `var(--cover-px, 0.001)` is now unreachable when the stage has `containerType: inline-size` (the property always resolves), but keep it as a defensive default in case the layer ever renders outside a containment context (e.g. detached test mounts).

#### Step 3 — `components/DecorationLayer.tsx`

Same: no change required (`fontSize: 'calc(40 * var(--cover-px, 0.001))'` keeps working).

#### Step 4 — `hooks/useCoverRender.ts`

Simplify:
- Remove the `pixelRatio = clientW > 0 ? width / clientW : 2` line; the export-size DOM no longer needs JS-side pixel-ratio coordination because cqw resolves naturally to the larger size during the foreignObject pass. Pass `pixelRatio: 1` explicitly.
- Keep `width`, `height`, `canvasWidth`, `canvasHeight` at the native export size.

```ts
const blob = await htmlToImage.toBlob(node, {
  width,
  height,
  pixelRatio: 1,
  cacheBust: false,
  canvasWidth: width,
  canvasHeight: height,
});
```

#### Defensive fallback (only if container queries are flaky inside html-to-image's foreignObject)

If post-merge testing reveals that some browsers do not evaluate `cqw` inside foreignObject (this is a documented edge in older Safari betas), add the following one-shot resize inside `useCoverRender.render()` immediately before `tryRender(full.width, full.height)`:

```ts
const stage = previewRef.current!;
const prev = { width: stage.style.width, height: stage.style.height, position: stage.style.position };
stage.style.width = `${full.width}px`;
stage.style.height = `${full.height}px`;
// Hide the resized stage off-screen so the user does not see it flicker.
stage.style.position = 'fixed';
stage.style.left = '-99999px';
void stage.offsetHeight;                              // force layout
await new Promise(r => requestAnimationFrame(r));      // give CSS one frame to settle
try {
  return await tryRender(full.width, full.height);
} finally {
  stage.style.width = prev.width;
  stage.style.height = prev.height;
  stage.style.position = prev.position;
}
```

This fallback is ONLY to be added if a regression is observed. Default execution: ship the cqw-only path.

### Tests (final)

Vitest (`__tests__/coverRender.test.tsx`):
1. Mount `CoverPreview` inside a `<div style="width: 400px">` and assert that `getComputedStyle(textLayer).fontSize` ≈ `layer.fontSize * 400 / nativeW` (±1px).
2. Re-mount inside `<div style="width: 1920px">` and assert ≈ `layer.fontSize * 1920 / nativeW`.

Manual:
- Open cover modal, pick `tutorial` template, click Download. Open the PNG; the title text occupies the same proportional area as in the preview (visual diff).

### Risks (refined)

- `containerType: inline-size` introduces a new containing block for absolutely-positioned descendants. The current absolute-positioned text and decoration layers are sized via `top`/`left`/`width` percentages of the same stage — the containing block change is a no-op for them. Verified by reading `EditableTextLayer.tsx:78-81` and `DecorationLayer.tsx:30-37`.
- `html-to-image@1.x` has shipped foreignObject CSS containment support since 1.10 (Sep 2024); the project's `package.json` should pin ≥ 1.10. Add a guard during implementation: read the current pin and bump if needed.

---

## Bug #2 — Frame scrubber has no accessible name (P1) — UNCHANGED

Original plan is correct. Final form:

```tsx
const tooltipId = useId();
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
  ...
/>
```

Plus the i18n key updates in the cross-cutting section below.

---

## Bug #3 — Editable text layers have no accessible name / placeholder (P1) — UNCHANGED

Original plan is correct. Two notes for the implementer:

1. Place the `[contenteditable][data-placeholder]:empty::before { content: attr(data-placeholder); ... }` rule in `src/app/globals.css` next to existing global utility rules. Use a class scope to avoid leaking to other contenteditables: `.cover-text-layer[data-placeholder]:empty::before { ... }`. Then add `className="cover-text-layer"` on the `<div contentEditable>` in `EditableTextLayer.tsx`.
2. The `capitalize` helper is one line — `(s: string) => s.charAt(0).toUpperCase() + s.slice(1)` — define inline.

---

## Bug #4 — Invalid color silently reverts (P2) — UNCHANGED IMPL, INTERFACE UPDATE REQUIRED

Original code in the plan is correct. The TypeScript `videoCoverModal.textTools` interface (i18n.ts:1151-1162) must be extended with the new keys (see cross-cutting section). Without this, `t.videoCoverModal?.textTools?.colorSwatch` will be `undefined` at runtime AND fail `npm run type-check` if accessed without the optional chain.

Required test:
```ts
// __tests__/textStyleToolbar.test.tsx
it('rejects invalid hex on commit', () => {
  // type "#XYZ", blur → expect colorError visible, onChange NOT called.
});
```

---

## Bug #5 — Size spinbutton silently clamps (P2) — CORRECTED

The original plan's `commitSize()` has an empty-input bug. If the user selects-all + delete + tab-out, `sizeDraft` becomes `''`, `Number.parseInt('', 10)` is `NaN`, the early-return leaves the visual input blank, and the layer's `fontSize` retains its old value — i.e. the input *displays as cleared* but the model is still `72`.

### Final `commitSize()`:

```ts
const commitSize = () => {
  const v = Number.parseInt(sizeDraft, 10);
  if (!Number.isFinite(v)) {
    // Reject empty / non-numeric: snap back to the canonical model value.
    setSizeDraft(String(layer?.fontSize ?? 72));
    setClampedFrom(null);
    return;
  }
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
```

Also: clear the timeout in a `useEffect` cleanup to avoid stale `setState` after unmount:

```ts
useEffect(() => () => {
  if (clampTimerRef.current) clearTimeout(clampTimerRef.current);
}, []);
```

i18n key `sizeClamped` is added to both the interface and the locale bags (cross-cutting section).

---

## Bug #6 — Programmatic events on the frame scrubber are ignored (P2) — SCOPE TRIMMED

The original plan proposed two complementary tactics:

1. ✅ Switch the input from controlled (`value=`) to uncontrolled (`defaultValue=` + ref + `useEffect` that mirrors prop changes).
2. ❌ Expose an imperative `setFrameSec` via `forwardRef` + `useImperativeHandle`.

**Drop tactic 2.** It is justified only by "future automation needs" and adds:
- A `forwardRef` boundary that breaks the current default export pattern,
- A new public type (`FrameScrubberHandle`),
- An additional code path that duplicates the `onChange` handler.

The bug (programmatic `dispatchEvent(new Event('input'))` is ignored) is fully resolved by tactic 1 alone — that converts the field to an uncontrolled input which accepts native value writes via the descriptor's `set`. Vitest can verify with the well-known pattern:

```ts
// __tests__/frameScrubber.test.tsx
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
setter.call(inputEl, '50');
inputEl.dispatchEvent(new Event('input', { bubbles: true }));
expect(onChange).toHaveBeenCalledWith(50);
```

### Final `FrameScrubber` slider block:

```tsx
const inputRef = useRef<HTMLInputElement | null>(null);

useEffect(() => {
  const el = inputRef.current;
  if (!el) return;
  const next = String(Math.min(max, Math.max(0, draftSec)));
  if (el.value !== next) el.value = next;
}, [draftSec, max]);

<input
  ref={inputRef}
  type="range"
  aria-labelledby={tooltipId}
  aria-valuetext={locked ? labels.noVideoItems : labels.atTime.replace('{time}', formatTime(draftSec))}
  min={0}
  max={max}
  step={0.05}
  defaultValue={String(Math.min(max, Math.max(0, valueSec)))}
  disabled={locked}
  className="w-full disabled:opacity-50"
  onChange={(e) => {
    const v = Number.parseFloat(e.target.value);
    if (!Number.isFinite(v)) return;
    setDraftSec(v);
    onChange(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onCommit(v), DEBOUNCE_MS);
  }}
/>
```

---

## Bug #7 — Switching to Upload wipes the preview (P2) — CORRECTED

The original plan's two-step `setState` chain inside `handleSourceChange` is a side-effecting reducer (a setState updater that calls `setBackgroundUrl`). React 18 strict mode runs updaters twice in dev, leading to a double `setBackgroundUrl` invocation. Replace with a clean two-touch fix.

### Final `handleSourceChange` in `VideoCoverModal.tsx:171-185`:

```ts
const handleSourceChange = useCallback((source: ImageSource) => {
  setState((prev) => {
    if (!prev) return prev;
    if (source === 'frame') {
      return {
        ...prev,
        imageSource: 'frame',
        uploadedImageUrl: null,
        frameVirtualTimeMs: prev.frameVirtualTimeMs ?? 0,
      };
    }
    return { ...prev, imageSource: 'upload', frameVirtualTimeMs: null };
  });
  // Critical: do NOT clear `backgroundUrl` here. The existing useEffect at
  // VideoCoverModal.tsx:109-124 owns the background — we only need to make
  // sure that effect does not stomp over the existing background when the
  // user switches into upload-mode without a saved upload (the "ghost
  // background" affordance from the bug report).
}, []);
```

### Final `useEffect` at `VideoCoverModal.tsx:109-124`:

```ts
useEffect(() => {
  if (!isOpen) return;
  if (!state) return;
  if (state.imageSource === 'upload') {
    if (state.uploadedImageUrl) {
      setBackgroundUrl(state.uploadedImageUrl);
    }
    // No uploadedImageUrl → keep the previous frame as a ghost background.
    // Intentionally do NOT call setBackgroundUrl(null) here.
    return;
  }
  const ms = state.frameVirtualTimeMs ?? 0;
  void frameExtraction
    .extractAt(ms / 1000)
    .then((dataUrl) => setBackgroundUrl(dataUrl ?? null))
    .catch(() => {
      /* swallow — empty timeline will simply leave the background null */
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [isOpen, state?.frameVirtualTimeMs, state?.imageSource, state?.uploadedImageUrl]);
```

The "60% opacity ghost behind the upload dropzone" from the original plan is **dropped from this round**: it is a UI-polish nicety with no measurable user-value gain over the simpler "keep the last frame visible" fix. Re-introduce later if user testing flags confusion.

---

## Bug #8 — Empty-timeline state lacks tooltip / explanation (P3) — INTERFACE FIX REQUIRED

Original plan is right except the `RadioPill` component does not currently accept or forward a `title` prop. Two-line addition:

### `components/SourceToggle.tsx` — extend `RadioPillProps` and forward:

```tsx
interface RadioPillProps {
  label: string;
  active: boolean;
  disabled?: boolean;
  title?: string;          // NEW
  onClick: () => void;
}

const RadioPill: React.FC<RadioPillProps> = ({ label, active, disabled, title, onClick }) => (
  <button
    type="button"
    aria-pressed={active}
    disabled={disabled}
    title={title}            // NEW
    onClick={onClick}
    className={...}
  >
    {label}
  </button>
);
```

Then pass `title` from the `frame` pill:

```tsx
<RadioPill
  label={labels.frame}
  active={value === 'frame'}
  disabled={!!frameDisabled}
  title={frameDisabled ? labels.frameDisabledHint : undefined}
  onClick={() => onChange('frame')}
/>
```

The empty-state helper banner in `VideoCoverModal.tsx` is added under the `<SourceToggle>` block (NOT inside the upload branch — because when `frameDisabled` triggers, the auto-flip useEffect has already moved `imageSource` to `upload`):

```tsx
<SourceToggle ... />
{frameExtraction.totalVirtualDurationSec <= 0 && (
  <p className="text-xs text-muted-foreground italic">
    {t.videoCoverModal?.source?.noFramesAvailable ?? 'No frames available — upload an image instead.'}
  </p>
)}
```

---

## Cross-cutting: i18n additions (3 places, not 2)

The original plan called out only the two locale blocks (3793 EN, 6474 ZH) but **forgot the TypeScript interface** at line 1132. All three must be updated, otherwise either compilation fails or the runtime returns `undefined`.

### Interface (i18n.ts ~line 1132)

Edit the `videoCoverModal` block:

```ts
videoCoverModal: {
  title: string;
  button: string;
  templates: { ... };
  source: {
    label: string;
    frame: string;
    upload: string;
    frameDisabledHint: string;        // NEW
    noFramesAvailable: string;        // NEW
  };
  scrubber: { ... };
  textTools: {
    font: string;
    size: string;
    color: string;
    align: string;
    alignLeft: string;
    alignCenter: string;
    alignRight: string;
    bold: string;
    italic: string;
    underline: string;
    colorSwatch: string;              // NEW
    colorInvalid: string;             // NEW
    sizeClamped: string;              // NEW
  };
  upload: { ... };
  actions: { ... };
  errors: { ... };
  a11y: {                             // NEW sub-object
    layerBadge: string;
    layerTitle: string;
    layerSubtitle: string;
    layerEyebrow: string;
    layerCta: string;
    layerGeneric: string;
    frameSlider: string;
  };
};
```

### English block (i18n.ts ~line 3793)

```ts
source: {
  label: 'Source',
  frame: 'Frame',
  upload: 'Upload',
  frameDisabledHint: 'Add a video clip to your timeline to pick a frame',
  noFramesAvailable: 'No frames available — upload an image instead.',
},
textTools: {
  ...,
  colorSwatch: 'Color picker',
  colorInvalid: 'Use a hex like #fff or #ffffff',
  sizeClamped: 'Clamped {from} → {to}',
},
a11y: {
  layerBadge: 'Badge text',
  layerTitle: 'Title text',
  layerSubtitle: 'Subtitle text',
  layerEyebrow: 'Eyebrow text',
  layerCta: 'Call-to-action text',
  layerGeneric: '{key} text',
  frameSlider: 'Drag to pick a frame',
},
```

### Chinese block (i18n.ts ~line 6474)

```ts
source: {
  label: '来源',
  frame: '视频帧',
  upload: '上传',
  frameDisabledHint: '请先在时间轴添加视频片段，再选取封面帧',
  noFramesAvailable: '暂无可用帧 —— 请上传一张图片',
},
textTools: {
  ...,
  colorSwatch: '颜色选择器',
  colorInvalid: '请输入十六进制颜色，如 #fff 或 #ffffff',
  sizeClamped: '已自动调整：{from} → {to}',
},
a11y: {
  layerBadge: '徽章文字',
  layerTitle: '标题文字',
  layerSubtitle: '副标题文字',
  layerEyebrow: '眉头文字',
  layerCta: '行动号召文字',
  layerGeneric: '{key} 文字',
  frameSlider: '拖动以选取一帧',
},
```

---

## Implementation order (final)

| Step | Bug(s) | Files | LoC |
|------|--------|-------|-----|
| 0 | Cross-cutting | `src/lib/i18n.ts` | ~50 (interface + 2 locale blocks) |
| 1 | #1 | `components/CoverPreview.tsx`, `hooks/useCoverRender.ts` | ~30 (mostly deletions) |
| 2 | #6 | `components/FrameScrubber.tsx` | ~15 |
| 3 | #2 + #3 | `components/FrameScrubber.tsx`, `components/EditableTextLayer.tsx`, `src/app/globals.css` | ~40 |
| 4 | #4 + #5 | `components/TextStyleToolbar.tsx` | ~80 |
| 5 | #7 + #8 | `VideoCoverModal.tsx`, `components/SourceToggle.tsx` | ~25 |

**Step 0 must precede every other step** — otherwise the type-check breaks the moment a step references the new keys.

Each step is independently testable with `npm run type-check` + `npm run lint` + `npm test -- VideoCoverModal`.

---

## Verification checklist (final, before merging each step)

- [ ] `npm run type-check` passes (extra emphasis: TS interface updated alongside locale blocks)
- [ ] `npm run lint` passes
- [ ] `npm test -- VideoCoverModal` passes (including new Vitest cases listed below)
- [ ] **Bug #1 manual**: open the cover modal on a 16:9 project, pick `tutorial`, click Download, open the PNG and visually compare to the preview at the same scale — text and decorations occupy the same fraction of the canvas.
- [ ] **Bug #2/3 a11y**: every `[contenteditable]` and the `<input type="range">` inside the cover modal have non-empty `aria-label` / `aria-labelledby`.
- [ ] **Bug #4 manual**: type `#XYZ` in the color text input → blur → see the inline error and the swatch color does not change to garbage.
- [ ] **Bug #5 manual**: type `999` in the Size input → blur → see "Clamped 999 → 400" helper for ~3s. Also: clear the field → blur → field snaps back to current size.
- [ ] **Bug #6 manual**: in DevTools console run `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call($('input[type=range]'), '50'); $('input[type=range]').dispatchEvent(new Event('input', {bubbles: true}))` — the preview updates and the time readout matches.
- [ ] **Bug #7 manual**: with a frame already extracted, switch source to Upload → the existing frame remains visible behind the empty drop zone.
- [ ] **Bug #8 manual**: open the cover modal on a project with NO timeline items → hover the disabled "Frame" pill → tooltip shows the localized hint. Below the source toggle the helper banner reads "No frames available — upload an image instead."

---

## Vitest test additions (concrete file paths)

| File | Cases |
|------|-------|
| `src/components/video/components/VideoCoverModal/__tests__/coverPreview.test.tsx` | (1) cqw font scaling at 400px and 1920px container widths; (2) `containerType: inline-size` is set on the stage. |
| `src/components/video/components/VideoCoverModal/__tests__/textStyleToolbar.test.tsx` | (1) `#XYZ` triggers colorError + does NOT call `onChange`; (2) `Size = 999` clamps to 400 and shows helper; (3) `Size = ''` snaps back to current `layer.fontSize`. |
| `src/components/video/components/VideoCoverModal/__tests__/frameScrubber.test.tsx` | (1) native value-setter dispatch produces an `onChange` call; (2) `aria-labelledby` references a `<span>` containing the localized tooltip. |
| `src/components/video/components/VideoCoverModal/__tests__/sourceToggle.test.tsx` | (1) disabled Frame pill carries the `title` attribute when `frameDisabled` is true. |
| `src/components/video/components/VideoCoverModal/__tests__/videoCoverModal.test.tsx` | (1) switching Frame → Upload (with no uploaded image) keeps `backgroundUrl` non-null; (2) the empty-frames helper banner renders when `totalVirtualDurationSec === 0`. |

---

## Final approval

✅ Plan is now technically correct, complete, and free of side-effecting reducers, missing-interface compile breaks, and incorrect CSS units.

Proceed to **Subtask #3: 步骤4 — 开始代码Bug修复** using this document as the single source of truth.
