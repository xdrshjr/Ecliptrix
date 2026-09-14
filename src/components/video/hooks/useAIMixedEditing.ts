/**
 * useAIMixedEditing — orchestrates AI auto edit (AM-08).
 *
 * analyze footage → ask the editing model for a plan → convert it through
 * /api/timeline-import → merge it into the live timeline as ONE undoable
 * step. One AbortController per run makes every stage cancellable; results
 * that arrive after a cancel or an unmount are discarded before they touch
 * React state or the timeline.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import { ApiError, TimeoutError, http } from '@/lib/api/http-client';
import type { Translations } from '@/lib/i18n';
import type { MaterialItem, TimelineState } from '@/types';
import type { AIMixingMode } from '../components/AIMixingModeSelectionModal/AIMixingModeSelectionModal';
import {
  findAiMixTargetTrack,
  mergeAiMixTimeline,
} from '../lib/aiMix/mergeAiMixTimeline';
import type { TrackData } from '../timeline/domain';
import { replaceTimelineAction } from '../timeline/store/actions/replaceTimeline';
import { useTimelineStore } from '../timeline/store/useTimelineStore';
import { deriveTrackDisplayName } from '../timeline/trackDisplayName';
import {
  VIDEO_ANALYSIS_CONFIG,
  analyzeVideosInBatch,
} from '../utils/parallelVideoAnalysis';

export type AiMixStage =
  | 'idle'
  | 'analyzing'
  | 'planning'
  | 'applying'
  | 'done'
  | 'error'
  | 'cancelled';

export interface AiMixRunState {
  stage: AiMixStage;
  /** Videos sent to analysis; shown while analyzing. */
  videoCount: number;
  /** Clips dropped or adjusted; known once the run is done. */
  warningCount: number;
}

export interface AiMixTimelineImpact {
  /** Clips on the video, image and audio lanes an AI plan may replace. */
  replaceableItemCount: number;
  /** Non-empty tracks the plan never touches (subtitles, locked tracks…). */
  preservedTrackNames: string[];
}

export interface UseAIMixedEditingOptions {
  taskId: string;
  /** Reads the latest material library (typically through a ref). */
  getMaterials: () => MaterialItem[];
  isAgentExecuting: boolean;
}

export interface UseAIMixedEditingReturn {
  runState: AiMixRunState;
  isModeModalOpen: boolean;
  timelineImpact: AiMixTimelineImpact;
  openModeModal: () => void;
  closeModeModal: () => void;
  start: (mode: AIMixingMode) => Promise<void>;
  cancel: () => void;
}

/** The lean material shape the planning service actually reads. */
export interface AiMixMaterialDto {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image';
  format: string;
  size: number;
  duration?: number;
  width?: number;
  height?: number;
  url: string;
  serverUrl?: string;
  thumbnailUrl?: string;
  description?: string;
  tags?: string[];
  createdAt: string;
  metadata?: {
    segment_id?: string;
    segment_number?: number;
    video_analysis?: unknown;
  };
}

interface AiMixTimelineData {
  metadata?: { warnings?: unknown[] };
}

interface AiMixPlanResponse {
  timelineData?: AiMixTimelineData;
}

interface TimelineImportResponse {
  success?: boolean;
  importedData?: { timelineState?: TimelineState };
}

interface AppliedAiMix {
  hasChanges: boolean;
  /** The plan was usable but left the timeline exactly as it was. */
  isUnchanged: boolean;
  skippedLockedTracks: boolean;
  warningCount: number;
}

type Notifier = ReturnType<typeof useNotification>;
type TrackCopy = Parameters<typeof deriveTrackDisplayName>[1];

type AiMixErrorKey =
  | 'errorModelNotConfigured'
  | 'errorUpstream'
  | 'errorUnparseable'
  | 'errorNoMaterials';

const IDLE_RUN_STATE: AiMixRunState = {
  stage: 'idle',
  videoCount: 0,
  warningCount: 0,
};
const NO_IMPACT: AiMixTimelineImpact = {
  replaceableItemCount: 0,
  preservedTrackNames: [],
};
const PLAN_TIMEOUT_MS = 600_000;
const IMPORT_TIMEOUT_MS = 300_000;
/** How long the finished checklist stays up before the dialog closes. */
const DONE_DISMISS_MS = 1200;
const PLANNABLE_TYPES: ReadonlySet<string> = new Set(['video', 'audio', 'image']);
/** Error name for "the agent took the timeline while planning" (S4). */
const BLOCKED_BY_AGENT_ERROR = 'AiMixBlockedByAgentError';
const ERROR_MESSAGE_KEYS: ReadonlyMap<string, AiMixErrorKey> = new Map([
  ['AI_MIX_MODEL_NOT_CONFIGURED', 'errorModelNotConfigured'],
  ['AI_MIX_LLM_UPSTREAM_FAILED', 'errorUpstream'],
  ['AI_MIX_PLAN_UNPARSEABLE', 'errorUnparseable'],
  ['AI_MIX_INVALID_REQUEST', 'errorNoMaterials'],
]);

/** Turn any failure into a localized, actionable sentence. */
export function mapAiMixError(error: unknown, t: Translations): string {
  const messages = t.aiMixingProgress;
  const key = error instanceof ApiError
    ? ERROR_MESSAGE_KEYS.get(error.code)
    : undefined;
  if (key) return messages[key];
  if (error instanceof TimeoutError) return messages.errorTimeout;
  const message = error instanceof Error && error.message
    ? error.message
    : String(error);
  return messages.errorGeneric.replace('{message}', message);
}

function toIsoString(value: unknown): string {
  const date = value instanceof Date
    ? value
    : new Date(typeof value === 'string' ? value : Number.NaN);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  return typeof value === 'string' && value !== ''
    ? value
    : new Date(0).toISOString();
}

const isInlineData = (url: string | undefined): boolean =>
  !!url && (url.startsWith('data:') || url.startsWith('blob:'));

/**
 * Only the fields the planning prompt reads; transcripts, sentence timing
 * and subtitles would bloat the request without informing the plan.
 */
function pickPlanMetadata(
  metadata: MaterialItem['metadata'],
): AiMixMaterialDto['metadata'] {
  if (!metadata) return undefined;
  const picked: NonNullable<AiMixMaterialDto['metadata']> = {};
  if (typeof metadata.segment_id === 'string') {
    picked.segment_id = metadata.segment_id;
  }
  if (typeof metadata.segment_number === 'number') {
    picked.segment_number = metadata.segment_number;
  }
  if (metadata.video_analysis !== undefined) {
    picked.video_analysis = metadata.video_analysis;
  }
  return Object.keys(picked).length > 0 ? picked : undefined;
}

export function toAiMixMaterialDtos(
  materials: readonly MaterialItem[],
): AiMixMaterialDto[] {
  return materials
    .filter((material) => PLANNABLE_TYPES.has(material.type))
    .map((material) => ({
      id: material.id,
      name: material.name,
      type: material.type as AiMixMaterialDto['type'],
      format: material.format || '',
      size: material.size ?? 0,
      duration: material.duration,
      width: material.width,
      height: material.height,
      url: material.url,
      serverUrl: material.serverUrl,
      thumbnailUrl: isInlineData(material.thumbnailUrl)
        ? undefined
        : material.thumbnailUrl,
      description: material.description,
      tags: material.tags,
      createdAt: toIsoString(material.createdAt),
      metadata: pickPlanMetadata(material.metadata),
    }));
}

const hasPlannableMaterials = (materials: readonly MaterialItem[]): boolean =>
  materials.some((material) => PLANNABLE_TYPES.has(material.type));

function computeTimelineImpact(
  tracks: readonly TrackData[],
  trackCopy: TrackCopy,
): AiMixTimelineImpact {
  const replaceable = new Set([
    findAiMixTargetTrack(tracks, 'video'),
    findAiMixTargetTrack(tracks, 'image'),
    ...tracks.filter((track) => track.type === 'audio'),
  ].filter((track): track is TrackData => !!track && !track.isLocked));
  return {
    replaceableItemCount: tracks
      .filter((track) => replaceable.has(track))
      .reduce((count, track) => count + track.items.length, 0),
    preservedTrackNames: tracks
      .filter((track) => !replaceable.has(track) && track.items.length > 0)
      // Default tracks store no name; list them by the label the timeline shows.
      .map((track) => deriveTrackDisplayName(track, trackCopy)),
  };
}

function createNamedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

const createAbortError = (): Error =>
  createNamedError('AbortError', 'AI auto edit was cancelled');

const hasErrorName = (error: unknown, name: string): boolean =>
  (error as { name?: unknown } | null)?.name === name;

/** Best effort: planning still works without analysis, as before. */
async function analyzeFootage(
  videos: MaterialItem[],
  mode: AIMixingMode,
  signal: AbortSignal,
  taskId: string,
): Promise<void> {
  if (videos.length === 0) return;
  try {
    const results = await analyzeVideosInBatch(videos, {
      maxRetries: VIDEO_ANALYSIS_CONFIG.MAX_RETRY_ATTEMPTS,
      retryDelayMs: VIDEO_ANALYSIS_CONFIG.RETRY_DELAY_MS,
      mode,
      signal,
    }, taskId);
    const failedCount = results.filter((result) => !result.success).length;
    if (failedCount > 0 && !signal.aborted) {
      console.warn('[useAIMixedEditing] some videos were not analyzed', {
        taskId,
        failedCount,
      });
    }
  } catch (error) {
    if (!signal.aborted) {
      console.warn('[useAIMixedEditing] video analysis failed; planning anyway', {
        taskId,
        error,
      });
    }
  }
  if (signal.aborted) throw createAbortError();
}

async function requestPlan(
  taskId: string,
  materials: readonly MaterialItem[],
  signal: AbortSignal,
  t: Translations,
): Promise<AiMixTimelineData> {
  const response = await http.post<AiMixPlanResponse>(
    '/api/ai-mixed-editing',
    { taskId, materials: toAiMixMaterialDtos(materials) },
    { timeoutMs: PLAN_TIMEOUT_MS, signal },
  );
  if (!response?.timelineData) {
    throw new Error(t.aiMixingProgress.errorInvalidResponse);
  }
  return response.timelineData;
}

async function importPlan(
  taskId: string,
  timelineData: AiMixTimelineData,
  signal: AbortSignal,
  t: Translations,
): Promise<TimelineState> {
  const response = await http.post<TimelineImportResponse>(
    '/api/timeline-import',
    {
      taskId,
      fileContent: JSON.stringify(timelineData),
      fileName: `ai-mixed-editing-${Date.now()}.json`,
      mergeMode: 'replace',
      preserveIds: true,
    },
    { timeoutMs: IMPORT_TIMEOUT_MS, signal },
  );
  const timelineState = response?.success
    ? response.importedData?.timelineState
    : undefined;
  if (!timelineState) throw new Error(t.aiMixingProgress.errorInvalidResponse);
  return timelineState;
}

function applyAiMixPlan(
  imported: TimelineState,
  planWarningCount: number,
  materials: readonly MaterialItem[],
  t: Translations,
): AppliedAiMix {
  // The agent may have taken the timeline while the plan was generated (S4).
  if (useTimelineStore.getState().externalEditLock !== null) {
    throw createNamedError(BLOCKED_BY_AGENT_ERROR, t.aiMixingProgress.blockedByAgent);
  }
  const merged = mergeAiMixTimeline({
    current: useTimelineStore.getState().exportToData(),
    imported,
    knownMaterialIds: new Set(materials.map((material) => material.id)),
  });
  const hasUsableClips =
    merged.replacedTrackIds.length + merged.createdTrackIds.length > 0;
  const skippedLockedTracks = merged.skippedLockedTrackIds.length > 0;
  // A plan with nothing usable must not report "applied".
  if (!hasUsableClips && !skippedLockedTracks) {
    throw new Error(t.aiMixingProgress.errorInvalidResponse);
  }
  // An identical result writes no history entry, so "press Ctrl+Z to undo"
  // would undo the user's previous edit instead; report it as unchanged.
  const hasChanges = hasUsableClips && replaceTimelineAction(
    () => useTimelineStore.getState(),
    merged.timeline,
    'ai-mix',
  );
  if (hasChanges) useTimelineStore.getState().setCurrentTime(0);
  return {
    hasChanges,
    isUnchanged: hasUsableClips && !hasChanges,
    skippedLockedTracks,
    warningCount: merged.droppedItems.length + planWarningCount,
  };
}

function announceAiMixResult(
  result: AppliedAiMix,
  t: Translations,
  notify: Notifier,
): void {
  const messages = t.aiMixingProgress;
  if (result.hasChanges) notify.showSuccess(messages.success);
  if (result.isUnchanged) notify.showInfo(messages.noChanges);
  if (result.warningCount > 0) {
    notify.showWarning(
      messages.partialWarning.replace('{count}', String(result.warningCount)),
    );
  }
  if (result.skippedLockedTracks) {
    notify.showWarning(messages.lockedTracksSkipped);
  }
}

/** Refusals shown before any work starts; true when nothing may start. */
function refuseToStart(
  materials: readonly MaterialItem[],
  isAgentExecuting: boolean,
  t: Translations,
  notify: Notifier,
): boolean {
  // Checked on the same filter the request uses: a library of subtitles only
  // would otherwise reach the backend as an empty list and fail validation.
  if (!hasPlannableMaterials(materials)) {
    notify.showError(t.aiMixingProgress.errorNoMaterials);
    return true;
  }
  if (isAgentExecuting) {
    notify.showWarning(t.aiMixingProgress.blockedByAgent);
    return true;
  }
  return false;
}

interface AiMixRunContext {
  taskId: string;
  mode: AIMixingMode;
  materials: MaterialItem[];
  videos: MaterialItem[];
  signal: AbortSignal;
  t: Translations;
  /** Re-reads the library right before merging; it may have changed. */
  getMaterials: () => MaterialItem[];
  isCurrentRun: () => boolean;
  advance: (stage: AiMixStage) => void;
}

/** analyze → plan → import → merge; throws on failure, cancel or a stale run. */
async function runAiMixStages(context: AiMixRunContext): Promise<AppliedAiMix> {
  const { taskId, signal, t, advance } = context;
  advance('analyzing');
  await analyzeFootage(context.videos, context.mode, signal, taskId);
  advance('planning');
  const timelineData = await requestPlan(taskId, context.materials, signal, t);
  advance('applying');
  const imported = await importPlan(taskId, timelineData, signal, t);
  if (signal.aborted || !context.isCurrentRun()) throw createAbortError();
  const planWarningCount = timelineData.metadata?.warnings?.length ?? 0;
  return applyAiMixPlan(imported, planWarningCount, context.getMaterials(), t);
}

interface RunFailureContext {
  signal: AbortSignal;
  stage: AiMixStage;
  taskId: string;
  t: Translations;
  notify: Notifier;
}

/** Tell the user why a run stopped; returns the stage the dialog settles on. */
function reportRunFailure(error: unknown, context: RunFailureContext): AiMixStage {
  const { signal, stage, taskId, t, notify } = context;
  if (signal.aborted || hasErrorName(error, 'AbortError')) {
    notify.showInfo(t.aiMixingProgress.cancelled);
    return 'cancelled';
  }
  if (hasErrorName(error, BLOCKED_BY_AGENT_ERROR)) {
    notify.showWarning(t.aiMixingProgress.blockedByAgent);
    return 'error';
  }
  console.error('[useAIMixedEditing] run failed', { taskId, stage, error });
  notify.showError(mapAiMixError(error, t));
  return 'error';
}

interface UseAiMixRunOptions extends UseAIMixedEditingOptions {
  /** Called as a run starts: the mode dialog hands over to progress. */
  onRunStart: () => void;
}

interface AiMixRun {
  runState: AiMixRunState;
  isRunActive: () => boolean;
  start: (mode: AIMixingMode) => Promise<void>;
  cancel: () => void;
}

// Over 60 lines: the refs, the unmount cleanup and start() are one
// cancellation contract, and splitting them would hide how they interact.
function useAiMixRun(options: UseAiMixRunOptions): AiMixRun {
  const { taskId, getMaterials, isAgentExecuting, onRunStart } = options;
  const { t } = useLocale();
  const notify = useNotification();
  const [runState, setRunState] = useState<AiMixRunState>(IDLE_RUN_STATE);
  // Refs, not state: a same-frame double click must see the first run.
  const activeRunRef = useRef(false);
  const runIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const dismissTimerRef = useRef<number | undefined>(undefined);

  const settleToIdle = useCallback((delayMs: number) => {
    window.clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = window.setTimeout(
      () => setRunState(IDLE_RUN_STATE),
      delayMs,
    );
  }, []);

  useEffect(() => () => {
    controllerRef.current?.abort();
    runIdRef.current += 1;
    window.clearTimeout(dismissTimerRef.current);
  }, []);

  const isRunActive = useCallback(() => activeRunRef.current, []);
  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  const start = useCallback(async (mode: AIMixingMode): Promise<void> => {
    if (activeRunRef.current) return;
    const materials = getMaterials();
    if (refuseToStart(materials, isAgentExecuting, t, notify)) return;
    activeRunRef.current = true;
    const runId = ++runIdRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    const { signal } = controller;
    const videos = materials.filter((material) =>
      material.type === 'video' && material.downloadStatus !== 'downloading');
    let stage: AiMixStage = 'analyzing';
    const show = (next: AiMixStage, warningCount = 0) =>
      setRunState({ stage: next, videoCount: videos.length, warningCount });
    const advance = (next: AiMixStage) => {
      if (signal.aborted) throw createAbortError();
      stage = next;
      show(next);
    };

    window.clearTimeout(dismissTimerRef.current);
    onRunStart();
    try {
      const result = await runAiMixStages({
        taskId, mode, materials, videos, signal, t, getMaterials, advance,
        isCurrentRun: () => runId === runIdRef.current,
      });
      show('done', result.warningCount);
      announceAiMixResult(result, t, notify);
      settleToIdle(DONE_DISMISS_MS);
    } catch (error) {
      if (runId !== runIdRef.current) return; // unmounted: nobody to tell
      show(reportRunFailure(error, { signal, stage, taskId, t, notify }));
      settleToIdle(0);
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        activeRunRef.current = false;
      }
    }
  }, [getMaterials, isAgentExecuting, notify, onRunStart, settleToIdle, t, taskId]);

  return { runState, isRunActive, start, cancel };
}

export function useAIMixedEditing(
  options: UseAIMixedEditingOptions,
): UseAIMixedEditingReturn {
  const { getMaterials, isAgentExecuting } = options;
  const { t } = useLocale();
  const notify = useNotification();
  const [isModeModalOpen, setIsModeModalOpen] = useState(false);
  const [timelineImpact, setTimelineImpact] = useState(NO_IMPACT);
  const closeModeModal = useCallback(() => setIsModeModalOpen(false), []);
  const { runState, isRunActive, start, cancel } = useAiMixRun({
    ...options,
    onRunStart: closeModeModal,
  });

  const openModeModal = useCallback(() => {
    if (refuseToStart(getMaterials(), isAgentExecuting, t, notify)) return;
    if (isRunActive()) return;
    setTimelineImpact(computeTimelineImpact(
      useTimelineStore.getState().tracks,
      t.timeline.track,
    ));
    setIsModeModalOpen(true);
  }, [getMaterials, isAgentExecuting, isRunActive, notify, t]);

  return {
    runState,
    isModeModalOpen,
    timelineImpact,
    openModeModal,
    closeModeModal,
    start,
    cancel,
  };
}
