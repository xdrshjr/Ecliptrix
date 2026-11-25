'use client';

/**
 * Dock lifecycle helpers (spec §4.2.3, §4.6.3).
 *
 * `useDockPhase` — the native view must stay hidden while the Dock slides, or it
 * trails behind the animation (拖影). So: mounted on open, `settled` only after the
 * slide has finished; on close `settled` drops at once (view hides first) and the
 * Dock unmounts after the exit animation.
 *
 * `useDockResize` — right-edge drag/keyboard resize. Dragging writes a CSS
 * variable directly (no React render per pointer move) and commits once.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { DOCK_MIN_WIDTH } from '@/lib/browserWorkspaceStore';

export const DOCK_ENTER_MS = 200;
export const DOCK_EXIT_MS = 160;
const KEY_STEP = 16;
const KEY_BIG_STEP = 64;
const OTHER_PANEL_MIN = 160;

export function useDockPhase(open: boolean): { mounted: boolean; settled: boolean } {
  const [mounted, setMounted] = useState(open);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const timer = window.setTimeout(() => setSettled(true), DOCK_ENTER_MS);
      return () => window.clearTimeout(timer);
    }
    setSettled(false);
    const timer = window.setTimeout(() => setMounted(false), DOCK_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);
  return { mounted: mounted || open, settled: open && settled };
}

export function clampDockWidth(width: number, containerWidth: number): number {
  const max = Math.max(DOCK_MIN_WIDTH, containerWidth - OTHER_PANEL_MIN);
  return Math.min(max, Math.max(DOCK_MIN_WIDTH, Math.round(width)));
}

export function useDockResize(
  dockRef: RefObject<HTMLElement | null>,
  width: number | null,
  commit: (width: number) => void,
) {
  const drag = useRef<{ origin: number; start: number; latest: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const containerWidth = () => dockRef.current?.parentElement?.clientWidth ?? 1200;
  const currentWidth = () => width ?? dockRef.current?.getBoundingClientRect().width ?? DOCK_MIN_WIDTH;

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { origin: event.clientX, start: currentWidth(), latest: currentWidth() };
    setDragging(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state) return;
    state.latest = clampDockWidth(state.start + event.clientX - state.origin, containerWidth());
    dockRef.current?.style.setProperty('--bw-dock-w', `${state.latest}px`);
  };
  const finish = () => {
    const state = drag.current;
    drag.current = null;
    setDragging(false);
    if (state && state.latest !== state.start) commit(state.latest);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? KEY_BIG_STEP : KEY_STEP;
    const delta = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
    if (!delta) return;
    event.preventDefault();
    commit(clampDockWidth(currentWidth() + delta, containerWidth()));
  };

  return {
    dragging,
    handleProps: { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish, onKeyDown },
  };
}
