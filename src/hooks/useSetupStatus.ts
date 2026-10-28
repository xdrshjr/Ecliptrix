'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchCapabilityStatus,
  isGap,
  type CapabilityId,
  type CapabilityStatus,
} from '@/lib/api/setupStatus';
import { SETUP_CONFIG_UPDATED_EVENT } from '@/lib/setupEvents';
import { readOptOuts } from '@/lib/setupOptOut';

export type SetupStatus = 'loading' | 'complete' | 'needs-setup' | 'unknown';

/** Backend cold-start races are absorbed by these waits (1s / 2s / 4s). */
export const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

/**
 * Core capabilities are never ignorable; extended ones only count as a gap
 * when the user has not explicitly opted out (D2 / D7).
 */
export function hasSetupGap(
  capabilities: CapabilityStatus[],
  optOuts: readonly CapabilityId[],
): boolean {
  return capabilities.some(
    (capability) =>
      isGap(capability) &&
      (capability.tier === 'core' || !optOuts.includes(capability.id)),
  );
}

/**
 * Startup capability check for the first-run wizard.
 *
 * Every failure mode maps to 'unknown' — fail-open, so a transient backend
 * fault never flashes the wizard at an already-configured install. Writes
 * anywhere in the app broadcast SETUP_CONFIG_UPDATED_EVENT, which triggers a
 * silent refetch (no return to 'loading', so the UI never flickers).
 */
export function useSetupStatus(): {
  status: SetupStatus;
  capabilities: CapabilityStatus[];
  optOuts: CapabilityId[];
  refresh: () => void;
} {
  const [capabilities, setCapabilities] = useState<CapabilityStatus[] | null>(null);
  const [optOuts, setOptOuts] = useState<CapabilityId[]>([]);
  const [failed, setFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const hasLoadedRef = useRef(false);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async (attempt: number) => {
      try {
        const next = await fetchCapabilityStatus();
        if (cancelled) return;
        hasLoadedRef.current = true;
        setOptOuts(readOptOuts());
        setCapabilities(next);
        setFailed(false);
      } catch {
        if (cancelled) return;
        // A silent refetch keeps the last good answer rather than flipping it.
        if (hasLoadedRef.current) return;
        if (attempt < RETRY_DELAYS_MS.length) {
          timer = setTimeout(() => void load(attempt + 1), RETRY_DELAYS_MS[attempt]);
          return;
        }
        console.warn('[setup] capability status unavailable — wizard skipped');
        setFailed(true);
      }
    };

    void load(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refreshKey]);

  useEffect(() => {
    window.addEventListener(SETUP_CONFIG_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(SETUP_CONFIG_UPDATED_EVENT, refresh);
  }, [refresh]);

  const status = useMemo<SetupStatus>(() => {
    if (capabilities === null) return failed ? 'unknown' : 'loading';
    return hasSetupGap(capabilities, optOuts) ? 'needs-setup' : 'complete';
  }, [capabilities, optOuts, failed]);

  return { status, capabilities: capabilities ?? [], optOuts, refresh };
}
