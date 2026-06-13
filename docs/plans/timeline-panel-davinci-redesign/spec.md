# Timeline Panel — DaVinci-grade Visual Redesign (spec.md)

- **Feature slug**: `timeline-panel-davinci-redesign`
- **Owner node**: Subtask #0 (方案设计)
- **Scope**: Visual / interaction redesign of the video-editor timeline panel (剪辑轨道区域) — ruler tick lines (刻线), background grid (网格线), the playhead/cursor (光标), tracks, clips, and the surrounding buttons. The goal is a *beautiful, elegant, top-tier* look that converges on professional NLEs (DaVinci Resolve / Premiere) **while keeping all existing functionality byte-for-byte correct**.
- **Status**: v2 (reviewed & fixed by Subtask #1 — 2026-06-13)
- **Non-goals**: No change to timeline data model, store actions, drag/resize/cut state machine, export pipeline, or playback engine. This is a presentation-layer refactor plus three small pure-function/presentational modules.

---

## 评审记录

> 评审人：Subtask #1（资深方案评审，Anthropic 工程团队）。评审维度：**可行性 / 完整性 / 一致性 / 规模适配**。本轮评审基于对真实代码的逐一核对：`TimelineRuler.tsx`、`Track.tsx`、`TrackContainer.tsx`、`timelineItemStyles.ts`（及 `__tests__/timelineItemStyles.test.ts`）、`constants.ts`、`timeFormat.ts`、`TimelinePanel.tsx` 的双滚动同步链路、`globals.css` 主题块、`video-editing.css` 遗留样式、以及 `TimelineToolbar.comingSoon` / `TimelineItem.filmstrip` 等源码文本断言型测试。结论见文末「评审结论」。

| # | 维度 | 严重度 | 问题 | 处置 |
|---|---|---|---|---|
| R1 | 完整性 / 正确性 | **P1** | §2.3 的 `computeRulerTicks` 分级描述用浮点取模 `time % majorInterval ≈ 0`，且「`else 'minor'`，`else 'subMinor'`」表述自相矛盾（两个 else）、无法直接实现；epsilon「按 interval 缩放的 `1e-6`」也未定义清楚，存在错分级 / 漏标签风险。 | **已修复**：§2.3 改写为**整数索引驱动**算法，用 `i % (r*q)` / `i % r` 的整数判定层级，逐刻循环内不再做任何浮点取模；新增 `MAX_TICKS` 兜底上限。 |
| R2 | 完整性 / 正确性 | **P1** | §2.3/§2.4 用 `computeRulerTicks` 取代 `generateTimeMarks`、用 `TimelinePlayhead` 取代上下两段光标时，**未复述必须原样保留的既有功能契约**：空时间轴仅渲染单个 `0:00`、`disabledWhenEmpty` 拖拽/键盘门控、播放头手柄 `hasItems` 指针门控、`role="slider"` a11y、`scrollLeft` 双向同步。实施时极易回归（出现幻影可拖拽刻度）。 | **已修复**：新增 §2.7「保留的功能契约」逐条固化这些不变量，并要求 `computeRulerTicks` 在 `paddedDuration <= 0` 时只返回单个 `time=0` major。 |
| R3 | 一致性 | **P2** | 遗留 CSS `.timeline-playhead` / `.timeline-grid-line`（`src/styles/video-editing.css` 约 1564–1610 行）已无任何 `className` 引用（全仓仅 `data-testid` 同名），系 v1 内联播放器残留的死代码，方案文件清单未纳入，且与新建 `TimelinePlayhead` 存在潜在类名冲突。 | **已修复**：§3 文件清单新增一行，要求清理该遗留 timeline 播放头 / 网格规则。 |
| R4 | 正确性 / 表述 | **P2** | `INTERVAL_LADDER_SEC` 中 `0.04 / 0.1 / 0.2` 在 `ZOOM_MAX=5`（250px/s）+ `MIN_MAJOR_LABEL_PX=72` 下永不可能被选为 `majorInterval`（需 `v ≥ 0.288`），「frame-aware ruler」的帧级**标签**实际无法达成（仅 minor 刻度可细到 ~0.05s）。 | **已修复**：§2.3 增补「可达区间」说明，澄清帧级仅体现在 minor 刻度，并标注不可达项仅用于 minor/subMinor 推导（可选裁剪）。 |
| R5 | 一致性 / DRY | **P2** | 头部宽度 `192` 现散落三处（`TrackContainer` 局部 `const`、ruler `w-48` class、新 token），ruler 高度 `32` 散落 `h-8` class 与 `RULER_HEIGHT` token 两处，易发散。 | **已修复**：§3 要求 `TrackContainer` 改为从 `timelineTheme` 引入 `TRACK_HEADER_WIDTH`（删除局部 `const`），并注明 `h-8`/`w-48` 与 token 的单一来源关系。 |
| R6 | 规模适配 | **P2（条件）** | `Track.tsx`(637) / `TrackContainer.tsx`(535) 重写后逼近 CLAUDE.md 的 800 行红线；`TimelinePanel.tsx` 已 1033 行（本方案不改动它）。 | 记录为放行条件 C1（见评审结论）。 |
| R7 | 一致性 | **P2（条件）** | §2.5 要求 token 写入 `:root`/`.dark`/`.light`，但未确认 `globals.css` 中 `:root` 是否即暗色默认基线；若是，向 `:root` 与 `.dark` 写入相同值会重复维护。 | 记录为放行条件 C2（见评审结论）。 |

**无 P0 问题。** 方案对 `computeItemStyles` 既测返回值、`data-testid="timeline-playhead"`、aria、`+TRACK_HEADER_WIDTH` 共线性、`color-mix` 既有用法（`timelineItemStyles.ts:76`）、`setScrollLeft` 滚动同步（`TimelinePanel.tsx:921/935`）等关键契约核对无误，不存在破坏构建或破坏既测契约的阻断项。所列回归测试中的 `TimelineToolbar.comingSoon.test.ts`、`TimelineItem.filmstrip.test.tsx` 等为**源码文本断言型**用例，重排版时须保留其断言所依赖的源码子串（已在 §2.7/评审结论 C3 强调）。

---

## 1. Overview

The timeline panel is the bottom region of the video editor. It is composed of three stacked rows inside `TimelinePanel.tsx`: a **toolbar** (`TimelineToolbar`), a **ruler** (`TimelineRuler`), and a **track container** (`TrackContainer` → many `Track` → many `TimelineItem`). It is the single, sole preview-and-edit surface (the v1 inline player and the `playback-v2` flag were removed in the `local-video-editing-refactor`), so its polish directly shapes the perceived quality of the whole product.

Today the surface reads as visually unfinished in three specific ways that the user called out. (1) The **tick lines** are rendered as a flat row of identical `border-l border-border` divs with labels only on every fifth mark, with no real major/minor hierarchy and a label format that shows hundredths even when zoomed far out. (2) The **background grid** is drawn twice and heavily: once per second across the ruler (`TimelineRuler.tsx:424-437`) and again as a full-opacity `var(--border)` `repeating-linear-gradient` inside every track lane (`Track.tsx:575-582`); at default zoom this paints a hard 1px line every 50px on every lane, which looks like graph paper, not an NLE. (3) The **cursor/playhead** is inconsistent — the ruler shows a solid 2px-ish red bar with two small red rectangles (`TimelineRuler.tsx:386-411`), while the track area shows a *different* element: a red **dashed** line with two filled circles (`TrackContainer.tsx:318-332`). The two never read as one continuous playhead.

This redesign introduces a small set of shared visual primitives — a **timeline design-token module**, a **pure ruler-tick model**, a **shared two-tier grid builder**, and a **single playhead presentational component** — and rewires the existing components to consume them. The result is an adaptive, frame-aware ruler with a clear major/minor/sub-minor tick hierarchy and non-overlapping timecode labels; one subtle, theme-aware two-tier grid that is perfectly aligned with the ruler ticks across every lane; and one crisp, continuous playhead with a polished top handle in the ruler that flows as a single thin line through the tracks. Tracks, clips, and buttons are restyled for consistent spacing, hover/active feedback, per-type color accents, and refined depth, all driven from the same tokens. Because the change is presentation-only and the tested pure functions keep their existing return contracts, functional risk is contained and verifiable by the existing test suite plus the mandatory desktop walkthrough gate.

---

## 2. Technical design

### 2.1 Design principles (the "DaVinci look")

1. **Two-tier (really three-tier) rhythm.** Major lines/ticks at labeled "nice" time stops; minor lines/ticks subdividing them; optional sub-minor hairlines at the finest zoom. Major ≈ 1px at higher contrast; minor ≈ 1px at low alpha; sub-minor only as short ruler ticks, never as grid lines.
2. **Quiet grid, loud content.** The grid sits far back (low alpha, derived from `--border`), so clips and the playhead are the focal points. Never a hard full-opacity line on every lane.
3. **One playhead.** A single accent-red vertical line with a handle in the ruler, visually continuous into the tracks. No dashed line, no circles.
4. **Adaptive density.** Tick/label/grid spacing is chosen from `pixelsPerSecond` so labels never collide and minor lines never moiré, across the whole zoom range (`ZOOM_MIN 0.1` → `ZOOM_MAX 5.0`, i.e. 5–250 px/s).
5. **Theme-aware tokens.** All new colors are CSS variables defined for `.dark` (primary) and `.light`, derived from existing theme variables via `color-mix` (already used in the repo at `timelineItemStyles.ts:76`) with solid fallbacks.
6. **Zero functional drift.** No store/prop/handler changes; preserved DOM hooks (`data-testid="timeline-playhead"`, `data-clip-id`, `.timeline-item`, `.track-controls`, `.timeline-item` etc.) and the exact tested return values of `computeItemStyles`.

### 2.2 New shared primitives

**(A) `theme/timelineTheme.ts` — design tokens.** A single TS module exporting numeric layout constants and CSS-variable strings used by every timeline component. Keeping them here (and the colors in `globals.css`) means one place to tune the look. No JSX. Exports include `TIMELINE_LAYOUT` (ruler height, header width = 192 to match `TRACK_HEADER_WIDTH`, tick heights, min label/minor spacing), `TIMELINE_COLORS` (CSS-var references), `PLAYHEAD`, and `CLIP` style constants.

**(B) `lib/rulerTicks.ts` — pure tick model + interval picker (shared source of truth).** Exposes:
- `pickTickIntervals(pixelsPerSecond: number): TickIntervals` — the single adaptive "nice number" chooser used by **both** the ruler and the grid, guaranteeing they line up.
- `computeRulerTicks(opts): RulerTick[]` — given the intervals, the padded duration, and an optional visible `[startSec, endSec]` window, returns the list of ticks to render (with `tier` and optional `label`), viewport-culled for performance.
- `formatRulerLabel(seconds, majorIntervalSec): string` — wraps `formatTimelineTime` so labels drop centiseconds when the major step ≥ 1s and show them only at sub-second zoom.

**(C) `lib/timelineGrid.ts` — shared grid background builder.** `buildGridBackground(pixelsPerSecond, intervals): CSSProperties` returns a layered `repeating-linear-gradient` (`major` painted on top, `minor` beneath) so a lane needs **zero** extra DOM to show a perfectly aligned two-tier grid. Because the grid uses the *same* `pickTickIntervals`, the grid lines and ruler ticks coincide by construction.

**(D) `TimelinePlayhead.tsx` — single presentational playhead.** A `pointer-events-none` (except the ruler handle) component with two variants: `variant="ruler"` renders the crisp line plus a top handle (a downward pentagon via `clip-path`), `variant="track"` renders just the continuous line. Both read `--timeline-playhead`. The ruler instance keeps `data-testid="timeline-playhead"` so existing tests/queries still resolve.

### 2.3 Adaptive interval algorithm (precise)

```
INTERVAL_LADDER_SEC = [0.04, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
MIN_MAJOR_LABEL_PX = 72   // min horizontal gap between *labeled* (major) ticks
MIN_MINOR_TICK_PX  = 9    // min gap between minor ticks (anti-moiré)
SUBDIVISIONS       = [10, 5, 4, 2]  // tried in order; major / subdivision = minor

pickTickIntervals(pps):
  majorInterval = first v in INTERVAL_LADDER_SEC where v * pps >= MIN_MAJOR_LABEL_PX
                  (fallback: last ladder value if none qualifies)
  minorInterval = majorInterval
  for sub in SUBDIVISIONS:
      candidate = majorInterval / sub
      if candidate * pps >= MIN_MINOR_TICK_PX:
          minorInterval = candidate; break
  subMinorInterval = (minorInterval/2)*pps >= MIN_MINOR_TICK_PX ? minorInterval/2 : null
  return { majorInterval, minorInterval, subMinorInterval }
```

`computeRulerTicks` is **index-driven** (not float-accumulating) so tier classification can never drift or mis-place a label (resolves review R1). Let `step = subMinorInterval ?? minorInterval` be the finest rendered spacing, and derive two **exact small integers** by construction (since `minorInterval = majorInterval / sub` and `subMinorInterval = minorInterval / 2`):

```
r = round(minorInterval / step)      // minor-per-step  (1 when no subMinor, 2 with subMinor)
q = round(majorInterval / minorInterval)  // minor-per-major (= the chosen `sub`)
```

`round(...)` (with `ZOOM_EPSILON` tolerance) is applied **only** to these two ratios — never inside the per-tick loop. Compute integer window bounds `i0 = floor(startSec / step)` and `i1 = ceil(endSec / step)`; then for each integer `i ∈ [i0, i1]` set `time = i * step` and classify by integer arithmetic:

```
tier = (i % (r * q) === 0) ? 'major'
     : (i % r === 0)       ? 'minor'
     :                       'subMinor'
```

Only `major` ticks carry `label = formatRulerLabel(time, majorInterval)`. As a defensive backstop the loop is hard-capped at `MAX_TICKS = 4000` nodes (it `console.warn`s and stops if exceeded — unreachable under correct culling, but it prevents a pathological DOM blow-up if culling ever returns a bad window). The visible window is derived in the ruler from `scrollLeft` (store — kept live by `setScrollLeft` in `TimelinePanel.handleRulerScroll`/`handleTrackScroll`, verified at `TimelinePanel.tsx:921/935`) and the scroll element's `clientWidth` (a `ResizeObserver` on `scrollRef.current` → state, **registered and torn down in a `useEffect` cleanup**), padded by one `clientWidth` on each side; if `clientWidth` is unknown (`0`/SSR) it falls back to the full `paddedDuration` so it never renders fewer ticks than today.

> **Reachable-interval note (review R4).** Given `ZOOM_MAX = 5` ⇒ `pps ≤ 250` and `MIN_MAJOR_LABEL_PX = 72`, the smallest selectable `majorInterval` is `0.5s` (needs `v·pps ≥ 72` ⇒ `v ≥ 0.288`). The ladder entries `0.04 / 0.1 / 0.2` can therefore **never** be chosen as a *labeled* major, so "frame-aware" granularity is delivered only at the **minor** tick level (down to ~`0.05s` at max zoom), not as frame-numbered labels. Those three sub-`0.5s` entries are retained solely because `minorInterval = majorInterval / sub` may still land on them; an implementer MAY prune `INTERVAL_LADDER_SEC` to `[0.5, 1, 2, 5, …]` with no behavioral change. Do not advertise per-frame labels in UI copy.

### 2.4 Key code paths & render sequence

1. **Zoom or scroll changes** → store updates `zoomLevel` / `scrollLeft` → `TimelineRuler`, `TrackContainer`, `Track` re-read via existing `useShallow` selectors.
2. `pixelsPerSecond = zoomLevel * 50` (unchanged). `const intervals = pickTickIntervals(pixelsPerSecond)` is computed in the ruler **and** in `Track` (same fn ⇒ identical result ⇒ aligned).
3. **Ruler**: compute visible `[t0,t1]`; `const ticks = computeRulerTicks({ intervals, paddedDuration, startSec: t0, endSec: t1, pixelsPerSecond })`; render ticks (positioned `left = time*pps`, height by tier, anchored to the ruler's bottom edge) + labels (centered above majors, `font-mono`). Render `<TimelinePlayhead variant="ruler" left={currentTime*pps} interactive />`. The redundant per-second grid block (`:424-437`) is **removed**.
4. **Track lane**: `style={{ ...buildGridBackground(pps, intervals) }}` replaces the current single hard gradient. Identical intervals ⇒ identical grid on every lane, aligned with the ruler.
5. **TrackContainer**: replace the dashed-red alignment line with `<TimelinePlayhead variant="track" left={currentTime*pps + TRACK_HEADER_WIDTH} />`. The `+ TRACK_HEADER_WIDTH` is retained because the track scroll content includes the 192px header column at its left (the ruler's control panel is non-scrolling, but both map `time=0` to the same on-screen x at any `scrollLeft`, so the two playhead segments stay collinear).
6. **Clip** (`TimelineItem` + `computeItemStyles`): refined background gradient, idle border, and depth shadow added; **all currently-tested values preserved** (see §2.6). Trim handles restyled (DaVinci bracket style) without changing the resize hit-area semantics.
7. **Drag/seek**: `handleMouseDown`/`handleScrubKeyDown` in the ruler are unchanged → `setCurrentTime` → both playhead segments move together.

### 2.5 Token values (concrete)

Added to `globals.css` under `:root`, `.dark` (same), and `.light` (overrides marked):

```css
--timeline-ruler-bg:      var(--muted);
--timeline-lane-bg:       var(--card);
--timeline-grid-minor:    color-mix(in srgb, var(--border) 38%, transparent);  /* light: 55% */
--timeline-grid-major:    color-mix(in srgb, var(--border) 80%, transparent);  /* light: 90% */
--timeline-tick-minor:    color-mix(in srgb, var(--muted-foreground) 45%, transparent);
--timeline-tick-major:    var(--muted-foreground);
--timeline-tick-label:    var(--muted-foreground);
--timeline-playhead:      #FF4D4F;                 /* crisp NLE red; theme-stable */
--timeline-playhead-glow: rgba(255, 77, 79, 0.30);
--timeline-clip-border:   rgba(0, 0, 0, 0.28);     /* idle 1px definition border */
--timeline-clip-sheen:    rgba(255, 255, 255, 0.10);
--timeline-accent-video:    #0D99FF;  /* matches text-blue-600 family / --primary */
--timeline-accent-image:    #8B5CF6;  /* purple */
--timeline-accent-audio:    #14B8A6;  /* teal/green */
--timeline-accent-subtitle: #F59E0B;  /* amber */
```

Layout constants in `timelineTheme.ts`: `RULER_HEIGHT = 32`, `TRACK_HEADER_WIDTH = 192`, `TICK_MAJOR_H = 14`, `TICK_MINOR_H = 8`, `TICK_SUBMINOR_H = 4`, `TICK_LABEL_FONT_PX = 11`, `MIN_MAJOR_LABEL_PX = 72`, `MIN_MINOR_TICK_PX = 9`, `PLAYHEAD_WIDTH = 1`, `PLAYHEAD_HANDLE_W = 11`, `PLAYHEAD_HANDLE_H = 12`, `CLIP_RADIUS = 4`, `CONTROL_BTN = 22` (≥ current 20, improves hit area without crowding short lanes).

### 2.6 Hard invariant: `computeItemStyles` tested values

`__tests__/timelineItemStyles.test.ts` asserts exact values. The redesign **must preserve** all of them: `left`/`width` (20px min clamp), `cursor` grab/grabbing, `transition` `'all 0.2s ease'`/`'none'`, `zIndex` `1/10/9`, `opacity` `0.8/0.65`, swap outline `'2px dashed #22d3ee'` + glow `rgba(34, 211, 238, 0.25)`, selected borders video `'2px solid var(--primary)'`, audio `'2px solid #10b981'`, subtitle `'2px solid #f59e0b'`, and **idle `outline` undefined**. Refinements may only ADD/alter the *non-asserted* `background` gradient, the idle (non-selected) `border`, and a non-selected depth `boxShadow`. Any change beyond that requires editing the test in the same change (call it out for Subtask #2/#3).

### 2.7 Preserved functional contracts (zero-drift guarantees)

Rewriting `generateTimeMarks` → `computeRulerTicks` and extracting the two cursors → `TimelinePlayhead` **must preserve these existing behaviors verbatim** (added in review R2 — they are the *functional* contract, not styling, and are the most likely place to silently regress):

1. **Empty timeline.** When `!hasItems` (the authoritative signal; `TimelineAggregate` floors `totalDuration` at ≈`0.001`) **or** `paddedDuration <= 0`, the ruler renders exactly one `0:00` major tick and nothing else. Implement this by (a) keeping the ruler's existing `if (!hasItems) { …single 0:00… }` short-circuit, **and** (b) having `computeRulerTicks` return a single `time=0` major when `paddedDuration <= 0`. No phantom seekable range, no grid.
2. **Scrub gating.** The scroll/slider element keeps `disabledWhenEmpty = !hasItems || totalDuration <= 0` driving `cursor-not-allowed pointer-events-none`, `tabIndex = -1`, `aria-disabled`, and `aria-valuemax = 0`. `calculateTimeFromMouseEvent` and `handleScrubKeyDown` keep their `hasItemsRef`/`hasItems` early-returns and clamping.
3. **Playhead handle gating.** `<TimelinePlayhead variant="ruler" hasItems={hasItems}>` keeps the handle's `pointerEvents: hasItems ? 'auto' : 'none'` and the `cursor-col-resize` ↔ `cursor-not-allowed` swap. The **ruler** instance is the *only* element carrying `data-testid="timeline-playhead"`; the `track` variant must **not** duplicate that test id (it is currently unique in the repo — verified).
4. **a11y.** `role="slider"` plus every `aria-*` attribute and all `t.timeline.ruler.*` / `t.timeline.toolbar.*` i18n strings stay on the existing elements, unchanged.
5. **Drag-scroll & sync.** `handleMouseDown` seek, `handleWheel` Ctrl-zoom, the zoom-ladder buttons, and the ruler↔track `scrollLeft` mirror (`onScroll` → `setScrollLeft`) are untouched, so both playhead segments and the lane grid stay collinear/aligned at every `scrollLeft` and zoom level.
6. **Source-text tests.** Several regression tests assert against *source substrings* rather than rendered DOM (`TimelineToolbar.comingSoon.test.ts`, `TimelineItem.filmstrip.test.tsx`, `TimelineItem.localDownload.test.ts`). Restyling must preserve the substrings they match (the `id: 'effects'/'transitions'` + `comingSoon: true` + `disabled: true` blocks, the `button.comingSoon … featureComingSoon` binding, the `renderFilmstrip|renderClipThumbnails` and `slots.map(` wiring).

---

## 3. File / module change plan

| File | Create/Modify | One-line intent |
|---|---|---|
| `src/components/video/timeline/theme/timelineTheme.ts` | **Create** | Central layout constants + CSS-var token references for the whole timeline. |
| `src/components/video/timeline/lib/rulerTicks.ts` | **Create** | Pure `pickTickIntervals` / `computeRulerTicks` / `formatRulerLabel` (shared source of truth for ruler + grid). |
| `src/components/video/timeline/lib/timelineGrid.ts` | **Create** | `buildGridBackground` → layered two-tier `repeating-linear-gradient` CSS for lanes. |
| `src/components/video/timeline/TimelinePlayhead.tsx` | **Create** | Single presentational playhead (`variant: 'ruler' \| 'track'`), keeps `data-testid="timeline-playhead"`. |
| `src/components/video/timeline/TimelineRuler.tsx` | Modify | Render ticks via `computeRulerTicks` (major/minor/sub + non-overlapping labels, viewport-culled); use `<TimelinePlayhead variant="ruler">`; delete redundant grid block (`:424-437`); restyle left control panel, zoom buttons, time readout, playing pill. |
| `src/components/video/timeline/Track.tsx` | Modify | Lane grid via `buildGridBackground`; restyle header (per-type left accent strip, typography), control buttons (consistent ghost style/hover, 22px), empty-state, drag-over overlay. |
| `src/components/video/timeline/TrackContainer.tsx` | Modify | Replace dashed-red alignment line with `<TimelinePlayhead variant="track">`; **import `TRACK_HEADER_WIDTH` from `timelineTheme` and delete the local `const TRACK_HEADER_WIDTH = 192` (TrackContainer.tsx:64)** so the 192px origin has a single source (review R5); restyle bottom track-management bar, add-track buttons, scroll-fade indicators. |
| `src/components/video/timeline/timelineItemStyles.ts` | Modify | Refine clip `background` gradient + idle `border` + depth `boxShadow` (preserving all tested values per §2.6). |
| `src/components/video/timeline/TimelineItem.tsx` | Modify | DaVinci-style trim/resize handles, label scrim, audio placeholder bars — no logic change. |
| `src/components/video/timeline/TimelineToolbar.tsx` | Modify | Restyle toolbar surface, buttons (consistent size/hover/active for cut), dividers, status chips. |
| `src/styles/globals.css` | Modify | Add `--timeline-*` tokens for `:root`/`.dark`/`.light`; optional `.timeline-panel` scrollbar refinement. |
| `src/styles/video-editing.css` | Modify | **Remove the orphaned legacy `.timeline-playhead` (incl. `::before`/`::after`) and `.timeline-grid-line` rules (~lines 1564–1610, plus the `@media` override ~1761)** — they are v1-inline-player dead CSS with zero `className` references and would collide conceptually with the new `TimelinePlayhead` (review R3). Do not touch unrelated rules in this file. |
| `src/components/video/timeline/__tests__/rulerTicks.test.ts` | **Create** | Unit tests for interval picker monotonicity, label non-overlap, tick-density bounds, label format. |
| `src/components/video/timeline/__tests__/timelineGrid.test.ts` | **Create** | Unit tests for the grid background string (period math, layer order). |

No other source files are touched. No new runtime dependency is introduced (CSS gradients + `clip-path` only).

---

## 4. Interface design

These are **internal module/component interfaces** (TypeScript). There is no REST/WebSocket/CLI surface.

```ts
// lib/rulerTicks.ts
export interface TickIntervals {
  majorInterval: number;      // seconds between labeled ticks
  minorInterval: number;      // seconds between minor ticks
  subMinorInterval: number | null; // seconds, or null when too dense
}
export type TickTier = 'major' | 'minor' | 'subMinor';
export interface RulerTick {
  time: number;               // seconds
  left: number;               // px = time * pixelsPerSecond
  tier: TickTier;
  label?: string;             // present only on major ticks
}
export interface RulerTickOptions {
  pixelsPerSecond: number;
  paddedDuration: number;     // seconds (already padded by TIMELINE_PADDING_SECONDS)
  startSec?: number;          // visible window start (default 0)
  endSec?: number;            // visible window end (default paddedDuration)
  intervals?: TickIntervals;  // default: pickTickIntervals(pixelsPerSecond)
}
export function pickTickIntervals(pixelsPerSecond: number): TickIntervals;
export function computeRulerTicks(opts: RulerTickOptions): RulerTick[];
export function formatRulerLabel(seconds: number, majorIntervalSec: number): string;

// lib/timelineGrid.ts
import type { CSSProperties } from 'react';
export function buildGridBackground(
  pixelsPerSecond: number,
  intervals: TickIntervals,
): CSSProperties;   // { backgroundImage, backgroundRepeat: 'repeat' }

// TimelinePlayhead.tsx
export interface TimelinePlayheadProps {
  left: number;                 // px within the scroll content
  variant: 'ruler' | 'track';
  hasItems?: boolean;           // gate the draggable handle on empty timelines (ruler)
  className?: string;
}
```

`TimelineRuler`, `Track`, `TrackContainer`, `TimelineItem`, `TimelineToolbar` keep their **existing props unchanged** (verified against current signatures). The redesign only changes their JSX/`className`/inline-style bodies.

---

## 5. Data model

No database, migration, or persisted-shape change. No Zustand store field is added or renamed. The only new in-memory shapes are the presentation types above (`TickIntervals`, `RulerTick`, `TimelinePlayheadProps`) plus the token constants in `timelineTheme.ts`. `ItemStyleInputs` / `computeItemStyles` keep their existing signature and tested output keys. Exported timeline JSON, the `TimelineState` callback shape (`TimelinePanel.computeShapeJson`), and the autosave path are untouched, so projects saved before and after this change are bit-compatible.

---

## 6. Testing & acceptance criteria

### 6.1 Automated (vitest — runner is `vitest run`)
- **`rulerTicks.test.ts`** (`@vitest-environment node`): (a) `pickTickIntervals` returns `majorInterval*pps ≥ 72` and `minorInterval*pps ≥ 9` across `pps ∈ {5,12.5,25,50,75,100,150,250}` (the zoom range); (b) `majorInterval` is monotonically non-increasing as `pps` increases; (c) `minorInterval` evenly subdivides `majorInterval`; (d) `computeRulerTicks` over a window yields labels only on `major` ticks and adjacent label `left`s differ by ≥ 72px; (e) `formatRulerLabel` shows centiseconds iff `majorIntervalSec < 1`.
- **`timelineGrid.test.ts`** (node): `buildGridBackground(50, {major:1,minor:0.5,...})` returns a `backgroundImage` containing two `repeating-linear-gradient` layers with periods `50px` (major) and `25px` (minor), with the **major layer listed first** (top).
- **Regression**: `timelineItemStyles.test.ts`, `TimelineToolbar.comingSoon.test.ts`, `TimelineItem.*.test.ts`, `timeFormat.test.ts` must still pass **unchanged** (proves the functional contract held). Run `npx vitest run src/components/video/timeline`.
- **Type/lint**: `npm run type-check` and `npm run lint` clean (no new `any`, `prefer-const`).

### 6.2 Manual / acceptance (DaVinci-convergence checklist — the mandatory desktop walkthrough gate)
1. Ruler shows clear **major (labeled) / minor / sub-minor** ticks; labels never overlap when zooming from 10% → 500% via buttons and Ctrl+wheel.
2. Track grid is **subtle** (no graph-paper effect) and its vertical lines **coincide** with ruler ticks at every zoom and scroll offset.
3. Exactly **one** playhead: red line with a clean top handle in the ruler, continuing as a single thin line through the tracks — no dashed line, no circles, perfectly collinear while scrubbing and during playback.
4. Clips read as polished bars (subtle gradient + definition border + depth) with per-type colors; selection ring and trim handles are crisp; drag/resize/cut/swap still work and the swap-target cyan outline is unchanged.
5. Track headers show a per-type color accent; lock/visibility/volume/select-all/delete/add-track buttons have consistent sizing, hover, and focus rings; tooltips and ARIA labels unchanged.
6. Verified in **dark and light** themes and on the **packaged desktop build** (per project gate), with no console errors and no playback/seek regression.
7. Empty-timeline behavior unchanged (single `0:00` mark, ruler not seekable, empty-state add-track CTA intact).

---

## 7. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Ruler ↔ grid misalignment if interval logic diverges | High | Both call the **same** `pickTickIntervals`; add a unit test asserting both paths consume identical intervals; manual checklist item 2. |
| Playhead segments not collinear (header-offset error) | High | Keep the proven `+ TRACK_HEADER_WIDTH` origin for the track variant; centralize the offset in `timelineTheme.ts`; checklist item 3. |
| Breaking the tested `computeItemStyles` contract | Med | §2.6 lists every frozen value; only non-asserted props may change; regression suite must stay green. |
| Perf regression from many tick DOM nodes at high zoom on long media | Med | Viewport-cull `computeRulerTicks`; move the grid to **zero-DOM** CSS gradients (replaces today's per-second div loop, a net DOM reduction). |
| `color-mix` unsupported in target runtime | Low | Already used in-repo (`timelineItemStyles.ts:76`); Electron Chromium supports it; provide solid-color fallback tokens commented in `globals.css`. |
| Light-theme contrast (grid too faint / labels weak) | Low | Separate `.light` overrides (grid alpha 55/90); verify against WCAG AA for label text; checklist item 6. |
| Test-id / selector drift breaking queries | Low | Preserve `data-testid="timeline-playhead"`, `data-clip-id`, `.timeline-item`, `.track-controls`, all button `aria-label`s. |
| Scope creep into layout/scroll behavior | Med | **Out of scope** for v1: making track headers `position: sticky` (kept as a noted follow-up because it interacts with the synced-scroll coordinate math); v1 keeps current layout and changes styling only. |
| i18n churn | Low | No new user-facing strings; all labels reuse `formatTimelineTime` and existing `t.timeline.*` keys. |

---

## 8. Implementation order (for Subtask #2)

1. `globals.css` tokens → `theme/timelineTheme.ts` → `lib/rulerTicks.ts` (+ test) → `lib/timelineGrid.ts` (+ test). (Foundations, fully unit-testable in isolation.)
2. `TimelinePlayhead.tsx`.
3. Wire `TimelineRuler.tsx` (ticks + playhead + remove redundant grid), then `Track.tsx` (grid + header), then `TrackContainer.tsx` (playhead + bottom bar).
4. `timelineItemStyles.ts` + `TimelineItem.tsx` (clips/handles), then `TimelineToolbar.tsx`.
5. Run `npx vitest run src/components/video/timeline`, `npm run type-check`, `npm run lint`; then the desktop walkthrough gate (§6.2).

Each step is independently buildable; the app compiles and runs after every step because props/handlers never change.

> **Implementation-order addendum (v2).** Step 1 now also lands the `globals.css` token block **and** removes the orphaned `video-editing.css` timeline rules (review R3); Step 3 has `TrackContainer` import `TRACK_HEADER_WIDTH` from `timelineTheme` rather than its local `const` (review R5). The `rulerTicks.ts` unit tests in §6.1 should additionally assert the new **index-driven** classifier (a major tick's index is divisible by `r·q`; no float modulo) per §2.3 (review R1).

---

## 评审结论

**有条件通过（Approved with conditions）。**

本方案在**可行性 / 完整性 / 一致性 / 规模适配**四个维度上整体扎实。纯函数 + 展示层的拆分边界清晰；对 `computeItemStyles` 既测返回值、`data-testid="timeline-playhead"`、aria 契约、`+TRACK_HEADER_WIDTH` 共线性（`TrackContainer.tsx:117`）、`color-mix` 既有用法（`timelineItemStyles.ts:76`）、`setScrollLeft` 滚动同步链路（`TimelinePanel.tsx:921/935`）均已逐一核对无误，**不存在阻断性（P0）问题**。两项 P1 已在 v2 正文就地修复：R1（刻度分级整数化）→ §2.3；R2（空时间轴 / 拖拽门控 / a11y / 源码文本测试等功能契约固化）→ §2.7。三项 P2（R3 遗留 CSS 清理、R4 帧级标签表述澄清、R5 192/32 单一来源）已在 §2.3、§3 就地修复。**无 P0 / P1 遗留。**

放行条件（须在 Subtask #2 实施、Subtask #3 评审时核验）：

1. **C1（R6 — 文件尺寸）**：`Track.tsx`(637) / `TrackContainer.tsx`(535) 改写后若单文件超过 CLAUDE.md 的 **800 行**红线，须按职责抽取子组件；**严禁**顺带重构未列入范围的 `TimelinePanel.tsx`（其已 1033 行，属既有债务，不在本次范围）。
2. **C2（R7 — 主题块）**：落 token 前确认 `globals.css` 中 `:root` 是否即暗色默认基线；按「`:root` 基线 + `.light` 覆盖」**单一写法**落地，避免 `:root` 与 `.dark` 重复维护。
3. **C3（验收门禁）**：必须 (a) 跑通 §6.1 全部既有回归测试 —— 含 `timelineItemStyles.test.ts`、`TimelineToolbar.comingSoon.test.ts`、`TimelineItem.*.test.tsx` 等**源码文本断言型**用例（重排版时务必保留其断言依赖的源码子串，见 §2.7-6）；(b) 新增 `rulerTicks.test.ts` / `timelineGrid.test.ts` 覆盖 §2.3 的整数化分级与网格周期；(c) `npm run type-check` 与 `npm run lint` 零新增告警；(d) 完成 §6.2 桌面走查门禁（明暗双主题 + 打包桌面构建、播放 / 拖拽 / 缩放 / swap 无回归、播放头单一且全程共线）。

满足以上条件即视为通过，可进入 Subtask #2 代码开发。

— 评审人 Subtask #1 · 2026-06-13 · 文档版本 **v2**
