'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { VideoProjectCategory } from '@/types';

export type SidebarSelection =
  | { kind: 'all' }
  | { kind: 'recent' }
  | { kind: 'uncategorized' }
  | { kind: 'category'; id: string };

interface ProjectSidebarProps {
  categories: VideoProjectCategory[];
  selection: SidebarSelection;
  onSelect: (next: SidebarSelection) => void;
  onCreateCategory: () => void;
  onEditCategory: (cat: VideoProjectCategory) => void;
  onDeleteCategory: (cat: VideoProjectCategory) => void;
  totalCount: number;
}

function isSelected(a: SidebarSelection, b: SidebarSelection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'category' && b.kind === 'category') return a.id === b.id;
  return true;
}

const SidebarRow: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
  trailing?: React.ReactNode;
}> = ({ active, onClick, icon, label, count, trailing }) => (
  <div
    onClick={onClick}
    className={`group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-sm transition-colors ${
      active
        ? 'bg-accent text-foreground'
        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
    }`}
  >
    <div className="w-4 h-4 flex-shrink-0 text-muted-foreground">{icon}</div>
    <span className="flex-1 truncate">{label}</span>
    {count !== undefined && count > 0 && (
      <span className="text-xs text-muted-foreground/80">{count}</span>
    )}
    {trailing}
  </div>
);

const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  categories,
  selection,
  onSelect,
  onCreateCategory,
  onEditCategory,
  onDeleteCategory,
  totalCount,
}) => {
  const { t } = useLocale();

  return (
    <aside className="h-full flex flex-col bg-muted/30 border-r border-border">
      <div className="px-4 pt-5 pb-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground tracking-wide">
          {t.videoProjects.sidebarHeading}
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t.videoProjects.projectCount.replace('{count}', String(totalCount))}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        <div className="space-y-0.5">
          <SidebarRow
            active={isSelected(selection, { kind: 'recent' })}
            onClick={() => onSelect({ kind: 'recent' })}
            label={t.videoProjects.recent}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <SidebarRow
            active={isSelected(selection, { kind: 'all' })}
            onClick={() => onSelect({ kind: 'all' })}
            label={t.videoProjects.all}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            }
          />
          <SidebarRow
            active={isSelected(selection, { kind: 'uncategorized' })}
            onClick={() => onSelect({ kind: 'uncategorized' })}
            label={t.videoProjects.uncategorized}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M3 12h18M3 17h18" strokeDasharray="2 3" />
              </svg>
            }
          />
        </div>

        <div>
          <div className="flex items-center justify-between px-3 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t.videoProjects.categories}
            </span>
            <button
              onClick={onCreateCategory}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title={t.videoProjects.newCategory}
              aria-label={t.videoProjects.newCategory}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
          <div className="space-y-0.5">
            {categories.map((c) => (
              <SidebarRow
                key={c.id}
                active={
                  selection.kind === 'category' && selection.id === c.id
                }
                onClick={() => onSelect({ kind: 'category', id: c.id })}
                label={c.name}
                icon={
                  <span
                    className="block w-2.5 h-2.5 rounded-full"
                    style={{
                      backgroundColor: c.color || 'var(--primary)',
                    }}
                  />
                }
                trailing={
                  <span className="hidden group-hover:flex items-center gap-1">
                    <button
                      type="button"
                      className="p-1 text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditCategory(c);
                      }}
                      aria-label={t.videoProjects.rename}
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="p-1 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteCategory(c);
                      }}
                      aria-label={t.videoProjects.delete}
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16" />
                      </svg>
                    </button>
                  </span>
                }
              />
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
};

export default ProjectSidebar;
