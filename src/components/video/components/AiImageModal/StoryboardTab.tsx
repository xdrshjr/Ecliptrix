'use client';

import React, { useState, useCallback } from 'react';
import { StoryboardGridSize, StoryboardPack } from '@/types';
import ImageUploadArea from './ImageUploadArea';
import GridSizeSelector from './GridSizeSelector';

/** Parse NxN grid size string into the total frame count */
function getFrameCount(gridSize: StoryboardGridSize): number {
  const n = parseInt(gridSize.split('x')[0], 10);
  return n * n;
}

export interface StoryboardTabState {
  prompt: string;
  gridSize: StoryboardGridSize;
  referenceImage: string | null;
}

type GenerationStatus = 'idle' | 'generating' | 'success' | 'error';

interface StoryboardTabProps {
  state: StoryboardTabState;
  onChange: (state: StoryboardTabState) => void;
  onGenerate: (state: StoryboardTabState) => Promise<StoryboardPack>;
}

const MAX_PROMPT_LENGTH = 2000;

const StoryboardTab: React.FC<StoryboardTabProps> = ({ state, onChange, onGenerate }) => {
  const { prompt, gridSize, referenceImage } = state;
  const [status, setStatus] = useState<GenerationStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [resultPack, setResultPack] = useState<StoryboardPack | null>(null);

  const frameCount = getFrameCount(gridSize);
  const canGenerate = prompt.trim().length > 0 && status !== 'generating';

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;
    setStatus('generating');
    setErrorMessage('');
    setResultPack(null);

    try {
      const pack = await onGenerate(state);
      setResultPack(pack);
      setStatus('success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '分镜生成失败，请重试';
      setErrorMessage(message);
      setStatus('error');
    }
  }, [canGenerate, onGenerate, state]);

  const handleRetry = useCallback(() => {
    setStatus('idle');
    setErrorMessage('');
    setResultPack(null);
  }, []);

  const isDisabled = status === 'generating';

  return (
    <div className="space-y-6">
      {/* Grid Size Selector */}
      <GridSizeSelector
        value={gridSize}
        onChange={(size) => onChange({ ...state, gridSize: size })}
        disabled={isDisabled}
      />

      {/* Prompt */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">
          提示词 <span className="text-destructive">*</span>
        </label>
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => onChange({ ...state, prompt: e.target.value.slice(0, MAX_PROMPT_LENGTH) })}
            rows={4}
            disabled={isDisabled}
            placeholder="描述您想要生成的分镜内容..."
            className="w-full border border-border rounded-md px-4 py-3 text-sm text-foreground bg-card resize-none focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <span className="absolute bottom-2.5 right-3 text-xs text-muted-foreground">
            {prompt.length}/{MAX_PROMPT_LENGTH}
          </span>
        </div>
      </div>

      {/* Reference Image */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">参考图</label>
        <ImageUploadArea
          value={referenceImage}
          onChange={(val) => onChange({ ...state, referenceImage: val })}
        />
      </div>

      {/* Generate Button */}
      {status === 'idle' && (
        <div>
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="w-full py-2.5 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            生成分镜
          </button>
          <p className="text-xs text-muted-foreground text-center mt-2">
            将生成 {gridSize} = {frameCount} 格分镜
          </p>
        </div>
      )}

      {/* Generating State */}
      {status === 'generating' && (
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">正在生成 {gridSize} 分镜...</p>
          <p className="text-xs text-muted-foreground">AI 正在绘制 {frameCount} 格分镜大图并自动裁剪</p>
        </div>
      )}

      {/* Success State */}
      {status === 'success' && resultPack && (
        <div className="border border-border rounded-md p-4 space-y-3">
          <div className="flex items-start gap-3">
            <img
              src={resultPack.originalImageUrl}
              alt="分镜大图"
              className="w-20 h-20 rounded-md border border-border object-cover flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                已自动裁剪为 {resultPack.frameCount} 张分镜并创建分镜包
              </p>
              <p className="text-xs text-muted-foreground mt-1 truncate">
                {resultPack.prompt}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                宫格: {resultPack.gridSize}
              </p>
            </div>
          </div>
          <button
            onClick={handleRetry}
            className="w-full py-2 text-sm font-medium text-foreground bg-secondary border border-border rounded-md hover:bg-accent transition-colors"
          >
            继续生成新分镜
          </button>
        </div>
      )}

      {/* Error State */}
      {status === 'error' && (
        <div className="border border-destructive/30 rounded-md p-4 space-y-3">
          <p className="text-sm text-destructive">{errorMessage}</p>
          <button
            onClick={handleRetry}
            className="w-full py-2 text-sm font-medium text-foreground bg-secondary border border-border rounded-md hover:bg-accent transition-colors"
          >
            重试
          </button>
        </div>
      )}
    </div>
  );
};

export default StoryboardTab;
