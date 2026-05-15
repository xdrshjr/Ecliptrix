'use client';

/**
 * PlayerOverlays — image / subtitle / cover overlay slot.
 *
 * Spec: docs/plans/video-editor-playback-optimization/specs/01-architecture-refactor.md §3
 *
 * Round 1 scaffold. Inline `ImageOverlay` and subtitle rendering remain in
 * `VideoPlayerPanel.tsx`; staged extraction is tracked in
 * "实施过程发现的方案缺陷" in spec 01.
 */

import React from 'react';

export interface PlayerOverlaysProps {
  children?: React.ReactNode;
  className?: string;
}

export default function PlayerOverlays({ children, className }: PlayerOverlaysProps) {
  return <div className={className}>{children}</div>;
}
