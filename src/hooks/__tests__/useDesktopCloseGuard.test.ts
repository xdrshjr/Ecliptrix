/**
 * ME-08 / RV-19: the renderer side of the desktop close handshake. A slow
 * save and a failed save must reach the main process with different advice.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { getTranslations } from '@/lib/i18n';
import type { CloseReadyResult, EcliptrixDesktopBridge } from '@/types/desktop';
import { registerPendingFlush } from '@/components/video/projects/autosaveRegistry';
import { useDesktopCloseGuard } from '../useDesktopCloseGuard';

vi.mock('@/contexts/LocaleContext', async () => {
  const { getTranslations: loadTranslations } = await import('@/lib/i18n');
  const t = loadTranslations('en');
  return { useLocale: () => ({ t, locale: 'en', setLocale: () => {} }) };
});

const en = getTranslations('en');
const cleanups: Array<() => void> = [];

interface FakeBridge {
  listeners: Set<(token: string) => void>;
  replies: Array<{ token: string; result: CloseReadyResult }>;
}

function installBridge(): FakeBridge {
  const bridge: FakeBridge = { listeners: new Set(), replies: [] };
  window.ecliptrixDesktop = {
    version: 'test',
    logsPath: '',
    app: {
      onBeforeClose: (cb: (token: string) => void) => {
        bridge.listeners.add(cb);
        return () => { bridge.listeners.delete(cb); };
      },
      closeReady: (token: string, result: CloseReadyResult) => {
        bridge.replies.push({ token, result });
      },
    },
  } as unknown as EcliptrixDesktopBridge;
  return bridge;
}

async function requestClose(bridge: FakeBridge, token: string, budgetMs = 0): Promise<void> {
  await act(async () => {
    bridge.listeners.forEach((listener) => listener(token));
    await vi.advanceTimersByTimeAsync(budgetMs);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanups.splice(0).forEach((unregister) => unregister());
  delete window.ecliptrixDesktop;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useDesktopCloseGuard', () => {
  it('answers ok once every pending save has flushed', async () => {
    const bridge = installBridge();
    const flush = vi.fn(async () => {});
    cleanups.push(registerPendingFlush('project:p1', flush));
    renderHook(() => useDesktopCloseGuard());

    await requestClose(bridge, 'token-1');

    expect(flush).toHaveBeenCalledTimes(1);
    expect(bridge.replies).toEqual([{ token: 'token-1', result: { ok: true } }]);
  });

  it('a save still running at the budget asks with the slow-save message', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bridge = installBridge();
    cleanups.push(registerPendingFlush('project:p1', () => new Promise<void>(() => {})));
    renderHook(() => useDesktopCloseGuard());

    await requestClose(bridge, 'token-1', 2500);

    expect(bridge.replies).toEqual([{
      token: 'token-1',
      result: {
        ok: false,
        prompt: {
          title: en.videoProjects.closeUnsavedTitle,
          body: en.videoProjects.closeSaveSlowBody,
          keepOpen: en.videoProjects.keepOpen,
          closeAnyway: en.videoProjects.closeAnyway,
        },
      },
    }]);
  });

  it('a failed save asks with the unsaved-changes message', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bridge = installBridge();
    cleanups.push(registerPendingFlush('project:p1', async () => { throw new Error('400'); }));
    renderHook(() => useDesktopCloseGuard());

    await requestClose(bridge, 'token-1');

    const [reply] = bridge.replies;
    expect(reply.result.ok).toBe(false);
    expect(reply.result.ok === false && reply.result.prompt.body).toBe(en.videoProjects.closeUnsavedBody);
  });

  it('unmounting stops listening for close requests', () => {
    const bridge = installBridge();
    const { unmount } = renderHook(() => useDesktopCloseGuard());
    expect(bridge.listeners.size).toBe(1);

    unmount();

    expect(bridge.listeners.size).toBe(0);
  });

  it('does nothing outside the desktop app', () => {
    const { unmount } = renderHook(() => useDesktopCloseGuard());

    expect(() => unmount()).not.toThrow();
    expect(window.ecliptrixDesktop).toBeUndefined();
  });
});
