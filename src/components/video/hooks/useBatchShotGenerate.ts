'use client';

import { useCallback, useRef, useState } from 'react';
import { http } from '@/lib/api/http-client';

export type ShotGenStatus = 'idle' | 'pending' | 'generating' | 'succeeded' | 'failed';

export interface ShotGenInput {
  shotId: string;
  visualPrompt: string;
  referenceImageUrl?: string;
}

export interface ShotGenState {
  shotId: string;
  status: ShotGenStatus;
  imageUrl?: string;
  error?: string;
}

interface UseBatchShotGenerateOptions {
  concurrency?: number;
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
}

/**
 * Batch generate one image per shot using /api/ark-image/generate.
 * Per-shot AbortController + top-level cancelAll.
 */
export function useBatchShotGenerate(opts: UseBatchShotGenerateOptions = {}) {
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 2, 4));
  const aspectRatio = opts.aspectRatio || '16:9';
  const [states, setStates] = useState<Record<string, ShotGenState>>({});
  const [isRunning, setIsRunning] = useState(false);
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const cancelledRef = useRef(false);
  const runningSetRef = useRef<Set<string>>(new Set());

  const setShot = useCallback((shotId: string, patch: Partial<ShotGenState>) => {
    setStates((prev) => ({
      ...prev,
      [shotId]: { ...(prev[shotId] || { shotId, status: 'idle' }), ...patch, shotId },
    }));
  }, []);

  const generateOne = useCallback(
    async (shot: ShotGenInput): Promise<void> => {
      // Skip if a previous cancelAll fired before this worker pulled the shot.
      if (cancelledRef.current) {
        setShot(shot.shotId, { status: 'idle' });
        return;
      }
      // Dedup: if this shot is already running, skip rather than racing controllers.
      if (runningSetRef.current.has(shot.shotId)) return;
      runningSetRef.current.add(shot.shotId);
      const ac = new AbortController();
      controllersRef.current.set(shot.shotId, ac);
      setShot(shot.shotId, { status: 'generating', error: undefined });
      try {
        const body: any = {
          prompt: shot.visualPrompt,
          size: aspectRatio === '16:9' ? '1280x720'
            : aspectRatio === '9:16' ? '720x1280'
            : aspectRatio === '1:1' ? '1024x1024'
            : aspectRatio === '4:3' ? '1024x576'
            : '576x1024',
          count: 1,
          watermark: false,
          aspect_ratio: aspectRatio,
        };
        if (shot.referenceImageUrl) {
          body.reference_image = shot.referenceImageUrl;
        }
        const data = await http.post<any>('/api/ark-image/generate', body, {
          timeoutMs: 300_000,
          signal: ac.signal,
        });
        if (ac.signal.aborted) {
          setShot(shot.shotId, { status: 'idle' });
          return;
        }
        if (!data?.success) {
          throw new Error(data?.message || 'image generation failed');
        }
        const url: string | undefined = data?.images?.[0]?.local_url || data?.images?.[0]?.image_url;
        if (!url) throw new Error('empty image url');
        setShot(shot.shotId, { status: 'succeeded', imageUrl: url });
      } catch (err: any) {
        if (err?.name === 'AbortError' || ac.signal.aborted) {
          setShot(shot.shotId, { status: 'idle' });
          return;
        }
        setShot(shot.shotId, {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controllersRef.current.delete(shot.shotId);
        runningSetRef.current.delete(shot.shotId);
      }
    },
    [aspectRatio, setShot],
  );

  const runBatch = useCallback(
    async (shots: ShotGenInput[]): Promise<void> => {
      if (shots.length === 0) return;
      // Reset cancel flag so a fresh run after cancelAll can proceed.
      cancelledRef.current = false;
      // Read latest state via setStates callback to avoid stale-closure double-runs.
      const eligible: ShotGenInput[] = [];
      setStates((prev) => {
        const next = { ...prev };
        for (const s of shots) {
          const st = prev[s.shotId]?.status;
          if (st === 'succeeded' || st === 'generating' || st === 'pending') continue;
          if (runningSetRef.current.has(s.shotId)) continue;
          eligible.push(s);
          next[s.shotId] = { ...(prev[s.shotId] || { shotId: s.shotId, status: 'idle' }), status: 'pending', shotId: s.shotId };
        }
        return next;
      });
      if (eligible.length === 0) return;
      setIsRunning(true);

      // Simple concurrency pool with cancel-aware worker.
      const queue = [...eligible];
      const workers: Promise<void>[] = [];
      const worker = async () => {
        while (queue.length > 0) {
          if (cancelledRef.current) break;
          const next = queue.shift();
          if (!next) break;
          await generateOne(next);
        }
      };
      for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
        workers.push(worker());
      }
      await Promise.all(workers);
      setIsRunning(false);
    },
    [concurrency, generateOne],
  );

  const retryOne = useCallback(
    async (shot: ShotGenInput) => {
      // Allow explicit retry to bypass a prior cancelAll.
      cancelledRef.current = false;
      await generateOne(shot);
    },
    [generateOne],
  );

  const cancelAll = useCallback(() => {
    cancelledRef.current = true;
    controllersRef.current.forEach((ac) => ac.abort());
    controllersRef.current.clear();
    // Mark any pending (queued but not started) shots back to idle.
    setStates((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (next[k].status === 'pending') next[k] = { ...next[k], status: 'idle' };
      }
      return next;
    });
    setIsRunning(false);
  }, []);

  const reset = useCallback(() => {
    cancelAll();
    setStates({});
  }, [cancelAll]);

  return { states, isRunning, runBatch, retryOne, cancelAll, reset };
}
