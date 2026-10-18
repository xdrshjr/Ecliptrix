'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

import { http } from '@/lib/api/http-client';

export interface SettingItem {
  key: string;
  value: unknown;
  default_value: unknown;
  value_type: string;
  description: string;
  updated_at: string | null;
  updated_by: string | null;
}

interface UseSettingsPanelReturn {
  settings: Record<string, unknown>;
  defaultValues: Record<string, unknown>;
  loading: boolean;
  loadError: boolean;
  saving: boolean;
  isDirty: boolean;
  updateSetting: (key: string, value: unknown) => void;
  saveSettings: () => Promise<boolean>;
  resetToDefaults: () => Promise<boolean>;
  refetch: () => Promise<void>;
}

async function fetchCategorySettings(category: string): Promise<{
  success: boolean;
  settings: SettingItem[];
}> {
  return http.get<{ success: boolean; settings: SettingItem[] }>(
    `/api/system-settings/${category}`,
  );
}

async function saveCategorySettings(
  category: string,
  settings: Record<string, unknown>,
): Promise<{ success: boolean; message: string }> {
  return http.put<{ success: boolean; message: string }>(
    `/api/system-settings/${category}`,
    { settings },
  );
}

async function resetCategorySettings(category: string): Promise<{
  success: boolean;
  message: string;
  settings: SettingItem[];
}> {
  return http.post<{ success: boolean; message: string; settings: SettingItem[] }>(
    `/api/system-settings/${category}/reset`,
  );
}

export function useSettingsPanel(category: string): UseSettingsPanelReturn {
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [defaultValues, setDefaultValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const originalSettings = useRef<Record<string, unknown>>({});

  const isDirty = JSON.stringify(settings) !== JSON.stringify(originalSettings.current);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchCategorySettings(category);
      if (data.success && Array.isArray(data.settings)) {
        const settingsMap: Record<string, unknown> = {};
        const defaultsMap: Record<string, unknown> = {};
        for (const item of data.settings) {
          settingsMap[item.key] = item.value;
          defaultsMap[item.key] = item.default_value;
        }
        setSettings(settingsMap);
        setDefaultValues(defaultsMap);
        originalSettings.current = { ...settingsMap };
        setLoadError(false);
      } else {
        setLoadError(true);
      }
    } catch {
      // A failed read must remain distinct from a successfully empty category.
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const updateSetting = useCallback((key: string, value: unknown) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const saveSettings = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      const result = await saveCategorySettings(category, settings);
      if (result.success) {
        originalSettings.current = { ...settings };
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }, [category, settings]);

  const resetToDefaults = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      const result = await resetCategorySettings(category);
      if (result.success && result.settings) {
        const settingsMap: Record<string, unknown> = {};
        for (const item of result.settings) {
          settingsMap[item.key] = item.value;
        }
        setSettings(settingsMap);
        originalSettings.current = { ...settingsMap };
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }, [category]);

  return {
    settings,
    defaultValues,
    loading,
    loadError,
    saving,
    isDirty,
    updateSetting,
    saveSettings,
    resetToDefaults,
    refetch: loadSettings,
  };
}
