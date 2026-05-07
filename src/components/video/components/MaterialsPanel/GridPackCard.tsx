'use client';

import React, { useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { ImagePack } from '@/lib/api/imagePack';

interface GridPackCardProps {
  pack: ImagePack;
  onClick: (pack: ImagePack) => void;
  onDelete: (pack: ImagePack) => void;
}

/**
 * GridPackCard — generic folder-like card for character / scene image
 * packs. Parallels :mod:`StoryboardPackCard` but consumes the unified
 * :class:`ImagePack` shape returned by ``/api/image-pack/{type}/list``.
 */
const GridPackCard: React.FC<GridPackCardProps> = ({ pack, onClick, onDelete }) => {
  const { t } = useLocale();
  const [imgError, setImgError] = useState(false);

  const isFramePack = pack.pack_type === 'frame';
  const label =
    pack.pack_type === 'character'
      ? t.materialsPanel.characterPack ?? '人物建模包'
      : pack.pack_type === 'scene'
        ? t.materialsPanel.scenePack ?? '场景建模包'
        : isFramePack
          ? t.materialsPanel.framePack ?? '视频帧包'
          : t.materialsPanel.storyboardPack;

  const deleteTitle = isFramePack
    ? t.materialsPanel.deleteFramePack ?? '删除视频帧包'
    : t.materialsPanel.deleteStoryboardPack;

  // Frame packs are not arranged on a grid; their badge is "N 帧" rather
  // than the storyboard "3x3 · N" form.
  const countBadge = isFramePack
    ? (t.materialsPanel.framePackBadge ?? '{count} frames').replace(
        '{count}',
        String(pack.frame_count),
      )
    : `${pack.grid_size} · ${pack.frame_count}${t.materialsPanel.frames}`;

  return (
    <div
      className="group bg-card border border-border rounded-md overflow-hidden transition-all cursor-pointer hover:border-primary/50"
      onClick={() => onClick(pack)}
    >
      <div className="aspect-video bg-muted relative">
        {pack.original_image_url && !imgError ? (
          <img
            src={pack.original_image_url}
            alt={`${pack.pack_type} pack`}
            className="w-full h-full object-cover pointer-events-none"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {isFramePack ? (
              <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16M4 6v12M9 6v12M14 6v12M19 6v12" />
              </svg>
            ) : (
              <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            )}
          </div>
        )}

        {!isFramePack && (
          <div className="absolute top-1 left-1">
            <span className="inline-flex items-center px-1 py-0.5 text-xs font-medium rounded bg-primary/20 text-primary">
              {pack.grid_size}
            </span>
          </div>
        )}
        {isFramePack && (
          <div className="absolute top-1 left-1">
            <span className="inline-flex items-center gap-0.5 px-1 py-0.5 text-xs font-medium rounded bg-primary/20 text-primary">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16M4 6v12M9 6v12M14 6v12M19 6v12" />
              </svg>
            </span>
          </div>
        )}

        <div className="absolute top-1 right-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(pack);
            }}
            className="w-6 h-6 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
            title={deleteTitle}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="absolute bottom-1 right-1">
          <span className="px-1 py-0.5 bg-foreground/75 text-background text-xs rounded">
            {countBadge}
          </span>
        </div>
      </div>

      <div className="p-1.5">
        <h4 className="text-xs font-medium text-foreground truncate" title={pack.prompt}>
          {pack.prompt || label}
        </h4>
        <div className="flex items-center justify-between text-xs text-muted-foreground mt-0.5">
          <span>{label}</span>
          <span>{pack.created_at ? new Date(pack.created_at).toLocaleDateString() : ''}</span>
        </div>
      </div>
    </div>
  );
};

export default GridPackCard;
