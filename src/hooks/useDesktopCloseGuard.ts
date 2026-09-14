'use client';

/**
 * useDesktopCloseGuard — answers the desktop main process when the window is
 * about to close (ME-08).
 *
 * Closing the last window quits the app and stops the local backend, so any
 * autosave still inside its debounce was lost. The main process now asks
 * first; this hook flushes every registered project save and replies whether
 * it is safe to close, with a localized prompt when it is not.
 */

import { useEffect, useRef, type MutableRefObject } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { Translations } from '@/lib/i18n';
import type { CloseReadyResult, DesktopAppLifecycle } from '@/types/desktop';
import { flushAllPending, type FlushAllResult } from '@/components/video/projects/autosaveRegistry';

/** Below the main process' 3 s timeout so the prompt can still be shown. */
const CLOSE_FLUSH_BUDGET_MS = 2500;

export function closeReadyResultFor(result: FlushAllResult, t: Translations): CloseReadyResult {
  if (result.ok) return { ok: true };
  const projects = t.videoProjects;
  return {
    ok: false,
    prompt: {
      title: projects.closeUnsavedTitle,
      // A slow save and a failed save need different advice (RV-19).
      body: result.timedOut ? projects.closeSaveSlowBody : projects.closeUnsavedBody,
      keepOpen: projects.keepOpen,
      closeAnyway: projects.closeAnyway,
    },
  };
}

async function answerCloseRequest(
  bridge: DesktopAppLifecycle,
  token: string,
  translationsRef: MutableRefObject<Translations>,
): Promise<void> {
  const result = await flushAllPending(CLOSE_FLUSH_BUDGET_MS);
  if (!result.ok) {
    console.warn('[closeGuard] pending project saves did not finish before close', result);
  }
  bridge.closeReady(token, closeReadyResultFor(result, translationsRef.current));
}

export function useDesktopCloseGuard(): void {
  const { t } = useLocale();
  // Read at reply time so a locale switch never re-subscribes the IPC listener.
  const translationsRef = useRef<Translations>(t);
  translationsRef.current = t;

  useEffect(() => {
    const bridge = typeof window === 'undefined' ? undefined : window.ecliptrixDesktop?.app;
    // Browser debugging path and older preloads: no close handshake.
    if (!bridge) return undefined;
    return bridge.onBeforeClose((token) => {
      void answerCloseRequest(bridge, token, translationsRef);
    });
  }, []);
}
