/**
 * layoutPrefs — pure layout rules of the editor workbench (spec §3.1, §6.2).
 *
 * The user's widths/heights are *preferences*: `resolvePanelSizes` computes
 * the sizes actually applied for the current container and never writes back,
 * so enlarging the window restores what the user chose (RV-05). Everything
 * here is side-effect free; `useWorkbenchLayout` owns storage and the DOM.
 */

export type LayoutPresetId = 'script' | 'edit' | 'custom';
export type RightPanelTabPref = 'materials' | 'properties';

export interface WorkbenchLayout {
  leftWidth: number;
  rightWidth: number;
  timelineHeight: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  preset: LayoutPresetId;
}

export interface StoredLayoutPrefsV1 extends WorkbenchLayout {
  v: 1;
  followPlayback: boolean;
  rightPanelTab: RightPanelTabPref;
}

export interface ResolvedPanelSizes {
  leftWidth: number;
  rightWidth: number;
  timelineHeight: number;
  /** Extra auto-collapse forced by the space solver (step 4). */
  rightForcedCollapsed: boolean;
}

export const LAYOUT_STORAGE_KEY = 'ecliptrix-editor-layout-v1';

export const LEFT_MIN = 280;
export const LEFT_MAX = 480;
export const RIGHT_MIN = 280;
export const RIGHT_MAX = 440;
export const TIMELINE_MIN = 160;
/** Share of the workbench height the timeline may take at most. */
export const TIMELINE_MAX_RATIO = 0.6;
export const CENTER_MIN = 420;
export const UPPER_MIN = 320;
export const SPLITTER_SIZE = 8;
/** `.ws-main` widths below which side panels auto-collapse (spec §3.1). */
export const AUTO_COLLAPSE_RIGHT_BELOW = 1180;
export const AUTO_COLLAPSE_LEFT_BELOW = 960;

export const DEFAULT_LAYOUT: WorkbenchLayout = {
  leftWidth: 320,
  rightWidth: 300,
  timelineHeight: 260,
  leftCollapsed: false,
  rightCollapsed: false,
  preset: 'custom',
};

export const DEFAULT_PREFS: StoredLayoutPrefsV1 = {
  v: 1,
  ...DEFAULT_LAYOUT,
  followPlayback: false,
  rightPanelTab: 'materials',
};

export const LAYOUT_PRESETS: Record<Exclude<LayoutPresetId, 'custom'>, Pick<
  WorkbenchLayout, 'leftWidth' | 'rightWidth' | 'timelineHeight'
>> = {
  script: { leftWidth: 400, rightWidth: 300, timelineHeight: 200 },
  edit: { leftWidth: 300, rightWidth: 300, timelineHeight: 360 },
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Upper bound of the timeline height for a workbench of height `h` (0 = unknown). */
export function timelineMaxFor(height: number): number {
  if (!(height > 0)) return Number.POSITIVE_INFINITY;
  return Math.max(TIMELINE_MIN, Math.floor(height * TIMELINE_MAX_RATIO));
}

export function clampLayout(layout: WorkbenchLayout, viewportHeight = 0): WorkbenchLayout {
  return {
    ...layout,
    leftWidth: clamp(Math.round(layout.leftWidth), LEFT_MIN, LEFT_MAX),
    rightWidth: clamp(Math.round(layout.rightWidth), RIGHT_MIN, RIGHT_MAX),
    timelineHeight: clamp(
      Math.round(layout.timelineHeight), TIMELINE_MIN, timelineMaxFor(viewportHeight),
    ),
  };
}

export type ParseResult =
  | { ok: true; prefs: StoredLayoutPrefsV1 }
  | { ok: false; prefs: StoredLayoutPrefsV1; reason: string };

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

function validationError(record: Record<string, unknown>): string | null {
  if (record.v !== 1) return 'unknown-version';
  const numbers = ['leftWidth', 'rightWidth', 'timelineHeight'];
  if (!numbers.every((key) => isNumber(record[key]))) return 'bad-size';
  const booleans = ['leftCollapsed', 'rightCollapsed', 'followPlayback'];
  if (!booleans.every((key) => isBoolean(record[key]))) return 'bad-flag';
  if (!['script', 'edit', 'custom'].includes(record.preset as string)) return 'bad-preset';
  if (!['materials', 'properties'].includes(record.rightPanelTab as string)) return 'bad-tab';
  return null;
}

/** Parse the stored JSON; anything invalid falls back to the defaults as a whole. */
export function parseLayoutPrefs(raw: string | null): ParseResult {
  if (raw === null) return { ok: true, prefs: DEFAULT_PREFS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, prefs: DEFAULT_PREFS, reason: 'invalid-json' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, prefs: DEFAULT_PREFS, reason: 'not-an-object' };
  }
  const record = parsed as Record<string, unknown>;
  const reason = validationError(record);
  if (reason) return { ok: false, prefs: DEFAULT_PREFS, reason };
  const prefs = record as unknown as StoredLayoutPrefsV1;
  return { ok: true, prefs: { ...prefs, ...clampLayout(prefs) } };
}

export function applyPreset(
  layout: WorkbenchLayout,
  id: Exclude<LayoutPresetId, 'custom'>,
): WorkbenchLayout {
  return {
    ...layout,
    ...LAYOUT_PRESETS[id],
    leftCollapsed: false,
    rightCollapsed: false,
    preset: id,
  };
}

export type SizeKey = 'left' | 'right' | 'timeline';

/** A manual resize always turns the layout into a custom one. */
export function setLayoutSize(
  layout: WorkbenchLayout,
  key: SizeKey,
  px: number,
  viewportHeight = 0,
): WorkbenchLayout {
  const field = key === 'left' ? 'leftWidth' : key === 'right' ? 'rightWidth' : 'timelineHeight';
  return clampLayout({ ...layout, [field]: px, preset: 'custom' }, viewportHeight);
}

/** Preset value a splitter resets to (Enter / double-click). */
export function presetSizeFor(layout: WorkbenchLayout, key: SizeKey): number {
  const source = layout.preset === 'custom' ? DEFAULT_LAYOUT : LAYOUT_PRESETS[layout.preset];
  if (key === 'left') return source.leftWidth;
  if (key === 'right') return source.rightWidth;
  return source.timelineHeight;
}

export interface SolveInput {
  leftWidth: number;
  rightWidth: number;
  timelineHeight: number;
  leftOpen: boolean;
  rightOpen: boolean;
}

function shrinkSides(left: number, right: number, avail: number): [number, number] {
  const leftSlack = left - LEFT_MIN;
  const rightSlack = right - RIGHT_MIN;
  const overflow = left + right - avail;
  const slack = leftSlack + rightSlack;
  if (slack <= 0) return [LEFT_MIN, RIGHT_MIN];
  const ratio = Math.min(1, overflow / slack);
  return [
    Math.round(left - leftSlack * ratio),
    Math.round(right - rightSlack * ratio),
  ];
}

function solveWidths(input: SolveInput, width: number): Omit<ResolvedPanelSizes, 'timelineHeight'> {
  const { leftOpen, rightOpen } = input;
  const left = leftOpen ? input.leftWidth : 0;
  const right = rightOpen ? input.rightWidth : 0;
  const openCount = Number(leftOpen) + Number(rightOpen);
  const avail = width - CENTER_MIN - openCount * SPLITTER_SIZE;
  if (!(width > 0) || left + right <= avail) {
    return { leftWidth: input.leftWidth, rightWidth: input.rightWidth, rightForcedCollapsed: false };
  }
  if (leftOpen && rightOpen) {
    if (LEFT_MIN + RIGHT_MIN > avail) {
      // Step 4: still no room with both at minimum → drop the right panel, re-solve.
      const retry = solveWidths({ ...input, rightOpen: false }, width);
      return { ...retry, rightWidth: input.rightWidth, rightForcedCollapsed: true };
    }
    const [l, r] = shrinkSides(left, right, avail);
    return { leftWidth: l, rightWidth: r, rightForcedCollapsed: false };
  }
  const min = leftOpen ? LEFT_MIN : RIGHT_MIN;
  const only = Math.max(min, Math.min(leftOpen ? left : right, avail));
  return leftOpen
    ? { leftWidth: only, rightWidth: input.rightWidth, rightForcedCollapsed: false }
    : { leftWidth: input.leftWidth, rightWidth: only, rightForcedCollapsed: false };
}

/** Timeline height for a workbench of height `h`: keeps UPPER_MIN for the upper row. */
export function solveTimelineHeight(pref: number, height: number): number {
  if (!(height > 0)) return pref;
  const room = height - UPPER_MIN - SPLITTER_SIZE;
  const capped = Math.min(pref, room, height * TIMELINE_MAX_RATIO);
  if (capped >= TIMELINE_MIN) return Math.round(capped);
  // Too short even for the minimum: the upper row keeps UPPER_MIN, the
  // timeline takes what is left, and the page never scrolls.
  return Math.max(0, Math.round(Math.min(TIMELINE_MIN, room)));
}

/**
 * Spec §3.1 「空间分配求解」: widths shrink proportionally above their
 * minimums to keep the centre ≥ CENTER_MIN; the right panel collapses when
 * both minimums still overflow. Results only feed CSS variables.
 */
export function resolvePanelSizes(input: SolveInput, width: number, height: number): ResolvedPanelSizes {
  return {
    ...solveWidths(input, width),
    timelineHeight: solveTimelineHeight(input.timelineHeight, height),
  };
}

/** Width-driven auto-collapse (spec §3.1); never overrides the user's own flags. */
export function autoCollapseFor(width: number): { left: boolean; right: boolean } {
  if (!(width > 0)) return { left: false, right: false };
  return {
    left: width < AUTO_COLLAPSE_LEFT_BELOW,
    right: width < AUTO_COLLAPSE_RIGHT_BELOW,
  };
}
