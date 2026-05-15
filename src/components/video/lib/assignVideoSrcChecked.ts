/**
 * assignVideoSrcChecked — optimistic-assign with element-driven retry.
 *
 * Set `<video>.src = candidate` and race three signals:
 *   - `loadedmetadata` (success)
 *   - `error`           (move to next fallback)
 *   - wall-clock timer  (move to next fallback)
 *
 * Why optimistic: HEAD probing every candidate before assignment burns
 * latency on the dominant happy path (same-origin cache hit). The
 * `<video>` element already raises `error` on unloadable sources;
 * leveraging that keeps first-paint fast while preserving correctness.
 *
 * Concurrency: the helper plugs into the existing `transitionIdRef`
 * pattern in `VideoPlayerPanel.tsx` — the caller passes its current
 * `transitionId` plus a `getCurrentId` reader so the helper can abort
 * cleanly when a newer transition supersedes it.
 *
 * Stale-cache repair: when a same-origin candidate fails, the caller is
 * notified via `onCandidateFailed(url, 'same-origin-error')` so it can
 * patch the source `MaterialItem` (`cacheStatus='pending', cacheUrl=null`)
 * — see spec §3.2a.
 */

import { NoPlayableSourceError } from '../errors';

export type AssignFailureReason =
  | 'same-origin-error'
  | 'remote-error'
  | 'timeout'
  | 'aborted';

export interface AssignVideoSrcOptions {
  /** Ordered list of additional candidates to try after `candidate`. */
  fallbacks?: string[];

  /** Bootstrap caller's transition id at the time of this call. */
  transitionId: number;

  /** Read the latest transition id; helper aborts when it diverges. */
  getCurrentId: () => number;

  /** Per-candidate wall-clock budget (default 2000 ms). */
  perCandidateTimeoutMs?: number;

  /**
   * Notified for every candidate that did NOT load. The caller uses
   * 'same-origin-error' to trigger a `patchMaterialCache` repair. For
   * 'remote-error' / 'timeout' the caller may log + emit a metric but
   * typically takes no action.
   */
  onCandidateFailed?: (url: string, reason: AssignFailureReason) => void;

  /** External abort (e.g. component unmount). */
  signal?: AbortSignal;

  /**
   * Opt-in HEAD probe BEFORE assignment. Default skip: assign and listen.
   * Preload pipeline may pass a probe fn for hidden sequences where
   * latency does not block first paint.
   */
  probe?: (url: string, signal: AbortSignal) => Promise<boolean>;
}

export interface AssignVideoSrcResult {
  assigned: string;
  source: 'primary' | 'fallback';
}

const DEFAULT_TIMEOUT_MS = 2000;

function isSameOrigin(url: string): boolean {
  if (!url) return false;
  if (typeof window === 'undefined') return false;
  // Bare relative path → same-origin.
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

function classifyError(url: string): 'same-origin-error' | 'remote-error' {
  return isSameOrigin(url) ? 'same-origin-error' : 'remote-error';
}

export async function assignVideoSrcChecked(
  video: HTMLVideoElement,
  candidate: string,
  options: AssignVideoSrcOptions,
): Promise<AssignVideoSrcResult> {
  const {
    fallbacks = [],
    transitionId,
    getCurrentId,
    perCandidateTimeoutMs = DEFAULT_TIMEOUT_MS,
    onCandidateFailed,
    signal,
    probe,
  } = options;

  const queue: string[] = [candidate, ...fallbacks].filter(Boolean);
  const attempted: string[] = [];

  for (let i = 0; i < queue.length; i++) {
    const url = queue[i];
    attempted.push(url);

    if (signal?.aborted || getCurrentId() !== transitionId) {
      throw new NoPlayableSourceError(attempted);
    }

    if (probe) {
      const probeAborter = new AbortController();
      const probeTimer = setTimeout(
        () => probeAborter.abort(),
        perCandidateTimeoutMs,
      );
      let probeOk = false;
      try {
        probeOk = await probe(url, probeAborter.signal);
      } catch {
        probeOk = false;
      } finally {
        clearTimeout(probeTimer);
      }
      if (signal?.aborted || getCurrentId() !== transitionId) {
        throw new NoPlayableSourceError(attempted);
      }
      if (!probeOk) {
        onCandidateFailed?.(url, classifyError(url));
        continue;
      }
    }

    const outcome = await assignAndAwait(
      video,
      url,
      perCandidateTimeoutMs,
      transitionId,
      getCurrentId,
      signal,
    );

    if (outcome === 'success') {
      return {
        assigned: url,
        source: i === 0 ? 'primary' : 'fallback',
      };
    }

    if (outcome === 'aborted') {
      throw new NoPlayableSourceError(attempted);
    }

    const reason: AssignFailureReason =
      outcome === 'timeout' ? 'timeout' : classifyError(url);
    onCandidateFailed?.(url, reason);
  }

  throw new NoPlayableSourceError(attempted);
}

type AwaitOutcome = 'success' | 'error' | 'timeout' | 'aborted';

function assignAndAwait(
  video: HTMLVideoElement,
  url: string,
  timeoutMs: number,
  transitionId: number,
  getCurrentId: () => number,
  signal: AbortSignal | undefined,
): Promise<AwaitOutcome> {
  return new Promise<AwaitOutcome>(resolve => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('canplay', onLoaded);
      video.removeEventListener('error', onError);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const settle = (outcome: AwaitOutcome) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(outcome);
    };

    const onLoaded = () => {
      if (getCurrentId() !== transitionId) {
        settle('aborted');
        return;
      }
      settle('success');
    };
    const onError = () => {
      if (getCurrentId() !== transitionId) {
        settle('aborted');
        return;
      }
      settle('error');
    };
    const onAbort = () => settle('aborted');

    video.addEventListener('loadedmetadata', onLoaded, { once: true });
    video.addEventListener('canplay', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });
    if (signal) {
      if (signal.aborted) {
        settle('aborted');
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    timer = setTimeout(() => {
      if (getCurrentId() !== transitionId) {
        settle('aborted');
        return;
      }
      settle('timeout');
    }, timeoutMs);

    // Assign last so any pending error event from a prior src is detached.
    try {
      video.src = url;
      // Some browsers will not fire load / error without an explicit load().
      // load() is a no-op when the URL hasn't changed.
      try {
        video.load();
      } catch {
        // ignore — load() throws only on dead elements
      }
    } catch {
      settle('error');
    }

    if (getCurrentId() !== transitionId) {
      settle('aborted');
    }
  });
}
