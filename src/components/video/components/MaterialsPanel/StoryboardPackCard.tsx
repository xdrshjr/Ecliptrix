'use client';

import React, { useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { StoryboardPack } from '@/types';

interface StoryboardPackCardProps {
  pack: StoryboardPack;
  onClick: (pack: StoryboardPack) => void;
  onDoubleClick?: (pack: StoryboardPack) => void;
  onDelete: (packId: string) => void;
}

/**
 * StoryboardPackCard — renders a storyboard pack as a folder-like card
 * in the material grid. Uses the original storyboard image as thumbnail,
 * shows a folder icon overlay, and displays grid-size / frame-count info.
 */
const StoryboardPackCard: React.FC<StoryboardPackCardProps> = ({
  pack,
  onClick,
  onDoubleClick,
  onDelete,
}) => {
  const { t } = useLocale();
  const [imgError, setImgError] = useState(false);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onDelete(pack.packId);
  };

  return (
    <div
      className="group bg-card border border-border rounded-md overflow-hidden transition-all cursor-pointer hover:border-primary/50"
      onClick={() => onClick(pack)}
      onDoubleClick={() => onDoubleClick?.(pack)}
    >
      {/* Thumbnail area — same aspect-ratio as regular material cards */}
      <div className="aspect-video bg-muted relative">
        {pack.originalImageUrl && !imgError ? (
          <img
            src={pack.originalImageUrl}
            alt={`${pack.gridSize} storyboard`}
            className="w-full h-full object-cover pointer-events-none"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}

        {/* Folder icon overlay — top-left */}
        <div className="absolute top-1 left-1">
          <span className="inline-flex items-center px-1 py-0.5 text-xs font-medium rounded bg-primary/20 text-primary">
            <svg className="w-3 h-3 mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            {pack.gridSize}
          </span>
        </div>

        {/* Delete button — top-right, visible on hover */}
        <div className="absolute top-1 right-1">
          <button
            onClick={handleDelete}
            className="w-6 h-6 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
            title={t.materialsPanel.deleteStoryboardPack}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Bottom-right label: grid size + frame count (with N/M when partial) */}
        <div className="absolute bottom-1 right-1">
          <span className="px-1 py-0.5 bg-foreground/75 text-background text-xs rounded">
            {pack.gridSize} ·{' '}
            {pack.frameCount}
            {pack.partial &&
            pack.requestedFrameCount &&
            pack.requestedFrameCount > pack.frameCount
              ? `/${pack.requestedFrameCount}`
              : ''}
            {t.materialsPanel.frames}
          </span>
        </div>

        {/* Partial-pack badge — top-center, above thumbnail, so users see
            at-a-glance which packs in their material library are incomplete. */}
        {pack.partial && (
          <div className="absolute top-1 left-1/2 -translate-x-1/2">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-500/85 text-yellow-50 border border-yellow-600/50">
              {t.storyboardPack.partialBadge}
            </span>
          </div>
        )}
      </div>

      {/* Info row */}
      <div className="p-1.5">
        <h4 className="text-xs font-medium text-foreground truncate" title={pack.prompt}>
          {pack.prompt || t.materialsPanel.storyboardPack}
        </h4>
        <div className="flex items-center justify-between text-xs text-muted-foreground mt-0.5">
          <span>{t.materialsPanel.storyboardPack}</span>
          <span>{new Date(pack.createdAt).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
};

export default StoryboardPackCard;
