'use client';

import React, { useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { VideoProjectListItem } from '@/types';

interface ProjectCardProps {
  project: VideoProjectListItem;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}

/** Deterministic gradient cover based on the project ID — used when no
 *  explicit cover_url is set. Derived from a 31-bit hash of the id. */
function gradientFromId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) & 0x7fffffff;
  }
  const hue1 = h % 360;
  const hue2 = (hue1 + 60) % 360;
  return `linear-gradient(135deg, hsl(${hue1} 60% 55%) 0%, hsl(${hue2} 60% 45%) 100%)`;
}

function formatRelative(iso: string | undefined, neverLabel: string): string {
  if (!iso) return neverLabel;
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return neverLabel;
    const diff = Date.now() - date.getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return date.toLocaleTimeString();
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d`;
    return date.toLocaleDateString();
  } catch {
    return neverLabel;
  }
}

const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  onOpen,
  onRename,
  onDelete,
}) => {
  const { t } = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);

  const cover = project.cover_url
    ? { backgroundImage: `url(${project.cover_url})` }
    : { backgroundImage: gradientFromId(project.id) };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`group relative bg-card border border-border rounded-md hover:shadow-lg hover:border-primary/40 transition-all cursor-pointer ${
        menuOpen ? 'z-30' : ''
      }`}
    >
      {/* Cover — overflow-hidden lives here (not on the card root) so the
          actions menu can escape the card bounds. */}
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

      {/* Body */}
      <div className="px-3 py-2.5 space-y-1">
        <div className="flex items-start gap-2">
          <h3 className="flex-1 text-sm font-medium text-foreground truncate">
            {project.name || t.videoProjects.untitled}
          </h3>

          {/* Actions menu */}
          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Project actions"
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
                  }}
                />
                <div
                  className="absolute right-0 top-full mt-1 z-20 min-w-[140px] bg-popover border border-border rounded-md shadow-lg py-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onRename();
                    }}
                    className="w-full px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent"
                  >
                    {t.videoProjects.rename}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete();
                    }}
                    className="w-full px-3 py-1.5 text-left text-sm text-destructive hover:bg-accent"
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
          {t.videoProjects.lastOpened}:{' '}
          {formatRelative(
            project.last_opened_at || project.updated_at,
            t.videoProjects.neverOpened,
          )}
        </div>
      </div>
    </div>
  );
};

export default ProjectCard;
