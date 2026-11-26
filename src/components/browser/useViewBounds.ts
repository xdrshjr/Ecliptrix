'use client';

/**
 * useViewBounds — keeps the main process' native view glued to the placeholder
 * `<div data-browser-viewport>` (spec §4.2.3 "边界同步").
 *
 * The native view lives in the window's contentView, outside the DOM, so its
 * rectangle must be pushed explicitly: ResizeObserver + window resize + the end
 * of CSS transitions/animations (the Dock slides in), all coalesced to one send
 * per animation frame. While `active` is false (Dock animating, closed, locked)
 * nothing is sent except a single `null` that detaches the view — no ghosting.
 */

import { useEffect, useRef, type RefObject } from 'react';
import { getBrowserBridge } from '@/lib/api/browserBridge';
import type { BrowserViewRect } from '@/types/browserWorkspace';

export function roundRect(box: Pick<DOMRect, 'x' | 'y' | 'width' | 'height'>): BrowserViewRect {
  return {
    x: Math.round(box.x), y: Math.round(box.y),
    width: Math.max(0, Math.round(box.width)), height: Math.max(0, Math.round(box.height)),
  };
}

export function sameRect(a: BrowserViewRect | null, b: BrowserViewRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function useViewBounds(
  elementRef: RefObject<HTMLElement | null>,
  active: boolean,
  onRect?: (rect: BrowserViewRect | null) => void,
): void {
  const onRectRef = useRef(onRect);
  onRectRef.current = onRect;
  const lastSent = useRef<BrowserViewRect | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    const bridge = getBrowserBridge();
    if (!bridge || typeof bridge.setBounds !== 'function') return undefined;
    const send = (rect: BrowserViewRect | null) => {
      if (sameRect(lastSent.current, rect)) return;
      lastSent.current = rect;
      onRectRef.current?.(rect);
      void bridge.setBounds?.(rect);
    };
    if (!active || !element) {
      send(null);
      return undefined;
    }

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const box = element.getBoundingClientRect();
        send(box.width > 0 && box.height > 0 ? roundRect(box) : null);
      });
    };
    schedule();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(element);
    window.addEventListener('resize', schedule);
    document.addEventListener('transitionend', schedule, true);
    document.addEventListener('animationend', schedule, true);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('transitionend', schedule, true);
      document.removeEventListener('animationend', schedule, true);
    };
  }, [elementRef, active]);

  // The placeholder itself going away (blank tab, Dock closed) must detach the view.
  useEffect(() => () => {
    if (lastSent.current === null) return;
    lastSent.current = null;
    onRectRef.current?.(null);
    void getBrowserBridge()?.setBounds?.(null);
  }, []);
}
