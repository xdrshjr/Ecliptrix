'use client';

import React, { useState } from 'react';
import { StoryboardPack, StoryboardFrame } from '@/types';
import FrameCard from './FrameCard';

interface StoryboardPackViewProps {
  pack: StoryboardPack;
  onBack: () => void;
  onSelectForScript: (pack: StoryboardPack) => void;
  onDelete: (packId: string) => void;
  onFrameClick: (frame: StoryboardFrame) => void;
  onAddAllFramesToMaterials?: (pack: StoryboardPack) => void;
}

/**
 * StoryboardPackView — renders the "inside" view when a user has
 * double-clicked into a storyboard pack. Shows breadcrumb navigation,
 * pack metadata, the original grid image, and a frame grid.
 */
const StoryboardPackView: React.FC<StoryboardPackViewProps> = ({
  pack,
  onBack,
  onSelectForScript,
  onDelete,
  onFrameClick,
  onAddAllFramesToMaterials,
}) => {
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [originalImgExpanded, setOriginalImgExpanded] = useState(false);

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb navigation */}
      <div className="flex items-center space-x-1 text-xs mb-3">
        <button
          onClick={onBack}
          className="text-primary hover:text-primary/80 hover:underline transition-colors"
        >
          素材
        </button>
        <svg className="w-3 h-3 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-foreground font-medium truncate max-w-[160px]" title={pack.prompt || '分镜包'}>
          {pack.prompt ? (pack.prompt.length > 20 ? pack.prompt.substring(0, 20) + '...' : pack.prompt) : '分镜包'}
        </span>
      </div>

      {/* Pack info bar */}
      <div className="bg-muted rounded-md p-2.5 mb-3 space-y-2">
        {/* Prompt — collapsible */}
        {pack.prompt && (
          <div>
            <button
              onClick={() => setPromptExpanded(!promptExpanded)}
              className="flex items-center space-x-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left"
            >
              <svg
                className={`w-3 h-3 transition-transform duration-200 flex-shrink-0 ${promptExpanded ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="font-medium">提示词</span>
            </button>
            {promptExpanded && (
              <p className="text-xs text-foreground mt-1 ml-4 whitespace-pre-wrap break-words">
                {pack.prompt}
              </p>
            )}
          </div>
        )}

        {/* Grid size + frame count */}
        <div className="flex items-center space-x-3 text-xs text-muted-foreground">
          <span>宫格规格: <span className="text-foreground font-medium">{pack.gridSize}</span></span>
          <span>帧数: <span className="text-foreground font-medium">{pack.frameCount}</span></span>
        </div>

        {/* Action buttons */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => onDelete(pack.packId)}
            className="px-2 py-1 text-xs text-destructive border border-destructive/30 rounded hover:bg-destructive/10 transition-colors"
          >
            删除分镜包
          </button>
          <button
            onClick={() => onSelectForScript(pack)}
            className="px-2 py-1 text-xs text-primary border border-primary/30 rounded hover:bg-primary/10 transition-colors"
          >
            在分镜脚本中使用
          </button>
        </div>
      </div>

      {/* Original image preview */}
      <div className="mb-3">
        <button
          onClick={() => setOriginalImgExpanded(!originalImgExpanded)}
          className="flex items-center space-x-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
        >
          <svg
            className={`w-3 h-3 transition-transform duration-200 ${originalImgExpanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="font-medium">原始分镜大图</span>
        </button>
        {originalImgExpanded && pack.originalImageUrl && (
          <div className="rounded-md overflow-hidden border border-border">
            <img
              src={pack.originalImageUrl}
              alt="Original storyboard"
              className="w-full object-contain cursor-pointer"
              onClick={() => onFrameClick({ index: -1, filename: 'original', url: pack.originalImageUrl, row: 0, col: 0, description: '原始分镜大图' })}
            />
          </div>
        )}
      </div>

      {/* Frame grid — scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {pack.frames.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <svg className="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-xs">暂无帧数据</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {pack.frames.map((frame) => (
              <FrameCard
                key={frame.index}
                frame={frame}
                index={frame.index + 1}
                onClick={onFrameClick}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bottom action bar */}
      {pack.frames.length > 0 && onAddAllFramesToMaterials && (
        <div className="border-t border-border pt-2 mt-2 flex-shrink-0">
          <button
            onClick={() => onAddAllFramesToMaterials(pack)}
            className="w-full px-3 py-1.5 text-xs font-medium text-primary bg-primary/10 border border-primary/20 rounded-md hover:bg-primary/20 transition-colors"
          >
            全部添加到素材
          </button>
        </div>
      )}
    </div>
  );
};

export default StoryboardPackView;
