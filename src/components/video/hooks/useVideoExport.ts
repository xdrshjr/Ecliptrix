import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { MaterialItem, TimelineState } from '@/types';
import { useNotification } from '@/contexts/NotificationContext';
import { useLocale } from '@/contexts/LocaleContext';
import type {
  CompositionDegradation,
  CompositionStage,
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
import { describeExportFailure, isExportTimeout } from './exportFailureMessage';
import {
  beginExportSession,
  endExportSession,
  exportSessionKey,
  getExportSession,
  subscribeExportSessions,
  updateExportSession,
  type ExportSession,
  type ExportSessionPatch,
} from './exportSessionStore';
import {
  BLACK_TAIL_NOTICE_SECONDS,
  buildExportCompositionItems,
  planVideoExport,
  type VideoExportPlan,
} from './videoExportItems';

type CompositionApi = (typeof import('@/lib/api/videoComposition'))['videoCompositionAPI'];
type Notify = (message: string, durationMs?: number) => void;

/** Progress once the composition is done and the file downloads; no cancel from here on. */
const DOWNLOAD_PROGRESS = 95;
/** How long the finished tick stays on screen after the download. */
const SUCCESS_TICK_MS = 2000;

interface UseVideoExportReturn {
  isExporting: boolean;
  exportProgress: number;
  exportStartTime: number | null;
  /** Backend stage of the running composition, when the backend reports one. */
  exportStage?: CompositionStage;
  /** Whether cancelling can still stop the export (it cannot once the file downloads). */
  canCancelExport: boolean;
  handleExport: () => Promise<void>;
  cancelExport: () => Promise<void>;
}

interface UseVideoExportProps {
  timelineState: TimelineState;
  materials?: MaterialItem[];
  taskId?: string;
  /** Scopes the export session to one project of the task (RV3-07). */
  projectId?: string;
  aspectRatio?: string; // Add aspect ratio support (e.g., "16:9", "9:16", "4:3", "1:1", "21:9")
}

interface PollOutcome {
  warnings: string[];
  degradations: CompositionDegradation[];
}

type ExportOutcome = 'downloaded' | 'download-failed' | 'cancelled' | 'failed';

interface ExportReporter {
  logger: VideoEditingLogger;
  showError: Notify;
  showInfo: Notify;
  t: Translations;
  locale?: SupportedLocale;
}

/** One export run: everything it needs, bound to the session it began. */
interface ExportRun {
  buildRequest: () => VideoCompositionRequest;
  controller: AbortController;
  /** Writes into this run's own session only. */
  update: (patch: ExportSessionPatch) => void;
  report: ExportReporter;
  reportNotices: (outcome: PollOutcome) => void;
}

const exportFileName = () =>
  `video_export_${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`;

async function loadCompositionApi(): Promise<CompositionApi> {
  return (await import('@/lib/api/videoComposition')).videoCompositionAPI;
}

function isCancellable(session: ExportSession | undefined): session is ExportSession {
  return session?.status === 'running'
    && session.progress < DOWNLOAD_PROGRESS
    && !session.controller.signal.aborted;
}

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

/**
 * Poll until the composition finishes, collecting the notices that only the
 * status channel carries: camera-motion degrade warnings and the content that
 * did not make it into the video (S7). Both repeat on every poll, so they are
 * de-duplicated here.
 */
async function pollUntilComposed(
  api: CompositionApi,
  compositionId: string,
  run: ExportRun,
): Promise<PollOutcome> {
  const outcome: PollOutcome = { warnings: [], degradations: [] };
  await api.pollCompositionStatus(compositionId, (status) => {
    run.update({
      progress: Math.max(30, Math.min(DOWNLOAD_PROGRESS, 30 + status.progress * 65)),
      stage: status.stage,
    });
    (status.warnings ?? []).forEach((warning) => {
      if (warning && !outcome.warnings.includes(warning)) outcome.warnings.push(warning);
    });
    outcome.degradations = mergeDegradations(outcome.degradations, status.degradations);
  }, { signal: run.controller.signal });
  return outcome;
}

/** One download attempt (EXO-14): a failure is reported, never shown as a finished export. */
async function downloadComposedVideo(
  api: CompositionApi,
  compositionId: string,
  taskId: string,
  { logger, showError, t }: ExportReporter,
): Promise<boolean> {
  try {
    await api.triggerDownload(compositionId, taskId, exportFileName());
    return true;
  } catch (error) {
    logger.error('成片下载失败', { compositionId, error: String(error) });
    showError(t.videoExport.exportCompletedButDownloadFailed, 10000);
    return false;
  }
}

/** Asks the backend to stop; a failed request is logged and the client stops regardless. */
async function requestBackendCancel(
  api: CompositionApi,
  compositionId: string,
  logger: VideoEditingLogger,
): Promise<void> {
  try {
    await api.cancelComposition(compositionId);
  } catch (error) {
    logger.error('取消导出请求失败', { compositionId, error: String(error) });
  }
}

function reportCancelled(report: ExportReporter): ExportOutcome {
  report.logger.info('导出已取消');
  report.showInfo(report.t.videoExport.exportCancelled);
  return 'cancelled';
}

function reportExportFailure(error: unknown, run: ExportRun): ExportOutcome {
  if (run.controller.signal.aborted) return reportCancelled(run.report);
  const { logger, showError, t, locale } = run.report;
  logger.error('导出失败', error instanceof Error ? error : { error: String(error) });
  // Backend text stays in the log above; the user reads a localized sentence.
  const message = describeExportFailure(error, t, locale);
  if (message === null) return reportCancelled(run.report);
  showError(message, isExportTimeout(error) ? 10000 : 15000);
  return 'failed';
}

async function runComposition(run: ExportRun): Promise<ExportOutcome> {
  try {
    const api = await loadCompositionApi();
    const request = run.buildRequest();
    run.update({ progress: 20 });
    const response = await api.composeVideo(request);
    if (!response.success || !response.composition_id) {
      throw new Error(response.message || 'Composition did not start');
    }
    const compositionId = response.composition_id;
    run.update({ progress: 30, compositionId });
    if (run.controller.signal.aborted) {
      // Cancelled while the request was starting: stop what it started.
      await requestBackendCancel(api, compositionId, run.report.logger);
      return reportCancelled(run.report);
    }
    // Not tied to this component's lifetime on purpose: leaving the editor
    // mid-export must still deliver the file, the backend keeps rendering.
    if (response.status !== 'completed') {
      run.reportNotices(await pollUntilComposed(api, compositionId, run));
      run.update({ progress: DOWNLOAD_PROGRESS });
    }
    const downloaded = await downloadComposedVideo(api, compositionId, request.task_id, run.report);
    return downloaded ? 'downloaded' : 'download-failed';
  } catch (error) {
    return reportExportFailure(error, run);
  }
}

/**
 * 可复用的视频导出hook
 * 提供视频导出功能，包括状态管理和进度跟踪。导出状态存放在按
 * `taskId:projectId` 隔离的会话存储中，编辑器卸载后导出继续、重新挂载后恢复（EXO-14）。
 */
export const useVideoExport = ({
  timelineState,
  materials,
  taskId = 'video_export',
  projectId,
  aspectRatio,
}: UseVideoExportProps): UseVideoExportReturn => {
  const { showError, showWarning, showInfo } = useNotification();
  const { t, locale } = useLocale();
  const sessionKey = exportSessionKey(taskId, projectId);
  const session = useSyncExternalStore(
    subscribeExportSessions,
    () => getExportSession(sessionKey),
    () => undefined,
  );
  // Memoized on taskId — stable across renders, safe in useCallback deps.
  const logger = useMemo(
    () => new VideoEditingLogger({ component: 'useVideoExport', taskId }),
    [taskId]
  );

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
    const controller = new AbortController();
    // Synchronous guard: a second click, or a remounted editor, never starts
    // a second composition while this one runs.
    if (!beginExportSession(sessionKey, controller)) return;

    const materialsById = indexMaterialsById(materials ?? []);
    const plan = planVideoExport(timelineState.tracks, materialsById);
    logger.info('导出前检查', { status: plan.status, trackCount: timelineState.tracks.length });
    if (plan.status !== 'ready') {
      showError(refusalMessage(plan, t, locale), 8000);
      endExportSession(sessionKey, controller);
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

    const outcome = await runComposition({
      buildRequest: () => buildCompositionRequest(
        timelineState.tracks, materialsById, plan.renderEnd, taskId, aspectRatio,
      ),
      controller,
      update: (patch) => updateExportSession(sessionKey, patch, controller),
      report: { logger, showError, showInfo, t, locale },
      reportNotices: reportCompositionNotices,
    });
    if (outcome !== 'downloaded') {
      endExportSession(sessionKey, controller);
      return;
    }
    updateExportSession(sessionKey, { status: 'finished', progress: 100 }, controller);
    setTimeout(() => endExportSession(sessionKey, controller), SUCCESS_TICK_MS);
  }, [timelineState, materials, taskId, aspectRatio, sessionKey, showError, showWarning, showInfo,
    t, locale, logger, reportCompositionNotices]);

  const cancelExport = useCallback(async () => {
    const current = getExportSession(sessionKey);
    if (!isCancellable(current)) return;
    logger.info('用户取消导出', { compositionId: current.compositionId });
    current.controller.abort();
    // Close the modal now; the run's own error path shows the cancelled notice.
    endExportSession(sessionKey, current.controller);
    // Without an id the composition has not started yet; the run cancels it
    // as soon as the start request returns.
    if (current.compositionId) {
      await requestBackendCancel(await loadCompositionApi(), current.compositionId, logger);
    }
  }, [sessionKey, logger]);

  return {
    isExporting: session !== undefined,
    exportProgress: session?.progress ?? 0,
    exportStartTime: session?.startTime ?? null,
    exportStage: session?.stage,
    canCancelExport: isCancellable(session),
    handleExport,
    cancelExport,
  };
};
