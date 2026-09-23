/**
 * collectActiveTasks — the task centre's single view over three read-only
 * sources (spec §3.2, RV-03). Only the Agent registers into `asyncTaskSlice`;
 * ScriptPanel's per-segment TTS and the export session live elsewhere, so the
 * top-bar count would read "0" while the user waits on them without this merge.
 *
 * Pure: no store access, no i18n. The button formats the rows.
 */

import { sanitizeErrorMessage } from '@/lib/sanitizeError';
import type {
  AsyncTask, AsyncTaskStatus, AsyncTaskType,
} from '@/stores/slices/asyncTaskSlice';
import type { SegmentIndexEntry } from '../lib/segments/segmentLinks';

const ERROR_MAX_CHARS = 120;

export type TaskRowKind = AsyncTaskType | 'segment_voice' | 'export';

export interface TaskRow {
  id: string;
  kind: TaskRowKind;
  status: AsyncTaskStatus;
  /** 0–100, or null when the source reports no progress (indeterminate). */
  progress: number | null;
  /** Sanitised one-line reason, only for failed tasks. */
  error: string | null;
  /** 1-based segment ordinal for `segment_voice`; null when unknown. */
  segmentOrdinal: number | null;
  /** Segment of a `segment_voice` row (retry target, R2 §3.4.4). */
  segmentId?: string;
}

export interface ExportTaskState {
  isExporting: boolean;
  progress: number;
}

export interface CollectActiveTasksInput {
  tasks: Readonly<Record<string, AsyncTask>>;
  convertingSegmentIds: ReadonlySet<string>;
  segmentIndex: ReadonlyMap<string, SegmentIndexEntry>;
  exportTask: ExportTaskState;
  /** Per-segment voice progress 0–100 (R2 §3.4.3-6); absent → indeterminate. */
  segmentVoiceProgress?: ReadonlyMap<string, number>;
  /** Per-segment voice failures kept for the session (R2 §3.4.4). */
  segmentVoiceErrors?: ReadonlyMap<string, string>;
}

export interface ActiveTaskSummary {
  /** Drives the "任务 {count}" badge: running work only. */
  activeCount: number;
  active: TaskRow[];
  /** Completed / failed Agent tasks the slice still holds (≤ 30 min). */
  recent: TaskRow[];
}

function isActiveStatus(status: AsyncTaskStatus): boolean {
  return status === 'pending' || status === 'processing';
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** First line only, stripped of stack/driver noise, capped for the popover. */
export function sanitizeTaskError(raw: string | null): string | null {
  if (!raw) return null;
  const firstLine = raw.split(/\r?\n/, 1)[0].trim();
  const safe = sanitizeErrorMessage(firstLine.slice(0, ERROR_MAX_CHARS), '');
  return safe || null;
}

function agentRow(task: AsyncTask): TaskRow {
  return {
    id: `agent:${task.taskId}`,
    kind: task.type,
    status: task.status,
    progress: clampProgress(task.progress),
    error: task.status === 'failed' ? sanitizeTaskError(task.error) : null,
    segmentOrdinal: null,
  };
}

function bySegmentOrder(rows: TaskRow[]): TaskRow[] {
  const order = (row: TaskRow) =>
    row.segmentOrdinal ?? Number.MAX_SAFE_INTEGER;
  return rows.sort((a, b) => order(a) - order(b));
}

function segmentVoiceRows(
  ids: ReadonlySet<string>,
  segmentIndex: ReadonlyMap<string, SegmentIndexEntry>,
  progress?: ReadonlyMap<string, number>,
): TaskRow[] {
  const rows: TaskRow[] = [];
  ids.forEach((segmentId) => {
    const value = progress?.get(segmentId);
    rows.push({
      id: `segment-voice:${segmentId}`,
      kind: 'segment_voice',
      status: 'processing',
      progress: value === undefined ? null : clampProgress(value),
      error: null,
      segmentOrdinal: segmentIndex.get(segmentId)?.ordinal ?? null,
      segmentId,
    });
  });
  return bySegmentOrder(rows);
}

/** Failed per-segment voice-overs, with the reason and a retry target. */
function failedSegmentVoiceRows(
  errors: ReadonlyMap<string, string> | undefined,
  converting: ReadonlySet<string>,
  segmentIndex: ReadonlyMap<string, SegmentIndexEntry>,
): TaskRow[] {
  const rows: TaskRow[] = [];
  errors?.forEach((message, segmentId) => {
    if (converting.has(segmentId) || !segmentIndex.has(segmentId)) return;
    rows.push({
      id: `segment-voice-failed:${segmentId}`,
      kind: 'segment_voice',
      status: 'failed',
      progress: null,
      error: sanitizeTaskError(message),
      segmentOrdinal: segmentIndex.get(segmentId)?.ordinal ?? null,
      segmentId,
    });
  });
  return bySegmentOrder(rows);
}

export function collectActiveTasks(
  input: CollectActiveTasksInput,
): ActiveTaskSummary {
  const agentTasks = Object.values(input.tasks)
    .sort((a, b) => a.createdAt - b.createdAt);
  const active: TaskRow[] = [];
  if (input.exportTask.isExporting) {
    active.push({
      id: 'export', kind: 'export', status: 'processing',
      progress: clampProgress(input.exportTask.progress),
      error: null, segmentOrdinal: null,
    });
  }
  active.push(
    ...segmentVoiceRows(input.convertingSegmentIds, input.segmentIndex, input.segmentVoiceProgress),
    ...agentTasks.filter((task) => isActiveStatus(task.status)).map(agentRow),
  );
  const recent = [
    ...failedSegmentVoiceRows(input.segmentVoiceErrors, input.convertingSegmentIds, input.segmentIndex),
    ...agentTasks
      .filter((task) => !isActiveStatus(task.status))
      .reverse()
      .map(agentRow),
  ];
  return { activeCount: active.length, active, recent };
}
