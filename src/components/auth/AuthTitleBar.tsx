'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { isDesktop } from '@/lib/desktop/isDesktop';
import type { DesktopWindowControls } from '@/types/desktop';

interface AuthTitleBarProps {
  /** Client version reported by the main process (`AuthStatus.appVersion`). */
  appVersion?: string;
}

const CONTROL_BUTTON =
  'h-full w-12 flex items-center justify-center text-muted-foreground transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset';

/**
 * Minimal title bar for the three pre-app states (booting / unauthenticated /
 * blocked), spec §2.7.
 *
 * Why it is a separate component instead of `AppTitleBar` with props: the app
 * bar decides whether to show its action cluster from `!!onSettingsClick`, so
 * "borrowing" it here would also render the settings gear on the login screen.
 *
 * Two constraints inherited from the frameless window:
 *  - the bar is exactly `h-10` (40px), the same height as `AppTitleBar`, so the
 *    window does not jump 4px the moment the user signs in;
 *  - it paints the 40px drag strip on the very first frame (no `if (!mounted)
 *    return null`), because the gate's skeleton relies on it for layout. Only
 *    the window controls wait for mount — that is what keeps SSR and the first
 *    client frame byte-identical.
 */
export default function AuthTitleBar({ appVersion }: AuthTitleBarProps) {
  const [mounted, setMounted] = useState(false);
  const [isMax, setIsMax] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  const controls: DesktopWindowControls | undefined = mounted && isDesktop()
    ? window.ecliptrixDesktop?.windowControls
    : undefined;
  const versionLabel = appVersion || (mounted ? window.ecliptrixDesktop?.version ?? '' : '');
  const stroke = 'currentColor';

  return (
    <div
      className="relative z-[10000] h-10 shrink-0 flex items-stretch bg-card border-b border-border select-none"
      style={{ WebkitAppRegion: 'drag' }}
    >
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
        <span className="text-xs font-medium text-foreground leading-none">Ecliptrix</span>
        {versionLabel && (
          <span className="text-xs text-muted-foreground leading-none">{versionLabel}</span>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex items-stretch h-full" style={{ WebkitAppRegion: 'no-drag' }}>
        {controls && (
          <>
            <button
              type="button"
              title="Minimize"
              aria-label="Minimize"
              onClick={() => controls.minimize().catch(() => {})}
              className={`${CONTROL_BUTTON} hover:bg-accent hover:text-foreground`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke={stroke}>
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
              className={`${CONTROL_BUTTON} hover:bg-accent hover:text-foreground`}
            >
              {isMax ? (
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke={stroke}>
                  <rect x="8" y="8" width="11" height="11" rx="1" strokeWidth={2} />
                  <path strokeWidth={2} d="M5 16V6a1 1 0 011-1h10" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke={stroke}>
                  <rect x="5" y="5" width="14" height="14" rx="1" strokeWidth={2} />
                </svg>
              )}
            </button>

            <button
              type="button"
              title="Close"
              aria-label="Close"
              onClick={() => controls.close().catch(() => {})}
              className={`${CONTROL_BUTTON} hover:bg-red-600 hover:text-white`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke={stroke}>
                <path strokeLinecap="round" strokeWidth={2} d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
