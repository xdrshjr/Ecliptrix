'use client';

/**
 * MotionPreviewStage — the panel's live "what will this look like" canvas
 * (spec §4.5.2 / R12).
 *
 * It calls the SAME `resolveCameraDraw` and the SAME `Camera3DRenderer` the
 * main preview uses, and reproduces the SAME D13 draw contract (destination
 * rect blown up by `rollPad`, rotate, clip). That is the whole point: two draw
 * implementations would be two things to keep in sync, and this way the stage
 * doubles as a live check on the math module.
 *
 * The loop is a 2s `requestAnimationFrame` cycle over the clip's own duration,
 * so the timing the user sees on the stage is the timing they will get.
 */

import React, { useEffect, useRef } from 'react';
import {
  Camera3DRenderer,
  fallbackCropForDraw,
  resolveCameraDraw,
  type CameraMotion,
} from '@/components/video/playback/camera';

interface MotionPreviewStageProps {
  motion: CameraMotion | null;
  /** Clip duration in seconds — drives the window solve so timing is honest. */
  clipDuration: number;
  /** Poster / thumbnail for the stage texture; a gradient stands in when absent. */
  posterUrl?: string;
  /** Loop period in seconds. */
  loopSeconds?: number;
  /** Static first frame instead of a loop (prefers-reduced-motion). */
  reducedMotion?: boolean;
  /** Raised once a 3D frame fell back to the 2D approximation. */
  onDegraded?: () => void;
  className?: string;
}

const STAGE_W = 480;
const STAGE_H = 270;

/** A neutral placeholder so the stage is never blank while a poster loads. */
function paintPlaceholder(ctx: CanvasRenderingContext2D): HTMLCanvasElement {
  const off = document.createElement('canvas');
  off.width = STAGE_W;
  off.height = STAGE_H;
  const octx = off.getContext('2d');
  if (!octx) return off;
  const gradient = octx.createLinearGradient(0, 0, STAGE_W, STAGE_H);
  gradient.addColorStop(0, '#334155');
  gradient.addColorStop(1, '#0f172a');
  octx.fillStyle = gradient;
  octx.fillRect(0, 0, STAGE_W, STAGE_H);
  // A coarse grid makes the motion legible even on a flat placeholder.
  octx.strokeStyle = 'rgba(148,163,184,0.35)';
  octx.lineWidth = 1;
  for (let x = 0; x <= STAGE_W; x += STAGE_W / 8) {
    octx.beginPath();
    octx.moveTo(x, 0);
    octx.lineTo(x, STAGE_H);
    octx.stroke();
  }
  for (let y = 0; y <= STAGE_H; y += STAGE_H / 6) {
    octx.beginPath();
    octx.moveTo(0, y);
    octx.lineTo(STAGE_W, y);
    octx.stroke();
  }
  octx.fillStyle = 'rgba(226,232,240,0.9)';
  octx.beginPath();
  octx.arc(STAGE_W / 2, STAGE_H / 2, 26, 0, Math.PI * 2);
  octx.fill();
  void ctx;
  return off;
}

const MotionPreviewStage: React.FC<MotionPreviewStageProps> = ({
  motion,
  clipDuration,
  posterUrl,
  loopSeconds = 2,
  reducedMotion = false,
  onDegraded,
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Camera3DRenderer | null>(null);
  const textureRef = useRef<HTMLCanvasElement | HTMLImageElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const motionRef = useRef(motion);
  const durationRef = useRef(clipDuration);
  const degradedRef = useRef(false);
  const onDegradedRef = useRef(onDegraded);

  motionRef.current = motion;
  durationRef.current = clipDuration;
  onDegradedRef.current = onDegraded;

  // Texture: the clip poster when available, else the painted placeholder.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return undefined;
    textureRef.current = paintPlaceholder(ctx);
    if (!posterUrl) return undefined;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      textureRef.current = img;
    };
    img.src = posterUrl;
    return () => {
      img.onload = null;
    };
  }, [posterUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    canvas.width = STAGE_W;
    canvas.height = STAGE_H;

    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const draw = (now: number) => {
      const texture = textureRef.current;
      const currentMotion = motionRef.current;
      const duration = durationRef.current > 0 ? durationRef.current : loopSeconds;
      ctx.clearRect(0, 0, STAGE_W, STAGE_H);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, STAGE_W, STAGE_H);
      if (!texture) return;

      const elapsed = reducedMotion ? 0 : ((now - start) / 1000) % loopSeconds;
      // Map the loop position onto the clip's own timeline so the stage shows
      // the real window solve (including a custom start offset / duration).
      const tLocal = (elapsed / loopSeconds) * duration;
      const camera = currentMotion
        ? resolveCameraDraw(currentMotion, tLocal, duration, STAGE_W / STAGE_H)
        : undefined;

      const naturalW = 'naturalWidth' in texture ? texture.naturalWidth || STAGE_W : texture.width;
      const naturalH = 'naturalHeight' in texture ? texture.naturalHeight || STAGE_H : texture.height;

      if (!camera) {
        ctx.drawImage(texture, 0, 0, STAGE_W, STAGE_H);
        return;
      }

      if (camera.mode === '3d' && !camera.degraded && camera.quad) {
        if (!rendererRef.current) rendererRef.current = new Camera3DRenderer();
        const surface = rendererRef.current.render(
          texture, camera.crop, camera.quad, STAGE_W, STAGE_H,
        );
        if (surface) {
          ctx.drawImage(surface, 0, 0, STAGE_W, STAGE_H);
          return;
        }
        if (!degradedRef.current) {
          degradedRef.current = true;
          onDegradedRef.current?.();
        }
      }

      const crop = camera.mode === '3d' ? fallbackCropForDraw(camera) : camera.crop;
      const rollPad = camera.rollPad > 1 ? camera.rollPad : 1;
      const dw = STAGE_W * rollPad;
      const dh = STAGE_H * rollPad;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, STAGE_W, STAGE_H);
      ctx.clip();
      if (camera.roll !== 0) {
        ctx.translate(STAGE_W / 2, STAGE_H / 2);
        ctx.rotate((camera.roll * Math.PI) / 180);
        ctx.translate(-STAGE_W / 2, -STAGE_H / 2);
      }
      try {
        ctx.drawImage(
          texture,
          crop.x * naturalW, crop.y * naturalH, crop.w * naturalW, crop.h * naturalH,
          (STAGE_W - dw) / 2, (STAGE_H - dh) / 2, dw, dh,
        );
      } catch {
        // A not-yet-decoded poster: the next frame will pick it up.
      }
      ctx.restore();
    };

    const tick = (now: number) => {
      draw(now);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [loopSeconds, reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      className={className ?? 'w-full rounded-lg border border-border bg-black'}
      style={{ aspectRatio: '16 / 9' }}
      role="img"
    />
  );
};

export default MotionPreviewStage;
