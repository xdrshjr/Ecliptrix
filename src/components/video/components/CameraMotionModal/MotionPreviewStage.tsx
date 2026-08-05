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
 *
 * A scrub bar under the stage freezes that loop at any point. Judging a motion
 * needs to be possible at a chosen instant, not only while it flies past — and
 * because the control is a real `<input type="range">`, that inspection works
 * with the arrow keys at whatever pace the user wants, mouse precision not
 * required.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import {
  Camera3DRenderer,
  fallbackCropForDraw,
  resolveCameraDraw,
  type CameraMotion,
} from '@/components/video/playback/camera';

export interface MotionStageLabels {
  scrub: string;
  /** `{percent}` placeholder — announced through `aria-valuetext`. */
  scrubValue: string;
  play: string;
  pause: string;
}

interface MotionPreviewStageProps {
  motion: CameraMotion | null;
  /** Clip duration in seconds — drives the window solve so timing is honest. */
  clipDuration: number;
  /**
   * Absolutely-positioned overlay drawn on top of the canvas (the direct-framing
   * layer). Passed as children rather than wired through a callback ON PURPOSE
   * (D45 / review P1-6): the draw loop below writes the playhead straight to the
   * DOM so animation costs zero React renders, and handing the per-frame
   * `ResolvedCameraDraw` up to a parent would re-render the whole panel subtree
   * at 60Hz for data the overlay does not even want — what it draws is the
   * SELECTED keyframe and the static path, both of which change only on edit.
   */
  children?: React.ReactNode;
  /**
   * The motion window as a fraction of the clip, highlighted on the scrub bar
   * (D44 / review P1-3). The scrub bar is in CLIP time while a keyframe's `at`
   * is normalized against the WINDOW; drawing the window makes that difference
   * visible instead of leaving the keyframe strip mysteriously out of register.
   */
  windowBand?: { from: number; to: number } | null;
  /** Accessible name for the band. */
  windowBandLabel?: string;
  /** Poster / thumbnail for the stage texture; a gradient stands in when absent. */
  posterUrl?: string;
  /** Loop period in seconds. */
  loopSeconds?: number;
  /** Auto-loop when true; frozen at {@link progress} when false. */
  playing: boolean;
  /** Frozen position in [0,1]; also the slider's value while paused. */
  progress: number;
  /** Dragging the slider reports here (and pauses the loop, in the parent). */
  onProgressChange: (u: number) => void;
  onTogglePlaying: () => void;
  labels: MotionStageLabels;
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
  playing,
  progress,
  onProgressChange,
  onTogglePlaying,
  labels,
  onDegraded,
  className,
  children,
  windowBand,
  windowBandLabel,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const rendererRef = useRef<Camera3DRenderer | null>(null);
  const textureRef = useRef<HTMLCanvasElement | HTMLImageElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const motionRef = useRef(motion);
  const durationRef = useRef(clipDuration);
  const degradedRef = useRef(false);
  const onDegradedRef = useRef(onDegraded);
  const playingRef = useRef(playing);
  const progressRef = useRef(progress);

  motionRef.current = motion;
  durationRef.current = clipDuration;
  onDegradedRef.current = onDegraded;
  playingRef.current = playing;
  progressRef.current = progress;

  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  /** Wall-clock origin of the current loop; re-anchored on every resume. */
  const loopStartRef = useRef<number | null>(null);
  const percentRef = useRef<HTMLSpanElement>(null);

  const percent = Math.round(clamp01(progress) * 100);

  /** Push a position into the DOM controls without going through React. */
  const writeScrubPosition = useCallback((u: number) => {
    const slider = sliderRef.current;
    if (slider) {
      slider.value = String(u);
      slider.setAttribute('aria-valuetext', valueText(labelsRef.current.scrubValue, u));
    }
    if (percentRef.current) {
      percentRef.current.textContent = `${Math.round(u * 100)}%`;
    }
  }, []);

  const handleScrub = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onProgressChange(clamp01(Number(event.target.value)));
    },
    [onProgressChange],
  );

  // Paused: React state owns the position (a reset, a preset change, or the
  // reduced-motion default). Playing: the draw loop owns it, so stay out.
  useEffect(() => {
    if (playing) return;
    writeScrubPosition(clamp01(progress));
  }, [playing, progress, writeScrubPosition]);

  // Resume from where the user parked the playhead, not from wherever the wall
  // clock happens to be: pressing play after inspecting a frame should continue
  // that motion, not teleport somewhere else in the loop.
  useEffect(() => {
    if (!playing) return;
    loopStartRef.current = now() - clamp01(progressRef.current) * loopSeconds * 1000;
    // `progress` intentionally omitted: re-anchoring on every scrub while
    // playing would fight the clock. It is read once, at the resume edge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, loopSeconds]);

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

    if (loopStartRef.current === null) {
      loopStartRef.current = now() - clamp01(progressRef.current) * loopSeconds * 1000;
    }

    const draw = (frameNow: number) => {
      const texture = textureRef.current;
      const currentMotion = motionRef.current;
      const duration = durationRef.current > 0 ? durationRef.current : loopSeconds;
      ctx.clearRect(0, 0, STAGE_W, STAGE_H);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, STAGE_W, STAGE_H);
      if (!texture) return;

      // While playing the position comes from the clock (anchored at the last
      // resume, so play/pause is continuous); while paused it is the scrub
      // value. The slider's DOM value is written directly, not through React,
      // so a 60Hz playhead never re-renders the panel around it.
      let u: number;
      if (playingRef.current) {
        const elapsed = (frameNow - (loopStartRef.current ?? frameNow)) / 1000;
        u = (((elapsed % loopSeconds) + loopSeconds) % loopSeconds) / loopSeconds;
        writeScrubPosition(u);
      } else {
        u = clamp01(progressRef.current);
      }
      // Map the loop position onto the clip's own timeline so the stage shows
      // the real window solve (including a custom start offset / duration).
      const tLocal = u * duration;
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

    const tick = (frameNow: number) => {
      draw(frameNow);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [loopSeconds, writeScrubPosition]);

  const bandVisible = windowBand != null && (windowBand.from > 0.001 || windowBand.to < 0.999);

  return (
    <div className="space-y-1.5">
      {/* The canvas and the overlay share one positioned box so the overlay can
          sit exactly on the picture without measuring anything. */}
      <div className="relative">
        <canvas
          ref={canvasRef}
          className={className ?? 'w-full rounded-lg border border-border bg-black'}
          style={{ aspectRatio: '16 / 9' }}
          role="img"
        />
        {children}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onTogglePlaying}
          aria-label={playing ? labels.pause : labels.play}
          title={playing ? labels.pause : labels.play}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border
            bg-card text-foreground transition-colors hover:bg-muted
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            {playing ? (
              <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
            ) : (
              <path d="M8 5v14l11-7z" />
            )}
          </svg>
        </button>
        {/* Uncontrolled ON PURPOSE: the playhead is written straight to the DOM
            by the draw loop (see above), so an animated slider costs zero React
            renders. While paused the effect below keeps it in sync with state. */}
        <div className="relative flex-1">
          {bandVisible && (
            <div
              className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2"
              aria-hidden="true"
            >
              <div
                className="absolute h-full rounded-full bg-primary/25"
                title={windowBandLabel}
                style={{
                  left: `${windowBand!.from * 100}%`,
                  width: `${Math.max(0, windowBand!.to - windowBand!.from) * 100}%`,
                }}
              />
            </div>
          )}
          <input
            ref={sliderRef}
            type="range"
            min={0}
            max={1}
            step={0.005}
            defaultValue={clamp01(progress)}
            onChange={handleScrub}
            aria-label={labels.scrub}
            aria-valuetext={valueText(labels.scrubValue, clamp01(progress))}
            className="relative h-1.5 w-full cursor-pointer accent-primary"
          />
        </div>
        <span
          ref={percentRef}
          className="w-9 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground"
        >
          {percent}%
        </span>
      </div>
    </div>
  );
};

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/** `'Motion progress {percent}%'` → `'Motion progress 42%'`. */
function valueText(template: string, u: number): string {
  return template.replace('{percent}', String(Math.round(u * 100)));
}

export default MotionPreviewStage;
