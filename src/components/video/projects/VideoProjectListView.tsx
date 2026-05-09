'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import {
  createVideoProject,
  createVideoProjectCategory,
  deleteVideoProject,
  deleteVideoProjectCategory,
  listVideoProjectCategories,
  listVideoProjects,
  updateVideoProject,
  updateVideoProjectCategory,
} from '@/lib/api/videoProjects';
import type {
  MaterialItem,
  VideoProjectCategory,
  VideoProjectListItem,
} from '@/types';
import ProjectSidebar, { type SidebarSelection } from './ProjectSidebar';
import ProjectCard from './ProjectCard';
import ProjectFormDialog, { type ProjectFormValues } from './ProjectFormDialog';
import CategoryFormDialog, { type CategoryFormValues } from './CategoryFormDialog';

type SortKey = 'recent' | 'created' | 'name';

interface VideoProjectListViewProps {
  /** Called when the user opens a project — typically wires through to
   *  a parent that sets `Task.selectedProjectId`. */
  onOpenProject: (projectId: string) => void;
  /** Inbound timeline payload from the Workflow tab. When non-empty, the
   *  view auto-creates an "Untitled" project containing the payload, calls
   *  `onConsumeIncoming()`, and opens the new project. */
  incomingTimeline?: unknown;
  incomingMaterials?: MaterialItem[];
  onConsumeIncoming?: () => void;
}

const VideoProjectListView: React.FC<VideoProjectListViewProps> = ({
  onOpenProject,
  incomingTimeline,
  incomingMaterials,
  onConsumeIncoming,
}) => {
  const { t } = useLocale();
  const { showError, showSuccess } = useNotification();

  // ── server data ─────────────────────────────────────────────────────────
  const [categories, setCategories] = useState<VideoProjectCategory[]>([]);
  const [projects, setProjects] = useState<VideoProjectListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // ── filter state ───────────────────────────────────────────────────────
  const [selection, setSelection] = useState<SidebarSelection>({ kind: 'recent' });
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');

  // ── dialog state ───────────────────────────────────────────────────────
  const [projectDialog, setProjectDialog] = useState<
    | { mode: 'create' | 'edit'; initial?: Partial<ProjectFormValues>; targetId?: string }
    | null
  >(null);
  const [categoryDialog, setCategoryDialog] = useState<
    | { mode: 'create' | 'edit'; initial?: Partial<VideoProjectCategory>; targetId?: string }
    | null
  >(null);
  const [confirmation, setConfirmation] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // Fetch categories
  const fetchCategories = useCallback(async () => {
    try {
      const cats = await listVideoProjectCategories();
      setCategories(cats);
    } catch (err) {
      console.error('[VideoProjectListView] Failed to load categories', err);
    }
  }, []);

  // Fetch projects (driven by selection / search / sort)
  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const params: {
        category_id?: string;
        search?: string;
        sort: SortKey;
      } = { sort };
      if (selection.kind === 'category') params.category_id = selection.id;
      else if (selection.kind === 'uncategorized')
        params.category_id = '__uncategorized__';
      if (search.trim()) params.search = search.trim();

      const res = await listVideoProjects(params);
      setProjects(res.items);
      setTotal(res.total);
    } catch (err) {
      console.error('[VideoProjectListView] Failed to load projects', err);
      showError(t.videoProjects.loadError);
    } finally {
      setLoading(false);
    }
  }, [selection, search, sort, showError, t.videoProjects.loadError]);

  // Initial load + refetch on filter change
  useEffect(() => {
    void fetchCategories();
  }, [fetchCategories]);
  useEffect(() => {
    // Debounce search input lightly (300ms) to avoid hammering the BFF.
    const handle = setTimeout(() => {
      void fetchProjects();
    }, search.trim() ? 300 : 0);
    return () => clearTimeout(handle);
  }, [fetchProjects, search]);

  // ── inbound handoff (R-A) ──────────────────────────────────────────────
  // When Workflow → Video sends pendingTimelineData, auto-create a project.
  // Use a ref to ensure we only fire once even if React re-renders.
  const handoffConsumedRef = useRef(false);
  useEffect(() => {
    if (handoffConsumedRef.current) return;
    if (!incomingTimeline && (!incomingMaterials || incomingMaterials.length === 0)) {
      return;
    }
    handoffConsumedRef.current = true;
    (async () => {
      try {
        const stamp = new Date();
        const niceDate = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')} ${String(stamp.getHours()).padStart(2, '0')}:${String(stamp.getMinutes()).padStart(2, '0')}`;
        const payload: Record<string, unknown> = {
          markdownContent: '',
          lastModified: stamp.toISOString(),
        };
        if (incomingTimeline) payload.pendingTimelineData = incomingTimeline;
        if (incomingMaterials && incomingMaterials.length > 0)
          payload.pendingMaterials = incomingMaterials;

        const created = await createVideoProject({
          name: `${t.videoProjects.untitled} — ${niceDate}`,
          project_data: payload,
        });
        // Consume the inbound payload so parent doesn't auto-create again
        onConsumeIncoming?.();
        onOpenProject(created.id);
      } catch (err) {
        handoffConsumedRef.current = false; // allow retry
        console.error('[VideoProjectListView] Auto-create from handoff failed', err);
        showError(t.videoProjects.saveError);
      }
    })();
  }, [
    incomingTimeline,
    incomingMaterials,
    onConsumeIncoming,
    onOpenProject,
    showError,
    t.videoProjects,
  ]);

  // ── handlers ────────────────────────────────────────────────────────────

  const handleCreateProject = async (values: ProjectFormValues) => {
    try {
      const created = await createVideoProject({
        name: values.name,
        description: values.description,
        category_id: values.category_id || undefined,
      });
      setProjectDialog(null);
      showSuccess(t.videoProjects.saved);
      onOpenProject(created.id);
    } catch (err) {
      console.error('[VideoProjectListView] Create project failed', err);
      showError(t.videoProjects.saveError);
    }
  };

  const handleRenameProject = async (
    projectId: string,
    values: ProjectFormValues,
  ) => {
    try {
      await updateVideoProject(projectId, {
        name: values.name,
        description: values.description,
        category_id: values.category_id ?? null,
      });
      setProjectDialog(null);
      showSuccess(t.videoProjects.saved);
      void fetchProjects();
    } catch (err) {
      console.error('[VideoProjectListView] Rename project failed', err);
      showError(t.videoProjects.saveError);
    }
  };

  const handleDeleteProject = (project: VideoProjectListItem) => {
    const TRUNCATE_AT = 60;
    const rawName = project.name?.trim() || t.videoProjects.untitled;
    const safeName = rawName.length > TRUNCATE_AT ? rawName.slice(0, TRUNCATE_AT) + '…' : rawName;
    // split/join replaces ALL occurrences of {name} (defensive against
    // translators duplicating the placeholder in the template).
    const interpolate = (template: string) => template.split('{name}').join(safeName);
    setConfirmation({
      title: interpolate(t.videoProjects.deleteConfirmTitle),
      message: interpolate(t.videoProjects.deleteConfirm),
      onConfirm: async () => {
        try {
          await deleteVideoProject(project.id);
          setConfirmation(null);
          void fetchProjects();
        } catch (err) {
          console.error('[VideoProjectListView] Delete project failed', err);
          showError(t.videoProjects.saveError);
        }
      },
    });
  };

  const handleCreateCategory = async (values: CategoryFormValues) => {
    try {
      await createVideoProjectCategory({ name: values.name });
      setCategoryDialog(null);
      void fetchCategories();
    } catch (err) {
      console.error('[VideoProjectListView] Create category failed', err);
      showError(t.videoProjects.saveError);
    }
  };

  const handleRenameCategory = async (
    categoryId: string,
    values: CategoryFormValues,
  ) => {
    try {
      await updateVideoProjectCategory(categoryId, { name: values.name });
      setCategoryDialog(null);
      void fetchCategories();
    } catch (err) {
      console.error('[VideoProjectListView] Rename category failed', err);
      showError(t.videoProjects.saveError);
    }
  };

  const handleDeleteCategory = (category: VideoProjectCategory) => {
    setConfirmation({
      title: t.videoProjects.delete,
      message: t.videoProjects.deleteCategoryConfirm,
      onConfirm: async () => {
        try {
          await deleteVideoProjectCategory(category.id);
          setConfirmation(null);
          // If we were filtering by this category, fall back to "All"
          setSelection((s) =>
            s.kind === 'category' && s.id === category.id ? { kind: 'all' } : s,
          );
          void fetchCategories();
          void fetchProjects();
        } catch (err) {
          console.error('[VideoProjectListView] Delete category failed', err);
          showError(t.videoProjects.saveError);
        }
      },
    });
  };

  // ── render ──────────────────────────────────────────────────────────────

  const headingLabel = useMemo(() => {
    if (selection.kind === 'all') return t.videoProjects.all;
    if (selection.kind === 'recent') return t.videoProjects.recent;
    if (selection.kind === 'uncategorized') return t.videoProjects.uncategorized;
    const cat = categories.find((c) => c.id === selection.id);
    return cat?.name ?? t.videoProjects.cardsHeading;
  }, [selection, categories, t.videoProjects]);

  return (
    <div className="flex-1 flex h-full min-h-0 bg-background">
      {/* Sidebar (~30%) */}
      <div className="w-[30%] min-w-[240px] max-w-[360px] flex-shrink-0">
        <ProjectSidebar
          categories={categories}
          selection={selection}
          onSelect={setSelection}
          onCreateCategory={() => setCategoryDialog({ mode: 'create' })}
          onEditCategory={(c) =>
            setCategoryDialog({ mode: 'edit', initial: c, targetId: c.id })
          }
          onDeleteCategory={handleDeleteCategory}
          totalCount={total}
        />
      </div>

      {/* Right side (~70%) */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
          <h1 className="text-lg font-semibold text-foreground">{headingLabel}</h1>
          <div className="flex-1" />
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.videoProjects.searchPlaceholder}
              className="w-64 pl-9 pr-3 py-1.5 text-sm bg-muted/40 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
            </svg>
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="px-3 py-1.5 text-sm bg-muted/40 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="recent">{t.videoProjects.sortRecent}</option>
            <option value="created">{t.videoProjects.sortCreated}</option>
            <option value="name">{t.videoProjects.sortName}</option>
          </select>
          <button
            type="button"
            onClick={() => setProjectDialog({ mode: 'create' })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            {t.videoProjects.newProject}
          </button>
        </div>

        {/* Cards */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-card border border-border rounded-md overflow-hidden animate-pulse"
                >
                  <div className="aspect-video bg-muted" />
                  <div className="px-3 py-2.5 space-y-2">
                    <div className="h-3 w-3/4 bg-muted rounded" />
                    <div className="h-2 w-1/2 bg-muted/70 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-sm">
                <div className="w-16 h-16 mx-auto mb-4 rounded-md bg-primary/10 flex items-center justify-center">
                  <svg className="w-8 h-8 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-foreground mb-2">
                  {search.trim()
                    ? t.videoProjects.noResults
                    : t.videoProjects.emptyTitle}
                </h3>
                {!search.trim() && (
                  <>
                    <p className="text-sm text-muted-foreground mb-4">
                      {t.videoProjects.emptyHint}
                    </p>
                    <button
                      type="button"
                      onClick={() => setProjectDialog({ mode: 'create' })}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:opacity-90"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      {t.videoProjects.newProject}
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {projects.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  onOpen={() => onOpenProject(p.id)}
                  onRename={() =>
                    setProjectDialog({
                      mode: 'edit',
                      targetId: p.id,
                      initial: {
                        name: p.name,
                        description: p.description ?? '',
                        category_id: p.category_id ?? null,
                      },
                    })
                  }
                  onDelete={() => handleDeleteProject(p)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <ProjectFormDialog
        isOpen={projectDialog !== null}
        mode={projectDialog?.mode ?? 'create'}
        initial={projectDialog?.initial ?? null}
        categories={categories}
        onSubmit={async (values) => {
          if (projectDialog?.mode === 'edit' && projectDialog.targetId) {
            await handleRenameProject(projectDialog.targetId, values);
          } else {
            await handleCreateProject(values);
          }
        }}
        onCancel={() => setProjectDialog(null)}
      />
      <CategoryFormDialog
        isOpen={categoryDialog !== null}
        mode={categoryDialog?.mode ?? 'create'}
        initial={categoryDialog?.initial ?? null}
        onSubmit={async (values) => {
          if (categoryDialog?.mode === 'edit' && categoryDialog.targetId) {
            await handleRenameCategory(categoryDialog.targetId, values);
          } else {
            await handleCreateCategory(values);
          }
        }}
        onCancel={() => setCategoryDialog(null)}
      />
      <ConfirmationDialog
        isOpen={confirmation !== null}
        title={confirmation?.title ?? ''}
        message={confirmation?.message ?? ''}
        confirmText={t.videoProjects.delete}
        cancelText={t.videoProjects.cancel}
        type="danger"
        onConfirm={() => confirmation?.onConfirm()}
        onCancel={() => setConfirmation(null)}
      />
    </div>
  );
};

export default VideoProjectListView;
