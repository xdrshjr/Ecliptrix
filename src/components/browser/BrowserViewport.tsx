'use client';

/**
 * BrowserViewport — the placeholder the native WebContentsView is glued onto
 * (spec §4.2.3). The page itself is NOT in the DOM; this component
 *   · reports its rectangle to the main process (useViewBounds),
 *   · swaps the live view for a frozen JPEG while a DOM layer overlaps it
 *     (useNativeOcclusion) so menus/dialogs stay visible and nothing flashes,
 *   · renders the DOM-side states that replace the view: crash, certificate
 *     error, blocked address, locked app.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useBrowserWorkspaceStore } from '@/contexts/BrowserWorkspaceContext';
import { getBrowserBridge } from '@/lib/api/browserBridge';
import type { BrowserTabInfo } from '@/types/browserWorkspace';
import { useNativeOcclusion } from './useNativeOcclusion';
import { useViewBounds } from './useViewBounds';

export type ViewportOverlay = 'crashed' | 'cert_error' | 'blocked' | 'locked' | null;

export function viewportOverlayFor(
  tab: BrowserTabInfo | null,
  locked: boolean,
): ViewportOverlay {
  if (locked) return 'locked';
  if (!tab) return null;
  if (tab.crashed) return 'crashed';
  if (tab.secure === 'cert_error') return 'cert_error';
  if (tab.secure === 'blocked') return 'blocked';
  return null;
}

/** Swap live view ⇄ frozen frame; at most one capture in flight, newest wins. */
function useFrozenFrame(occluded: boolean, live: boolean): string | null {
  const [frozen, setFrozen] = useState<string | null>(null);
  const token = useRef(0);

  useEffect(() => {
    const bridge = getBrowserBridge();
    const current = ++token.current;
    if (!live) {
      void bridge?.setVisible?.(false);
      setFrozen(null);
      return undefined;
    }
    if (occluded) {
      const capture = bridge?.captureFrozen?.();
      void Promise.resolve(capture).then((result) => {
        if (token.current !== current) return;
        if (result && result.ok && 'dataUrl' in result) setFrozen(result.dataUrl);
        void bridge?.setVisible?.(false);
      }).catch(() => {
        if (token.current === current) void bridge?.setVisible?.(false);
      });
      return undefined;
    }
    // Released: show the live view first, drop the still one a frame later.
    void bridge?.setVisible?.(true);
    const frame = requestAnimationFrame(() => {
      if (token.current === current) setFrozen(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [occluded, live]);

  return frozen;
}

export interface BrowserViewportProps {
  tab: BrowserTabInfo | null;
  /** The Dock is fully open (not animating) and the tab has a real page. */
  live: boolean;
  locked: boolean;
  onReload(): void;
  onBack(): void;
}

const BrowserViewport: React.FC<BrowserViewportProps> = ({
  tab, live, locked, onReload, onBack,
}) => {
  const { t } = useLocale();
  const copy = t.browserWorkspace.viewport;
  const ref = useRef<HTMLDivElement>(null);
  const overlay = viewportOverlayFor(tab, locked);
  const showNative = live && overlay === null;
  const store = useBrowserWorkspaceStore();
  useViewBounds(ref, showNative, (rect) => store.setDockViewportRect(rect && {
    left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height,
  }));
  const occluded = useNativeOcclusion(ref, showNative);
  const frozen = useFrozenFrame(occluded, showNative);

  return (
    <div className="bw-viewport" ref={ref} data-browser-viewport
      data-occluded={occluded ? 'true' : undefined}>
      {frozen && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="bw-frozen" src={frozen} alt="" draggable={false} />
      )}
      {occluded && frozen && (
        // In-flow marker: this hint must never count as an occluder, or the view would stay frozen.
        <div className="bw-frozen-hint" data-native-inflow="true">{copy.frozenHint}</div>
      )}
      {overlay === 'crashed' && (
        <div className="bw-state" role="alert">
          <p className="bw-state-title">{copy.crashed}</p>
          <button type="button" className="bw-btn" onClick={onReload}>{copy.reload}</button>
        </div>
      )}
      {overlay === 'cert_error' && (
        <div className="bw-state" role="alert">
          <p className="bw-state-title">{copy.certTitle}</p>
          <p className="bw-state-body">{copy.certBody}</p>
          <button type="button" className="bw-btn" onClick={onBack}>{t.browserWorkspace.toolbar.back}</button>
        </div>
      )}
      {overlay === 'blocked' && (
        <div className="bw-state" role="status">
          <p className="bw-state-title">{copy.blocked}</p>
          <button type="button" className="bw-btn" onClick={onBack}>{t.browserWorkspace.toolbar.back}</button>
        </div>
      )}
      {overlay === 'locked' && (
        <div className="bw-state" role="status">
          <p className="bw-state-title">{copy.locked}</p>
        </div>
      )}
    </div>
  );
};

export default BrowserViewport;
