'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import SettingsSectionCard from './components/SettingsSectionCard';
import ResetDefaultsButton from './components/ResetDefaultsButton';
import { useSettingsPanel } from './components/useSettingsPanel';

import { NumberField, SwitchField, SelectField, LOG_LEVELS } from './components/SettingsFieldHelpers';

const VIDEO_QUALITIES = [
  { value: '360p', label: '360p' }, { value: '480p', label: '480p' },
  { value: '720p', label: '720p' }, { value: '1080p', label: '1080p' },
  { value: 'best', label: 'Best' },
];
const AUDIO_QUALITIES = [
  { value: 'worst', label: 'Worst' }, { value: '128k', label: '128k' },
  { value: '256k', label: '256k' }, { value: 'best', label: 'Best' },
];
const OUTPUT_FORMATS = [
  { value: 'mp4', label: 'MP4' }, { value: 'webm', label: 'WebM' }, { value: 'mkv', label: 'MKV' },
];
/* ── Main Panel ── */
const YouTubeSettingsPanel: React.FC = () => {
  const { t } = useLocale();
  const { showSuccess, showError } = useNotification();
  const { settings, loading, saving, isDirty, updateSetting, saveSettings, resetToDefaults } = useSettingsPanel('youtube');

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

  const download = getObj('download', { max_concurrent_downloads: 20, download_timeout: 300, max_retries: 3, retry_delay: 5 });
  const upload = getObj('upload', { upload_timeout: 600, max_retries: 3, retry_delay: 10 });
  const quality = getObj('quality', { default_video_quality: '720p', default_audio_quality: 'best', default_format: 'mp4' });
  const fileMgmt = getObj('file_management', { auto_cleanup: true, temp_file_retention_hours: 24, generate_thumbnail: true });
  const loggingConf = getObj('logging', { enable_detailed_logging: true, log_download_progress: true, progress_log_interval: 10 });

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6 max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground">{t.adminSettings.youtubeSettings}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t.adminSettings.youtubeSettingsDesc}</p>
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

        <SettingsSectionCard title={t.adminSettings.ytDownload} description={t.adminSettings.ytDownloadDesc}>
          <NumberField label={t.adminSettings.ytMaxConcurrent} value={download.max_concurrent_downloads as number} onChange={(v) => updateNested('download', 'max_concurrent_downloads', v)} min={1} max={50} />
          <NumberField label={t.adminSettings.ytTimeout} value={download.download_timeout as number} onChange={(v) => updateNested('download', 'download_timeout', v)} min={60} max={600} />
          <NumberField label={t.adminSettings.ytMaxRetries} value={download.max_retries as number} onChange={(v) => updateNested('download', 'max_retries', v)} min={0} max={10} />
          <NumberField label={t.adminSettings.ytRetryDelay} value={download.retry_delay as number} onChange={(v) => updateNested('download', 'retry_delay', v)} min={1} max={30} />
        </SettingsSectionCard>

        <SettingsSectionCard title={t.adminSettings.ytUpload} description={t.adminSettings.ytUploadDesc}>
          <NumberField label={t.adminSettings.ytUploadTimeout} value={upload.upload_timeout as number} onChange={(v) => updateNested('upload', 'upload_timeout', v)} min={60} max={1200} />
          <NumberField label={t.adminSettings.ytMaxRetries} value={upload.max_retries as number} onChange={(v) => updateNested('upload', 'max_retries', v)} min={0} max={10} />
          <NumberField label={t.adminSettings.ytRetryDelay} value={upload.retry_delay as number} onChange={(v) => updateNested('upload', 'retry_delay', v)} min={1} max={30} />
        </SettingsSectionCard>

        <SettingsSectionCard title={t.adminSettings.ytQuality} description={t.adminSettings.ytQualityDesc}>
          <SelectField label={t.adminSettings.ytVideoQuality} value={quality.default_video_quality as string} options={VIDEO_QUALITIES} onChange={(v) => updateNested('quality', 'default_video_quality', v)} />
          <SelectField label={t.adminSettings.ytAudioQuality} value={quality.default_audio_quality as string} options={AUDIO_QUALITIES} onChange={(v) => updateNested('quality', 'default_audio_quality', v)} />
          <SelectField label={t.adminSettings.ytOutputFormat} value={quality.default_format as string} options={OUTPUT_FORMATS} onChange={(v) => updateNested('quality', 'default_format', v)} />
        </SettingsSectionCard>

        <SettingsSectionCard title={t.adminSettings.ytFileManagement} description={t.adminSettings.ytFileManagementDesc}>
          <SwitchField label={t.adminSettings.ytAutoCleanup} checked={fileMgmt.auto_cleanup as boolean} onChange={(v) => updateNested('file_management', 'auto_cleanup', v)} />
          <NumberField label={t.adminSettings.ytRetentionHours} value={fileMgmt.temp_file_retention_hours as number} onChange={(v) => updateNested('file_management', 'temp_file_retention_hours', v)} min={1} max={168} />
          <SwitchField label={t.adminSettings.ytGenerateThumbnail} checked={fileMgmt.generate_thumbnail as boolean} onChange={(v) => updateNested('file_management', 'generate_thumbnail', v)} />
        </SettingsSectionCard>

        <SettingsSectionCard title={t.adminSettings.settingsLogging}>
          <SwitchField label={t.adminSettings.settingsVerboseLog} checked={loggingConf.enable_detailed_logging as boolean} onChange={(v) => updateNested('logging', 'enable_detailed_logging', v)} />
          <SwitchField label={t.adminSettings.ytLogProgress} checked={loggingConf.log_download_progress as boolean} onChange={(v) => updateNested('logging', 'log_download_progress', v)} />
          <NumberField label={t.adminSettings.ytProgressInterval} value={loggingConf.progress_log_interval as number} onChange={(v) => updateNested('logging', 'progress_log_interval', v)} min={1} max={60} />
        </SettingsSectionCard>
      </div>
    </div>
  );
};

export default YouTubeSettingsPanel;
