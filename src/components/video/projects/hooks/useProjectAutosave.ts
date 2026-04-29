'use client';

import { useEffect, useRef } from 'react';
import {
  normaliseProjectDataForSave,
  updateVideoProject,
} from '@/lib/api/videoProjects';
import type { VideoEditingTaskContent } from '@/types';

/**
 * Autosave contract (R-C):
 *  - Idle debounce: 800ms after the last `content` change.
 *  - Max-flush: 10s during continuous editing.
 *  - Skip-equal: JSON-stringify of normalised payload — skip if identical.
 *  - Unmount flush: best-effort PUT before the editor unmounts.
 *  - Failure handling: 5xx → retry once after 3s; 4xx → toast and stop.
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

export interface UseProjectAutosaveOptions {
  onSaveStart?: () => void;
  onSaveSuccess?: () => void;
  onSaveError?: (err: unknown) => void;
}

export function useProjectAutosave(
  projectId: string | null,
  content: VideoEditingTaskContent | null,
  opts: UseProjectAutosaveOptions = {},
): void {
  const lastSavedJsonRef = useRef<string>('');
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaveAtRef = useRef<number>(Date.now());
  const inFlightRef = useRef<boolean>(false);
  const dirtyRef = useRef<boolean>(false);
  const contentRef = useRef<VideoEditingTaskContent | null>(content);
  const projectIdRef = useRef<string | null>(projectId);
  const optsRef = useRef(opts);

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
  }, [projectId]);

  // The save routine — reads from refs so it can be re-driven without
  // re-creating closures.
  const flush = useRef<() => Promise<void>>(async () => {});
  flush.current = async () => {
    const pid = projectIdRef.current;
    const c = contentRef.current;
    if (!pid || !c) return;
    if (inFlightRef.current) {
      // Another save is currently running. Mark dirty so it re-fires when
      // the in-flight one completes.
      dirtyRef.current = true;
      return;
    }

    const payload = normaliseProjectDataForSave(c);
    let snapshot = '';
    try {
      snapshot = JSON.stringify(payload);
    } catch {
      return;
    }
    if (!snapshot || snapshot === lastSavedJsonRef.current) {
      dirtyRef.current = false;
      return;
    }

    inFlightRef.current = true;
    dirtyRef.current = false;
    optsRef.current.onSaveStart?.();
    try {
      await updateVideoProject(pid, { project_data: payload });
      lastSavedJsonRef.current = snapshot;
      lastSaveAtRef.current = Date.now();
      optsRef.current.onSaveSuccess?.();
    } catch (err) {
      const status = (err as { status?: number } | undefined)?.status;
      if (typeof status === 'number' && status >= 500 && status < 600) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          await updateVideoProject(pid, { project_data: payload });
          lastSavedJsonRef.current = snapshot;
          lastSaveAtRef.current = Date.now();
          optsRef.current.onSaveSuccess?.();
        } catch (err2) {
          optsRef.current.onSaveError?.(err2);
        }
      } else {
        optsRef.current.onSaveError?.(err);
      }
    } finally {
      inFlightRef.current = false;
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
    } catch {
      return;
    }
    if (!json || json === lastSavedJsonRef.current) {
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

  // Unmount flush — synchronous best-effort. Reads the latest content from
  // refs, NOT a stale closure capture from when [projectId] first ran.
  useEffect(() => {
    return () => {
      const pid = projectIdRef.current;
      const c = contentRef.current;
      if (!pid || !c) return;
      let json = '';
      try {
        json = JSON.stringify(normaliseProjectDataForSave(c));
      } catch {
        return;
      }
      if (!json || json === lastSavedJsonRef.current) return;
      void updateVideoProject(pid, {
        project_data: normaliseProjectDataForSave(c),
      }).catch(() => {
        /* swallow — best effort */
      });
    };
  }, []);
}
