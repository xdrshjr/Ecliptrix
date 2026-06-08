'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { isDesktop } from '@/lib/desktop/isDesktop';
import HeaderActions from '@/components/HeaderActions';
import type { DesktopWindowControls } from '@/types/desktop';

/**
 * Action callbacks mirror `Header`'s — only `page.tsx` passes them, so the
 * action cluster renders only on the main page; the bootstrap routes
 * (`login`, `not-found`) mount the bar prop-less and get brand + window
 * controls only (spec §2.3d).
 */
interface DesktopTitleBarProps {
  onLoginClick?: () => void;
  onProfileClick?: () => void;
  onSettingsClick?: () => void;
  onAccountSettingsClick?: () => void;
  showSettingsAttention?: boolean;
}

/**
 * Self-drawn title bar for the frameless Electron window (spec §2.3).
 *
 * Renders only inside the desktop shell — on the browser it returns `null`, so
 * inserting it into shared pages has zero visual/layout impact on the web app.
 * A mount gate keeps SSR and the first client frame identical (both `null`),
 * avoiding a hydration mismatch on the desktop; the bar appears right after
 * mount, in step with the page's neutral boot placeholder (§2.2).
 *
 * The 40px bar carries three segments: draggable brand, draggable spacer, and a
 * `no-drag` command zone holding the shared action cluster, a divider, and the
 * window controls (§2.3b).
 */
export default function DesktopTitleBar(props: DesktopTitleBarProps) {
  const [mounted, setMounted] = useState(false);
  const [isMax, setIsMax] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Sync the maximize state from the main process: read the initial value and
  // subscribe to changes (double-click, window snap, OS shortcuts).
  useEffect(() => {
    if (!mounted || !isDesktop()) return;
    const controls = window.ecliptrixDesktop?.windowControls;
    if (!controls) return;

    let active = true;
    controls
      .isMaximized()
      .then((value) => {
        if (active) setIsMax(value);
      })
      .catch(() => {});

    const unsubscribe = controls.onMaximizeChange((value) => setIsMax(value));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [mounted]);

  if (!mounted || !isDesktop()) return null;

  const controls: DesktopWindowControls | undefined =
    window.ecliptrixDesktop?.windowControls;
  if (!controls) return null;

  const iconStroke = 'currentColor';
  // Only the main page wires action callbacks; bootstrap routes mount prop-less.
  const hasAppActions = !!props.onProfileClick;

  return (
    // `relative z-[10000]` establishes a stacking context above the content so
    // the cluster's dropdowns float over it (§2.3c).
    <div
      className="relative z-[10000] h-10 flex items-stretch bg-card border-b border-border select-none"
      style={{ WebkitAppRegion: 'drag' }}
    >
      {/* Brand — doubles as the draggable region; double-click toggles maximize. */}
      <div
        className="flex items-center gap-2 pl-3"
        onDoubleClick={() => {
          controls.toggleMaximize().catch(() => {});
        }}
      >
        <Image
          src="/logo-ai.png"
          alt="Ecliptrix"
          width={18}
          height={18}
          className="object-contain"
        />
        <span className="text-xs font-medium text-foreground leading-none">
          Ecliptrix
        </span>
      </div>

      {/* Generous draggable grab area between brand and command zone (§2.3b). */}
      <div className="flex-1" />

      {/* Command zone — opts out of the drag region so buttons/dropdowns stay clickable. */}
      <div className="flex items-stretch h-full" style={{ WebkitAppRegion: 'no-drag' }}>
        {hasAppActions && (
          <>
            <div className="flex items-center h-full pl-2">
              <HeaderActions
                variant="titlebar"
                onLoginClick={props.onLoginClick!}
                onProfileClick={props.onProfileClick!}
                onSettingsClick={props.onSettingsClick}
                onAccountSettingsClick={props.onAccountSettingsClick}
                showSettingsAttention={props.showSettingsAttention}
              />
            </div>
            {/* Divider between app commands and window commands (§2.3b). */}
            <span className="self-center w-px h-5 bg-border mx-1.5" aria-hidden="true" />
          </>
        )}

        <button
          type="button"
          title="Minimize"
          aria-label="Minimize"
          onClick={() => controls.minimize().catch(() => {})}
          className="h-full w-12 flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke={iconStroke}>
            <path strokeLinecap="round" strokeWidth={2} d="M5 12h14" />
          </svg>
        </button>

        <button
          type="button"
          title={isMax ? 'Restore' : 'Maximize'}
          aria-label={isMax ? 'Restore' : 'Maximize'}
          onClick={() => {
            controls
              .toggleMaximize()
              .then((value) => setIsMax(value))
              .catch(() => {});
          }}
          className="h-full w-12 flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          {isMax ? (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke={iconStroke}>
              <rect x="8" y="8" width="11" height="11" rx="1" strokeWidth={2} />
              <path strokeWidth={2} d="M5 16V6a1 1 0 011-1h10" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke={iconStroke}>
              <rect x="5" y="5" width="14" height="14" rx="1" strokeWidth={2} />
            </svg>
          )}
        </button>

        <button
          type="button"
          title="Close"
          aria-label="Close"
          onClick={() => controls.close().catch(() => {})}
          className="h-full w-12 flex items-center justify-center text-muted-foreground hover:bg-red-600 hover:text-white transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke={iconStroke}>
            <path strokeLinecap="round" strokeWidth={2} d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
