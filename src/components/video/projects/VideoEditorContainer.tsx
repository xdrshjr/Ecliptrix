'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import VideoEditingInterface from '@/components/video/VideoEditingInterface';
import { resetVideoEditingStore } from '@/stores/videoEditingStore';
import { useNotification } from '@/contexts/NotificationContext';
import { useLocale } from '@/contexts/LocaleContext';
import { getVideoProject } from '@/lib/api/videoProjects';
import type { Conversation, MaterialItem, VideoEditingTaskContent } from '@/types';
import { useProjectAutosave } from './hooks/useProjectAutosave';
import {
  hydrateTimelineFromProjectData,
  withTimelineRecoveryBackup,
  type HydrationResult,
} from './hydrateTimeline';
import { repairDerivedMaterialIdentity } from '../lib/derivedMaterial';

/** Render a project's `updated_at` ISO string for the editor top strip.
 *  Mirrors ProjectCard's relative formatting so list ↔ editor agree. */
function formatLastUpdated(iso: string | undefined, fallback: string): string {
  if (!iso) return fallback;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return fallback;
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return date.toLocaleTimeString();
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return date.toLocaleDateString();
}

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
 *  rebuild their storage identity so preview, export and delete use their own. */
function repairProjectMaterials(data: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(data.materials)) return data;
  const { materials, repairedIds } = repairDerivedMaterialIdentity(data.materials as MaterialItem[]);
  if (repairedIds.length === 0) return data;
  console.info('[project] repaired derived material identity', { count: repairedIds.length });
  return { ...data, materials };
}

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
  const { t } = useLocale();
  const { showError, showWarning } = useNotification();
  const [content, setContent] = useState<VideoEditingTaskContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [projectMeta, setProjectMeta] = useState<{ name: string; updatedAt: string } | null>(null);
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
      setContent(next);
    },
    [],
  );

  // Autosave (R-C). Suppress saves while still loading.
  useProjectAutosave(loading || error ? null : projectId, content, {
    onSaveStart: () => setSaveStatus('saving'),
    onSaveSuccess: () => {
      setSaveStatus('saved');
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
      {/* Top strip: Back to projects + project meta + save status.
          Uses bg-background + border so it picks up both light/dark themes
          uniformly (was bg-muted/20, which had insufficient contrast). */}
      <div className="flex items-center gap-3 px-4 h-9 border-b border-border bg-background flex-shrink-0">
        <button
          type="button"
          onClick={onCloseProject}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {t.videoProjects.backToProjects}
        </button>
        {projectMeta && (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-xs font-medium text-foreground truncate">
              {projectMeta.name || t.videoProjects.untitled}
            </span>
            <span className="text-xs text-muted-foreground/70 truncate flex-shrink-0">
              · {t.videoProjects.lastUpdated}:{' '}
              {formatLastUpdated(projectMeta.updatedAt, t.videoProjects.neverOpened)}
            </span>
          </div>
        )}
        <div className="text-xs text-muted-foreground flex-shrink-0" aria-live="polite">
          {saveStatus === 'saving' && t.videoProjects.saving}
          {saveStatus === 'saved' && t.videoProjects.saved}
          {saveStatus === 'error' && t.videoProjects.saveError}
        </div>
      </div>

      <VideoEditingInterface
        key={projectId}
        projectId={projectId}
        taskId={taskId}
        content={content}
        onUpdateContent={handleUpdateContent}
      />
    </div>
  );
};

export default VideoEditorContainer;
