'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import SettingsSectionCard from './components/SettingsSectionCard';
import ResetDefaultsButton from './components/ResetDefaultsButton';
import VoiceListEditor, { VoiceItem } from './components/VoiceListEditor';
import { useSettingsPanel } from './components/useSettingsPanel';
import { NumberField, SwitchField, SelectField, LOG_LEVELS } from './components/SettingsFieldHelpers';

/* ── Main Panel ── */
const TTSSettingsPanel: React.FC = () => {
  const { t } = useLocale();
  const { showSuccess, showError } = useNotification();
  const {
    settings,
    loading,
    saving,
    isDirty,
    updateSetting,
    saveSettings,
    resetToDefaults,
  } = useSettingsPanel('tts');

  const getVal = <T,>(key: string, fallback: T): T => {
    const v = settings[key];
    if (v === undefined || v === null) return fallback;
    return v as T;
  };

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

  const concurrency = getObj('concurrency', { concurrent_threads: 3, max_concurrent_threads: 10, request_timeout: 30, batch_timeout: 300 });
  const concurrentThreads = concurrency.concurrent_threads as number;
  const maxConcurrentThreads = concurrency.max_concurrent_threads as number;
  const concurrencyInvariantViolated =
    Number.isFinite(concurrentThreads) &&
    Number.isFinite(maxConcurrentThreads) &&
    concurrentThreads > maxConcurrentThreads;
  const retry = getObj('retry', { max_attempts: 3, delay_seconds: 1, backoff_factor: 2 });
  const limits = getObj('limits', { max_segments_per_batch: 50, max_text_length_per_segment: 5000, max_total_text_length: 100000 });
  const loggingConf = getObj('logging', { enable_detailed_logs: true, log_progress_interval: 1, log_level: 'INFO' });
  const voices = getVal<VoiceItem[]>('voices', []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6 max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground">{t.adminSettings.ttsSettings}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t.adminSettings.ttsSettingsDesc}</p>
          </div>
          <div className="flex items-center gap-3">
            {isDirty && (
              <span className="text-xs text-amber-500 font-medium">{t.adminSettings.settingsUnsaved}</span>
            )}
            <ResetDefaultsButton onReset={handleReset} loading={saving} />
            <button
              onClick={handleSave}
              disabled={!isDirty || saving || concurrencyInvariantViolated}
              className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? t.adminSettings.saving : t.adminSettings.save}
            </button>
          </div>
        </div>

        {/* Section 1: Concurrency */}
        <SettingsSectionCard title={t.adminSettings.ttsConcurrency} description={t.adminSettings.ttsConcurrencyDesc}>
          <div className="space-y-2">
            <NumberField label={t.adminSettings.ttsConcurrentThreads} value={concurrentThreads} onChange={(v) => updateNested('concurrency', 'concurrent_threads', v)} min={1} max={10} />
            {concurrencyInvariantViolated && (
              <p role="alert" className="text-xs text-destructive">
                {t.adminSettings.ttsConcurrencyInvariantError}
              </p>
            )}
          </div>
          <NumberField label={t.adminSettings.ttsMaxConcurrentThreads} value={maxConcurrentThreads} onChange={(v) => updateNested('concurrency', 'max_concurrent_threads', v)} min={1} max={20} />
          <NumberField label={t.adminSettings.ttsRequestTimeout} value={concurrency.request_timeout as number} onChange={(v) => updateNested('concurrency', 'request_timeout', v)} min={5} max={120} />
          <NumberField label={t.adminSettings.ttsBatchTimeout} value={concurrency.batch_timeout as number} onChange={(v) => updateNested('concurrency', 'batch_timeout', v)} min={60} max={600} />
        </SettingsSectionCard>

        {/* Section 2: Retry */}
        <SettingsSectionCard title={t.adminSettings.ttsRetry} description={t.adminSettings.ttsRetryDesc}>
          <NumberField label={t.adminSettings.ttsMaxRetries} value={retry.max_attempts as number} onChange={(v) => updateNested('retry', 'max_attempts', v)} min={0} max={10} />
          <NumberField label={t.adminSettings.ttsRetryDelay} value={retry.delay_seconds as number} onChange={(v) => updateNested('retry', 'delay_seconds', v)} min={1} max={30} />
          <NumberField label={t.adminSettings.ttsBackoffFactor} value={retry.backoff_factor as number} onChange={(v) => updateNested('retry', 'backoff_factor', v)} min={1} max={5} />
        </SettingsSectionCard>

        {/* Section 3: Limits */}
        <SettingsSectionCard title={t.adminSettings.ttsLimits} description={t.adminSettings.ttsLimitsDesc}>
          <NumberField label={t.adminSettings.ttsMaxSegments} value={limits.max_segments_per_batch as number} onChange={(v) => updateNested('limits', 'max_segments_per_batch', v)} min={10} max={200} />
          <NumberField label={t.adminSettings.ttsMaxCharsPerSegment} value={limits.max_text_length_per_segment as number} onChange={(v) => updateNested('limits', 'max_text_length_per_segment', v)} min={1000} max={10000} />
          <NumberField label={t.adminSettings.ttsMaxTotalChars} value={limits.max_total_text_length as number} onChange={(v) => updateNested('limits', 'max_total_text_length', v)} min={10000} max={500000} />
        </SettingsSectionCard>

        {/* Section 4: Logging */}
        <SettingsSectionCard title={t.adminSettings.settingsLogging}>
          <SwitchField label={t.adminSettings.settingsVerboseLog} checked={loggingConf.enable_detailed_logs as boolean} onChange={(v) => updateNested('logging', 'enable_detailed_logs', v)} />
          <NumberField label={t.adminSettings.settingsProgressInterval} value={loggingConf.log_progress_interval as number} onChange={(v) => updateNested('logging', 'log_progress_interval', v)} min={1} max={100} />
          <SelectField label={t.adminSettings.settingsLogLevel} value={loggingConf.log_level as string} options={LOG_LEVELS} onChange={(v) => updateNested('logging', 'log_level', v)} />
        </SettingsSectionCard>

        {/* Section 5: Voices */}
        <SettingsSectionCard title={t.adminSettings.ttsVoices} description={t.adminSettings.ttsVoicesDesc}>
          <VoiceListEditor
            voices={Array.isArray(voices) ? voices : []}
            onChange={(v) => updateSetting('voices', v)}
          />
        </SettingsSectionCard>
      </div>
    </div>
  );
};

export default TTSSettingsPanel;
