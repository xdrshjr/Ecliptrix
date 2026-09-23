'use client';

/**
 * EditorTopBar — global actions only (spec §3.2):
 * back › project name · modified time · [backup] · save state … undo redo |
 * tasks · AI assistant · Export (always top-right, no longer part of the player).
 */

import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Download, Loader2, Redo2, RotateCcw, Sparkles, Undo2 } from './icons';
import { useLocale } from '@/contexts/LocaleContext';
import { useTimelineStore } from '../timeline/store';
import ProjectNameEditor from './ProjectNameEditor';
import SaveStatusIndicator, { type SaveStatus } from './SaveStatusIndicator';
import TaskCenterButton from './TaskCenterButton';

/** Project chrome handed down by VideoEditorContainer (spec §5.1). */
export interface EditorProjectChrome {
  projectName: string;
  updatedAt: string | null;
  saveStatus: SaveStatus;
  lastSavedAt: number | null;
  hasRecoveryBackup: boolean;
  onBack(): void;
  /** Rejects on failure; the top bar reverts the name and reports it. */
  onRenameProject(name: string): Promise<void>;
  onRenameFailed(error: unknown): void;
  /** Retry now without racing an in-flight save (RV-09). */
  onRetrySave(): void;
  onRequestRestoreBackup(): void;
  onRequestDiscardBackup(): void;
}

export interface EditorExportState {
  canExport: boolean;
  isExporting: boolean;
  progress: number;
  disabledReason?: string;
}

export interface EditorTopBarProps {
  project: EditorProjectChrome;
  isAssistantOpen: boolean;
  isAgentBusy: boolean;
  onToggleAssistant(): void;
  exportState: EditorExportState;
  onExport(): void;
}

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;

/** Relative "modified" time, mirroring the project list's formatting. */
export function formatLastUpdated(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return date.toLocaleTimeString();
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d` : date.toLocaleDateString();
}

function BackupChip({ project }: { project: EditorProjectChrome }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const pick = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <div ref={wrapRef} style={{ position: 'relative' }}
      onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}>
      <button type="button" className="ws-chip ws-chip--warn" style={{ height: 24, border: 'none', cursor: 'pointer' }}
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <RotateCcw size={12} strokeWidth={1.75} aria-hidden="true" />
        {t.workbench.topBar.backupFound}
      </button>
      {open && (
        <div role="menu" className="ws-menu" style={{ position: 'absolute', top: 30, left: 0 }}>
          <button type="button" role="menuitem" className="ws-menu-item" autoFocus
            onClick={() => pick(project.onRequestRestoreBackup)}>
            {t.videoProjects.restoreBackup}
          </button>
          <button type="button" role="menuitem" className="ws-menu-item"
            onClick={() => pick(project.onRequestDiscardBackup)}>
            {t.videoProjects.discardBackup}
          </button>
        </div>
      )}
    </div>
  );
}

function HistoryButtons() {
  const { t } = useLocale();
  const copy = t.workbench.topBar;
  const canUndo = useTimelineStore((state) => state.canUndo);
  const canRedo = useTimelineStore((state) => state.canRedo);
  const isLocked = useTimelineStore((state) => state.externalEditLock !== null || state.isInteracting);
  const lockReason = isLocked ? copy.historyLockedAgent : undefined;
  return (
    <div className="ws-topbar-group">
      <button type="button" className="ws-btn ws-btn--ghost" disabled={!canUndo || isLocked}
        title={lockReason ?? copy.undoTitle} aria-label={copy.undoTitle}
        onClick={() => useTimelineStore.getState().undo()}>
        <Undo2 {...ICON} /><span className="ws-hide-narrow">{copy.undo}</span>
      </button>
      <button type="button" className="ws-btn ws-btn--ghost" disabled={!canRedo || isLocked}
        title={lockReason ?? copy.redoTitle} aria-label={copy.redoTitle}
        onClick={() => useTimelineStore.getState().redo()}>
        <Redo2 {...ICON} /><span className="ws-hide-narrow">{copy.redo}</span>
      </button>
    </div>
  );
}

function ExportButton({ exportState, onExport }: Pick<EditorTopBarProps, 'exportState' | 'onExport'>) {
  const { t } = useLocale();
  const copy = t.workbench.topBar;
  const { canExport, isExporting, progress, disabledReason } = exportState;
  const label = isExporting
    ? copy.exporting.replace('{progress}', String(Math.round(progress)))
    : copy.exportVideo;
  return (
    <button type="button" className="ws-btn ws-btn--primary" style={{ minWidth: 112 }}
      disabled={isExporting || !canExport} aria-busy={isExporting || undefined}
      title={!canExport && !isExporting ? disabledReason : undefined}
      aria-label={!canExport && !isExporting && disabledReason ? `${copy.exportVideo} — ${disabledReason}` : label}
      onClick={onExport}>
      {isExporting ? <Loader2 {...ICON} className="animate-spin" /> : <Download {...ICON} />}
      <span className="ws-tabular">{label}</span>
    </button>
  );
}

const EditorTopBar: React.FC<EditorTopBarProps> = ({
  project, isAssistantOpen, isAgentBusy, onToggleAssistant, exportState, onExport,
}) => {
  const { t } = useLocale();
  const copy = t.workbench.topBar;
  const modified = formatLastUpdated(project.updatedAt);
  const assistantTitle = isAgentBusy ? copy.assistantBusy : copy.assistantShortcut;
  return (
    <header className="ws-topbar" aria-label={t.workbench.regions.topBar}>
      <button type="button" className="ws-btn ws-btn--ghost" onClick={project.onBack}>
        <ChevronLeft {...ICON} /><span className="ws-hide-narrow">{copy.back}</span>
      </button>
      <span className="ws-crumb-sep" aria-hidden="true">›</span>
      <ProjectNameEditor name={project.projectName} onRename={project.onRenameProject}
        onRenameFailed={project.onRenameFailed} />
      {modified && (
        <span className="ws-meta ws-hide-narrow">{copy.lastModified.replace('{time}', modified)}</span>
      )}
      {project.hasRecoveryBackup && <BackupChip project={project} />}
      <SaveStatusIndicator status={project.saveStatus} lastSavedAt={project.lastSavedAt}
        onRetry={project.onRetrySave} />
      <div style={{ flex: 1, minWidth: 8 }} />
      <HistoryButtons />
      <div className="ws-topbar-divider" aria-hidden="true" />
      <TaskCenterButton exportTask={{ isExporting: exportState.isExporting, progress: exportState.progress }} />
      <button type="button" className="ws-btn ws-btn--ghost" style={{ position: 'relative' }}
        aria-pressed={isAssistantOpen} title={assistantTitle} aria-label={assistantTitle}
        onClick={onToggleAssistant}>
        <Sparkles {...ICON} /><span className="ws-hide-narrow">{copy.assistant}</span>
        {isAgentBusy && <span className="ws-busy-dot" aria-hidden="true" />}
      </button>
      <ExportButton exportState={exportState} onExport={onExport} />
    </header>
  );
};

export default EditorTopBar;
