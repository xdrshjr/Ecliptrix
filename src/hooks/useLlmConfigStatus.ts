'use client';

import { useCallback, useEffect, useState } from 'react';
import { http } from '@/lib/api/http-client';

export type LlmConfigStatus = 'loading' | 'configured' | 'unconfigured' | 'unknown';

interface LlmStatusResponse {
  success?: boolean;
  data?: { configured?: boolean; source?: string };
}

const CONFIG_UPDATED_EVENT = 'ecliptrix-llm-config-updated';

/**
 * LLM credential status for the first-run setup guide.
 *
 * `enabled=false` (unauthenticated / non-admin) keeps the hook idle at
 * 'loading' without issuing a request. Every failure mode (network error,
 * non-200, parse failure, backend `success !== true`) maps to 'unknown' —
 * fail-open so a transient backend fault never flashes the setup guide at an
 * already-configured admin (spec R4). Model-settings saves broadcast
 * 'ecliptrix-llm-config-updated' which triggers a silent refetch.
 */
export function useLlmConfigStatus(enabled: boolean): {
  status: LlmConfigStatus;
  refresh: () => void;
} {
  const [status, setStatus] = useState<LlmConfigStatus>('loading');
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus('loading');
      return;
    }
    let cancelled = false;

    const fetchStatus = async () => {
      try {
        // Public endpoint — requireAuth:false keeps a stray 401 from routing
        // through the global session-expired handler.
        const body = await http.get<LlmStatusResponse>(
          '/api/config/llm-status',
          { requireAuth: false },
        );
        if (cancelled) return;
        if (body?.success !== true) {
          // R4: backend resolution fault — indeterminate, do not prompt.
          setStatus('unknown');
          return;
        }
        setStatus(body.data?.configured === true ? 'configured' : 'unconfigured');
      } catch {
        // Network error / non-200 / parse failure — all fail-open.
        if (!cancelled) setStatus('unknown');
      }
    };

    fetchStatus();
    return () => {
      cancelled = true;
    };
  }, [enabled, refreshKey]);

  useEffect(() => {
    window.addEventListener(CONFIG_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(CONFIG_UPDATED_EVENT, refresh);
  }, [refresh]);

  return { status, refresh };
}
