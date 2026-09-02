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
 * Every failure mode (network error, non-200, parse failure, backend
 * `success !== true`) maps to 'unknown' — fail-open so a transient backend
 * fault never flashes the setup guide at an already-configured install.
 * Model-settings saves broadcast 'ecliptrix-llm-config-updated' which
 * triggers a silent refetch.
 */
export function useLlmConfigStatus(): {
  status: LlmConfigStatus;
  refresh: () => void;
} {
  const [status, setStatus] = useState<LlmConfigStatus>('loading');
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const body = await http.get<LlmStatusResponse>('/api/config/llm-status');
        if (cancelled) return;
        if (body?.success !== true) {
          // Backend resolution fault — indeterminate, do not prompt.
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
  }, [refreshKey]);

  useEffect(() => {
    window.addEventListener(CONFIG_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(CONFIG_UPDATED_EVENT, refresh);
  }, [refresh]);

  return { status, refresh };
}
