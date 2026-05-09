'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import SettingsSectionCard from './components/SettingsSectionCard';
import ResetDefaultsButton from './components/ResetDefaultsButton';
import { useSettingsPanel } from './components/useSettingsPanel';

import { NumberField, SwitchField, SelectField, LOG_LEVELS } from './components/SettingsFieldHelpers';

/* ── Main Panel ── */
const WatermarkSettingsPanel: React.FC = () => {
  const { t } = useLocale();
  const { showSuccess, showError } = useNotification();
  const { settings, loading, saving, isDirty, updateSetting, saveSettings, resetToDefaults } = useSettingsPanel('watermark');

  const getObj = <T extends Record<string, unknown>>(key: string, fallback: T): T => {
    const v = settings[key];
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as T;
    return fallback;
  };

  const updateNested = (key: string, field: string, value: unknown) => {
    const current = getObj(key, {} as Record<string, unknown>);
    updateSetting(key, { ...current, [field]: value });
  };

  const handleSave = async () => {
    const ok = await saveSettings();
    if (ok) showSuccess(t.adminSettings.settingsSaveSuccess);
    else showError(t.adminSettings.settingsSaveError);
  };

  const handleReset = async () => {
    const ok = await resetToDefaults();
    if (ok) showSuccess(t.adminSettings.settingsResetSuccess);
    else showError(t.adminSettings.settingsResetError);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-sm text-muted-foreground">{t.adminSettings.loading}</div>
      </div>
    );
  }

  const removal = getObj('removal', { concurrent_threads: 5, max_concurrent_threads: 10, batch_size: 50, batch_timeout: 60 });
  const loggingConf = getObj('logging', { enable_detailed_logs: true, log_progress_interval: 100, log_level: 'INFO', enable_thread_logging: true });

  const concurrencyInvalid =
    Number(removal.concurrent_threads) > Number(removal.max_concurrent_threads);

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6 max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground">{t.adminSettings.watermarkSettings}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t.adminSettings.watermarkSettingsDesc}</p>
          </div>
          <div className="flex items-center gap-3">
            {isDirty && <span className="text-xs text-amber-500 font-medium">{t.adminSettings.settingsUnsaved}</span>}
            <ResetDefaultsButton onReset={handleReset} loading={saving} />
            <button
              onClick={handleSave}
              disabled={!isDirty || saving || concurrencyInvalid}
              aria-disabled={!isDirty || saving || concurrencyInvalid}
              className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? t.adminSettings.saving : t.adminSettings.save}
            </button>
          </div>
        </div>

        <SettingsSectionCard title={t.adminSettings.wmRemoval} description={t.adminSettings.wmRemovalDesc}>
          <NumberField label={t.adminSettings.wmConcurrentThreads} value={removal.concurrent_threads as number} onChange={(v) => updateNested('removal', 'concurrent_threads', v)} min={1} max={20} />
          <NumberField label={t.adminSettings.wmMaxConcurrentThreads} value={removal.max_concurrent_threads as number} onChange={(v) => updateNested('removal', 'max_concurrent_threads', v)} min={1} max={30} />
          <NumberField label={t.adminSettings.wmBatchFrames} value={removal.batch_size as number} onChange={(v) => updateNested('removal', 'batch_size', v)} min={10} max={200} />
          <NumberField label={t.adminSettings.wmBatchTimeout} value={removal.batch_timeout as number} onChange={(v) => updateNested('removal', 'batch_timeout', v)} min={10} max={300} />
          {concurrencyInvalid && (
            <p role="alert" className="text-xs text-destructive mt-1">
              {t.adminSettings.wmConcurrencyInvalid}
            </p>
          )}
        </SettingsSectionCard>

        <SettingsSectionCard title={t.adminSettings.settingsLogging}>
          <SwitchField label={t.adminSettings.settingsVerboseLog} checked={loggingConf.enable_detailed_logs as boolean} onChange={(v) => updateNested('logging', 'enable_detailed_logs', v)} />
          <NumberField label={t.adminSettings.wmProgressIntervalFrames} value={loggingConf.log_progress_interval as number} onChange={(v) => updateNested('logging', 'log_progress_interval', v)} min={1} max={1000} />
          <SelectField label={t.adminSettings.settingsLogLevel} value={loggingConf.log_level as string} options={LOG_LEVELS} onChange={(v) => updateNested('logging', 'log_level', v)} />
          <SwitchField label={t.adminSettings.wmThreadLogging} checked={loggingConf.enable_thread_logging as boolean} onChange={(v) => updateNested('logging', 'enable_thread_logging', v)} />
        </SettingsSectionCard>
      </div>
    </div>
  );
};

export default WatermarkSettingsPanel;
