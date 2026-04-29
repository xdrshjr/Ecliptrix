'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import VideoEditingInterface from '@/components/video/VideoEditingInterface';
import { resetVideoEditingStore } from '@/stores/videoEditingStore';
import { useNotification } from '@/contexts/NotificationContext';
import { useLocale } from '@/contexts/LocaleContext';
import { getVideoProject } from '@/lib/api/videoProjects';
import type { VideoEditingTaskContent } from '@/types';
import { useProjectAutosave } from './hooks/useProjectAutosave';

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
 *    3. Hydrate local `content` from `project_data`.
 *    4. Mount `VideoEditingInterface` with `key={projectId}` so it remounts.
 *    5. Autosave fires on every content change (R-C debounce contract).
 */
const VideoEditorContainer: React.FC<VideoEditorContainerProps> = ({
  projectId,
  taskId,
  onCloseProject,
}) => {
  const { t } = useLocale();
  const { showError } = useNotification();
  const [content, setContent] = useState<VideoEditingTaskContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const lastShownErrorRef = useRef<string | null>(null);

  // Reset Zustand state BEFORE hydration on every project switch (R-F).
  useEffect(() => {
    resetVideoEditingStore();
  }, [projectId]);

  // Fetch the project on mount / projectId change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);
    (async () => {
      try {
        const record = await getVideoProject(projectId);
        if (cancelled) return;
        const data = (record.project_data ?? {}) as Record<string, unknown>;
        // Re-hydrate the lastModified date if it was persisted as ISO string.
        // Spread first so explicit overrides (Date object, default markdown)
        // win over the persisted string form.
        const lm = data.lastModified;
        const hydrated: VideoEditingTaskContent = {
          ...(data as Partial<VideoEditingTaskContent>),
          markdownContent: (data.markdownContent as string) ?? '',
          lastModified:
            typeof lm === 'string' && lm
              ? new Date(lm)
              : new Date(record.updated_at),
        } as VideoEditingTaskContent;
        setContent(hydrated);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error('[VideoEditorContainer] Failed to load project', err);
        setError(t.videoProjects.loadError);
        setLoading(false);
        showError(t.videoProjects.loadError);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, showError, t.videoProjects.loadError]);

  const handleUpdateContent = useCallback(
    (next: VideoEditingTaskContent) => {
      setContent(next);
    },
    [],
  );

  // Autosave (R-C). Suppress saves while still loading.
  useProjectAutosave(loading || error ? null : projectId, content, {
    onSaveStart: () => setSaveStatus('saving'),
    onSaveSuccess: () => setSaveStatus('saved'),
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
      {/* Top strip: Back to projects + save status */}
      <div className="flex items-center justify-between px-4 h-9 border-b border-border bg-muted/20 flex-shrink-0">
        <button
          type="button"
          onClick={onCloseProject}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {t.videoProjects.backToProjects}
        </button>
        <div className="text-xs text-muted-foreground" aria-live="polite">
          {saveStatus === 'saving' && t.videoProjects.saving}
          {saveStatus === 'saved' && t.videoProjects.saved}
          {saveStatus === 'error' && t.videoProjects.saveError}
        </div>
      </div>

      <VideoEditingInterface
        key={projectId}
        taskId={taskId}
        content={content}
        onUpdateContent={handleUpdateContent}
      />
    </div>
  );
};

export default VideoEditorContainer;
