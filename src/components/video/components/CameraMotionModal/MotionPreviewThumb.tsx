'use client';

/**
 * MotionPreviewThumb — a looping mini preview of one camera move.
 *
 * Plan: docs/plans/timeline-camera-motion/experiment-plan.md §6.2.
 *
 * Shows the move on the CLIP'S OWN frame rather than a generic diagram, so what
 * the user picks is what they get. It reuses `CameraMotionLayer` — the exact
 * geometry the preview compositor and the FFmpeg export consume — so a card can
 * never advertise a framing the render will not produce.
 *
 * Two deliberate limits:
 *   - 3D moves render through the affine shadow (`affineFrom`). A WebGL context
 *     per card would cost more than the extra fidelity is worth at 60×34 px; the
 *     large preview and the real canvas do the true perspective.
 *   - Animation only runs while `active`, so the gallery can cap how many cards
 *     move at once (L8) and `prefers-reduced-motion` can stop them entirely.
 */

import React, { useEffect, useRef } from 'react';
import {
  affineFrom,
  cameraHomography,
  motionStateAt,
  type CameraMotion,
} from '../../playback';

/** Seconds for one loop of the demo animation. */
const LOOP_SECONDS = 2.4;
/** Pause at the end of a loop so the final framing reads before it restarts. */
const LOOP_HOLD_SECONDS = 0.5;

export interface MotionPreviewThumbProps {
  /** The move to demonstrate. */
  motion: CameraMotion;
  /** Clip thumbnail; a synthetic scene is drawn when absent or unloadable. */
  imageSrc?: string;
  /** CSS pixel size of the canvas. */
  width: number;
  height: number;
  /** Whether the loop should run. Static first frame when false. */
  active: boolean;
  className?: string;
}

/**
 * A legible stand-in when the clip has no usable thumbnail. Deliberately
 * asymmetric — a centred symmetric pattern would make pans and orbits invisible.
 */
function drawSyntheticScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#3b82f6');
  gradient.addColorStop(1, '#8b5cf6');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(width * 0.3, height * 0.35, Math.min(width, height) * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(width * 0.55, height * 0.55, width * 0.35, height * 0.3);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = Math.max(1, width * 0.012);
  ctx.strokeRect(width * 0.08, height * 0.08, width * 0.84, height * 0.84);
}

function containRect(
  sourceW: number,
  sourceH: number,
  destW: number,
  destH: number,
): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(destW / sourceW, destH / sourceH);
  const w = sourceW * scale;
  const h = sourceH * scale;
  return { x: (destW - w) / 2, y: (destH - h) / 2, width: w, height: h };
}

const MotionPreviewThumb: React.FC<MotionPreviewThumbProps> = ({
  motion,
  imageSrc,
  width,
  height,
  active,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!imageSrc) {
      imageRef.current = null;
      return;
    }
    const image = new Image();
    // Same-origin thumbnails only in practice; crossOrigin keeps a CDN poster
    // from tainting the canvas (which would break the same capture path the
    // main compositor relies on).
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      imageRef.current = image;
    };
    image.onerror = () => {
      imageRef.current = null;
    };
    image.src = imageSrc;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [imageSrc]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));

    const draw = (localTime: number) => {
      // The DPR scale is the canvas' BASE transform. The motion must compose on
      // top of it with `transform` (multiply); `setTransform` would replace it
      // and silently render at 1× on a HiDPI screen (plan §4.1).
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);

      const state = motionStateAt(
        motion,
        { startTime: 0, duration: LOOP_SECONDS },
        localTime,
        width / height,
      );
      const affine = affineFrom(cameraHomography(state, { width, height }));

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
      ctx.clip();
      ctx.transform(affine[0], affine[1], affine[2], affine[3], affine[4], affine[5]);
      const image = imageRef.current;
      if (image && image.naturalWidth > 0) {
        const fit = containRect(image.naturalWidth, image.naturalHeight, width, height);
        try {
          ctx.drawImage(image, fit.x, fit.y, fit.width, fit.height);
        } catch {
          drawSyntheticScene(ctx, width, height);
        }
      } else {
        drawSyntheticScene(ctx, width, height);
      }
      ctx.restore();
    };

    if (!active) {
      draw(0);
      return;
    }

    const step = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const elapsed = (now - startRef.current) / 1000;
      const cycle = LOOP_SECONDS + LOOP_HOLD_SECONDS;
      draw(Math.min(elapsed % cycle, LOOP_SECONDS));
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      startRef.current = null;
    };
  }, [motion, width, height, active]);

  return (
    <canvas
      ref={canvasRef}
      className={`block rounded-[3px] bg-black ${className}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
};

export default MotionPreviewThumb;
