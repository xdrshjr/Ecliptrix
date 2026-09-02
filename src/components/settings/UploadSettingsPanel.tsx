'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import SettingsSectionCard from './components/SettingsSectionCard';
import ResetDefaultsButton from './components/ResetDefaultsButton';
import { useSettingsPanel } from './components/useSettingsPanel';

import { NumberField, SwitchField, SelectField, TextField, LOG_LEVELS } from './components/SettingsFieldHelpers';

/* ── Main Panel ── */
const UploadSettingsPanel: React.FC = () => {
  const { t } = useLocale();
  const { showSuccess, showError } = useNotification();
  const { settings, loading, saving, isDirty, updateSetting, saveSettings, resetToDefaults } = useSettingsPanel('upload');

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

  const concurrent = getObj('concurrent_upload', { max_concurrent_uploads: 3, max_queue_size: 0, upload_timeout: 300, enable_queue: true });
  const fileLimits = getObj('file_size_limits', { max_video_size_mb: 500, max_audio_size_mb: 100, max_image_size_mb: 50 });
  const retry = getObj('retry', { max_retries: 3, retry_delay: 5, exponential_backoff: true });
  const thumbnail = getObj('thumbnail', { auto_generate_video_thumbnail: true, thumbnail_quality: 2, thumbnail_max_width: 320, thumbnail_max_height: 180 });
  const tempFile = getObj('temp_file_management', { auto_cleanup: true, temp_file_retention_hours: 24, temp_file_directory: 'temp' });
  const loggingConf = getObj('logging', { enable_detailed_logging: true, log_upload_progress: true, progress_log_interval: 10, log_upload_statistics: true });

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6 max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground">{t.adminSettings.uploadSettings}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t.adminSettings.uploadSettingsDesc}</p>
          </div>
          <div className="flex items-center gap-3">
            {isDirty && <span className="text-xs text-amber-500 font-medium">{t.adminSettings.settingsUnsaved}</span>}
            <ResetDefaultsButton onReset={handleReset} loading={saving} />
            <button onClick={handleSave} disabled={!isDirty || saving}
              className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? t.adminSettings.saving : t.adminSettings.save}
            </button>
          </div>
        </div>

        <SettingsSectionCard title={t.adminSettings.uploadConcurrent} description={t.adminSettings.uploadConcurrentDesc}>
          <NumberField label={t.adminSettings.uploadMaxConcurrent} value={concurrent.max_concurrent_uploads as number} onChange={(v) => updateNested('concurrent_upload', 'max_concurrent_uploads', v)} min={1} max={10} />
          <NumberField label={t.adminSettings.uploadQueueMaxLength} value={concurrent.max_queue_size as number} onChange={(v) => updateNested('concurrent_upload', 'max_queue_size', v)} min={0} max={100} />
          <NumberField label={t.adminSettings.uploadTimeout} value={concurrent.upload_timeout as number} onChange={(v) => updateNested('concurrent_upload', 'upload_timeout', v)} min={60} max={600} />
          <SwitchField label={t.adminSettings.uploadEnableQueue} checked={concurrent.enable_queue as boolean} onChange={(v) => updateNested('concurrent_upload', 'enable_queue', v)} />
        </SettingsSectionCard>

        <SettingsSectionCard title={t.adminSettings.uploadFileLimits} description={t.adminSettings.uploadFileLimitsDesc}>
          <NumberField label={t.adminSettings.uploadVideoMax} value={fileLimits.max_video_size_mb as number} onChange={(v) => updateNested('file_size_limits', 'max_video_size_mb', v)} min={100} max={2000} />
          <NumberField label={t.adminSettings.uploadAudioMax} value={fileLimits.max_audio_size_mb as number} onChange={(v) => updateNested('file_size_limits', 'max_audio_size_mb', v)} min={50} max={500} />
          <NumberField label={t.adminSettings.uploadImageMax} value={fileLimits.max_image_size_mb as number} onChange={(v) => updateNested('file_size_limits', 'max_image_size_mb', v)} min={10} max={200} />
        </SettingsSectionCard>

        <SettingsSectionCard title={t.adminSettings.uploadRetry}>
          <NumberField label={t.adminSettings.uploadMaxRetries} value={retry.max_retries as number} onChange={(v) => updateNested('retry', 'max_retries', v)} min={0} max={10} />
          <NumberField label={t.adminSettings.uploadRetryDelay} value={retry.retry_delay as number} onChange={(v) => updateNested('retry', 'retry_delay', v)} min={1} max={30} />
          <SwitchField label={t.adminSettings.uploadExponentialBackoff} checked={retry.exponential_backoff as boolean} onChange={(v) => updateNested('retry', 'exponential_backoff', v)} />
        </SettingsSectionCard>

        <SettingsSectionCard title={t.adminSettings.uploadThumbnail} description={t.adminSettings.uploadThumbnailDesc}>
          <SwitchField label={t.adminSettings.uploadAutoThumbnail} checked={thumbnail.auto_generate_video_thumbnail as boolean} onChange={(v) => updateNested('thumbnail', 'auto_generate_video_thumbnail', v)} />
          <NumberField label={t.adminSettings.uploadThumbnailQuality} value={thumbnail.thumbnail_quality as number} onChange={(v) => updateNested('thumbnail', 'thumbnail_quality', v)} min={1} max={31} />
          <NumberField label={t.adminSettings.uploadThumbnailMaxWidth} value={thumbnail.thumbnail_max_width as number} onChange={(v) => updateNested('thumbnail', 'thumbnail_max_width', v)} min={100} max={1920} />
          <NumberField label={t.adminSettings.uploadThumbnailMaxHeight} value={thumbnail.thumbnail_max_height as number} onChange={(v) => updateNested('thumbnail', 'thumbnail_max_height', v)} min={100} max={1080} />
        </SettingsSectionCard>

        <SettingsSectionCard title={t.adminSettings.uploadTempFiles}>
          <SwitchField label={t.adminSettings.uploadAutoCleanup} checked={tempFile.auto_cleanup as boolean} onChange={(v) => updateNested('temp_file_management', 'auto_cleanup', v)} />
          <NumberField label={t.adminSettings.uploadRetentionHours} value={tempFile.temp_file_retention_hours as number} onChange={(v) => updateNested('temp_file_management', 'temp_file_retention_hours', v)} min={1} max={168} />
          <TextField label={t.adminSettings.uploadTempDir} value={tempFile.temp_file_directory as string} readOnly />
        </SettingsSectionCard>

        <SettingsSectionCard title={t.adminSettings.settingsLogging}>
          <SwitchField label={t.adminSettings.settingsVerboseLog} checked={loggingConf.enable_detailed_logging as boolean} onChange={(v) => updateNested('logging', 'enable_detailed_logging', v)} />
          <NumberField label={t.adminSettings.settingsProgressInterval} value={loggingConf.progress_log_interval as number} onChange={(v) => updateNested('logging', 'progress_log_interval', v)} min={1} max={100} />
        </SettingsSectionCard>
      </div>
    </div>
  );
};

export default UploadSettingsPanel;
