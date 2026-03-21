'use client';

import React, { useState } from 'react';
import { StoryboardScriptSegment } from '@/types';

interface StoryboardSegmentCardProps {
  segment: StoryboardScriptSegment;
  index: number;
  totalCount: number;
  onUpdate: (updates: Partial<StoryboardScriptSegment>) => void;
  onGenerateVideo: () => void;
  onCancelGeneration: () => void;
  onRegenerateDescription: () => void;
  onExpandScript: () => void;
  onDelete: () => void;
  isDescribing: boolean;
  isExpanding: boolean;
}

const DURATION_OPTIONS = [5, 7, 10, 12];

const StoryboardSegmentCard: React.FC<StoryboardSegmentCardProps> = ({
  segment,
  index,
  totalCount,
  onUpdate,
  onGenerateVideo,
  onCancelGeneration,
  onRegenerateDescription,
  onExpandScript,
  onDelete,
  isDescribing,
  isExpanding,
}) => {
  const [isImageEnlarged, setIsImageEnlarged] = useState(false);

  const isGenerating = segment.generationStatus === 'generating';
  const isSucceeded = segment.generationStatus === 'succeeded';
  const isFailed = segment.generationStatus === 'failed';

  return (
    <div className="bg-card border border-border rounded-md overflow-hidden transition-shadow duration-200">
      {/* Gradient header */}
      <div className="bg-gradient-to-r from-teal-500/10 to-cyan-500/10 dark:from-teal-500/20 dark:to-cyan-500/20 px-3 py-2 border-b border-border">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-foreground flex items-center">
            <span className="w-6 h-6 bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400 rounded-full text-xs font-semibold flex items-center justify-center mr-2">
              {index + 1}
            </span>
            <span className="text-xs text-muted-foreground">
              #{index + 1} / {totalCount}
            </span>
          </h4>
          <button
            onClick={onDelete}
            disabled={isGenerating}
            className="p-1.5 text-destructive bg-destructive/10 border border-destructive/20 rounded hover:bg-destructive/20 hover:border-destructive/30 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            title="删除此帧"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* Frame preview image */}
        <div className="flex space-x-3">
          <div className="shrink-0">
            <div
              className="w-20 h-20 rounded-md border border-border overflow-hidden cursor-pointer hover:ring-2 hover:ring-teal-400 transition-all"
              onClick={() => setIsImageEnlarged(true)}
              title="点击放大"
            >
              {segment.frameUrl ? (
                <img
                  src={segment.frameUrl}
                  alt={`分镜 #${index + 1}`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-muted flex items-center justify-center">
                  <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              )}
            </div>
          </div>

          {/* Description editing area */}
          <div className="flex-1 min-w-0">
            {/* Action buttons row */}
            <div className="flex justify-end space-x-1 mb-1">
              <button
                onClick={onRegenerateDescription}
                disabled={isDescribing || isGenerating}
                className="flex items-center space-x-1 px-2 py-1 text-xs text-teal-600 hover:text-teal-700 hover:bg-teal-50 dark:text-teal-400 dark:hover:text-teal-300 dark:hover:bg-teal-900/20 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="重新生成描述"
              >
                {isDescribing ? (
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                <span>重新描述</span>
              </button>
              <button
                onClick={onExpandScript}
                disabled={isExpanding || isGenerating}
                className="flex items-center space-x-1 px-2 py-1 text-xs text-teal-600 hover:text-teal-700 hover:bg-teal-50 dark:text-teal-400 dark:hover:text-teal-300 dark:hover:bg-teal-900/20 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title={segment.description.trim() ? 'AI扩展描述' : 'AI生成描述'}
              >
                {isExpanding ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span>扩展中...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                    <span>AI扩展</span>
                  </>
                )}
              </button>
            </div>

            <textarea
              value={segment.description}
              onChange={(e) =>
                onUpdate({ description: e.target.value })
              }
              disabled={isExpanding || isDescribing}
              placeholder="输入或AI生成场景描述..."
              className="w-full p-2 text-xs border border-border rounded-md resize-y focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent min-h-[64px] max-h-[160px] disabled:opacity-60 disabled:cursor-not-allowed"
              rows={3}
            />
          </div>
        </div>

        {/* Duration selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground shrink-0">时长:</span>
          <div className="flex gap-1">
            {DURATION_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => !isGenerating && onUpdate({ duration: d })}
                disabled={isGenerating}
                className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                  (segment.duration || 5) === d
                    ? 'bg-teal-500 text-white border-teal-500 dark:bg-teal-600 dark:border-teal-600'
                    : 'bg-muted text-muted-foreground border-border hover:text-foreground hover:bg-accent'
                } disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                {d}s
              </button>
            ))}
          </div>
        </div>

        {/* Generate / Progress / Failed area */}
        <div>
          {isGenerating ? (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-teal-600 font-medium">生成中...</span>
                <span className="text-xs text-muted-foreground">{segment.generationProgress || 0}%</span>
              </div>
              <div className="w-full bg-accent rounded-full h-1.5">
                <div
                  className="bg-gradient-to-r from-teal-500 to-cyan-500 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${segment.generationProgress || 0}%` }}
                />
              </div>
              <button
                onClick={onCancelGeneration}
                className="mt-2 text-xs text-muted-foreground hover:text-destructive transition-colors"
              >
                取消生成
              </button>
            </div>
          ) : isFailed ? (
            <div className="flex items-center justify-between">
              <span className="text-xs text-destructive truncate mr-2">
                生成失败: {segment.generationError}
              </span>
              <button
                onClick={onGenerateVideo}
                className="flex items-center space-x-1 px-3 py-1.5 text-xs font-medium text-white bg-destructive rounded-md hover:bg-destructive/90 transition-colors shrink-0"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>重试</span>
              </button>
            </div>
          ) : !isSucceeded ? (
            <button
              onClick={onGenerateVideo}
              disabled={!segment.description.trim()}
              className="w-full flex items-center justify-center space-x-1.5 py-2 text-xs font-medium text-white bg-gradient-to-r from-teal-500 to-cyan-500 rounded-md hover:from-teal-600 hover:to-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span>生成视频</span>
            </button>
          ) : null}
        </div>

        {/* Generated video preview */}
        {isSucceeded && segment.generatedVideoUrl && (
          <div className="p-2.5 bg-muted rounded-md border border-border">
            <div className="text-xs font-medium text-muted-foreground mb-2">已生成视频</div>
            <div className="relative bg-black rounded-md overflow-hidden aspect-video">
              <video
                src={segment.generatedVideoUrl}
                poster={segment.generatedVideoThumbnailUrl}
                controls
                preload="metadata"
                className="w-full h-full object-contain"
              />
            </div>
          </div>
        )}
      </div>

      {/* Enlarged image modal */}
      {isImageEnlarged && segment.frameUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setIsImageEnlarged(false)}
        >
          <div className="relative max-w-[80vw] max-h-[80vh]">
            <img
              src={segment.frameUrl}
              alt={`分镜 #${index + 1}`}
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsImageEnlarged(false);
              }}
              className="absolute top-2 right-2 p-2 bg-black/50 text-white rounded-full hover:bg-black/70 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default StoryboardSegmentCard;
