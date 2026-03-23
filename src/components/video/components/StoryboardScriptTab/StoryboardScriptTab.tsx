'use client';

import React, { useCallback, useState } from 'react';
import { StoryboardScriptSegment, StoryboardPack, MaterialItem } from '@/types';
import { useStoryboardScriptGeneration } from '../../hooks/useStoryboardScriptGeneration';
import PackSelector from './PackSelector';
import StoryboardSegmentCard from './StoryboardSegmentCard';

interface StoryboardScriptTabProps {
  segments: StoryboardScriptSegment[];
  onUpdateSegments: (segments: StoryboardScriptSegment[]) => void;
  onAddMaterial?: (material: MaterialItem) => void;
  taskId?: string;
}

const StoryboardScriptTab: React.FC<StoryboardScriptTabProps> = ({
  segments,
  onUpdateSegments,
  onAddMaterial,
  taskId,
}) => {
  const {
    availablePacks,
    loadPack,
    refreshPacks,
    isLoadingPacks,
    isLoadingPack,
    selectedPackId,
    isDescribing,
    generateAllDescriptions,
    regenerateDescription,
    generateVideo,
    batchGenerateAllVideos,
    cancelGeneration,
    composeAllVideos,
    isComposing,
    composedVideoUrl,
    compositionError,
    overallProgress,
    totalDuration,
  } = useStoryboardScriptGeneration({
    segments,
    onUpdateSegments,
    onAddMaterial,
    taskId,
  });

  const [expandingSegmentId, setExpandingSegmentId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // ── Segment operations ──

  const handleUpdateSegment = useCallback(
    (segmentId: string, updates: Partial<StoryboardScriptSegment>) => {
      onUpdateSegments(
        segments.map((s) => (s.id === segmentId ? { ...s, ...updates } : s)),
      );
    },
    [segments, onUpdateSegments],
  );

  const handleDeleteSegment = useCallback(
    (segmentId: string) => {
      cancelGeneration(segmentId);
      const remaining = segments.filter((s) => s.id !== segmentId);
      // Renumber frameIndex
      const renumbered = remaining.map((s, i) => ({
        ...s,
        frameIndex: i,
      }));
      onUpdateSegments(renumbered);
      setDeleteConfirmId(null);
    },
    [segments, onUpdateSegments, cancelGeneration],
  );

  const handleAddEmptySegment = useCallback(() => {
    const newSeg: StoryboardScriptSegment = {
      id: `storyboard-seg-custom-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      frameIndex: segments.length,
      frameUrl: '',
      description: '',
      duration: 5,
      generationStatus: 'idle',
      generationProgress: 0,
    };
    onUpdateSegments([...segments, newSeg]);
  }, [segments, onUpdateSegments]);

  const handleExpandScript = useCallback(
    async (segmentId: string) => {
      const segmentIndex = segments.findIndex((s) => s.id === segmentId);
      const segment = segments[segmentIndex];
      if (!segment) return;

      setExpandingSegmentId(segmentId);
      try {
        const otherSegments = segments
          .map((s, i) => ({
            index: i,
            title: `分镜 #${i + 1}`,
            scriptText:
              s.description.length > 200
                ? s.description.slice(0, 200)
                : s.description,
          }))
          .filter((_, i) => i !== segmentIndex);

        const response = await fetch('/api/ai-video-script-expand', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId: taskId || 'unknown',
            segmentIndex,
            segmentTitle: `分镜 #${segmentIndex + 1}`,
            segmentText: segment.description,
            otherSegments,
          }),
        });

        const data = await response.json();
        if (data.success && data.expandedText) {
          handleUpdateSegment(segmentId, {
            description: data.expandedText,
          });
        }
      } catch (error) {
        console.error('[StoryboardScriptTab] Failed to expand script:', error);
      } finally {
        setExpandingSegmentId(null);
      }
    },
    [segments, taskId, handleUpdateSegment],
  );

  // ── Derived state ──

  const allVideosGenerated =
    segments.length > 0 &&
    segments.every(
      (s) => s.generationStatus === 'succeeded' && s.generatedVideoUrl,
    );

  const hasIdleOrFailed = segments.some(
    (s) => s.generationStatus === 'idle' || s.generationStatus === 'failed',
  );

  const hasAnyGenerating = segments.some(
    (s) => s.generationStatus === 'generating',
  );

  const canBatchGenerate =
    hasIdleOrFailed && !hasAnyGenerating && segments.length > 0;

  // ── Empty state ──

  if (segments.length === 0 && !selectedPackId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <svg
          className="w-12 h-12 text-muted-foreground mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <p className="text-sm text-muted-foreground">请选择一个分镜包开始</p>
        <p className="text-xs text-muted-foreground mt-1">
          在上方下拉菜单中选择已生成的分镜包
        </p>

        {/* Pack selector in empty state */}
        <div className="mt-4 w-64">
          <PackSelector
            packs={availablePacks}
            selectedPackId={selectedPackId}
            onSelectPack={loadPack}
            isLoading={isLoadingPacks || isLoadingPack}
            onRefresh={refreshPacks}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Top toolbar */}
      <div className="p-2 space-y-2 border-b border-border shrink-0">
        {/* Pack selector */}
        <PackSelector
          packs={availablePacks}
          selectedPackId={selectedPackId}
          onSelectPack={loadPack}
          isLoading={isLoadingPacks || isLoadingPack}
          onRefresh={refreshPacks}
        />

        {/* Action buttons */}
        <div className="flex items-center space-x-2">
          {/* Generate descriptions */}
          <button
            onClick={generateAllDescriptions}
            disabled={isDescribing || segments.length === 0}
            className="flex items-center justify-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-amber-500 to-orange-500 rounded-md hover:from-amber-600 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            title={isDescribing ? '正在生成描述...' : '为所有分镜帧生成AI描述'}
          >
            {isDescribing ? (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            )}
            <span>{isDescribing ? '生成中...' : '生成描述'}</span>
          </button>

          {/* Batch generate */}
          <button
            onClick={batchGenerateAllVideos}
            disabled={!canBatchGenerate}
            className="flex-1 flex items-center justify-center space-x-1.5 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-teal-500 to-cyan-500 rounded-md hover:from-teal-600 hover:to-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            title={
              hasAnyGenerating
                ? '有视频正在生成中'
                : !hasIdleOrFailed
                  ? '所有视频已生成'
                  : '一键批量生成所有未生成的视频'
            }
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <span>一键批量生成</span>
          </button>

          {/* Compose */}
          <button
            onClick={composeAllVideos}
            disabled={!allVideosGenerated || isComposing}
            className="flex-1 flex items-center justify-center space-x-1.5 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-indigo-500 to-purple-500 rounded-md hover:from-indigo-600 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            title={
              !allVideosGenerated
                ? '请先生成所有分镜视频'
                : isComposing
                  ? '正在合成...'
                  : '一键合成所有分镜视频'
            }
          >
            {isComposing ? (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4V2m0 2a2 2 0 00-2 2v1h10V6a2 2 0 00-2-2H7zm-4 6h14M5 10v10a2 2 0 002 2h6a2 2 0 002-2V10" />
              </svg>
            )}
            <span>{isComposing ? '正在合成...' : '一键合成视频'}</span>
          </button>
        </div>
      </div>

      {/* Pack loading overlay */}
      {isLoadingPack && (
        <div className="px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 shrink-0">
          <div className="flex items-center space-x-2 text-xs text-blue-700 dark:text-blue-300">
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>正在加载分镜包...</span>
          </div>
        </div>
      )}

      {/* Describing overlay */}
      {isDescribing && segments.length > 0 && (
        <div className="px-3 py-2 bg-teal-50 dark:bg-teal-900/20 border-b border-teal-200 dark:border-teal-800 shrink-0">
          <div className="flex items-center space-x-2 text-xs text-teal-700 dark:text-teal-300">
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>正在为分镜帧生成描述...</span>
          </div>
        </div>
      )}

      {/* Composition error */}
      {compositionError && (
        <div className="px-3 py-2 bg-destructive/10 border-b border-destructive/20 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-xs text-destructive">
              合成失败: {compositionError}
            </span>
            <button
              onClick={composeAllVideos}
              disabled={isComposing}
              className="text-xs text-destructive hover:text-destructive/80 underline"
            >
              重试
            </button>
          </div>
        </div>
      )}

      {/* Composed video preview */}
      {composedVideoUrl && (
        <div className="p-3 border-b border-border shrink-0">
          <div className="p-2.5 bg-muted rounded-md border border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-foreground">合成视频</span>
              <span className="text-xs text-muted-foreground">
                总时长: {totalDuration}s
              </span>
            </div>
            <div className="relative bg-black rounded-md overflow-hidden aspect-video">
              <video
                src={composedVideoUrl}
                controls
                preload="metadata"
                className="w-full h-full object-contain"
              />
            </div>
          </div>
        </div>
      )}

      {/* Segment list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {segments.map((segment, index) => (
          <StoryboardSegmentCard
            key={segment.id}
            segment={segment}
            index={index}
            totalCount={segments.length}
            onUpdate={(updates) => handleUpdateSegment(segment.id, updates)}
            onGenerateVideo={() => generateVideo(segment.id)}
            onCancelGeneration={() => cancelGeneration(segment.id)}
            onRegenerateDescription={() =>
              regenerateDescription(segment.id)
            }
            onExpandScript={() => handleExpandScript(segment.id)}
            onDelete={() => setDeleteConfirmId(segment.id)}
            isDescribing={isDescribing}
            isExpanding={expandingSegmentId === segment.id}
          />
        ))}

        {/* Add segment button */}
        <button
          onClick={handleAddEmptySegment}
          className="w-full py-2.5 text-sm text-muted-foreground hover:text-teal-600 bg-muted hover:bg-teal-50 dark:hover:bg-teal-900/20 border-2 border-dashed border-border hover:border-teal-300 dark:hover:border-teal-700 rounded-md transition-colors duration-150 flex items-center justify-center space-x-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          <span>添加帧</span>
        </button>
      </div>

      {/* Bottom status bar */}
      {segments.length > 0 && (
        <div className="px-3 py-2 bg-muted/50 border-t border-border flex items-center justify-between text-xs text-muted-foreground shrink-0">
          <span>
            已生成 {overallProgress.completed}/{overallProgress.total} 个视频
          </span>
          <span>预计总时长: {totalDuration}s</span>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-lg p-5 shadow-xl max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">
              确认删除
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              确定要删除此分镜帧吗？已生成的视频不会从素材面板中移除。
            </p>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-3 py-1.5 text-xs text-muted-foreground bg-muted border border-border rounded-md hover:bg-accent transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => handleDeleteSegment(deleteConfirmId)}
                className="px-3 py-1.5 text-xs text-white bg-destructive rounded-md hover:bg-destructive/90 transition-colors"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StoryboardScriptTab;
