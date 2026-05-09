'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { http } from './http-client';

export type NotificationPrefs = {
  email: boolean;
  push: boolean;
  marketing: boolean;
};

export type PrivacyPrefs = {
  profile_visible: boolean;
  activity_visible: boolean;
};

export type UserPreferences = {
  notifications: NotificationPrefs;
  privacy: PrivacyPrefs;
  language: 'en' | 'zh-CN';
  theme: 'light' | 'dark' | 'auto';
};

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

type PatchOpts = {
  delta: Partial<UserPreferences>;
  rollback?: () => void;
};

interface UseUserPreferencesMutationOpts {
  onError?: (err: unknown) => void;
}

const PATCH_DEBOUNCE_MS = 300;
const STATUS_FLASH_MS = 2000;
const ERROR_FLASH_MS = 4000;

/**
 * Optimistic, debounced PATCH client for /api/user/me/preferences.
 *
 * Each call to ``patch({ delta, rollback })`` enqueues a delta and schedules
 * a flush 300ms later (resetting the timer if more deltas arrive). The full
 * queue is sent as a single PATCH; on failure we run every queued
 * ``rollback`` callback in LIFO order so optimistic FE state is reverted.
 */
export function useUserPreferencesMutation(opts: UseUserPreferencesMutationOpts = {}) {
  const { onError } = opts;
  const queue = useRef<Partial<UserPreferences>>({});
  const rollbacks = useRef<Array<() => void>>([]);
  const timer = useRef<number | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');

  const flush = useCallback(async () => {
    timer.current = null;
    if (Object.keys(queue.current).length === 0) return;
    setStatus('saving');
    const delta = queue.current;
    const cbs = rollbacks.current;
    queue.current = {};
    rollbacks.current = [];
    try {
      await http.patch('/api/user/me/preferences', delta);
      setStatus('saved');
      window.setTimeout(() => setStatus('idle'), STATUS_FLASH_MS);
    } catch (err) {
      setStatus('error');
      // Run rollbacks LIFO so the latest optimistic update is undone first.
      for (let i = cbs.length - 1; i >= 0; i--) {
        try { cbs[i](); } catch { /* ignore */ }
      }
      try { onError?.(err); } catch { /* ignore */ }
      window.setTimeout(() => setStatus('idle'), ERROR_FLASH_MS);
    }
  }, [onError]);

  const patch = useCallback((opts: PatchOpts) => {
    queue.current = { ...queue.current, ...opts.delta };
    if (opts.rollback) rollbacks.current.push(opts.rollback);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, PATCH_DEBOUNCE_MS);
  }, [flush]);

  useEffect(() => {
    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    };
  }, []);

  return { patch, status };
}

export async function fetchUserPreferences(): Promise<UserPreferences | null> {
  try {
    const data = await http.get<{ success?: boolean; preferences?: UserPreferences }>(
      '/api/user/me/preferences',
    );
    return (data?.preferences as UserPreferences) ?? null;
  } catch {
    return null;
  }
}
