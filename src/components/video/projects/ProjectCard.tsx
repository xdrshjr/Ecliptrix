'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { VideoProjectListItem } from '@/types';
import { formatRelativeTime } from '@/lib/relativeTime';

interface ProjectCardProps {
  project: VideoProjectListItem;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}

function gradientFromId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) & 0x7fffffff;
  }
  const hue1 = h % 360;
  const hue2 = (hue1 + 60) % 360;
  return `linear-gradient(135deg, hsl(${hue1} 60% 55%) 0%, hsl(${hue2} 60% 45%) 100%)`;
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

  const cover = project.cover_url
    ? { backgroundImage: `url(${project.cover_url})` }
    : { backgroundImage: gradientFromId(project.id) };

  return (
    <div
      onClick={onOpen}
      className={`group relative bg-card border border-border rounded-md hover:shadow-lg hover:border-primary/40 transition-all cursor-pointer ${
        menuOpen ? 'z-30' : ''
      }`}
    >
      <div
        className="aspect-video bg-cover bg-center relative rounded-t-[5px] overflow-hidden"
        style={cover}
      >
        {!project.cover_url && (
          <div className="absolute inset-0 flex items-center justify-center text-white/80">
            <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
        )}
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
