'use client';

/**
 * useWorkbenchLayout — sizes, collapse flags, presets and responsive
 * auto-collapse of the editor workbench (spec §3.1, §5.2, §6.2).
 *
 * Owns the single localStorage key `ecliptrix-editor-layout-v1`, including the
 * two focus preferences (`followPlayback`, `rightPanelTab`) that it injects
 * into `useEditorFocusStore` and writes back (RV-12). Sizes reach the DOM only
 * as CSS variables on the workbench root, so a splitter drag never re-renders
 * the editor or the compositor (R3).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import {
  DEFAULT_PREFS,
  LAYOUT_STORAGE_KEY,
  applyPreset as applyPresetToLayout,
  autoCollapseFor,
  parseLayoutPrefs,
  resolvePanelSizes,
  setLayoutSize,
  type LayoutPresetId,
  type SizeKey,
  type StoredLayoutPrefsV1,
  type WorkbenchLayout,
} from './layoutPrefs';

type SidePanel = 'left' | 'right';

export interface UseWorkbenchLayoutReturn {
  layout: WorkbenchLayout;
  autoCollapsed: { left: boolean; right: boolean };
  /** Solver output actually applied (RV-05); never written back to `layout`. */
  resolved: { leftWidth: number; rightWidth: number; timelineHeight: number };
  overlayOpen: { left: boolean; right: boolean };
  /** Whether each side panel is visible (docked or as an overlay). */
  visible: { left: boolean; right: boolean };
  /** Workbench (`.ws-main`) height, for the splitter's max value. */
  mainHeight: number;
  setSize(key: SizeKey, px: number): void;
  /** Live drag preview: writes the CSS variable only. */
  previewSize(key: SizeKey, px: number): void;
  toggle(panel: SidePanel): void;
  /** Show a side panel (docked or overlay) without ever hiding it. */
  reveal(panel: SidePanel): void;
  closeOverlays(): void;
  applyPreset(id: Exclude<LayoutPresetId, 'custom'>): void;
  reset(): void;
  rootRef: React.RefObject<HTMLDivElement | null>;
  mainRef: React.RefObject<HTMLDivElement | null>;
}

const CSS_VAR: Record<SizeKey, string> = {
  left: '--ws-left-w',
  right: '--ws-right-w',
  timeline: '--ws-timeline-h',
};

function readStoredPrefs(): StoredLayoutPrefsV1 {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
  } catch (error) {
    console.warn('[workbench] layout prefs unavailable', { error });
    return DEFAULT_PREFS;
  }
  const result = parseLayoutPrefs(raw);
  if (!result.ok) console.warn('[workbench] invalid layout prefs', { reason: result.reason });
  return result.prefs;
}

function writeStoredPrefs(prefs: StoredLayoutPrefsV1): void {
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(prefs));
  } catch (error) {
    console.warn('[workbench] could not persist layout prefs', { error });
  }
}

function toLayout(prefs: StoredLayoutPrefsV1): WorkbenchLayout {
  const { leftWidth, rightWidth, timelineHeight, leftCollapsed, rightCollapsed, preset } = prefs;
  return { leftWidth, rightWidth, timelineHeight, leftCollapsed, rightCollapsed, preset };
}

/** Observe `.ws-main` so auto-collapse and the solver follow the window. */
function useElementSize(ref: React.RefObject<HTMLDivElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize((prev) => (prev.width === rect.width && prev.height === rect.height
        ? prev : { width: rect.width, height: rect.height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** Inject the two focus preferences once, then write them back on change. */
function useFocusPrefsSync(initial: StoredLayoutPrefsV1, persist: () => void): void {
  useEffect(() => {
    const store = useEditorFocusStore.getState();
    store.setFollowPlayback(initial.followPlayback);
    store.setRightPanelTab(initial.rightPanelTab);
    return useEditorFocusStore.subscribe((state, prev) => {
      if (state.followPlayback !== prev.followPlayback || state.rightPanelTab !== prev.rightPanelTab) {
        persist();
      }
    });
    // Mount-only: `initial` is the snapshot read from storage on mount.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

// Hook body exceeds 60 lines: the collapse/overlay/solver state shares one
// set of refs and splitting it would scatter the invariants of §3.1.
export function useWorkbenchLayout(): UseWorkbenchLayoutReturn {
  const initialRef = useRef<StoredLayoutPrefsV1 | null>(null);
  if (initialRef.current === null) {
    initialRef.current = typeof window === 'undefined' ? DEFAULT_PREFS : readStoredPrefs();
  }
  const [layout, setLayout] = useState<WorkbenchLayout>(() => toLayout(initialRef.current!));
  const [overlayOpen, setOverlayOpen] = useState({ left: false, right: false });
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(mainRef);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const persist = useCallback(() => {
    const focus = useEditorFocusStore.getState();
    writeStoredPrefs({
      v: 1,
      ...layoutRef.current,
      followPlayback: focus.followPlayback,
      rightPanelTab: focus.rightPanelTab,
    });
  }, []);
  useFocusPrefsSync(initialRef.current, persist);

  const firstLayoutRef = useRef(true);
  useEffect(() => {
    if (firstLayoutRef.current) {
      firstLayoutRef.current = false;
      return;
    }
    persist();
  }, [layout, persist]);

  const widthAuto = autoCollapseFor(width);
  const leftDocked = !layout.leftCollapsed && !widthAuto.left;
  const solved = resolvePanelSizes({
    leftWidth: layout.leftWidth,
    rightWidth: layout.rightWidth,
    timelineHeight: layout.timelineHeight,
    leftOpen: leftDocked,
    rightOpen: !layout.rightCollapsed && !widthAuto.right,
  }, width, height);
  const autoCollapsed = useMemo(() => ({
    left: widthAuto.left,
    right: widthAuto.right || solved.rightForcedCollapsed,
  }), [widthAuto.left, widthAuto.right, solved.rightForcedCollapsed]);
  const resolved = useMemo(() => ({
    leftWidth: solved.leftWidth,
    rightWidth: solved.rightWidth,
    timelineHeight: solved.timelineHeight,
  }), [solved.leftWidth, solved.rightWidth, solved.timelineHeight]);

  // Overlays only make sense while the panel is auto-collapsed.
  useEffect(() => {
    setOverlayOpen((prev) => ({
      left: prev.left && autoCollapsed.left,
      right: prev.right && autoCollapsed.right,
    }));
  }, [autoCollapsed.left, autoCollapsed.right]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.style.setProperty(CSS_VAR.left, `${resolved.leftWidth}px`);
    root.style.setProperty(CSS_VAR.right, `${resolved.rightWidth}px`);
    root.style.setProperty(CSS_VAR.timeline, `${resolved.timelineHeight}px`);
  }, [resolved]);

  const previewSize = useCallback((key: SizeKey, px: number) => {
    rootRef.current?.style.setProperty(CSS_VAR[key], `${Math.round(px)}px`);
  }, []);
  const setSize = useCallback((key: SizeKey, px: number) => {
    setLayout((prev) => setLayoutSize(prev, key, px, height));
  }, [height]);

  const toggle = useCallback((panel: SidePanel) => {
    if (autoCollapsed[panel]) {
      setOverlayOpen((prev) => ({ ...prev, [panel]: !prev[panel] }));
      return;
    }
    const field = panel === 'left' ? 'leftCollapsed' : 'rightCollapsed';
    setLayout((prev) => ({ ...prev, [field]: !prev[field] }));
  }, [autoCollapsed]);

  const reveal = useCallback((panel: SidePanel) => {
    if (autoCollapsed[panel]) {
      setOverlayOpen((prev) => ({ ...prev, [panel]: true }));
      return;
    }
    const field = panel === 'left' ? 'leftCollapsed' : 'rightCollapsed';
    setLayout((prev) => (prev[field] ? { ...prev, [field]: false } : prev));
  }, [autoCollapsed]);

  const closeOverlays = useCallback(() => setOverlayOpen({ left: false, right: false }), []);
  const applyPreset = useCallback((id: Exclude<LayoutPresetId, 'custom'>) => {
    setLayout((prev) => applyPresetToLayout(prev, id));
  }, []);
  const reset = useCallback(() => setLayout(toLayout(DEFAULT_PREFS)), []);

  const visible = {
    left: leftDocked || (autoCollapsed.left && overlayOpen.left),
    right: (!layout.rightCollapsed && !autoCollapsed.right) || (autoCollapsed.right && overlayOpen.right),
  };

  return {
    layout, autoCollapsed, resolved, overlayOpen, visible, mainHeight: height,
    setSize, previewSize, toggle, reveal, closeOverlays, applyPreset, reset, rootRef, mainRef,
  };
}
