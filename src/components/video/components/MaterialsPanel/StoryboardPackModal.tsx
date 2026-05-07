'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { StoryboardPack, StoryboardFrame } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';

interface StoryboardPackModalProps {
  isOpen: boolean;
  pack: StoryboardPack | null;
  onClose: () => void;
  onSelectForScript: (pack: StoryboardPack) => void;
  onDelete: (packId: string) => void;
  onFrameClick: (frame: StoryboardFrame) => void;
  onAddAllFramesToMaterials?: (pack: StoryboardPack) => void;
}

/**
 * StoryboardPackModal — 弹窗查看分镜包内的所有分镜帧。
 * 单击分镜包卡片时弹出，展示分镜详情、原图和帧网格。
 */
const StoryboardPackModal: React.FC<StoryboardPackModalProps> = ({
  isOpen,
  pack,
  onClose,
  onSelectForScript,
  onDelete,
  onFrameClick,
  onAddAllFramesToMaterials,
}) => {
  const { t } = useLocale();
  const [originalImgExpanded, setOriginalImgExpanded] = useState(false);
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null);

  // Reset state when pack changes
  useEffect(() => {
    if (isOpen) {
      setOriginalImgExpanded(false);
      setSelectedFrameIndex(null);
    }
  }, [isOpen, pack?.packId]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedFrameIndex !== null) {
          setSelectedFrameIndex(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, selectedFrameIndex]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      if (selectedFrameIndex !== null) {
        setSelectedFrameIndex(null);
      } else {
        onClose();
      }
    }
  }, [onClose, selectedFrameIndex]);

  if (!isOpen || !pack) return null;

  const selectedFrame = selectedFrameIndex !== null
    ? pack.frames.find(f => f.index === selectedFrameIndex) ?? null
    : null;

  // Partial-pack accounting — compute the user-facing "X of Y" counts and
  // which scene indexes are missing so the banner can list them.
  const isPartial = pack.partial === true;
  const requestedTotal =
    pack.requestedFrameCount && pack.requestedFrameCount > 0
      ? pack.requestedFrameCount
      : pack.frameCount;
  const completedBatches = pack.completedBatches ?? 0;
  const totalBatches = pack.totalBatches ?? 0;
  const presentIndexes = new Set(pack.frames.map((f) => f.index));
  const missingIndexes: number[] = [];
  if (isPartial) {
    for (let i = 0; i < requestedTotal; i += 1) {
      if (!presentIndexes.has(i)) missingIndexes.push(i);
    }
  }

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-200"
      onClick={handleBackdropClick}
    >
      <div className="relative bg-card border border-border rounded-lg shadow-2xl w-[90vw] max-w-4xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border flex-shrink-0">
          <div className="flex items-center space-x-3 min-w-0">
            {/* Folder icon */}
            <div className="flex-shrink-0 w-8 h-8 bg-primary/10 rounded-md flex items-center justify-center">
              <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground truncate" title={pack.prompt || t.storyboardPack.defaultTitle}>
                {pack.prompt || t.storyboardPack.defaultTitle}
              </h3>
              <div className="flex items-center space-x-3 text-xs text-muted-foreground mt-0.5">
                <span>{pack.gridSize}</span>
                <span>
                  {pack.frameCount}
                  {isPartial && requestedTotal > pack.frameCount ? `/${requestedTotal}` : ''}
                  {' '}
                  {t.storyboardPack.frames}
                </span>
                <span>{new Date(pack.createdAt).toLocaleDateString()}</span>
                {isPartial && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border border-yellow-500/30">
                    {t.storyboardPack.partialBadge}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="flex-shrink-0 w-8 h-8 rounded-md hover:bg-muted flex items-center justify-center transition-colors"
            title={t.storyboardPack.close}
          >
            <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
          {/* Partial-pack banner — shown only when generation finished with
              fewer frames than the user asked for. */}
          {isPartial && (
            <div className="border border-yellow-500/40 bg-yellow-500/10 rounded-md p-3 space-y-1">
              <p className="text-sm text-yellow-700 dark:text-yellow-400 font-medium">
                {t.storyboardPack.partialBanner
                  .replace('{completed}', String(pack.frameCount))
                  .replace('{total}', String(requestedTotal))
                  .replace('{batchesDone}', String(completedBatches))
                  .replace('{batchesTotal}', String(totalBatches))}
              </p>
              {missingIndexes.length > 0 && (
                <p className="text-xs text-yellow-700 dark:text-yellow-400/80">
                  {t.storyboardPack.partialMissingScenes.replace(
                    '{scenes}',
                    missingIndexes.map((i) => i + 1).join(', '),
                  )}
                </p>
              )}
              {pack.error?.message && (
                <p className="text-xs text-yellow-700/80 dark:text-yellow-400/70 truncate">
                  {t.storyboardPack.partialErrorPrefix}{pack.error.message}
                </p>
              )}
            </div>
          )}

          {/* Original image — collapsible */}
          <div>
            <button
              onClick={() => setOriginalImgExpanded(!originalImgExpanded)}
              className="flex items-center space-x-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg
                className={`w-3 h-3 transition-transform duration-200 ${originalImgExpanded ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="font-medium">{t.storyboardPack.originalImage}</span>
            </button>
            {originalImgExpanded && pack.originalImageUrl && (
              <div className="mt-2 rounded-md overflow-hidden border border-border max-h-80">
                <img
                  src={pack.originalImageUrl}
                  alt="Original storyboard"
                  className="w-full object-contain cursor-pointer"
                  onClick={() => onFrameClick({ index: -1, filename: 'original', url: pack.originalImageUrl, row: 0, col: 0, description: t.storyboardPack.originalImage })}
                />
              </div>
            )}
          </div>

          {/* Frame grid */}
          {pack.frames.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <svg className="w-10 h-10 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm">{t.storyboardPack.noFrames}</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              {pack.frames.map((frame) => (
                <FrameCardInModal
                  key={frame.index}
                  frame={frame}
                  isSelected={selectedFrameIndex === frame.index}
                  onClick={() => setSelectedFrameIndex(
                    selectedFrameIndex === frame.index ? null : frame.index
                  )}
                  onPreview={() => onFrameClick(frame)}
                />
              ))}
            </div>
          )}

          {/* Selected frame detail */}
          {selectedFrame && (
            <div className="bg-muted rounded-lg p-4 border border-border animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-48 aspect-square rounded-md overflow-hidden border border-border bg-background">
                  <img
                    src={selectedFrame.url}
                    alt={`Frame #${selectedFrame.index + 1}`}
                    className="w-full h-full object-contain cursor-pointer"
                    onClick={() => onFrameClick(selectedFrame)}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-foreground mb-1">
                    帧 #{selectedFrame.index + 1}
                  </h4>
                  <div className="text-xs text-muted-foreground mb-2">
                    位置: 第{selectedFrame.row + 1}行 第{selectedFrame.col + 1}列
                  </div>
                  {selectedFrame.description ? (
                    <p className="text-sm text-foreground leading-relaxed">
                      {selectedFrame.description}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      {t.storyboardPack.noDescription}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border flex-shrink-0 bg-muted/30">
          <button
            onClick={() => onDelete(pack.packId)}
            className="px-3 py-1.5 text-xs text-destructive border border-destructive/30 rounded-md hover:bg-destructive/10 transition-colors"
          >
            {t.storyboardPack.deletePack}
          </button>
          <div className="flex items-center space-x-2">
            {onAddAllFramesToMaterials && pack.frames.length > 0 && (
              <button
                onClick={() => onAddAllFramesToMaterials(pack)}
                className="px-3 py-1.5 text-xs font-medium text-foreground border border-border rounded-md hover:bg-muted transition-colors"
              >
                全部添加到素材
              </button>
            )}
            <button
              onClick={() => onSelectForScript(pack)}
              className="px-3 py-1.5 text-xs font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 transition-colors"
            >
              在分镜脚本中使用
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* FrameCardInModal — 弹窗内的帧卡片，带选中态                         */
/* ------------------------------------------------------------------ */

interface FrameCardInModalProps {
  frame: StoryboardFrame;
  isSelected: boolean;
  onClick: () => void;
  onPreview: () => void;
}

const FrameCardInModal: React.FC<FrameCardInModalProps> = ({
  frame,
  isSelected,
  onClick,
  onPreview,
}) => {
  const [imgError, setImgError] = useState(false);

  return (
    <div
      className={`group bg-card border rounded-md overflow-hidden transition-all cursor-pointer ${
        isSelected
          ? 'border-primary ring-1 ring-primary/30 shadow-sm'
          : 'border-border hover:border-primary/50'
      }`}
      onClick={onClick}
    >
      {/* Frame thumbnail */}
      <div className="aspect-square bg-muted relative">
        {frame.url && !imgError ? (
          <img
            src={frame.url}
            alt={`Frame #${frame.index + 1}`}
            className="w-full h-full object-cover pointer-events-none"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}

        {/* Frame number badge */}
        <div className="absolute top-1 left-1">
          <span className="px-1.5 py-0.5 text-xs font-bold rounded bg-foreground/75 text-background">
            #{frame.index + 1}
          </span>
        </div>

        {/* Preview icon on hover */}
        <div
          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onPreview();
          }}
        >
          <div className="w-6 h-6 rounded bg-card/90 flex items-center justify-center hover:bg-card transition-colors">
            <svg className="w-3.5 h-3.5 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
            </svg>
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="p-1.5">
        {frame.description ? (
          <p className="text-xs text-foreground line-clamp-2" title={frame.description}>
            {frame.description}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground italic">未生成描述</p>
        )}
      </div>
    </div>
  );
};

export default StoryboardPackModal;
