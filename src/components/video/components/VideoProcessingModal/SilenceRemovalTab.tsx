'use client';

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { MaterialItem } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import type { SilenceSegment } from './SilenceSegmentList';
import SilenceSegmentList from './SilenceSegmentList';
import WaveformPreview from './WaveformPreview';
import type { WaveformPreviewHandle } from './WaveformPreview';
import ProcessingProgress from './ProcessingProgress';
import type { SilenceRemoveResult } from './ProcessingProgress';
import { http, ApiError } from '@/lib/api/http-client';

// ---- Types ----

type Preset = 'loose' | 'standard' | 'aggressive' | 'custom';

interface DetectionParams {
  preset: Preset;
  noiseThreshold: number;      // dB (UI unit)
  minSilenceDuration: number;  // ms (UI unit, convert to seconds for API)
  preservedGap: number;        // ms (UI unit, convert to seconds for API)
}

type Phase = 'select' | 'configure' | 'preview' | 'processing' | 'completed';

interface SilenceRemovalTabProps {
  materials: MaterialItem[];
  onMaterialUpdate: (id: string, newData: Partial<MaterialItem>) => void;
  onSilenceRemoved?: (processedVideoUrl: string, result: SilenceRemoveResult, originalMaterial: MaterialItem) => void;
  onMinimize?: (taskId: string, videoName: string) => void;
  /** Notifies parent when processing state changes (for auto-minimize on modal close) */
  onProcessingStateChange?: (isProcessing: boolean, taskId?: string, videoName?: string) => void;
  /** Whether the parent modal is currently visible (passed to ProcessingProgress for resume after restore) */
  isModalVisible?: boolean;
}

// ---- Preset definitions ----

const PRESETS: Record<Exclude<Preset, 'custom'>, Omit<DetectionParams, 'preset'>> = {
  loose:      { noiseThreshold: -40, minSilenceDuration: 800, preservedGap: 300 },
  standard:   { noiseThreshold: -30, minSilenceDuration: 500, preservedGap: 200 },
  aggressive: { noiseThreshold: -25, minSilenceDuration: 300, preservedGap: 100 },
};

// PRESET_LABELS is now resolved inside components via useLocale — see t.videoProcessing.presets

const DEFAULT_PARAMS: DetectionParams = {
  preset: 'standard',
  ...PRESETS.standard,
};

// ---- Helpers ----

function formatDuration(seconds: number, minsLabel: string, secsLabel: string): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins > 0) return `${mins}${minsLabel}${secs}${secsLabel}`;
  return `${secs}${secsLabel}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Max video duration: 30 minutes */
const MAX_DURATION_SECONDS = 30 * 60;

// ---- Sub-components (inlined for simplicity per spec) ----

/** VideoSelector: grid of video thumbnails for selection */
function VideoSelector({
  materials,
  selectedVideo,
  onSelect,
}: {
  materials: MaterialItem[];
  selectedVideo: MaterialItem | null;
  onSelect: (video: MaterialItem) => void;
}) {
  const { t } = useLocale();
  const videos = materials.filter((m) => m.type === 'video');

  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <svg className="w-12 h-12 mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        <p className="text-sm">{t.videoProcessing.selectVideo.noVideos}</p>
        <p className="text-xs mt-1">{t.videoProcessing.selectVideo.noVideosHint}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-3 max-h-[400px] overflow-y-auto pr-1">
      {videos.map((video) => {
        const tooLong = (video.duration ?? 0) > MAX_DURATION_SECONDS;
        const isSelected = selectedVideo?.id === video.id;

        return (
          <div
            key={video.id}
            onClick={() => !tooLong && onSelect(video)}
            className={`relative rounded-md border-2 overflow-hidden cursor-pointer transition-all ${
              tooLong
                ? 'opacity-50 cursor-not-allowed border-border'
                : isSelected
                ? 'border-primary ring-2 ring-primary/30'
                : 'border-border hover:border-primary/50'
            }`}
          >
            {/* Thumbnail */}
            <div className="aspect-video bg-muted relative">
              {video.thumbnailUrl ? (
                <img
                  src={video.thumbnailUrl}
                  alt={video.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-muted-foreground/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              )}

              {/* Duration badge */}
              {video.duration != null && (
                <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1 py-0.5 rounded">
                  {formatDuration(video.duration, t.videoProcessing.duration.minutes, t.videoProcessing.duration.seconds)}
                </span>
              )}

              {/* Too long overlay */}
              {tooLong && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <span className="text-xs text-white bg-destructive/80 px-2 py-0.5 rounded">
                    {t.videoProcessing.selectVideo.tooLong}
                  </span>
                </div>
              )}

              {/* Selected check */}
              {isSelected && (
                <div className="absolute top-1 right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                  <svg className="w-3 h-3 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </div>

            {/* Info */}
            <div className="p-1.5">
              <p className="text-xs font-medium text-foreground truncate" title={video.name}>
                {video.name}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {video.width && video.height ? `${video.width}x${video.height}` : ''}
                {video.width && video.height && video.size ? ' · ' : ''}
                {video.size ? formatFileSize(video.size) : ''}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** ParameterPanel: preset buttons + custom sliders */
function ParameterPanel({
  params,
  onChange,
}: {
  params: DetectionParams;
  onChange: (params: DetectionParams) => void;
}) {
  const { t } = useLocale();
  const presetLabels: Record<Preset, string> = {
    loose: t.videoProcessing.presets.loose,
    standard: t.videoProcessing.presets.standard,
    aggressive: t.videoProcessing.presets.aggressive,
    custom: t.videoProcessing.presets.custom,
  };
  const handlePresetChange = (preset: Preset) => {
    if (preset === 'custom') {
      onChange({ ...params, preset: 'custom' });
    } else {
      onChange({ ...PRESETS[preset], preset });
    }
  };

  const isCustom = params.preset === 'custom';

  return (
    <div className="space-y-4">
      {/* Preset buttons */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">{t.videoProcessing.params.detectionPreset}</label>
        <div className="flex gap-2">
          {(Object.keys(presetLabels) as Preset[]).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => handlePresetChange(preset)}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                params.preset === preset
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted text-foreground border-border hover:bg-accent'
              }`}
            >
              {presetLabels[preset]}
            </button>
          ))}
        </div>
      </div>

      {/* Custom parameters (visible when "custom" selected or always shown with less emphasis) */}
      <div className={`space-y-3 ${isCustom ? '' : 'opacity-60 pointer-events-none'}`}>
        {/* Noise threshold */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-foreground">
              {t.videoProcessing.params.volumeThreshold.replace('{value}', String(params.noiseThreshold))}
            </label>
            <span className="text-[10px] text-muted-foreground">{t.videoProcessing.params.volumeThresholdHint}</span>
          </div>
          <input
            type="range"
            min={-60}
            max={-10}
            step={1}
            value={params.noiseThreshold}
            onChange={(e) =>
              onChange({ ...params, preset: 'custom', noiseThreshold: Number(e.target.value) })
            }
            className="w-full h-1.5 bg-accent rounded-full appearance-none cursor-pointer accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
            <span>-60 dB</span>
            <span>-10 dB</span>
          </div>
        </div>

        {/* Min silence duration */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-foreground">
              {t.videoProcessing.params.minSilenceDuration.replace('{value}', String(params.minSilenceDuration))}
            </label>
            <span className="text-[10px] text-muted-foreground">{t.videoProcessing.params.minSilenceHint}</span>
          </div>
          <input
            type="range"
            min={100}
            max={3000}
            step={50}
            value={params.minSilenceDuration}
            onChange={(e) =>
              onChange({ ...params, preset: 'custom', minSilenceDuration: Number(e.target.value) })
            }
            className="w-full h-1.5 bg-accent rounded-full appearance-none cursor-pointer accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
            <span>100 ms</span>
            <span>3000 ms</span>
          </div>
        </div>

        {/* Preserved gap */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-foreground">
              {t.videoProcessing.params.preservedGap.replace('{value}', String(params.preservedGap))}
            </label>
            <span className="text-[10px] text-muted-foreground">{t.videoProcessing.params.preservedGapHint}</span>
          </div>
          <input
            type="range"
            min={0}
            max={1000}
            step={50}
            value={params.preservedGap}
            onChange={(e) =>
              onChange({ ...params, preset: 'custom', preservedGap: Number(e.target.value) })
            }
            className="w-full h-1.5 bg-accent rounded-full appearance-none cursor-pointer accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
            <span>0 ms</span>
            <span>1000 ms</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Main SilenceRemovalTab ----

const SilenceRemovalTab: React.FC<SilenceRemovalTabProps> = ({
  materials,
  onMaterialUpdate,
  onSilenceRemoved,
  onMinimize,
  onProcessingStateChange,
  isModalVisible = true,
}) => {
  const { t } = useLocale();
  // ---- State ----
  const [phase, setPhase] = useState<Phase>('select');
  const [selectedVideo, setSelectedVideo] = useState<MaterialItem | null>(null);
  const [detectionParams, setDetectionParams] = useState<DetectionParams>(DEFAULT_PARAMS);
  const [silenceSegments, setSilenceSegments] = useState<SilenceSegment[]>([]);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<string>>(new Set());
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Task ID returned from the removal API — needed by ProcessingProgress for polling
  const [processingTaskId, setProcessingTaskId] = useState<string | null>(null);
  // Completed result from ProcessingProgress
  const [completedResult, setCompletedResult] = useState<SilenceRemoveResult | null>(null);

  // Focus a segment on the waveform when clicked in the list
  const [focusSegmentId, setFocusSegmentId] = useState<string | null>(null);

  // Ref to WaveformPreview for imperative calls
  const waveformRef = useRef<WaveformPreviewHandle>(null);

  // Notify parent modal when entering/leaving processing state (for auto-minimize on close)
  useEffect(() => {
    if (onProcessingStateChange) {
      const isProcessing = phase === 'processing' && !!processingTaskId;
      onProcessingStateChange(isProcessing, processingTaskId || undefined, selectedVideo?.name || undefined);
    }
  }, [phase, processingTaskId, selectedVideo?.name, onProcessingStateChange]);

  // ---- Computed values ----
  const videoDuration = selectedVideo?.duration ?? 0;

  const selectedDuration = useMemo(() => {
    return silenceSegments
      .filter((s) => selectedSegmentIds.has(s.id))
      .reduce((acc, s) => acc + s.duration, 0);
  }, [silenceSegments, selectedSegmentIds]);

  // ---- API calls ----

  /** Detect silence segments via backend */
  const detectSilence = useCallback(async () => {
    if (!selectedVideo) return;
    setIsDetecting(true);
    setError(null);

    try {
      // Determine the video URL to send — prefer serverUrl over url
      const videoUrl = selectedVideo.serverUrl || selectedVideo.url;

      const body = {
        video_url: videoUrl,
        noise_threshold: detectionParams.noiseThreshold,
        // Convert ms to seconds for the API
        min_silence_duration: detectionParams.minSilenceDuration / 1000,
      };

      let json: any;
      try {
        json = await http.post<any>('/api/silence/detect', body, {
          timeoutMs: 600_000,
        });
      } catch (httpError) {
        if (httpError instanceof ApiError) {
          throw new Error(httpError.message || t.videoProcessing.errors.detectionFailed.replace('{status}', String(httpError.status)));
        }
        throw httpError;
      }

      if (!json.success) {
        throw new Error(json.message || t.videoProcessing.errors.detectionFailedShort);
      }

      const data = json.data;
      const segments: SilenceSegment[] = (data.silence_segments || []).map(
        (s: { id: string; start: number; end: number; duration: number }) => ({
          id: s.id,
          start: s.start,
          end: s.end,
          duration: s.duration,
        })
      );

      setSilenceSegments(segments);
      // Default: all segments selected for removal
      setSelectedSegmentIds(new Set(segments.map((s) => s.id)));
      setAudioUrl(data.audio_url || null);
      setPhase('preview');
    } catch (err) {
      const message = err instanceof Error ? err.message : t.videoProcessing.errors.detectionError;
      setError(message);
    } finally {
      setIsDetecting(false);
    }
  }, [selectedVideo, detectionParams, t]);

  /** Start silence removal via backend (returns task_id for polling) */
  const removeSilence = useCallback(async () => {
    if (!selectedVideo || selectedSegmentIds.size === 0) return;
    setError(null);

    try {
      const videoUrl = selectedVideo.serverUrl || selectedVideo.url;

      const segmentsToRemove = silenceSegments
        .filter((s) => selectedSegmentIds.has(s.id))
        .map((s) => ({ id: s.id, start: s.start, end: s.end }));

      const body = {
        video_url: videoUrl,
        segments_to_remove: segmentsToRemove,
        preserved_gap: detectionParams.preservedGap / 1000, // ms→seconds
        fade_duration: 0.05,
      };

      let json: any;
      try {
        json = await http.post<any>('/api/silence/remove', body, {
          timeoutMs: 600_000,
        });
      } catch (httpError) {
        if (httpError instanceof ApiError) {
          throw new Error(httpError.message || t.videoProcessing.errors.processFailed.replace('{status}', String(httpError.status)));
        }
        throw httpError;
      }

      if (!json.success) {
        throw new Error(json.message || t.videoProcessing.errors.processFailedShort);
      }

      // Capture task_id for polling by ProcessingProgress (TODO 04)
      const taskId = json.data?.task_id || null;
      setProcessingTaskId(taskId);

      // Transition to processing phase — ProcessingProgress (TODO 04) will handle
      // polling and progress display. For now we show a placeholder.
      setPhase('processing');
    } catch (err) {
      const message = err instanceof Error ? err.message : t.videoProcessing.errors.submitFailed;
      setError(message);
    }
  }, [selectedVideo, silenceSegments, selectedSegmentIds, detectionParams.preservedGap, t]);

  // ---- Segment interaction callbacks ----

  const handleToggleSegment = useCallback((id: string) => {
    setSelectedSegmentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedSegmentIds(new Set(silenceSegments.map((s) => s.id)));
  }, [silenceSegments]);

  const handleDeselectAll = useCallback(() => {
    setSelectedSegmentIds(new Set());
  }, []);

  const handleInvertSelection = useCallback(() => {
    setSelectedSegmentIds((prev) => {
      const next = new Set<string>();
      for (const s of silenceSegments) {
        if (!prev.has(s.id)) next.add(s.id);
      }
      return next;
    });
  }, [silenceSegments]);

  const handleSegmentUpdate = useCallback((id: string, start: number, end: number) => {
    setSilenceSegments((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, start, end, duration: end - start } : s
      )
    );
  }, []);

  const handleFocusSegment = useCallback((id: string) => {
    setFocusSegmentId(id);
  }, []);

  const handleFocusHandled = useCallback(() => {
    setFocusSegmentId(null);
  }, []);

  const handlePlaySegment = useCallback((id: string) => {
    waveformRef.current?.playSegmentContext(id);
  }, []);

  // ---- Render per phase ----

  return (
    <div className="flex flex-col h-full">
      {/* Error display */}
      {error && (
        <div className="mx-4 mt-3 p-3 bg-destructive/10 border border-destructive/30 rounded-md text-sm text-destructive">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-2 underline hover:no-underline"
          >
            {t.videoProcessing.buttons.close}
          </button>
        </div>
      )}

      {/* Phase content */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* ---- SELECT PHASE ---- */}
        {phase === 'select' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-foreground mb-1">{t.videoProcessing.selectVideo.heading}</h3>
              <p className="text-xs text-muted-foreground">{t.videoProcessing.selectVideo.description}</p>
            </div>
            <VideoSelector
              materials={materials}
              selectedVideo={selectedVideo}
              onSelect={setSelectedVideo}
            />
          </div>
        )}

        {/* ---- CONFIGURE PHASE ---- */}
        {phase === 'configure' && selectedVideo && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-md border border-border">
              {selectedVideo.thumbnailUrl && (
                <img
                  src={selectedVideo.thumbnailUrl}
                  alt={selectedVideo.name}
                  className="w-16 h-10 object-cover rounded"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{selectedVideo.name}</p>
                <p className="text-xs text-muted-foreground">
                  {selectedVideo.duration != null ? formatDuration(selectedVideo.duration, t.videoProcessing.duration.minutes, t.videoProcessing.duration.seconds) : ''}
                  {selectedVideo.width && selectedVideo.height ? ` · ${selectedVideo.width}x${selectedVideo.height}` : ''}
                </p>
              </div>
            </div>

            <ParameterPanel params={detectionParams} onChange={setDetectionParams} />
          </div>
        )}

        {/* ---- PREVIEW PHASE ---- */}
        {phase === 'preview' && audioUrl && (
          <div className="space-y-4">
            {/* Selected video info bar */}
            <div className="flex items-center gap-3 p-2 bg-muted/50 rounded-md border border-border">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{selectedVideo?.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {t.videoProcessing.stats.originalDuration}: {formatDuration(videoDuration, t.videoProcessing.duration.minutes, t.videoProcessing.duration.seconds)} → {t.videoProcessing.stats.estimatedNewDuration}: {formatDuration(Math.max(0, videoDuration - selectedDuration), t.videoProcessing.duration.minutes, t.videoProcessing.duration.seconds)}
                  ({t.videoProcessing.stats.saved} {selectedDuration.toFixed(1)} {t.videoProcessing.duration.seconds})
                </p>
              </div>
            </div>

            {/* Waveform */}
            <WaveformPreview
              ref={waveformRef}
              audioUrl={audioUrl}
              segments={silenceSegments}
              selectedIds={selectedSegmentIds}
              onSegmentUpdate={handleSegmentUpdate}
              focusSegmentId={focusSegmentId}
              onFocusHandled={handleFocusHandled}
            />

            {/* Segment list */}
            <SilenceSegmentList
              segments={silenceSegments}
              selectedIds={selectedSegmentIds}
              onToggle={handleToggleSegment}
              onToggleAll={handleSelectAll}
              onDeselectAll={handleDeselectAll}
              onInvertSelection={handleInvertSelection}
              onFocus={handleFocusSegment}
              onPlaySegment={handlePlaySegment}
            />
          </div>
        )}

        {/* ---- PROCESSING PHASE ---- */}
        {phase === 'processing' && processingTaskId && (
          <ProcessingProgress
            taskId={processingTaskId}
            videoName={selectedVideo?.name || ''}
            isVisible={isModalVisible}
            onComplete={(result) => {
              setCompletedResult(result);
              setPhase('completed');
            }}
            onError={(errMsg) => {
              setCompletedResult(null);
              setError(errMsg);
              setPhase('completed');
            }}
            onMinimize={(tId, vName) => {
              if (onMinimize) onMinimize(tId, vName);
            }}
            onCancel={() => {
              // Stop polling; return to preview phase
              setPhase('preview');
              setProcessingTaskId(null);
            }}
          />
        )}

        {/* ---- COMPLETED PHASE (success) ---- */}
        {phase === 'completed' && completedResult && (
          <div className="flex flex-col items-center py-8 px-6">
            {/* Success icon */}
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-1">{t.videoProcessing.progress.completed}</h3>
            <p className="text-sm text-muted-foreground mb-6">{selectedVideo?.name}</p>

            {/* Stats card */}
            <div className="w-full max-w-sm bg-muted/50 rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t.videoProcessing.stats.originalDuration}</span>
                <span className="font-medium text-foreground">{formatDuration(completedResult.original_duration, t.videoProcessing.duration.minutes, t.videoProcessing.duration.seconds)}</span>
              </div>
              <div className="flex items-center justify-center">
                <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t.videoProcessing.stats.newDuration}</span>
                <span className="font-medium text-green-600 dark:text-green-400">{formatDuration(completedResult.new_duration, t.videoProcessing.duration.minutes, t.videoProcessing.duration.seconds)}</span>
              </div>
              <div className="border-t border-border pt-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t.videoProcessing.stats.removedSegments}</span>
                  <span className="font-medium text-foreground">{completedResult.removed_count} {t.videoProcessing.stats.segments}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t.videoProcessing.stats.savedTime}</span>
                  <span className="font-medium text-green-600 dark:text-green-400">
                    {completedResult.time_saved.toFixed(1)}{t.videoProcessing.duration.seconds}
                    ({completedResult.original_duration > 0
                      ? ((completedResult.time_saved / completedResult.original_duration) * 100).toFixed(1)
                      : '0'}%)
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Completed with error (failed) */}
        {phase === 'completed' && !completedResult && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-foreground mb-1">{t.videoProcessing.progress.failed}</h3>
            <p className="text-sm text-destructive">{error || t.videoProcessing.errors.unknownError}</p>
          </div>
        )}
      </div>

      {/* ---- Action buttons (bottom bar) ---- */}
      <div className="border-t border-border px-4 py-3 flex items-center justify-end gap-2 bg-muted/30">
        {/* SELECT phase */}
        {phase === 'select' && (
          <button
            type="button"
            disabled={!selectedVideo}
            onClick={() => setPhase('configure')}
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t.videoProcessing.buttons.next}
          </button>
        )}

        {/* CONFIGURE phase */}
        {phase === 'configure' && (
          <>
            <button
              type="button"
              onClick={() => setPhase('select')}
              className="px-4 py-2 text-sm rounded-md bg-muted text-foreground border border-border hover:bg-accent transition-colors"
            >
              {t.videoProcessing.buttons.back}
            </button>
            <button
              type="button"
              onClick={detectSilence}
              disabled={isDetecting}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {isDetecting && (
                <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
              )}
              {isDetecting ? t.videoProcessing.progress.detecting : t.videoProcessing.progress.detectSilence}
            </button>
          </>
        )}

        {/* PREVIEW phase */}
        {phase === 'preview' && (
          <>
            <button
              type="button"
              onClick={() => {
                setPhase('configure');
                setSilenceSegments([]);
                setSelectedSegmentIds(new Set());
                setAudioUrl(null);
              }}
              className="px-4 py-2 text-sm rounded-md bg-muted text-foreground border border-border hover:bg-accent transition-colors"
            >
              {t.videoProcessing.buttons.redetect}
            </button>
            <button
              type="button"
              onClick={removeSilence}
              disabled={selectedSegmentIds.size === 0}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t.videoProcessing.buttons.startProcessing}
              {selectedSegmentIds.size > 0 && (
                <span className="ml-1 text-xs opacity-80">
                  ({selectedSegmentIds.size}{t.videoProcessing.segments.segmentsUnit}, {t.videoProcessing.stats.saved}{selectedDuration.toFixed(1)}s)
                </span>
              )}
            </button>
          </>
        )}

        {/* COMPLETED phase — success */}
        {phase === 'completed' && completedResult && (
          <button
            type="button"
            onClick={() => {
              if (selectedVideo && onSilenceRemoved) {
                onSilenceRemoved(completedResult.video_url, completedResult, selectedVideo);
              }
            }}
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {t.videoProcessing.buttons.done}
          </button>
        )}

        {/* COMPLETED phase — failure */}
        {phase === 'completed' && !completedResult && (
          <button
            type="button"
            onClick={() => {
              setPhase('preview');
              setError(null);
              setProcessingTaskId(null);
            }}
            className="px-4 py-2 text-sm rounded-md bg-muted text-foreground border border-border hover:bg-accent transition-colors"
          >
            {t.videoProcessing.buttons.return}
          </button>
        )}
      </div>
    </div>
  );
};

export default SilenceRemovalTab;
