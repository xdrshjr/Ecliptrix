import { useCallback, useMemo, useState } from 'react';
import type { MaterialItem, TimelineState } from '@/types';
import { useNotification } from '@/contexts/NotificationContext';
import { useLocale } from '@/contexts/LocaleContext';
import { http, ApiError } from '@/lib/api/http-client';
import type {
  CompositionDegradation,
  VideoCompositionRequest,
} from '@/lib/api/videoComposition';
import type { SupportedLocale, Translations } from '@/lib/i18n';
import { VideoEditingLogger } from '../utils/logger';
import { indexMaterialsById } from '../timeline/infrastructure/renderableTimeline';
import {
  formatDegradationMessage,
  formatNameList,
  mergeDegradations,
} from './exportDegradations';
import {
  BLACK_TAIL_NOTICE_SECONDS,
  buildExportCompositionItems,
  planVideoExport,
  type VideoExportPlan,
} from './videoExportItems';

type CompositionApi = (typeof import('@/lib/api/videoComposition'))['videoCompositionAPI'];
type Notify = (message: string, durationMs?: number) => void;

interface UseVideoExportReturn {
  isExporting: boolean;
  exportProgress: number;
  exportStartTime: number | null;
  handleExport: () => Promise<void>;
}

interface UseVideoExportProps {
  timelineState: TimelineState;
  materials?: MaterialItem[];
  taskId?: string;
  aspectRatio?: string; // Add aspect ratio support (e.g., "16:9", "9:16", "4:3", "1:1", "21:9")
}

interface FailedVideoDetail {
  video_name?: string;
  stage?: string;
  error_message?: string;
}

interface ExportErrorDetails {
  error_summary?: string;
  failed_videos?: FailedVideoDetail[];
  recovery_suggestions?: string[];
}

interface PollOutcome {
  warnings: string[];
  degradations: CompositionDegradation[];
}

const exportFileName = () =>
  `video_export_${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`;

/** Why a timeline cannot be exported, in the user's language. */
function refusalMessage(
  plan: Exclude<VideoExportPlan, { status: 'ready' }>,
  t: Translations,
  locale?: SupportedLocale,
): string {
  if (plan.status === 'nothing-visible') return t.videoExport.nothingVisibleToExport;
  return t.videoExport.missingMaterials
    .replace('{count}', String(plan.clips.length))
    .replace('{names}', formatNameList(plan.clips.map((clip) => clip.name), t, locale));
}

function buildCompositionRequest(
  tracks: TimelineState['tracks'],
  materialsById: ReadonlyMap<string, MaterialItem>,
  renderEnd: number,
  taskId: string,
  aspectRatio?: string,
): VideoCompositionRequest {
  const items = buildExportCompositionItems(tracks, materialsById);
  return {
    task_id: `export_${taskId}_${Date.now()}`,
    aspect_ratio: aspectRatio,
    video_items: items.videoItems,
    audio_items: items.audioItems,
    subtitle_items: items.subtitleItems,
    image_items: items.imageItems,
    // The render end, not the sum of clip lengths: overlapping tracks and gaps
    // keep their real timing, and the preview ends at the same second (S5).
    total_duration: renderEnd,
    // Without an aspect ratio the backend needs an explicit resolution.
    ...(aspectRatio ? {} : { output_resolution: { width: 1920, height: 1080 } }),
    output_fps: 30,
    output_format: 'mp4',
  };
}

/** Failure text: the backend summary with failed clips and suggestions when present. */
function describeExportFailure(
  error: unknown,
  t: Translations,
): { message: string; durationMs: number } {
  // http-client and the status poller both name their timeouts; a backend
  // failure whose text merely mentions "timeout" keeps its real reason.
  if (error instanceof Error && error.name === 'TimeoutError') {
    return { message: t.videoExport.exportTimeout, durationMs: 10000 };
  }
  if (!(error instanceof Error)) return { message: t.videoExport.exportFailed, durationMs: 15000 };
  const details = error instanceof ApiError
    ? (error.details as { error_details?: ExportErrorDetails } | undefined)?.error_details
    : undefined;
  if (!details) {
    return { message: `${t.videoExport.exportFailedWithError} ${error.message}`, durationMs: 15000 };
  }
  let message = `${details.error_summary}`;
  const failedVideos = details.failed_videos ?? [];
  if (failedVideos.length > 0) {
    const lines = failedVideos.map((video) =>
      `• ${video.video_name} (${video.stage}${t.videoExport.exportFailedWithError}): ${video.error_message}`,
    );
    message += `\n\n${t.videoExport.failedVideos}\n${lines.join('\n')}`;
    const suggestions = details.recovery_suggestions ?? [];
    if (suggestions.length > 0) {
      message += `\n\n${t.videoExport.recoverySuggestions}\n${suggestions.map((s) => `• ${s}`).join('\n')}`;
    }
  }
  return { message, durationMs: 15000 };
}

/**
 * Poll until the composition finishes, collecting the notices that only the
 * status channel carries: camera-motion degrade warnings and the content that
 * did not make it into the video (S7). Both repeat on every poll, so they are
 * de-duplicated here.
 */
async function pollUntilComposed(
  api: CompositionApi,
  compositionId: string,
  onProgress: (percent: number) => void,
): Promise<PollOutcome> {
  const outcome: PollOutcome = { warnings: [], degradations: [] };
  await api.pollCompositionStatus(compositionId, (status) => {
    onProgress(Math.max(30, Math.min(95, 30 + status.progress * 65)));
    (status.warnings ?? []).forEach((warning) => {
      if (warning && !outcome.warnings.includes(warning)) outcome.warnings.push(warning);
    });
    outcome.degradations = mergeDegradations(outcome.degradations, status.degradations);
  });
  return outcome;
}

interface ExportReporter {
  logger: VideoEditingLogger;
  showError: Notify;
  t: Translations;
}

async function downloadComposedVideo(
  api: CompositionApi,
  compositionId: string,
  taskId: string,
  { logger, showError, t }: ExportReporter,
): Promise<void> {
  try {
    await api.triggerDownload(compositionId, taskId, exportFileName());
    return;
  } catch (downloadError) {
    logger.error('自动下载失败，尝试 Blob 下载兜底', { error: String(downloadError) });
  }
  const downloadUrl = `/api/video-compose/${compositionId}/download?task_id=${taskId}`;
  try {
    await http.download(downloadUrl, exportFileName(), { timeoutMs: 600_000 });
  } catch (blobError) {
    // Both paths failed: say so rather than leaving a "succeeded" export with no file.
    const reason = blobError instanceof Error ? blobError.message : '';
    logger.error('Blob 兜底下载也失败', { blobError: reason });
    showError(`${t.videoExport.exportCompletedButDownloadFailed} ${reason}`, 10000);
  }
}

/**
 * 可复用的视频导出hook
 * 提供视频导出功能，包括状态管理和进度跟踪
 */
export const useVideoExport = ({
  timelineState,
  materials,
  taskId = 'video_export',
  aspectRatio,
}: UseVideoExportProps): UseVideoExportReturn => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStartTime, setExportStartTime] = useState<number | null>(null);
  const { showError, showWarning } = useNotification();
  const { t, locale } = useLocale();
  // Memoized on taskId — stable across renders, safe in useCallback deps.
  const logger = useMemo(
    () => new VideoEditingLogger({ component: 'useVideoExport', taskId }),
    [taskId]
  );

  const resetExportState = useCallback(() => {
    setIsExporting(false);
    setExportProgress(0);
    setExportStartTime(null);
  }, []);

  const reportCompositionNotices = useCallback((outcome: PollOutcome) => {
    if (outcome.warnings.length > 0) {
      // The export SUCCEEDED — "some clips rendered differently than the
      // preview" must be visible but not framed as a failure.
      logger.warn('合成过程产生降级告警', { warnings: outcome.warnings });
      showWarning([t.videoExport.compositionWarningsTitle, ...outcome.warnings].join('\n'), 12000);
    }
    const degradationMessage = formatDegradationMessage(outcome.degradations, t, locale);
    if (degradationMessage) {
      // Reasons are backend text: logged for diagnosis, never shown (RV-08).
      logger.warn('导出内容有缺失', { degradations: outcome.degradations });
      showWarning(degradationMessage, 15000);
    }
  }, [logger, showWarning, t, locale]);

  const handleExport = useCallback(async () => {
    setExportStartTime(Date.now());
    setIsExporting(true);

    const materialsById = indexMaterialsById(materials ?? []);
    const plan = planVideoExport(timelineState.tracks, materialsById);
    logger.info('导出前检查', { status: plan.status, trackCount: timelineState.tracks.length });
    if (plan.status !== 'ready') {
      showError(refusalMessage(plan, t, locale), 8000);
      resetExportState();
      return;
    }
    // A picture shorter than the audio exports a black tail, exactly as the
    // preview plays it; tell the user instead of refusing (D-12).
    if (plan.blackTailSeconds > BLACK_TAIL_NOTICE_SECONDS) {
      showWarning(
        t.videoExport.blackTailNotice.replace('{seconds}', plan.blackTailSeconds.toFixed(1)),
        8000,
      );
    }

    try {
      const { videoCompositionAPI } = await import('@/lib/api/videoComposition');
      const request = buildCompositionRequest(
        timelineState.tracks, materialsById, plan.renderEnd, taskId, aspectRatio,
      );
      setExportProgress(20);
      const response = await videoCompositionAPI.composeVideo(request);
      if (!response.success || !response.composition_id) {
        throw new Error(response.message || t.videoExport.exportFailed);
      }
      setExportProgress(30);
      // Not tied to this component's lifetime on purpose: leaving the editor
      // mid-export must still deliver the file, the backend keeps rendering.
      if (response.status !== 'completed') {
        const outcome = await pollUntilComposed(
          videoCompositionAPI, response.composition_id, setExportProgress,
        );
        reportCompositionNotices(outcome);
        setExportProgress(95);
      }
      await downloadComposedVideo(
        videoCompositionAPI, response.composition_id, request.task_id, { logger, showError, t },
      );
      setExportProgress(100);
    } catch (error) {
      if (error instanceof Error) {
        logger.error('导出失败', error);
      } else {
        logger.error('导出失败', { error: String(error) });
      }
      const { message, durationMs } = describeExportFailure(error, t);
      showError(message, durationMs);
    } finally {
      setTimeout(resetExportState, 2000);
    }
  }, [timelineState, materials, taskId, aspectRatio, showError, showWarning, t, locale, logger,
    resetExportState, reportCompositionNotices]);

  return {
    isExporting,
    exportProgress,
    exportStartTime,
    handleExport
  };
};
