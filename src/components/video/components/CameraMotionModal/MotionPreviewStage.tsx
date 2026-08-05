'use client';

/**
 * MotionPreviewStage — the panel's large preview, in TRUE perspective.
 *
 * Plan: docs/plans/camera-motion-stills-and-desktop-gate/experiment-plan.md §4 (G2).
 *
 * The gallery cards deliberately settle for the affine shadow (a WebGL context
 * per card is not worth it at 60×34 px). The large preview is where the user
 * actually decides, so it renders exactly what the timeline canvas will: the
 * same `drawWithMotion` seam the compositor uses, so a 3D preset shows its real
 * foreshortening instead of a flattened approximation that quietly drops the one
 * property that makes it 3D.
 *
 * Everything is drawn in DEVICE pixels rather than under a DPR base transform.
 * The perspective renderer hands back an offscreen canvas sized in device
 * pixels, which a DPR-scaled context would then draw at 2× — geometry stays
 * identical either way, so device space is simply the one with no trap in it.
 *
 * Degradation is visible, never silent: no WebGL (or a lost context) falls back
 * to the affine shadow AND says so through a polite `role="status"` line, so the
 * user is not left comparing a 3D preset against a 2D picture with no
 * explanation (L6).
 */

import React, { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { motionStateAt, PerspectiveQuadRenderer, type CameraMotion } from '../../playback';
import { containInBox } from '../../playback/internal/boxTextureCache';
import { drawWithMotion } from '../../playback/internal/drawWithMotion';
import { drawSyntheticScene, LOOP_HOLD_SECONDS, LOOP_SECONDS } from './MotionPreviewThumb';

export interface MotionPreviewStageProps {
  /** The move to demonstrate. */
  motion: CameraMotion;
  /** Clip thumbnail; a synthetic scene is drawn when absent or unloadable. */
  imageSrc?: string;
  /** CSS pixel size of the stage. */
  width: number;
  height: number;
  /** Whether the loop should run. Static first frame when false. */
  active: boolean;
  /** Must match what the renderer will do for this clip (§3.1.1). */
  enforceCoverage?: boolean;
  className?: string;
}

const MotionPreviewStage: React.FC<MotionPreviewStageProps> = ({
  motion,
  imageSrc,
  width,
  height,
  active,
  enforceCoverage = true,
  className = '',
}) => {
  const { t } = useLocale();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const rendererRef = useRef<PerspectiveQuadRenderer | null>(null);
  const [perspectiveLost, setPerspectiveLost] = useState(false);
  const perspectiveLostRef = useRef(false);

  useEffect(() => {
    if (!imageSrc) {
      imageRef.current = null;
      return;
    }
    const image = new Image();
    // A CDN poster without CORS headers would taint the canvas, and a tainted
    // canvas cannot be uploaded as a WebGL texture at all — the 3D path would
    // silently become the 2D one for a reason that has nothing to do with 3D.
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

  // The GL context is owned for the panel's lifetime, not per frame: acquiring
  // is the expensive half, and one context for one visible preview keeps us far
  // from the browser's per-document limit (H3). Released on unmount — the
  // teardown method is `release()`; this class has no `dispose()`.
  useEffect(
    () => () => {
      rendererRef.current?.release();
      rendererRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    const deviceWidth = canvas.width;
    const deviceHeight = canvas.height;

    const acquirePerspective = (): PerspectiveQuadRenderer | null => {
      let renderer = rendererRef.current;
      if (!renderer) {
        renderer = new PerspectiveQuadRenderer();
        rendererRef.current = renderer;
      }
      return renderer.acquire() ? renderer : null;
    };

    const reportPerspective = (lost: boolean) => {
      if (perspectiveLostRef.current === lost) return;
      perspectiveLostRef.current = lost;
      setPerspectiveLost(lost);
    };

    const draw = (localTime: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, deviceWidth, deviceHeight);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, deviceWidth, deviceHeight);

      const state = motionStateAt(
        motion,
        { startTime: 0, duration: LOOP_SECONDS },
        localTime,
        deviceWidth / deviceHeight,
        enforceCoverage,
      );
      const image = imageRef.current;
      const hasImage = !!image && image.naturalWidth > 0;
      const fit = hasImage
        ? containInBox(image!.naturalWidth, image!.naturalHeight, deviceWidth, deviceHeight)
        : { x: 0, y: 0, width: deviceWidth, height: deviceHeight };
      // Only a real picture can be textured; the synthetic stand-in is drawn by
      // the 2D painter, so it must not be reported as a WebGL failure.
      const renderer = motion.space === '3d' && hasImage ? acquirePerspective() : null;
      reportPerspective(motion.space === '3d' && hasImage && !renderer);

      drawWithMotion({
        ctx,
        canvasSize: { width: deviceWidth, height: deviceHeight },
        motion: { space: motion.space, state },
        motionBox: { x: 0, y: 0, width: deviceWidth, height: deviceHeight },
        quadRect: fit,
        texture: hasImage ? image : null,
        acquirePerspective: () => renderer,
        clipToBox: true,
        paint: (target) => {
          if (hasImage) target.drawImage(image!, fit.x, fit.y, fit.width, fit.height);
          else drawSyntheticScene(target, deviceWidth, deviceHeight);
        },
      });
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
  }, [motion, width, height, active, enforceCoverage]);

  return (
    <div className={className}>
      <canvas
        ref={canvasRef}
        className="block w-full rounded-[3px] border border-border bg-black"
        style={{ width, height }}
        aria-hidden="true"
      />
      {perspectiveLost && (
        <p role="status" className="mt-1 text-center text-[11px] leading-snug text-muted-foreground">
          {t.timeline.cameraMotion.previewUnavailable}
        </p>
      )}
    </div>
  );
};

export default MotionPreviewStage;
