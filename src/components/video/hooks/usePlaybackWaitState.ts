/**
 * usePlaybackWaitState — small state machine for "next clip not yet cached".
 *
 * Drives the UX flow described in phase2-development-plan-revised.md §3.3 T8:
 *
 *   idle ─ next clip's cacheStatus is 'ready' (or it's same-origin already);
 *          composition playback proceeds normally with the cached URL.
 *
 *   waiting-prefetch ─ next clip's cacheStatus is 'pending' / 'downloading'
 *          and we'd rather pause for a few seconds than start streaming the
 *          remote CDN URL (which is what causes the original stutter). The
 *          consumer pauses the <video> while in this state and shows a
 *          toast / inline tooltip.
 *
 *   expired ─ the wait budget elapsed without ready. Caller falls back to
 *          the origin URL (`serverUrl || url`) so the user is never blocked
 *          longer than `timeoutMs` (default 20s).
 *
 * The hook owns nothing visual — it just exposes the state and a `await
 * waitForReady(material, signal?)` helper that resolves to `'ready' |
 * 'expired'`. The VideoPlayerPanel decides how to surface the toast and
 * which URL to ultimately load.
 *
 * Why a separate hook? VideoPlayerPanel is already a 1k+ line component
 * with intricate playback state; isolating this lets us unit-test the
 * timing logic without booting the full player.
 */

import { useCallback, useRef, useState } from 'react';
import type { MaterialItem } from '@/types';

export type PlaybackWaitStatus = 'idle' | 'waiting-prefetch' | 'expired';

export interface UsePlaybackWaitStateOptions {
  /** How long we're willing to wait for cacheStatus='ready' before falling back. Default 20_000. */
  timeoutMs?: number;
  /** How often we poll the materials snapshot (ms). Default 250. */
  pollIntervalMs?: number;
}

export interface UsePlaybackWaitStateReturn {
  /** Current state, useful for rendering toasts / inline messages. */
  status: PlaybackWaitStatus;
  /**
   * Wait for the given material's cacheStatus to flip to 'ready'.
   * Returns 'ready' on success, 'expired' on timeout, 'cancelled' on abort.
   *
   * `getMaterial()` is invoked on each poll tick — pass a closure that
   * reads the latest materials snapshot from your store.
   */
  waitForReady(
    getMaterial: () => MaterialItem | undefined | null,
    signal?: AbortSignal,
  ): Promise<'ready' | 'expired' | 'cancelled'>;
  /** Reset to idle (e.g. on user-initiated seek). */
  reset(): void;
}

const DEFAULT_TIMEOUT = 20_000;
const DEFAULT_POLL = 250;

/** Material is considered playable from cache when status='ready' AND we have a cacheUrl. */
function isReady(m: MaterialItem | undefined | null): boolean {
  if (!m) return true; // no material to wait on → caller can proceed
  return m.cacheStatus === 'ready' && !!m.cacheUrl;
}

function isFailed(m: MaterialItem | undefined | null): boolean {
  return !!m && m.cacheStatus === 'failed';
}

export function usePlaybackWaitState(
  opts: UsePlaybackWaitStateOptions = {},
): UsePlaybackWaitStateReturn {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const pollMs = opts.pollIntervalMs ?? DEFAULT_POLL;
  const [status, setStatus] = useState<PlaybackWaitStatus>('idle');
  const lastDeadlineRef = useRef<number | null>(null);

  const reset = useCallback(() => {
    lastDeadlineRef.current = null;
    setStatus('idle');
  }, []);

  const waitForReady = useCallback<UsePlaybackWaitStateReturn['waitForReady']>(
    async (getMaterial, signal) => {
      // Short-circuit on initial check — no need to enter waiting state.
      const initial = getMaterial();
      if (isReady(initial) || isFailed(initial)) return 'ready';

      setStatus('waiting-prefetch');
      const deadline = Date.now() + timeoutMs;
      lastDeadlineRef.current = deadline;

      type TickOutcome = 'continue' | 'cancelled';
      const tick = (): Promise<TickOutcome> =>
        new Promise<TickOutcome>((resolve) => {
          if (signal?.aborted) {
            resolve('cancelled');
            return;
          }
          const handle = setTimeout(() => {
            cleanup();
            resolve('continue');
          }, pollMs);
          const onAbort = () => {
            cleanup();
            resolve('cancelled');
          };
          const cleanup = () => {
            clearTimeout(handle);
            signal?.removeEventListener('abort', onAbort);
          };
          signal?.addEventListener('abort', onAbort, { once: true });
        });

      // eslint-disable-next-line no-constant-condition
      while (true) {
        // Guard against another wait having taken over (e.g. user seeked).
        if (lastDeadlineRef.current !== deadline) return 'cancelled';

        const cur = getMaterial();
        // 'failed' is treated as terminal: caller falls back to serverUrl||url
        // rather than blocking forever. We return 'ready' to signal "stop
        // waiting" — the caller checks the material's actual cacheStatus to
        // decide which URL to load.
        if (isReady(cur) || isFailed(cur)) {
          setStatus('idle');
          return 'ready';
        }
        if (Date.now() >= deadline) {
          setStatus('expired');
          return 'expired';
        }
        const r = await tick();
        if (r === 'cancelled') {
          setStatus('idle');
          return 'cancelled';
        }
        // 'continue' → loop again
      }
    },
    [pollMs, timeoutMs],
  );

  return { status, waitForReady, reset };
}
