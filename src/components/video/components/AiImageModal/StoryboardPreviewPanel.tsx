'use client';

import React, { useMemo } from 'react';
import {
  STORYBOARD_BATCH_SIZE,
  StoryboardAspectRatio,
} from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
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

/**
 * Preview panel that mirrors how the backend will lay out scenes: one 2×2
 * mini-grid per batch, with ``ceil(frameCount / 4)`` batches stacked
 * vertically. Unused cells in the final batch render as dashed placeholders
 * to communicate that Seedream will still see a 4-cell prompt but those
 * cells are discarded post-crop.
 */
const StoryboardPreviewPanel: React.FC<StoryboardPreviewPanelProps> = ({
  frameCount,
  aspectRatio,
  locale: localeProp,
}) => {
  const { t, locale: contextLocale } = useLocale();
  const locale = localeProp || (contextLocale.startsWith('zh') ? 'zh' : 'en');
  const pt = t.storyboardPreviewPanel;
  const variant = aspectRatioIconVariant(aspectRatio);

  const { batches, totalCells } = useMemo(() => {
    const safeCount = Math.max(1, frameCount);
    const batchCount = Math.ceil(safeCount / STORYBOARD_BATCH_SIZE);
    return {
      batches: batchCount,
      totalCells: batchCount * STORYBOARD_BATCH_SIZE,
    };
  }, [frameCount]);

  const ariaLabel = useMemo(() => {
    return pt.ariaLabel
      .replace('{aspectRatio}', aspectRatioLabel(aspectRatio))
      .replace('{batches}', String(batches))
      .replace('{frameCount}', String(frameCount));
  }, [pt.ariaLabel, aspectRatio, batches, frameCount]);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <h4 className="text-sm font-semibold text-foreground mb-3">{pt.title}</h4>

      {/* Stack of 2×2 batch previews */}
      <div className="mx-auto w-full max-w-[220px] space-y-3" aria-label={ariaLabel} role="img">
        {Array.from({ length: batches }).map((_, bi) => (
          <div key={bi}>
            <div className="text-[10px] text-muted-foreground mb-1">
              {pt.batchLabel.replace('{index}', String(bi + 1)).replace('{total}', String(batches))}
            </div>
            <div
              className="grid gap-1"
              style={{
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                aspectRatio: aspectRatio.replace(':', ' / '),
              }}
            >
              {Array.from({ length: STORYBOARD_BATCH_SIZE }).map((__, ci) => {
                const globalIdx = bi * STORYBOARD_BATCH_SIZE + ci;
                const active = globalIdx < frameCount;
                return (
                  <div
                    key={ci}
                    className={`rounded-sm border ${
                      active
                        ? ci % 2 === 0
                          ? 'bg-muted border-border'
                          : 'bg-primary/10 border-primary/20'
                        : 'bg-transparent border-dashed border-border/50'
                    }`}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="mt-4 space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AspectRatioIcon variant={variant} active={false} className="w-4 h-4" />
          <span>
            {aspectRatioLabel(aspectRatio)} {locale === 'zh' ? '画面' : ''}
          </span>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            <span className="font-medium text-foreground">{pt.batchCount}:</span>{' '}
            {pt.batchCountValue
              .replace('{batches}', String(batches))
              .replace('{batchSize}', String(STORYBOARD_BATCH_SIZE))
              .replace('{totalCells}', String(totalCells))}
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
