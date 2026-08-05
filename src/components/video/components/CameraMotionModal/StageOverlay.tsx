'use client';

/**
 * StageOverlay — direct framing on the panel's stage (§4.5.2 / G3).
 *
 * Sits above the stage canvas and turns pointer / wheel / keyboard gestures into
 * edits of the SELECTED keyframe, while drawing the framing rectangle, the 3D
 * corner wireframe and the motion path. All of the arithmetic lives in
 * `stageInteraction.ts`; this file is wiring plus accessibility.
 *
 * Three physical constraints govern the implementation (review R41). None of
 * them shows up as a failing test — they only show up as software that feels
 * wrong — so they are spelled out where they are enforced:
 *
 *  1. DRAW in the logical 480×270 `viewBox`, MEASURE with
 *     `getBoundingClientRect()`. The canvas backing store is 480×270 but its CSS
 *     width follows the panel, so constants would make drag sensitivity drift
 *     with the window width.
 *  2. The wheel listener must be registered natively with `{ passive: false }`.
 *     React registers `wheel` as passive, so `onWheel`'s `preventDefault()` does
 *     nothing — and since the panel body is `overflow-y-auto`, every zoom notch
 *     would scroll the panel out from under the user.
 *  3. It must NOT subscribe to per-frame data (D45). The stage writes its
 *     playhead straight to the DOM specifically so animation costs zero React
 *     renders; a per-frame callback up to the parent would re-render this whole
 *     subtree at 60Hz. Everything drawn here — the selected keyframe's framing,
 *     the path through all the keyframes — is static between edits anyway.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  cameraMotionConstants,
  computeCropRect,
  expandStops,
  keyframeAtTrajectory,
  project3DCorners,
  scaleQuad,
  type CameraKeyframe,
  type CameraMotion,
} from '@/components/video/playback/camera';
import {
  STAGE_ANGLE_STEP,
  STAGE_PAN_STEP,
  STAGE_VIEW_H,
  STAGE_VIEW_W,
  clampComponent,
  cropToStageRect,
  orbitDelta,
  panDelta,
  quadToStagePoints,
  rollDelta,
  tiltDelta,
  zoomDelta,
  zoomStep,
} from './stageInteraction';

export interface StageOverlayLabels {
  overlayLabel: string;
  hint: string;
}

interface StageOverlayProps {
  motion: CameraMotion;
  /** Index of the keyframe every gesture edits. */
  selectedIndex: number;
  /** Applies one component change to the selected keyframe. */
  onComponentChange: (key: keyof CameraKeyframe, value: number) => void;
  /** Raised on pointer-down so the panel can pause and park the playhead. */
  onInteractionStart?: () => void;
  /** True while a drag owns the pointer — the panel must not close mid-drag. */
  onDraggingChange?: (dragging: boolean) => void;
  labels: StageOverlayLabels;
  disabled?: boolean;
}

const StageOverlay: React.FC<StageOverlayProps> = ({
  motion,
  selectedIndex,
  onComponentChange,
  onInteractionStart,
  onDraggingChange,
  labels,
  disabled,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; shift: boolean } | null>(null);
  // Gesture handlers run outside React's render, so they read the current
  // motion / selection through refs instead of stale closure captures.
  const motionRef = useRef(motion);
  const selectedRef = useRef(selectedIndex);
  const disabledRef = useRef(disabled);
  const changeRef = useRef(onComponentChange);
  motionRef.current = motion;
  selectedRef.current = selectedIndex;
  disabledRef.current = disabled;
  changeRef.current = onComponentChange;

  /**
   * The static drawing (D45): the selected keyframe's framing plus the path
   * through every keyframe. Both change only when the user edits, never per
   * frame — so this is a `useMemo`, not a subscription.
   *
   * Every point below is RESOLVED through `keyframeAtTrajectory`, not read
   * straight off the stop. `intensity` scales the trajectory about the first
   * stop (D35), so at `intensity != 1` a stop's stored components are NOT what
   * the canvas underneath paints — an overlay drawn from them would hang a
   * framing box somewhere the picture never goes. At a stop `tau = at` exactly
   * (the segment ending there finishes at `s = 1`), so this reproduces what
   * `resolveCameraDraw` returns once the playhead is parked on the keyframe,
   * which is precisely what selecting or dragging one does.
   */
  const drawing = useMemo(() => {
    const stops = expandStops(motion);
    const index = Math.min(Math.max(selectedIndex, 0), stops.length - 1);
    const aspect = STAGE_VIEW_W / STAGE_VIEW_H;
    const constants = cameraMotionConstants(motion, aspect);
    const resolved = stops.map((stop) => keyframeAtTrajectory(motion, stop.at));
    const selected = resolved[index];
    const crop = computeCropRect(selected, constants.rollPad);
    const frame = cropToStageRect(crop, STAGE_VIEW_W, STAGE_VIEW_H);
    const path = resolved.map((keyframe) => ({
      x: keyframe.x * STAGE_VIEW_W,
      y: keyframe.y * STAGE_VIEW_H,
    }));
    let quadPoints: Array<{ x: number; y: number }> | null = null;
    if (motion.mode === '3d' && !constants.degraded) {
      const quad = project3DCorners(selected, aspect);
      if (quad) {
        quadPoints = quadToStagePoints(
          scaleQuad(quad, constants.coverScale), STAGE_VIEW_W, STAGE_VIEW_H,
        );
      }
    }
    return { crop, frame, path, quadPoints, index, count: stops.length };
  }, [motion, selectedIndex]);

  const cropRef = useRef(drawing.crop);
  cropRef.current = drawing.crop;

  /**
   * Current value of one component ON THE STOP — the raw stored number, which is
   * what `setKeyframeComponent` writes back. Gestures accumulate here, not on
   * the resolved value the overlay draws (`drawing` above), or `intensity` would
   * be folded in twice.
   */
  const readComponent = useCallback((key: keyof CameraKeyframe): number => {
    const stops = expandStops(motionRef.current);
    const index = Math.min(Math.max(selectedRef.current, 0), stops.length - 1);
    return stops[index][key] ?? 0;
  }, []);

  const bump = useCallback((key: keyof CameraKeyframe, next: number) => {
    changeRef.current(key, clampComponent(key, next));
  }, []);

  // ── Wheel: native + non-passive, or it scrolls the panel (review P1-5) ─────
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const handler = (event: WheelEvent) => {
      if (disabledRef.current) return;
      // Only meaningful because the listener is non-passive; React's own
      // `onWheel` is registered passive and this call would be ignored.
      event.preventDefault();
      onInteractionStart?.();
      bump('scale', zoomDelta(event.deltaY, readComponent('scale')));
    };
    host.addEventListener('wheel', handler, { passive: false });
    return () => host.removeEventListener('wheel', handler);
  }, [bump, readComponent, onInteractionStart]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    const host = hostRef.current;
    if (!host) return;
    host.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, shift: event.shiftKey };
    onDraggingChange?.(true);
    onInteractionStart?.();
  }, [disabled, onDraggingChange, onInteractionStart]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const host = hostRef.current;
    if (!drag || !host || disabled) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (dx === 0 && dy === 0) return;
    dragRef.current = { ...drag, x: event.clientX, y: event.clientY };
    // MEASURED, never the 480×270 constants (review P1-4).
    const rect = host.getBoundingClientRect();
    const mode = motionRef.current.mode;

    if (drag.shift || event.shiftKey) {
      if (mode === '3d') {
        if (Math.abs(dx) >= Math.abs(dy)) {
          bump('rotateY', readComponent('rotateY') + orbitDelta(dx, rect.width));
        } else {
          bump('rotateX', readComponent('rotateX') + tiltDelta(dy, rect.height));
        }
      } else {
        bump('roll', readComponent('roll') + rollDelta(dx, rect.width));
      }
      return;
    }

    const delta = panDelta(dx, dy, cropRef.current, rect.width, rect.height);
    bump('x', readComponent('x') + delta.dx);
    bump('y', readComponent('y') + delta.dy);
  }, [bump, disabled, readComponent]);

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    hostRef.current?.releasePointerCapture?.(event.pointerId);
    onDraggingChange?.(false);
  }, [onDraggingChange]);

  /**
   * Keyboard equivalents — required, not a nicety (A43). Every gesture above has
   * one here, and `ParameterControls`' number inputs remain the precise channel.
   */
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const fast = event.shiftKey ? 5 : 1;
    const pan = STAGE_PAN_STEP * fast;
    const angle = STAGE_ANGLE_STEP * fast;
    const is3d = motion.mode === '3d';
    let handled = true;
    switch (event.key) {
      case 'ArrowLeft': bump('x', readComponent('x') - pan); break;
      case 'ArrowRight': bump('x', readComponent('x') + pan); break;
      case 'ArrowUp': bump('y', readComponent('y') - pan); break;
      case 'ArrowDown': bump('y', readComponent('y') + pan); break;
      case '+':
      case '=': bump('scale', zoomStep(readComponent('scale'), 1)); break;
      case '-':
      case '_': bump('scale', zoomStep(readComponent('scale'), -1)); break;
      case '[':
        if (is3d) bump('rotateY', readComponent('rotateY') - angle);
        else bump('roll', readComponent('roll') - angle);
        break;
      case ']':
        if (is3d) bump('rotateY', readComponent('rotateY') + angle);
        else bump('roll', readComponent('roll') + angle);
        break;
      default: handled = false;
    }
    if (handled) {
      event.preventDefault();
      onInteractionStart?.();
    }
  }, [bump, disabled, motion.mode, onInteractionStart, readComponent]);

  const { frame, path, quadPoints } = drawing;
  const pathPoints = path.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');

  return (
    <div
      ref={hostRef}
      role="application"
      aria-label={labels.overlayLabel}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      className={`absolute inset-0 rounded-lg outline-none
        focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1
        ${disabled ? 'pointer-events-none' : 'cursor-grab active:cursor-grabbing'}`}
      title={labels.hint}
    >
      {/* Resolution-independent: the browser scales the viewBox, so nothing
          here needs to know the overlay's real pixel size. */}
      <svg
        viewBox={`0 0 ${STAGE_VIEW_W} ${STAGE_VIEW_H}`}
        className="h-full w-full"
        aria-hidden="true"
        focusable="false"
      >
        {/* 3D corner wireframe first, so the framing box reads on top of it. */}
        {quadPoints && (
          <polygon
            // Corners arrive TL, TR, BL, BR (FFmpeg `perspective` order); a
            // polygon needs them to walk the boundary, hence 0 → 1 → 3 → 2.
            points={[0, 1, 3, 2]
              .map((i) => `${quadPoints[i].x.toFixed(2)},${quadPoints[i].y.toFixed(2)}`)
              .join(' ')}
            fill="none"
            stroke="rgba(56,189,248,0.85)"
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
        )}

        {/* The motion path through every keyframe's framing centre — the one
            visual answer to "where does this move?". */}
        {path.length > 1 && (
          <polyline
            points={pathPoints}
            fill="none"
            stroke="rgba(250,250,250,0.55)"
            strokeWidth={1.25}
            strokeDasharray="4 3"
          />
        )}
        {path.map((point, index) => (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={index === drawing.index ? 4.5 : 3}
            fill={index === drawing.index ? 'rgb(56,189,248)' : 'rgba(250,250,250,0.7)'}
            stroke="rgba(15,23,42,0.85)"
            strokeWidth={1}
          />
        ))}

        {/* The selected keyframe's framing rectangle, with corner handles. */}
        <rect
          x={frame.x}
          y={frame.y}
          width={frame.width}
          height={frame.height}
          fill="none"
          stroke="rgb(56,189,248)"
          strokeWidth={1.75}
        />
        {[
          [frame.x, frame.y],
          [frame.x + frame.width, frame.y],
          [frame.x, frame.y + frame.height],
          [frame.x + frame.width, frame.y + frame.height],
        ].map(([cx, cy], index) => (
          <rect
            key={index}
            x={cx - 3}
            y={cy - 3}
            width={6}
            height={6}
            fill="rgb(56,189,248)"
            stroke="rgba(15,23,42,0.9)"
            strokeWidth={1}
          />
        ))}
      </svg>
    </div>
  );
};

export default StageOverlay;
