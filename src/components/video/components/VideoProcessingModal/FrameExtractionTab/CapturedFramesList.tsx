'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { CapturedFrame } from './useFrameExtraction';

interface CapturedFramesListProps {
  frames: CapturedFrame[];
  maxFrames: number;
  onRemove: (id: string) => void;
  onSeek?: (timestampSec: number) => void;
}

function formatTimestamp(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00.00';
  const minutes = Math.floor(sec / 60);
  const remainder = sec - minutes * 60;
  return `${minutes}:${remainder.toFixed(2).padStart(5, '0')}`;
}

const CapturedFramesList: React.FC<CapturedFramesListProps> = ({
  frames,
  maxFrames,
  onRemove,
  onSeek,
}) => {
  const { t } = useLocale();
  const fe = t.videoProcessing.frameExtraction;

  if (!fe) return null;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border">
        <span className="text-xs font-medium text-foreground">
          {fe.capturedListTitle}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {fe.capturedListCount
            .replace('{count}', String(frames.length))
            .replace('{max}', String(maxFrames))}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
        {frames.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6 px-2">
            {fe.capturedListEmpty}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {frames.map((frame, index) => (
              <li
                key={frame.id}
                className="group flex items-center gap-2 rounded-md border border-border bg-card px-1.5 py-1.5 hover:border-primary/50 transition-colors"
              >
                <button
                  type="button"
                  onClick={() => onSeek?.(frame.timestampSec)}
                  className="flex-shrink-0 w-16 aspect-video rounded overflow-hidden bg-muted relative"
                  title={`${index + 1} · ${formatTimestamp(frame.timestampSec)}`}
                >
                  {frame.thumbDataUrl ? (
                    <img
                      src={frame.thumbDataUrl}
                      alt={`frame ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  ) : null}
                  <span className="absolute bottom-0 right-0 text-[9px] text-white bg-black/60 px-1 rounded-tl">
                    {index + 1}
                  </span>
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-foreground font-medium truncate">
                    #{index + 1}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {formatTimestamp(frame.timestampSec)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(frame.id)}
                  className="flex-shrink-0 w-6 h-6 rounded bg-destructive/10 hover:bg-destructive text-destructive hover:text-destructive-foreground flex items-center justify-center transition-colors"
                  title={fe.removeFrame}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default CapturedFramesList;
