'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { isDesktop } from '@/lib/desktop/isDesktop';
import TitleBarActions from '@/components/shell/TitleBarActions';
import type { DesktopWindowControls } from '@/types/desktop';

/**
 * Only `page.tsx` passes callbacks, so the action cluster renders only on the
 * main page; `not-found` mounts the bar prop-less and gets brand (plus window
 * controls when running inside the Electron shell) only.
 */
interface AppTitleBarProps {
  onSettingsClick?: () => void;
  showSettingsAttention?: boolean;
}

/**
 * The application's only chrome: a self-drawn 40px title bar (spec §4.7).
 *
 * It renders in BOTH runtimes. Inside the frameless Electron window it also
 * draws minimize / maximize / close; in a plain browser (the `npm run dev`
 * debugging path) those three are absent and the bar is just brand + actions.
 * There is deliberately no second `isDesktop()` fork beyond the window
 * controls — one shell, one code path.
 *
 * A mount gate keeps SSR and the first client frame identical, avoiding a
 * hydration mismatch; the bar appears right after mount, in step with the
 * page's neutral boot placeholder.
 *
 * The bar carries three segments: draggable brand, draggable spacer, and a
 * `no-drag` command zone holding the action cluster, a divider, and the
 * window controls. `WebkitAppRegion` is simply inert CSS in the browser, so
 * it needs no guard.
 */
export default function AppTitleBar(props: AppTitleBarProps) {
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

  if (!mounted) return null;

  const controls: DesktopWindowControls | undefined = isDesktop()
    ? window.ecliptrixDesktop?.windowControls
    : undefined;

  const iconStroke = 'currentColor';
  // Only the main page wires action callbacks; bootstrap routes mount prop-less.
  const hasAppActions = !!props.onSettingsClick;

  return (
    // `relative z-[10000]` establishes a stacking context above the content so
    // the cluster's dropdowns float over it.
    <div
      className="relative z-[10000] h-10 flex items-stretch bg-card border-b border-border select-none"
      style={{ WebkitAppRegion: 'drag' }}
    >
      {/* Brand — doubles as the draggable region; double-click toggles maximize. */}
      <div
        className="flex items-center gap-2 pl-3"
        onDoubleClick={() => {
          controls?.toggleMaximize().catch(() => {});
        }}
      >
        <Image
          src="/brand/ecliptrix-mark.png"
          alt="Ecliptrix"
          width={18}
          height={18}
          className="object-contain"
        />
        <span className="text-xs font-medium text-foreground leading-none">
          Ecliptrix
        </span>
      </div>

      {/* Generous draggable grab area between brand and command zone. */}
      <div className="flex-1" />

      {/* Command zone — opts out of the drag region so buttons/dropdowns stay clickable. */}
      <div className="flex items-stretch h-full" style={{ WebkitAppRegion: 'no-drag' }}>
        {hasAppActions && (
          <>
            <div className="flex items-center h-full pl-2">
              <TitleBarActions
                onSettingsClick={props.onSettingsClick}
                showSettingsAttention={props.showSettingsAttention}
              />
            </div>
            {/* Divider between app commands and window commands. */}
            {controls && (
              <span className="self-center w-px h-5 bg-border mx-1.5" aria-hidden="true" />
            )}
          </>
        )}

        {controls && (
          <>
            <button
              type="button"
              title="Minimize"
              aria-label="Minimize"
              onClick={() => controls.minimize().catch(() => {})}
              className="h-full w-12 flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
              className="h-full w-12 flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
              className="h-full w-12 flex items-center justify-center text-muted-foreground hover:bg-red-600 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke={iconStroke}>
                <path strokeLinecap="round" strokeWidth={2} d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
