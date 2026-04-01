'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import SettingsSectionCard from './components/SettingsSectionCard';
import ResetDefaultsButton from './components/ResetDefaultsButton';
import { useSettingsPanel } from './components/useSettingsPanel';

import { NumberField, SwitchField, SelectField, TextField, LOG_LEVELS } from './components/SettingsFieldHelpers';

/* ── Duration Strategy Sub-form ── */
const DurationStrategySubform: React.FC<{
  strategy: Record<string, unknown>;
  onChange: (strategy: Record<string, unknown>) => void;
  t: ReturnType<typeof import('@/contexts/LocaleContext').useLocale>['t'];
}> = ({ strategy, onChange, t }) => {
  const shortVideos = (strategy.short_videos || { duration_threshold_seconds: 60, frame_interval_seconds: 3, max_frames: 5 }) as Record<string, unknown>;
  const mediumVideos = (strategy.medium_videos || { duration_threshold_seconds: 300, frame_interval_seconds: 10, max_frames: 5 }) as Record<string, unknown>;
  const longVideos = (strategy.long_videos || { frame_interval_seconds: 30, max_frames: 5 }) as Record<string, unknown>;

  const updateGroup = (group: string, field: string, value: number) => {
    const current = (strategy[group] || {}) as Record<string, unknown>;
    onChange({ ...strategy, [group]: { ...current, [field]: value } });
  };

  return (
    <div className="space-y-4">
      {/* Short videos */}
      <div className="border border-border/50 rounded-md p-3 space-y-2">
        <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {t.adminSettings.vaShortVideos}
        </h5>
        <NumberField label={t.adminSettings.vaMaxDuration} value={shortVideos.duration_threshold_seconds as number} onChange={(v) => updateGroup('short_videos', 'duration_threshold_seconds', v)} min={10} max={300} />
        <NumberField label={t.adminSettings.vaFrameInterval} value={shortVideos.frame_interval_seconds as number} onChange={(v) => updateGroup('short_videos', 'frame_interval_seconds', v)} min={1} max={60} />
        <NumberField label={t.adminSettings.vaMaxFrames} value={shortVideos.max_frames as number} onChange={(v) => updateGroup('short_videos', 'max_frames', v)} min={1} max={20} />
      </div>

      {/* Medium videos */}
      <div className="border border-border/50 rounded-md p-3 space-y-2">
        <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {t.adminSettings.vaMediumVideos}
        </h5>
        <NumberField label={t.adminSettings.vaMaxDuration} value={mediumVideos.duration_threshold_seconds as number} onChange={(v) => updateGroup('medium_videos', 'duration_threshold_seconds', v)} min={60} max={1800} />
        <NumberField label={t.adminSettings.vaFrameInterval} value={mediumVideos.frame_interval_seconds as number} onChange={(v) => updateGroup('medium_videos', 'frame_interval_seconds', v)} min={1} max={120} />
        <NumberField label={t.adminSettings.vaMaxFrames} value={mediumVideos.max_frames as number} onChange={(v) => updateGroup('medium_videos', 'max_frames', v)} min={1} max={30} />
      </div>

      {/* Long videos */}
      <div className="border border-border/50 rounded-md p-3 space-y-2">
        <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {t.adminSettings.vaLongVideos}
        </h5>
        <NumberField label={t.adminSettings.vaFrameInterval} value={longVideos.frame_interval_seconds as number} onChange={(v) => updateGroup('long_videos', 'frame_interval_seconds', v)} min={1} max={300} />
        <NumberField label={t.adminSettings.vaMaxFrames} value={longVideos.max_frames as number} onChange={(v) => updateGroup('long_videos', 'max_frames', v)} min={1} max={50} />
      </div>
    </div>
  );
};

/* ── Formats Tag Input ── */
const TagInput: React.FC<{
  label: string;
  tags: string[];
  onChange: (tags: string[]) => void;
}> = ({ label, tags, onChange }) => {
  const [inputValue, setInputValue] = React.useState('');

  const handleAdd = () => {
    const val = inputValue.trim();
    if (val && !tags.includes(val)) {
      onChange([...tags, val]);
      setInputValue('');
    }
  };

  const handleRemove = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div>
      <label className="text-sm text-foreground block mb-1.5">{label}</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-accent rounded-md text-foreground">
            {tag}
            <button onClick={() => handleRemove(tag)} className="text-muted-foreground hover:text-foreground">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. mp4"
          className="w-32 px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button onClick={handleAdd}
          className="px-3 py-1.5 text-sm border border-border rounded-md text-foreground hover:bg-accent transition-colors">
          +
        </button>
      </div>
    </div>
  );
};

/* ── Main Panel ── */
const VideoAnalysisSettingsPanel: React.FC = () => {
  const { t } = useLocale();
  const { showSuccess, showError } = useNotification();
  const { settings, loading, saving, isDirty, updateSetting, saveSettings, resetToDefaults } = useSettingsPanel('video_analysis');

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

  const queue = getObj('queue_management', { queue_name: 'video_analysis', max_concurrent: 2, enable_for_single_analysis: true });
  const vlm = getObj('vlm_processing', { concurrent_threads: 3, api_timeout: 30, max_retries: 2 });
  const frameExtraction = getObj('frame_extraction', {
    default_frame_interval_seconds: 5, max_frames_per_video: 5,
    supported_formats: ['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv'],
    duration_based_strategy: {
      short_videos: { duration_threshold_seconds: 60, frame_interval_seconds: 3, max_frames: 5 },
      medium_videos: { duration_threshold_seconds: 300, frame_interval_seconds: 10, max_frames: 5 },
      long_videos: { frame_interval_seconds: 30, max_frames: 5 },
    },
  });
  const performance = getObj('performance', { enable_performance_logging: true, log_concurrent_stats: true, max_video_duration_seconds: 3600 });
  const tempFiles = getObj('temp_files', { video_download_dir: 'video_analysis', frames_dir_prefix: 'frames_', auto_cleanup: true, cleanup_timeout: 300 });
  const loggingConf = getObj('logging', { log_level: 'INFO', log_analysis_content: false, log_base64_content: false, log_frame_processing_time: true });

  const supportedFormats = Array.isArray(frameExtraction.supported_formats) ? frameExtraction.supported_formats as string[] : ['mp4', 'avi', 'mkv', 'mov', 'webm'];
  const durationStrategy = (frameExtraction.duration_based_strategy || {}) as Record<string, unknown>;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6 max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground">{t.adminSettings.videoAnalysisSettings}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t.adminSettings.videoAnalysisSettingsDesc}</p>
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

        {/* Queue Management */}
        <SettingsSectionCard title={t.adminSettings.vaQueueManagement} description={t.adminSettings.vaQueueManagementDesc}>
          <NumberField label={t.adminSettings.vaMaxConcurrentAnalyses} value={queue.max_concurrent as number} onChange={(v) => updateNested('queue_management', 'max_concurrent', v)} min={1} max={10} />
          <SwitchField label={t.adminSettings.vaEnableSingleVideoQueue} checked={queue.enable_for_single_analysis as boolean} onChange={(v) => updateNested('queue_management', 'enable_for_single_analysis', v)} />
        </SettingsSectionCard>

        {/* VLM Processing */}
        <SettingsSectionCard title={t.adminSettings.vaVlmProcessing} description={t.adminSettings.vaVlmProcessingDesc}>
          <NumberField label={t.adminSettings.vaConcurrentThreads} value={vlm.concurrent_threads as number} onChange={(v) => updateNested('vlm_processing', 'concurrent_threads', v)} min={1} max={10} />
          <NumberField label={t.adminSettings.vaApiTimeout} value={vlm.api_timeout as number} onChange={(v) => updateNested('vlm_processing', 'api_timeout', v)} min={10} max={120} />
          <NumberField label={t.adminSettings.vaMaxRetries} value={vlm.max_retries as number} onChange={(v) => updateNested('vlm_processing', 'max_retries', v)} min={0} max={5} />
        </SettingsSectionCard>

        {/* Frame Extraction */}
        <SettingsSectionCard title={t.adminSettings.vaFrameExtraction} description={t.adminSettings.vaFrameExtractionDesc}>
          <NumberField label={t.adminSettings.vaDefaultFrameInterval} value={frameExtraction.default_frame_interval_seconds as number} onChange={(v) => updateNested('frame_extraction', 'default_frame_interval_seconds', v)} min={1} max={30} />
          <NumberField label={t.adminSettings.vaMaxFramesPerVideo} value={frameExtraction.max_frames_per_video as number} onChange={(v) => updateNested('frame_extraction', 'max_frames_per_video', v)} min={1} max={20} />
          <TagInput
            label={t.adminSettings.vaSupportedFormats}
            tags={supportedFormats}
            onChange={(tags) => updateNested('frame_extraction', 'supported_formats', tags)}
          />

          <div className="pt-2 border-t border-border/50">
            <h4 className="text-sm font-medium text-foreground mb-3">{t.adminSettings.vaDurationStrategy}</h4>
            <DurationStrategySubform
              strategy={durationStrategy}
              onChange={(s) => updateNested('frame_extraction', 'duration_based_strategy', s)}
              t={t}
            />
          </div>
        </SettingsSectionCard>

        {/* Performance */}
        <SettingsSectionCard title={t.adminSettings.vaPerformance} description={t.adminSettings.vaPerformanceDesc}>
          <SwitchField label={t.adminSettings.vaEnablePerfLog} checked={performance.enable_performance_logging as boolean} onChange={(v) => updateNested('performance', 'enable_performance_logging', v)} />
          <SwitchField label={t.adminSettings.vaLogConcurrencyStats} checked={performance.log_concurrent_stats as boolean} onChange={(v) => updateNested('performance', 'log_concurrent_stats', v)} />
          <NumberField label={t.adminSettings.vaMaxVideoDuration} value={performance.max_video_duration_seconds as number} onChange={(v) => updateNested('performance', 'max_video_duration_seconds', v)} min={60} max={7200} />
        </SettingsSectionCard>

        {/* Temp Files */}
        <SettingsSectionCard title={t.adminSettings.vaTempFiles}>
          <TextField label={t.adminSettings.vaVideoDownloadDir} value={tempFiles.video_download_dir as string} readOnly />
          <TextField label={t.adminSettings.vaFrameExtractPrefix} value={tempFiles.frames_dir_prefix as string} readOnly />
          <SwitchField label={t.adminSettings.vaAutoCleanup} checked={tempFiles.auto_cleanup as boolean} onChange={(v) => updateNested('temp_files', 'auto_cleanup', v)} />
          <NumberField label={t.adminSettings.vaCleanupTimeout} value={tempFiles.cleanup_timeout as number} onChange={(v) => updateNested('temp_files', 'cleanup_timeout', v)} min={30} max={3600} />
        </SettingsSectionCard>

        {/* Logging */}
        <SettingsSectionCard title={t.adminSettings.settingsLogging}>
          <SelectField label={t.adminSettings.settingsLogLevel} value={loggingConf.log_level as string} options={LOG_LEVELS} onChange={(v) => updateNested('logging', 'log_level', v)} />
          <SwitchField label={t.adminSettings.vaLogAnalysisContent} checked={loggingConf.log_analysis_content as boolean} onChange={(v) => updateNested('logging', 'log_analysis_content', v)} />
          <SwitchField label={t.adminSettings.vaLogFrameProcessingTime} checked={loggingConf.log_frame_processing_time as boolean} onChange={(v) => updateNested('logging', 'log_frame_processing_time', v)} />
        </SettingsSectionCard>
      </div>
    </div>
  );
};

export default VideoAnalysisSettingsPanel;
