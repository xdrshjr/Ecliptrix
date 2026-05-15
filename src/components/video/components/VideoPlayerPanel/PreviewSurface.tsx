'use client';

/**
 * PreviewSurface — playback rendering layer.
 *
 * Spec: docs/plans/video-editor-playback-optimization/specs/01-architecture-refactor.md §3, §4, §5
 *
 * The full responsibility (canvas + A/B hidden `<video>` pool + letterbox)
 * lands across specs 03 (compositor) and 04 (A/B buffer). Round 1 ships
 * this file as a **scaffold**: it exposes the variant prop and a stable DOM
 * structure, but does not yet replace the inline rendering in
 * `VideoPlayerPanel`. The legacy variant returns `null` so `VideoPlayerPanel`
 * keeps owning the live DOM — see "实施过程发现的方案缺陷" in spec 01 for
 * the staged rollout plan.
 */

import React, { forwardRef, useImperativeHandle, useRef } from 'react';

export type PreviewSurfaceVariant = 'legacy' | 'v2';

export interface PreviewSurfaceProps {
  variant: PreviewSurfaceVariant;
  className?: string;
  ariaLabel?: string;
}

export interface PreviewSurfaceHandle {
  /** v2: backing `<canvas>`. legacy: null. */
  getCanvas(): HTMLCanvasElement | null;
  /** v2: hidden `<video>` element A. legacy: null. */
  getVideoA(): HTMLVideoElement | null;
  /** v2: hidden `<video>` element B. legacy: null. */
  getVideoB(): HTMLVideoElement | null;
}

const HIDDEN_VIDEO_STYLE: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  opacity: 0,
  pointerEvents: 'none',
};

const PreviewSurface = forwardRef<PreviewSurfaceHandle, PreviewSurfaceProps>(
  function PreviewSurface({ variant, className, ariaLabel }, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const videoARef = useRef<HTMLVideoElement | null>(null);
    const videoBRef = useRef<HTMLVideoElement | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        getCanvas: () => canvasRef.current,
        getVideoA: () => videoARef.current,
        getVideoB: () => videoBRef.current,
      }),
      []
    );

    if (variant === 'legacy') {
      // Legacy path is owned by VideoPlayerPanel inline rendering.
      // Spec 01 §五 guarantees identical behavior when flag is off.
      return null;
    }

    return (
      <div className={className} aria-label={ariaLabel}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
        <video ref={videoARef} muted playsInline preload="auto" style={HIDDEN_VIDEO_STYLE} />
        <video ref={videoBRef} muted playsInline preload="auto" style={HIDDEN_VIDEO_STYLE} />
      </div>
    );
  }
);

export default PreviewSurface;
