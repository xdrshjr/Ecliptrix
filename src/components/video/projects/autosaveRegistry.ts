/**
 * autosaveRegistry — pending project saves the desktop close guard must flush.
 *
 * Autosave debounces edits by 800 ms. Closing the window inside that window
 * used to stop the local backend before the save ran, silently losing the
 * last edits. Each mounted autosave registers a flush here; the close guard
 * runs them all against a time budget before the window is allowed to close.
 */

export interface FlushAllResult {
  ok: boolean;
  failedKeys: string[];
  timedOut: boolean;
}

const pendingFlushes = new Map<string, () => Promise<void>>();

/** Register a flush under `key`; returns an unregister function. */
export function registerPendingFlush(key: string, flush: () => Promise<void>): () => void {
  pendingFlushes.set(key, flush);
  return () => {
    // A newer registration under the same key (remount) must survive the old cleanup.
    if (pendingFlushes.get(key) === flush) pendingFlushes.delete(key);
  };
}

/** Run every registered flush in parallel, racing `timeoutMs`; any failure or the timeout → ok=false. */
export async function flushAllPending(timeoutMs: number): Promise<FlushAllResult> {
  const entries = Array.from(pendingFlushes.entries());
  if (entries.length === 0) return { ok: true, failedKeys: [], timedOut: false };

  const failedKeys: string[] = [];
  const allSettled = Promise.all(
    entries.map(([key, flush]) =>
      Promise.resolve()
        .then(flush)
        .catch((error: unknown) => {
          console.warn('[autosaveRegistry] pending flush failed', { key, error });
          failedKeys.push(key);
        }),
    ),
  ).then(() => 'settled' as const);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timed-out'>((resolve) => {
    timer = setTimeout(() => resolve('timed-out'), timeoutMs);
  });

  const outcome = await Promise.race([allSettled, timeout]);
  clearTimeout(timer);
  if (outcome === 'timed-out') {
    return { ok: false, failedKeys: [...failedKeys], timedOut: true };
  }
  return { ok: failedKeys.length === 0, failedKeys, timedOut: false };
}
