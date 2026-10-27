import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAgentToolkitCapabilities } from '@/lib/api/agentToolkit';
import { updateCategorySettings } from '@/lib/api/systemSettings';

/**
 * `auto_compact` / `auto_compact_ratio`, read from the toolkit capabilities
 * response (`memory_compaction`). The ring never blocks on this: any failure
 * leaves the factory defaults in force.
 */

export interface CompactionSettings {
  autoCompact: boolean;
  autoCompactRatio: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  autoCompact: true,
  autoCompactRatio: 0.75,
};

const MIN_RATIO = 0.6;
const MAX_RATIO = 0.9;
const SETTINGS_CATEGORY = 'agent_toolkit';

function clampRatio(value: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
}

export interface UseCompactionSettingsReturn {
  settings: CompactionSettings;
  /** Re-read the settings (they may have been changed in the settings centre). */
  refresh: () => Promise<CompactionSettings>;
  /** Persist the quick switch; rolls back and returns false when saving fails. */
  setAutoCompact: (enabled: boolean) => Promise<boolean>;
}

export function useCompactionSettings(): UseCompactionSettingsReturn {
  const [settings, setSettings] = useState(DEFAULT_COMPACTION_SETTINGS);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const aliveRef = useRef(true);

  const refresh = useCallback(async (): Promise<CompactionSettings> => {
    try {
      const raw = (await fetchAgentToolkitCapabilities()).memory_compaction;
      if (!raw || !aliveRef.current) return settingsRef.current;
      const next: CompactionSettings = {
        autoCompact: raw.auto_compact !== false,
        autoCompactRatio: Number.isFinite(raw.auto_compact_ratio)
          ? clampRatio(raw.auto_compact_ratio) : DEFAULT_COMPACTION_SETTINGS.autoCompactRatio,
      };
      settingsRef.current = next;
      setSettings(next);
      return next;
    } catch (error) {
      console.warn('[useCompactionSettings] capabilities unavailable, keeping settings', error);
      return settingsRef.current;
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    return () => { aliveRef.current = false; };
  }, [refresh]);

  const setAutoCompact = useCallback(async (enabled: boolean): Promise<boolean> => {
    const previous = settingsRef.current;
    setSettings({ ...previous, autoCompact: enabled });
    try {
      const result = await updateCategorySettings(SETTINGS_CATEGORY, { auto_compact: enabled });
      if (!result.success) throw new Error('settings_update_rejected');
      return true;
    } catch (error) {
      console.warn('[useCompactionSettings] could not save auto_compact', error);
      setSettings(previous);
      return false;
    }
  }, []);

  return { settings, refresh, setAutoCompact };
}
