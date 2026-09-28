'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import VideoEditingInterface from '@/components/video/VideoEditingInterface';
import { resetVideoEditingStore } from '@/stores/videoEditingStore';
import { useNotification } from '@/contexts/NotificationContext';
import { useLocale } from '@/contexts/LocaleContext';
import { getVideoProject, updateVideoProject } from '@/lib/api/videoProjects';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import { useTimelineStore } from '@/components/video/timeline/store';
import type { Conversation, MaterialItem, VideoEditingTaskContent } from '@/types';
import { useProjectAutosave } from './hooks/useProjectAutosave';
import type { EditorProjectChrome } from '../workbench/EditorTopBar';
import {
  hydrateTimelineFromProjectData,
  restoreTimelineBackup,
  withCurrentRecoveryBackup,
  withCoverSchemaVersion,
  withoutTimelineRecoveryBackup,
  withTimelineRecoveryBackup,
  type HydrationResult,
} from './hydrateTimeline';
import { repairDerivedMaterialIdentity, repairInheritedSegmentMembership } from '../lib/derivedMaterial';

/** Convert a value that was persisted as JSON back into a `Date`. Returns
 *  `undefined` for unparseable input so callers can fall back. */
function toDate(v: unknown): Date | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v;
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

/** Re-hydrate `Date` fields inside persisted conversations. JSON-serialised
 *  ISO strings would otherwise crash UI code that calls `.toLocaleTimeString()`
 *  directly on the field. */
function rehydrateConversations(raw: unknown): Conversation[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const now = new Date();
  return raw.map((c) => {
    const conv = (c ?? {}) as Partial<Conversation> & Record<string, unknown>;
    const messages = Array.isArray(conv.messages)
      ? conv.messages.map((m) => {
          const msg = (m ?? {}) as unknown as Record<string, unknown>;
          return {
            ...msg,
            timestamp: toDate(msg.timestamp) ?? now,
          };
        })
      : [];
    return {
      ...(conv as object),
      messages,
      createdAt: toDate(conv.createdAt) ?? now,
      updatedAt: toDate(conv.updatedAt) ?? now,
    } as Conversation;
  });
}

/** Derived materials saved before ME-01 still point at their original's file;
 *  rebuild their storage identity so preview, export and delete use their own.
 *  Clips and silence-removed copies saved before N-13 also drop the script
 *  segment membership they inherited from their original. */
function repairProjectMaterials(data: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(data.materials)) return data;
  const identity = repairDerivedMaterialIdentity(data.materials as MaterialItem[]);
  const membership = repairInheritedSegmentMembership(identity.materials);
  if (identity.repairedIds.length + membership.repairedIds.length === 0) return data;
  console.info('[project] repaired derived materials', {
    identityCount: identity.repairedIds.length,
    segmentMembershipCount: membership.repairedIds.length,
  });
  return { ...data, materials: membership.materials };
}

/** The backup's save time for the restore prompt; the raw value if unparseable. */
function formatBackupDate(savedAt: string, locale: string): string {
  const date = new Date(savedAt);
  return Number.isNaN(date.getTime()) ? savedAt : date.toLocaleString(locale);
}

type BackupDialogKind = 'restore' | 'discard';

interface VideoEditorContainerProps {
  /** The persisted project ID to load and bind to. */
  projectId: string;
  /** Local task ID (Container's `Task.id`) — passed straight through to the
   *  underlying VideoEditingInterface for its task-scoped operations. */
  taskId: string;
  /** Called when the user clicks "Back to projects" — should clear the
   *  parent task's `selectedProjectId`. */
  onCloseProject: () => void;
}

/** Hydrates a saved project into the editor and wires up autosave.
 *
 *  Lifecycle on `projectId` change:
 *    1. Reset the Zustand store so prior project state cannot leak (R-F).
 *    2. Fetch the project record from the backend (touches last_opened_at).
 *    3. Hydrate local `content` from `project_data` (repairing what cannot be
 *       read, and backing up a timeline that still cannot — RV-01).
 *    4. Mount `VideoEditingInterface` with `key={projectId}` so it remounts.
 *    5. Autosave fires on every content change (R-C debounce contract).
 */
const VideoEditorContainer: React.FC<VideoEditorContainerProps> = ({
  projectId,
  taskId,
  onCloseProject,
}) => {
  const { t, locale } = useLocale();
  const { showError, showWarning, showSuccess } = useNotification();
  const [content, setContent] = useState<VideoEditingTaskContent | null>(null);
  // Kind survives closing so the dialog's exit animation keeps its text.
  const [backupDialog, setBackupDialog] = useState<{ isOpen: boolean; kind: BackupDialogKind }>(
    { isOpen: false, kind: 'restore' },
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [projectMeta, setProjectMeta] = useState<{ name: string; updatedAt: string } | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const lastShownErrorRef = useRef<string | null>(null);
  // Read by the load effect, which must not refetch the project on a locale change.
  const translationsRef = useRef(t);
  translationsRef.current = t;

  // Reset Zustand state BEFORE hydration on every project switch (R-F).
  useEffect(() => {
    resetVideoEditingStore();
  }, [projectId]);

  const announceHydration = useCallback((hydration: HydrationResult) => {
    const messages = translationsRef.current.videoProjects;
    if (hydration.status === 'repaired') {
      const count = hydration.report.clampedItemIds.length + hydration.report.droppedItemIds.length;
      showWarning(messages.timelineRepaired.replace('{count}', String(count)));
    } else if (hydration.status === 'failed') {
      showError(messages.timelineUnreadable);
    }
  }, [showError, showWarning]);

  // Fetch the project on mount / projectId change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);
    setProjectMeta(null);
    (async () => {
      try {
        const record = await getVideoProject(projectId);
        if (cancelled) return;
        setProjectMeta({ name: record.name, updatedAt: record.updated_at });
        const persisted = (record.project_data ?? {}) as Record<string, unknown>;
        // Hydrate the timeline store BEFORE setContent. setContent triggers
        // VideoEditingInterface mount → TimelinePanel mount; the panel checks
        // `tracks.length === 0` to decide whether to seed defaults. By
        // importing persisted tracks here, the default-init branch only
        // fires for fresh projects.
        const hydration = hydrateTimelineFromProjectData(persisted);
        const data = repairProjectMaterials(withTimelineRecoveryBackup(persisted, hydration));
        // Re-hydrate the lastModified date if it was persisted as ISO string.
        // Spread first so explicit overrides (Date object, default markdown)
        // win over the persisted string form.
        const lm = data.lastModified;
        const conversations = rehydrateConversations(data.conversations);
        const hydrated: VideoEditingTaskContent = {
          ...(data as Partial<VideoEditingTaskContent>),
          markdownContent: (data.markdownContent as string) ?? '',
          lastModified:
            typeof lm === 'string' && lm
              ? new Date(lm)
              : new Date(record.updated_at),
          ...(conversations !== undefined ? { conversations } : {}),
        } as VideoEditingTaskContent;
        setContent(hydrated);
        setLoading(false);
        announceHydration(hydration);
      } catch (err) {
        if (cancelled) return;
        console.error('[VideoEditorContainer] Failed to load project', err);
        const loadError = translationsRef.current.videoProjects.loadError;
        setError(loadError);
        setLoading(false);
        showError(loadError);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, showError, announceHydration]);

  const handleUpdateContent = useCallback(
    (next: VideoEditingTaskContent) => {
      // The backup field is the container's: a discard must survive an update
      // the editor built from an earlier render.
      setContent((current) => withCoverSchemaVersion(current,
        withCurrentRecoveryBackup(current, next)));
    },
    [],
  );

  // Autosave (R-C). Suppress saves while still loading.
  const autosave = useProjectAutosave(loading || error ? null : projectId, content, {
    onSaveStart: () => setSaveStatus('saving'),
    onSaveSuccess: () => {
      setSaveStatus('saved');
      setLastSavedAt(Date.now());
      // Refresh the displayed last-updated timestamp to match what the
      // backend now records. Using the local clock is acceptable since
      // updateVideoProject() set updated_at server-side at this same moment.
      setProjectMeta((prev) =>
        prev ? { ...prev, updatedAt: new Date().toISOString() } : prev,
      );
    },
    onSaveError: (err) => {
      setSaveStatus('error');
      const status = (err as { status?: number } | undefined)?.status;
      // 4xx → user-visible toast (rate-limited to avoid spam)
      if (typeof status === 'number' && status >= 400 && status < 500) {
        const key = String(status);
        if (lastShownErrorRef.current !== key) {
          lastShownErrorRef.current = key;
          showError(t.videoProjects.saveError);
        }
      }
    },
  });

  // N-07: the only way back to a timeline the hydration backed up.
  const recoveryBackup = content?.timelineRecoveryBackup;
  const closeBackupDialog = useCallback(() => {
    setBackupDialog((current) => ({ ...current, isOpen: false }));
  }, []);

  const handleRestoreBackup = useCallback(() => {
    closeBackupDialog();
    if (!recoveryBackup) return;
    // Restored as one undoable step; TimelinePanel's subscription carries the
    // new timeline into content and autosave. The backup stays until discarded.
    const outcome = restoreTimelineBackup(() => useTimelineStore.getState(), recoveryBackup);
    if (outcome.kind === 'edit-locked') {
      showWarning(t.timeline.messages.editLockedByAgent);
    } else if (outcome.kind === 'unreadable') {
      showError(t.videoProjects.backupUnreadable);
    } else {
      const messages = t.videoProjects;
      showSuccess(outcome.skippedCount > 0
        ? messages.backupRestored.replace('{count}', String(outcome.skippedCount))
        : messages.backupRestoredAll);
    }
  }, [closeBackupDialog, recoveryBackup, showError, showSuccess, showWarning, t]);

  const handleDiscardBackup = useCallback(() => {
    closeBackupDialog();
    setContent((current) => (current ? withoutTimelineRecoveryBackup(current) : current));
  }, [closeBackupDialog]);

  // In-place rename from the editor top bar: the same API the project list
  // uses. Autosave only sends `project_data`, so the two never overwrite
  // each other (RV-10).
  const openProjectIdRef = useRef(projectId);
  openProjectIdRef.current = projectId;
  const handleRenameProject = useCallback(async (name: string) => {
    await updateVideoProject(projectId, { name });
    // A rename that lands after switching projects must not relabel the new one.
    if (openProjectIdRef.current !== projectId) return;
    setProjectMeta((prev) => (prev ? { name, updatedAt: new Date().toISOString() } : prev));
  }, [projectId]);

  const handleRenameFailed = useCallback((err: unknown) => {
    console.error('[VideoEditorContainer] Failed to rename project', { projectId, err });
    showError(t.workbench.topBar.renameFailed);
  }, [projectId, showError, t]);

  const projectChrome: EditorProjectChrome = {
    projectName: projectMeta?.name ?? '',
    updatedAt: projectMeta?.updatedAt ?? null,
    saveStatus,
    lastSavedAt,
    hasRecoveryBackup: !!recoveryBackup,
    onBack: onCloseProject,
    onRenameProject: handleRenameProject,
    onRenameFailed: handleRenameFailed,
    onRetrySave: autosave.retryNow,
    onRequestRestoreBackup: () => setBackupDialog({ isOpen: true, kind: 'restore' }),
    onRequestDiscardBackup: () => setBackupDialog({ isOpen: true, kind: 'discard' }),
  };

  // Render
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground animate-pulse">…</div>
      </div>
    );
  }

  if (error || !content) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-background">
        <p className="text-sm text-muted-foreground">{error}</p>
        <button
          type="button"
          onClick={onCloseProject}
          className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90"
        >
          {t.videoProjects.backToProjects}
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <VideoEditingInterface
        key={projectId}
        projectId={projectId}
        taskId={taskId}
        content={content}
        onUpdateContent={handleUpdateContent}
        projectChrome={projectChrome}
      />

      <ConfirmationDialog
        isOpen={backupDialog.isOpen && !!recoveryBackup}
        title={backupDialog.kind === 'discard'
          ? t.videoProjects.discardBackup
          : t.videoProjects.restoreBackupConfirmTitle}
        message={backupDialog.kind === 'discard'
          ? t.videoProjects.discardBackupConfirmBody
          : t.videoProjects.restoreBackupConfirmBody
            .replace('{date}', formatBackupDate(recoveryBackup?.savedAt ?? '', locale))}
        confirmText={backupDialog.kind === 'discard' ? t.videoProjects.discardBackup : t.videoProjects.restoreBackup}
        cancelText={t.common.cancel}
        type={backupDialog.kind === 'discard' ? 'danger' : 'warning'}
        onConfirm={backupDialog.kind === 'discard' ? handleDiscardBackup : handleRestoreBackup}
        onCancel={closeBackupDialog}
      />
    </div>
  );
};

export default VideoEditorContainer;
