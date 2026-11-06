'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getVideoModelConfiguration, type VideoModelConfiguration } from '@/lib/api/arkVideo';

export function useVideoModelConfig(open: boolean) {
  const [config, setConfig] = useState<VideoModelConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setFailed(false);
    try {
      const next = await getVideoModelConfiguration(controller.signal);
      if (!controller.signal.aborted) setConfig(next);
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!open) return;
    void refresh();
    const changed = () => { void refresh(); };
    window.addEventListener('ecliptrix-llm-config-updated', changed);
    return () => {
      request.current?.abort();
      window.removeEventListener('ecliptrix-llm-config-updated', changed);
    };
  }, [open, refresh]);
  return { config, loading, failed, refresh, model: config?.models.find(item => item.id === config.default_model) };
}
