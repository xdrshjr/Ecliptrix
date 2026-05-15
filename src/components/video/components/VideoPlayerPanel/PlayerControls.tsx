'use client';

/**
 * PlayerControls — controls strip.
 *
 * Spec: docs/plans/video-editor-playback-optimization/specs/01-architecture-refactor.md §3
 *
 * Round 1 ships the file as a scaffold. The extraction of inline buttons,
 * sliders, ratio toggles, and the CoverButton from `VideoPlayerPanel.tsx`
 * is staged across rounds 2-4 to keep the diff reviewable. See
 * "实施过程发现的方案缺陷" in spec 01.
 */

import React from 'react';

export interface PlayerControlsProps {
  /** Children allow VideoPlayerPanel to project its current inline controls
   *  into this slot without changing the surrounding layout. */
  children?: React.ReactNode;
  className?: string;
}

export default function PlayerControls({ children, className }: PlayerControlsProps) {
  return <div className={className}>{children}</div>;
}
