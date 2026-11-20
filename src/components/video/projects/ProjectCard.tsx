'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { VideoProjectListItem } from '@/types';
import { formatRelativeTime } from '@/lib/relativeTime';
import ProjectThumbnail from './ProjectThumbnail';

interface ProjectCardProps {
  project: VideoProjectListItem;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}

const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  onOpen,
  onRename,
  onDelete,
}) => {
  const { t, locale } = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<HTMLButtonElement[]>([]);

  // Esc closes menu and restores focus to trigger.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // Focus first item when menu opens.
  useEffect(() => {
    if (menuOpen && itemRefs.current[0]) itemRefs.current[0].focus();
  }, [menuOpen]);

  const onItemKeyDown = (e: React.KeyboardEvent, idx: number) => {
    const items = itemRefs.current.filter(Boolean);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Tab') {
      setMenuOpen(false);
    }
  };

  return (
    <div
      onClick={onOpen}
      className={`group relative bg-card border border-border rounded-md hover:shadow-lg hover:border-primary/40 transition-all cursor-pointer ${
        menuOpen ? 'z-30' : ''
      }`}
    >
      <div
        className="aspect-video bg-cover bg-center relative rounded-t-[5px] overflow-hidden"
      >
        <ProjectThumbnail
          key={JSON.stringify([project.id, project.cover_url, project.updated_at])}
          projectId={project.id}
          coverUrl={project.cover_url}
          updatedAt={project.updated_at}
        />
      </div>

      <div className="px-3 py-2.5 space-y-1">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className="flex-1 text-left text-sm font-medium text-foreground truncate bg-transparent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
          >
            {project.name || t.videoProjects.untitled}
          </button>

          <div className="relative">
            <button
              ref={triggerRef}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label={t.videoProjects.projectActions}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="12" cy="19" r="1.5" />
              </svg>
            </button>

            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    triggerRef.current?.focus();
                  }}
                />
                <div
                  role="menu"
                  aria-label={t.videoProjects.projectActions}
                  className="absolute right-0 top-full mt-1 z-20 min-w-[140px] bg-popover border border-border rounded-md shadow-lg py-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    ref={(el) => { if (el) itemRefs.current[0] = el; }}
                    role="menuitem"
                    type="button"
                    onKeyDown={(e) => onItemKeyDown(e, 0)}
                    onClick={() => {
                      setMenuOpen(false);
                      onRename();
                    }}
                    className="w-full px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent focus:bg-accent focus:outline-none"
                  >
                    {t.videoProjects.rename}
                  </button>
                  <button
                    ref={(el) => { if (el) itemRefs.current[1] = el; }}
                    role="menuitem"
                    type="button"
                    onKeyDown={(e) => onItemKeyDown(e, 1)}
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete();
                    }}
                    className="w-full px-3 py-1.5 text-left text-sm text-destructive hover:bg-accent focus:bg-accent focus:outline-none"
                  >
                    {t.videoProjects.delete}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {project.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {project.description}
          </p>
        )}

        <div className="text-[11px] text-muted-foreground/80">
          {t.videoProjects.lastOpened}{t.common.colon}
          {formatRelativeTime(
            project.last_opened_at || project.updated_at,
            locale,
            t,
            t.videoProjects.neverOpened,
          )}
        </div>
      </div>
    </div>
  );
};

export default ProjectCard;
