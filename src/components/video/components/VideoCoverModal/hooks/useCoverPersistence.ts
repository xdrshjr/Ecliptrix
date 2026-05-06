'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getCover, putCover, uploadCoverPng } from '@/lib/api/videoCover';
import type { CoverState } from '../types';

export interface UseCoverPersistenceResult {
  initialState: CoverState | null;
  isLoading: boolean;
  loadError: Error | null;
  /** Debounced save (600 ms). Safe to call on every keystroke. */
  save: (state: CoverState) => void;
  /** Force any pending save to flush immediately. */
  flush: () => Promise<void>;
  /** Upload a freshly-rendered PNG and resolve to the cache-busted URL. */
  uploadPng: (blob: Blob) => Promise<string>;
}

const DEBOUNCE_MS = 600;

/**
 * Persistence + debounce wrapper for the cover authoring state.
 *
 * Loads the initial state via ``GET /api/video-cover/{projectId}`` on mount,
 * then exposes a debounced ``save`` plus an immediate-flush ``flush`` and a
 * one-shot ``uploadPng``. Errors are surfaced via ``loadError`` (load) and
 * via promise rejection (save / upload) so the caller can show a toast.
 */
export function useCoverPersistence(projectId: string): UseCoverPersistenceResult {
  const [initialState, setInitialState] = useState<CoverState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);

  const pendingRef = useRef<CoverState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<Promise<void> | null>(null);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    getCover(projectId)
      .then((state) => {
        if (cancelled) return;
        setInitialState(state);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const doSave = useCallback(async (state: CoverState): Promise<void> => {
    await putCover(projectId, state);
  }, [projectId]);

  const save = useCallback(
    (state: CoverState) => {
      pendingRef.current = state;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const next = pendingRef.current;
        pendingRef.current = null;
        timerRef.current = null;
        if (!next) return;
        // Track the in-flight save so flush() can await it.
        const promise = doSave(next).catch((err: unknown) => {
          // Re-throw on flush() but don't block the timer callback.
          // eslint-disable-next-line no-console
          console.warn('[useCoverPersistence] debounced save failed', err);
          throw err;
        });
        inflightRef.current = promise.finally(() => {
          if (inflightRef.current === promise) inflightRef.current = null;
        });
      }, DEBOUNCE_MS);
    },
    [doSave],
  );

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) {
      await doSave(pending);
    } else if (inflightRef.current) {
      await inflightRef.current;
    }
  }, [doSave]);

  const uploadPng = useCallback(
    async (blob: Blob): Promise<string> => {
      const { url } = await uploadCoverPng(projectId, blob);
      return url;
    },
    [projectId],
  );

  // Cleanup pending timer on unmount — fire-and-forget the final save.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) {
        // No await — unmount path. Errors are swallowed.
        doSave(pending).catch(() => {
          /* swallow */
        });
      }
    };
  }, [doSave]);

  return { initialState, isLoading, loadError, save, flush, uploadPng };
}
