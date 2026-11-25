'use client';

/**
 * useNativeOcclusion — true while some floating DOM layer overlaps the native
 * view's placeholder (spec §4.2.3 "遮挡", R1-5). The caller swaps the live view
 * for a frozen frame while this is true.
 *
 * It watches the whole <body> subtree (portaled menus/dialogs live there, the
 * Dock's own popovers live inside it), coalesces every mutation into one check
 * per frame, and only re-renders when the answer actually flips.
 */

import { useEffect, useState, type RefObject } from 'react';
import { collectOccluderRects, computeOcclusion, rectOf } from './occlusion';

const WATCHED_ATTRIBUTES = ['open', 'data-state', 'aria-hidden', 'style', 'class', 'hidden'];

export function useNativeOcclusion(
  viewportRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): boolean {
  const [occluded, setOccluded] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!enabled || !viewport) {
      setOccluded(false);
      return undefined;
    }
    let frame = 0;
    const check = () => {
      frame = 0;
      const next = computeOcclusion(rectOf(viewport), collectOccluderRects(document));
      setOccluded((previous) => (previous === next ? previous : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: WATCHED_ATTRIBUTES,
    });
    const resizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    resizes?.observe(viewport);
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      mutations.disconnect();
      resizes?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [viewportRef, enabled]);

  return enabled && occluded;
}
