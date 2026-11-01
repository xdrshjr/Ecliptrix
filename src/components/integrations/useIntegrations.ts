'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listIntegrations,
  type IntegrationId,
  type IntegrationStatus,
} from '@/lib/api/integrations';

export type IntegrationsLoadState = 'loading' | 'ready' | 'error';

/**
 * Loads the integration list once and re-reads it after every write. The
 * wizard and the settings panel both use it, so they show the same values.
 * `reload` keeps the previous list on screen while refetching (no flicker).
 */
export function useIntegrations() {
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loadState, setLoadState] = useState<IntegrationsLoadState>('loading');
  const [loadFailed, setLoadFailed] = useState(false);
  const mountedRef = useRef(true);

  const reload = useCallback(async () => {
    try {
      const list = await listIntegrations();
      if (!mountedRef.current) return;
      setIntegrations(list.integrations);
      setLoadFailed(list.loadFailed);
      setLoadState('ready');
    } catch {
      if (!mountedRef.current) return;
      setLoadState((current) => (current === 'ready' ? current : 'error'));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void reload();
    return () => {
      mountedRef.current = false;
    };
  }, [reload]);

  const find = useCallback(
    (id: IntegrationId) => integrations.find((item) => item.id === id),
    [integrations],
  );

  return { integrations, find, loadState, loadFailed, reload };
}

export type IntegrationsState = ReturnType<typeof useIntegrations>;
