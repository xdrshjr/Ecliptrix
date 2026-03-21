'use client';

import React, { useState } from 'react';
import { StoryboardFrame } from '@/types';

interface FrameCardProps {
  frame: StoryboardFrame;
  /** 1-based display index shown in the badge */
  index: number;
  onClick: (frame: StoryboardFrame) => void;
}

/**
 * FrameCard — renders an individual storyboard frame thumbnail inside
 * the StoryboardPackView grid. Shows the frame image, a sequence number
 * badge, and a truncated description preview.
 */
const FrameCard: React.FC<FrameCardProps> = ({ frame, index, onClick }) => {
  const [imgError, setImgError] = useState(false);

  return (
    <div
      className="group bg-card border border-border rounded-md overflow-hidden transition-all cursor-pointer hover:border-primary/50"
      onClick={() => onClick(frame)}
    >
      {/* Frame thumbnail */}
      <div className="aspect-square bg-muted relative">
        {frame.url && !imgError ? (
          <img
            src={frame.url}
            alt={`Frame #${index}`}
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

        {/* Frame number badge — top-left */}
        <div className="absolute top-1 left-1">
          <span className="px-1.5 py-0.5 text-xs font-bold rounded bg-foreground/75 text-background">
            #{index}
          </span>
        </div>

        {/* Preview icon on hover — center */}
        <div className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-30 transition-all duration-200 flex items-center justify-center">
          <div className="w-8 h-8 rounded-md bg-card bg-opacity-90 flex items-center justify-center transition-all duration-200 opacity-0 group-hover:opacity-100">
            <svg className="w-4 h-4 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Description preview */}
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

export default FrameCard;
