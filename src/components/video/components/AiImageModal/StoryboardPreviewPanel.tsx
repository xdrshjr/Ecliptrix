'use client';

import React, { useMemo } from 'react';
import { StoryboardAspectRatio } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { computeOptimalGrid } from './gridUtils';
import AspectRatioIcon from './AspectRatioIcon';

export interface StoryboardPreviewPanelProps {
  frameCount: number;
  aspectRatio: StoryboardAspectRatio;
  locale?: 'zh' | 'en';
}

function aspectRatioIconVariant(ar: StoryboardAspectRatio): 'square' | 'landscape' | 'portrait' {
  switch (ar) {
    case '1:1':
      return 'square';
    case '16:9':
    case '4:3':
      return 'landscape';
    case '9:16':
    case '3:4':
      return 'portrait';
    default:
      return 'landscape';
  }
}

function aspectRatioLabel(ar: StoryboardAspectRatio): string {
  switch (ar) {
    case '1:1':
      return '1:1';
    case '16:9':
      return '16:9';
    case '9:16':
      return '9:16';
    case '4:3':
      return '4:3';
    case '3:4':
      return '3:4';
    default:
      return ar;
  }
}

const StoryboardPreviewPanel: React.FC<StoryboardPreviewPanelProps> = ({
  frameCount,
  aspectRatio,
  locale: localeProp,
}) => {
  const { t, locale: contextLocale } = useLocale();
  const locale = localeProp || (contextLocale.startsWith('zh') ? 'zh' : 'en');
  const pt = t.storyboardPreviewPanel;

  const { rows, cols } = useMemo(() => computeOptimalGrid(frameCount), [frameCount]);
  const totalCells = rows * cols;
  const variant = aspectRatioIconVariant(aspectRatio);

  const ariaLabel = useMemo(() => {
    return pt.ariaLabel
      .replace('{aspectRatio}', aspectRatioLabel(aspectRatio))
      .replace('{rows}', String(rows))
      .replace('{cols}', String(cols))
      .replace('{frameCount}', String(frameCount));
  }, [pt.ariaLabel, aspectRatio, rows, cols, frameCount]);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <h4 className="text-sm font-semibold text-foreground mb-3">{pt.title}</h4>

      {/* Grid preview */}
      <div
        className="mx-auto w-full max-w-[220px]"
        aria-label={ariaLabel}
        role="img"
      >
        <div
          className="grid gap-1"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            aspectRatio: aspectRatio.replace(':', ' / '),
          }}
        >
          {Array.from({ length: totalCells }).map((_, idx) => (
            <div
              key={idx}
              className={`rounded-sm border ${
                idx < frameCount
                  ? idx % 2 === 0
                    ? 'bg-muted border-border'
                    : 'bg-primary/10 border-primary/20'
                  : 'bg-transparent border-dashed border-border/50'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Aspect ratio icon + summary */}
      <div className="mt-4 space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AspectRatioIcon variant={variant} active={false} className="w-4 h-4" />
          <span>
            {aspectRatioLabel(aspectRatio)} {locale === 'zh' ? '画面' : ''}
          </span>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            <span className="font-medium text-foreground">{pt.gridSize}:</span> {rows}×{cols}
          </p>
          <p>
            <span className="font-medium text-foreground">{pt.aspectRatio}:</span>{' '}
            {aspectRatioLabel(aspectRatio)}
          </p>
          <p>
            <span className="font-medium text-foreground">{pt.totalFrames}:</span> {frameCount}
          </p>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">{pt.hint}</p>
      </div>
    </div>
  );
};

export default StoryboardPreviewPanel;
