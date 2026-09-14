'use client';

import { useEffect, useRef, type MutableRefObject } from 'react';
import {
  normaliseProjectDataForSave,
  updateVideoProject,
} from '@/lib/api/videoProjects';
import type { VideoEditingTaskContent } from '@/types';
import { registerPendingFlush } from '../autosaveRegistry';

/**
 * Autosave contract (R-C):
 *  - Idle debounce: 800ms after the last `content` change.
 *  - Max-flush: 10s during continuous editing.
 *  - Skip-equal: JSON-stringify of normalised payload — skip if identical.
 *  - Unmount flush: waits for an in-flight save, then saves the latest content.
 *  - Failure handling: 5xx → retry once after 3s with the LATEST content (the
 *    failed payload may be older than a save made meanwhile); 4xx → report.
 *  - Close flush (ME-08): registered with autosaveRegistry so the desktop close
 *    guard can end a pending retry wait and save before the window closes.
 *
 * `projectId` may be null while the editor is loading; in that case the
 * hook is a no-op.
 *
 * Implementation notes:
 *  - Option callbacks (onSaveStart/Success/Error) are accessed via a ref so
 *    inline lambdas in the parent do NOT re-trigger the debounce timer on
 *    every render. The main effect depends ONLY on (projectId, content).
 *  - The latest `content` is also captured in a ref so the unmount cleanup
 *    can flush the most recent edits, not whatever `content` was when the
 *    `[projectId]` effect first ran.
 *  - If a content change lands while a save is in-flight, the dirty flag
 *    causes `flush()` to re-run after the in-flight completes — otherwise
 *    that final keystroke would be silently dropped until the user typed
 *    again.
 */

const IDLE_DEBOUNCE_MS = 800;
const MAX_FLUSH_MS = 10_000;
const RETRY_DELAY_MS = 3000;

// Unmount flushes of the same project (leave, reopen, leave) must not share a
// registry key, or the second would hide the first from the close guard.
let unmountFlushSequence = 0;

export interface UseProjectAutosaveOptions {
  onSaveStart?: () => void;
  onSaveSuccess?: () => void;
  onSaveError?: (err: unknown) => void;
}

function isServerError(err: unknown): boolean {
  const status = (err as { status?: number } | undefined)?.status;
  return typeof status === 'number' && status >= 500 && status < 600;
}

/** Back-off before the retry; `retryWaitRef.current()` ends it early. */
function waitForRetryWindow(retryWaitRef: MutableRefObject<(() => void) | null>): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      if (retryWaitRef.current === finish) retryWaitRef.current = null;
      resolve();
    };
    const timer = setTimeout(finish, RETRY_DELAY_MS);
    retryWaitRef.current = finish;
  });
}

/** Ends a pending retry back-off so the retry runs now instead of after 3 s. */
function endRetryWait(retryWaitRef: MutableRefObject<(() => void) | null>): void {
  retryWaitRef.current?.();
}

/** Resolves once no save is in flight, including saves chained by the dirty flag. */
async function waitForInFlight(inFlightRef: MutableRefObject<Promise<void> | null>): Promise<void> {
  while (inFlightRef.current) {
    await inFlightRef.current;
  }
}

// Hook body exceeds 60 lines: it wires four effects around shared refs, and
// splitting it would scatter the refs the save paths must all agree on.
export function useProjectAutosave(
  projectId: string | null,
  content: VideoEditingTaskContent | null,
  opts: UseProjectAutosaveOptions = {},
): void {
  const lastSavedJsonRef = useRef<string>('');
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaveAtRef = useRef<number>(Date.now());
  const inFlightPromiseRef = useRef<Promise<void> | null>(null);
  const retryWaitRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef<boolean>(true);
  const dirtyRef = useRef<boolean>(false);
  const contentRef = useRef<VideoEditingTaskContent | null>(content);
  const projectIdRef = useRef<string | null>(projectId);
  const optsRef = useRef(opts);
  // Tracks the project for which the hydrate-baseline has already been
  // captured. The first non-empty `json` we see for a given projectId is
  // the rehydrated content (timeline + UI state from the backend); it must
  // not trigger a PUT, otherwise opening any saved project causes a noop
  // round-trip and burns autosave noise. After this fires once, normal
  // skip-equal handling (`json === lastSavedJsonRef.current`) takes over.
  const baselineInitProjectIdRef = useRef<string | null>(null);

  // Keep refs current on every render (cheap, no effect needed).
  contentRef.current = content;
  projectIdRef.current = projectId;
  optsRef.current = opts;

  // Reset cached "last saved" baseline whenever we open a different project
  // so the new project's first content frame doesn't get skipped.
  useEffect(() => {
    lastSavedJsonRef.current = '';
    lastSaveAtRef.current = Date.now();
    dirtyRef.current = false;
    baselineInitProjectIdRef.current = null;
  }, [projectId]);

  // Save the latest content of `pid` unless it equals the last saved payload.
  // Throws on failure so every caller decides how to report it.
  const saveLatestIfDirty = useRef<(pid: string) => Promise<void>>(async () => {});
  saveLatestIfDirty.current = async (pid) => {
    // After a project switch the content ref belongs to another project.
    if (projectIdRef.current !== pid) return;
    const c = contentRef.current;
    if (!c) return;
    const payload = normaliseProjectDataForSave(c);
    const snapshot = JSON.stringify(payload);
    if (!snapshot || snapshot === lastSavedJsonRef.current) return;
    await updateVideoProject(pid, { project_data: payload });
    lastSavedJsonRef.current = snapshot;
    lastSaveAtRef.current = Date.now();
  };

  // One save attempt plus its single 5xx retry. Never rejects.
  const runSave = useRef<(pid: string, payload: Record<string, unknown>, snapshot: string) => Promise<void>>(
    async () => {},
  );
  runSave.current = async (pid, payload, snapshot) => {
    optsRef.current.onSaveStart?.();
    try {
      await updateVideoProject(pid, { project_data: payload });
      lastSavedJsonRef.current = snapshot;
      lastSaveAtRef.current = Date.now();
      optsRef.current.onSaveSuccess?.();
    } catch (err) {
      if (!isServerError(err)) {
        optsRef.current.onSaveError?.(err);
        return;
      }
      await waitForRetryWindow(retryWaitRef);
      // Unmounted: the unmount flush saves the latest content. Switched: `pid` is no longer open.
      if (!mountedRef.current || projectIdRef.current !== pid) {
        optsRef.current.onSaveError?.(err);
        return;
      }
      try {
        await saveLatestIfDirty.current(pid);
        optsRef.current.onSaveSuccess?.();
      } catch (retryErr) {
        optsRef.current.onSaveError?.(retryErr);
      }
    }
  };

  // The save routine — reads from refs so it can be re-driven without
  // re-creating closures.
  const flush = useRef<() => Promise<void>>(async () => {});
  flush.current = async () => {
    const pid = projectIdRef.current;
    const c = contentRef.current;
    if (!pid || !c) return;
    if (inFlightPromiseRef.current) {
      // Another save is currently running. Mark dirty so it re-fires when
      // the in-flight one completes.
      dirtyRef.current = true;
      return;
    }

    const payload = normaliseProjectDataForSave(c);
    let snapshot = '';
    try {
      snapshot = JSON.stringify(payload);
    } catch (error) {
      console.warn('[autosave] project content is not serialisable', { projectId: pid, error });
      return;
    }
    if (!snapshot || snapshot === lastSavedJsonRef.current) {
      dirtyRef.current = false;
      return;
    }

    dirtyRef.current = false;
    const save = runSave.current(pid, payload, snapshot).catch((error: unknown) => {
      console.error('[autosave] save failed unexpectedly', { projectId: pid, error });
    });
    inFlightPromiseRef.current = save;
    try {
      await save;
    } finally {
      inFlightPromiseRef.current = null;
      // If a change landed while we were saving, fire another pass so the
      // final keystroke isn't silently dropped.
      if (dirtyRef.current) {
        dirtyRef.current = false;
        void flush.current();
      }
    }
  };

  // Schedule a debounced save whenever content changes.
  useEffect(() => {
    if (!projectId || !content) return;

    // Skip-equal: compute the normalised JSON once. If it matches the last
    // saved snapshot, do not schedule a save and do not cancel an existing
    // timer (other re-renders should not interfere with a pending save).
    let json = '';
    try {
      json = JSON.stringify(normaliseProjectDataForSave(content));
    } catch (error) {
      console.warn('[autosave] project content is not serialisable', { projectId, error });
      return;
    }
    if (!json || json === lastSavedJsonRef.current) {
      return;
    }

    // Hydrate-baseline: the very first non-empty `json` we observe for a
    // given project is the rehydrated content from the backend. Treat it
    // as the saved baseline and skip scheduling a save — otherwise simply
    // opening a project causes a no-op PUT (and a saving→saved flicker).
    // The next genuine content change will be different from this baseline
    // and flow through normal scheduling.
    if (
      baselineInitProjectIdRef.current !== projectId &&
      lastSavedJsonRef.current === ''
    ) {
      baselineInitProjectIdRef.current = projectId;
      lastSavedJsonRef.current = json;
      lastSaveAtRef.current = Date.now();
      return;
    }

    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

    const elapsedSinceSave = Date.now() - lastSaveAtRef.current;
    const remainingMaxFlush = Math.max(0, MAX_FLUSH_MS - elapsedSinceSave);
    const wait = Math.min(IDLE_DEBOUNCE_MS, remainingMaxFlush);

    idleTimerRef.current = setTimeout(() => {
      void flush.current();
    }, wait);

    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [projectId, content]);

  // Close flush: the desktop close guard ends a pending retry back-off (it
  // would otherwise eat the close budget), waits for the save in flight and
  // then saves whatever is newer.
  useEffect(() => {
    if (!projectId) return undefined;
    return registerPendingFlush(`project:${projectId}`, async () => {
      endRetryWait(retryWaitRef);
      await waitForInFlight(inFlightPromiseRef);
      await saveLatestIfDirty.current(projectId);
    });
  }, [projectId]);

  // Unmount flush. Chained after the in-flight save so an older payload can
  // never land after the latest one. The close flush above unregisters on
  // unmount, so this save registers itself until it lands: closing the window
  // right after leaving the editor (e.g. during a 5xx back-off) must still
  // wait for it instead of stopping the backend first.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const pid = projectIdRef.current;
      if (!pid) return;
      const save = waitForInFlight(inFlightPromiseRef).then(() => saveLatestIfDirty.current(pid));
      unmountFlushSequence += 1;
      const unregister = registerPendingFlush(`project:${pid}:unmount:${unmountFlushSequence}`, () => {
        endRetryWait(retryWaitRef);
        return save;
      });
      void save
        .catch((error: unknown) => {
          console.warn('[autosave] unmount flush failed', { projectId: pid, error });
        })
        .finally(unregister);
    };
  }, []);
}
