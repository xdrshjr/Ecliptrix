'use client';

/**
 * TaskCenterButton — top-bar「任务」entry (spec §3.2, RV-03).
 *
 * Read-only: it merges Agent tasks, ScriptPanel's per-segment voice-overs and
 * the export session through `collectActiveTasks` and lists them. There is no
 * cancel here on purpose — existing cancel buttons stay where the task was
 * started, and the popover says so.
 */

import React, {
  useCallback, useEffect, useId, useMemo, useRef, useState,
} from 'react';
import { Loader2 } from './icons';
import { useLocale } from '@/contexts/LocaleContext';
import { useVideoEditingStore } from '@/stores/videoEditingStore';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import { useSegmentLinksValue } from '../lib/segments/SegmentLinksContext';
import {
  collectActiveTasks,
  type ExportTaskState,
  type TaskRow,
} from './collectActiveTasks';

export interface TaskCenterButtonProps {
  exportTask: ExportTaskState;
}

type TaskCenterCopy =
  ReturnType<typeof useLocale>['t']['workbench']['taskCenter'];

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;

/** Idle glyph (lucide "list-checks"); the shared icon set has none. */
function ListChecksIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" focusable="false"
      data-icon="list">
      <path d="m3 17 2 2 4-4" /><path d="m3 7 2 2 4-4" />
      <path d="M13 6h8" /><path d="M13 12h8" /><path d="M13 18h8" />
    </svg>
  );
}

function statusText(row: TaskRow, copy: TaskCenterCopy): string {
  switch (row.status) {
    case 'pending': return copy.statusPending;
    case 'processing': return copy.statusProcessing;
    case 'completed': return copy.statusCompleted;
    default: return copy.statusFailed;
  }
}

function rowName(row: TaskRow, copy: TaskCenterCopy): string {
  if (row.kind === 'export') return copy.exportTask;
  if (row.kind === 'segment_voice') {
    const ordinal = String(row.segmentOrdinal ?? '?');
    return copy.segmentVoice.replace('{index}', ordinal);
  }
  return copy.types[row.kind];
}

function TaskRowView({ row, copy }: { row: TaskRow; copy: TaskCenterCopy }) {
  const name = rowName(row, copy);
  const isFailed = row.status === 'failed';
  return (
    <li className="ws-task-row" data-status={row.status}>
      <div className="ws-task-row-head">
        <span className="ws-task-name">{name}</span>
        <span className="ws-task-status ws-tabular">
          {statusText(row, copy)}
          {row.progress !== null && !isFailed ? ` ${row.progress}%` : ''}
        </span>
      </div>
      {!isFailed && (
        <div
          className="ws-task-progress"
          role="progressbar"
          aria-label={name}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={row.progress ?? undefined}
          data-indeterminate={row.progress === null || undefined}
        >
          <span style={{ width: `${row.progress ?? 100}%` }} />
        </div>
      )}
      {isFailed && (
        <p className="ws-task-error">{row.error ?? copy.statusFailed}</p>
      )}
    </li>
  );
}

/** Pointer-down outside the button + popover closes it. */
function usePopoverDismiss(
  isOpen: boolean,
  close: () => void,
  rootRef: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen, close, rootRef]);
}

const TaskCenterButton: React.FC<TaskCenterButtonProps> = ({ exportTask }) => {
  const { t } = useLocale();
  const copy = t.workbench.taskCenter;
  const tasks = useVideoEditingStore((state) => state.tasks);
  const convertingSegmentIds = useEditorFocusStore(
    (state) => state.convertingSegmentIds,
  );
  const { segmentIndex } = useSegmentLinksValue();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const { isExporting, progress } = exportTask;
  const summary = useMemo(() => collectActiveTasks({
    tasks, convertingSegmentIds, segmentIndex,
    exportTask: { isExporting, progress },
  }), [tasks, convertingSegmentIds, segmentIndex, isExporting, progress]);
  const close = useCallback(() => setIsOpen(false), []);
  usePopoverDismiss(isOpen, close, rootRef);

  const label = summary.activeCount > 0
    ? copy.buttonCount.replace('{count}', String(summary.activeCount))
    : copy.button;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !isOpen) return;
    event.stopPropagation();
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="ws-task-center" onKeyDown={handleKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="ws-btn ws-btn--ghost"
        aria-expanded={isOpen}
        aria-controls={isOpen ? popoverId : undefined}
        aria-haspopup="dialog"
        title={copy.title}
        onClick={() => setIsOpen((open) => !open)}
      >
        {summary.activeCount > 0
          ? <Loader2 {...ICON} className="animate-spin" />
          : <ListChecksIcon />}
        <span className="ws-tabular">{label}</span>
      </button>
      {isOpen && (
        <div id={popoverId} className="ws-menu ws-task-popover"
          role="dialog" aria-label={copy.title}>
          <div className="ws-task-title">{copy.title}</div>
          {summary.active.length === 0 && (
            <p className="ws-menu-note">{copy.empty}</p>
          )}
          {summary.active.length > 0 && (
            <ul className="ws-task-list">
              {summary.active.map((row) => (
                <TaskRowView key={row.id} row={row} copy={copy} />
              ))}
            </ul>
          )}
          {summary.recent.length > 0 && (
            <>
              <div className="ws-menu-sep" />
              <div className="ws-task-title">{copy.recent}</div>
              <ul className="ws-task-list">
                {summary.recent.map((row) => (
                  <TaskRowView key={row.id} row={row} copy={copy} />
                ))}
              </ul>
            </>
          )}
          <div className="ws-menu-sep" />
          <p className="ws-menu-note">{copy.displayOnlyNote}</p>
        </div>
      )}
    </div>
  );
};

export default TaskCenterButton;
