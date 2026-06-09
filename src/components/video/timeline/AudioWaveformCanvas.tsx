'use client';

/**
 * AudioWaveformCanvas — renders an audio item's persisted waveform on the
 * timeline track (spec 04 — 本地音频波形).
 *
 * Reads peaks from the shared {@link waveformCache} (backend FFmpeg-generated,
 * persisted) and draws them via the pure {@link drawWaveform} canvas renderer.
 * NEVER decodes audio in the browser. While peaks are pending it shows a quiet
 * animated placeholder; on failure it degrades to a flat baseline (never
 * blocks the track render).
 *
 * Clip trim/split is honoured by passing the item's `clipStart/clipEnd` to the
 * renderer, which slices the peaks to the matching source interval.
 */

import React, { useEffect, useRef, useState } from 'react';
import { drawWaveform } from '../lib/waveform/drawWaveform';
import { waveformCache, type CacheState } from '../lib/waveform/waveformCache';

interface AudioWaveformCanvasProps {
  materialId: string;
  /** Same-origin audio reference used to trigger generation when missing. */
  audioUrl: string;
  width: number;
  height: number;
  clipStart?: number;
  clipEnd?: number;
  /** Bar fill color. Defaults to translucent white over the clip gradient. */
  color?: string;
}

const AudioWaveformCanvas: React.FC<AudioWaveformCanvasProps> = ({
  materialId,
  audioUrl,
  width,
  height,
  clipStart,
  clipEnd,
  color,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<CacheState>(() =>
    waveformCache.status(materialId),
  );

  // Ensure peaks (idempotent) whenever the material changes.
  useEffect(() => {
    if (!materialId || !audioUrl) return;
    let cancelled = false;
    // Reflect cached readiness synchronously, then resolve async.
    setState(waveformCache.status(materialId));
    waveformCache
      .ensure(materialId, audioUrl)
      .then((result) => {
        if (!cancelled) setState(result);
      })
      .catch(() => {
        if (!cancelled) setState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [materialId, audioUrl]);

  // Redraw whenever geometry, clip interval, or readiness changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const peaks = waveformCache.peaksFor(materialId, { clipStart, clipEnd });
    const pps = waveformCache.peaksPerSecond(materialId);

    // Empty peaks (pending / failed) → drawWaveform renders a flat baseline
    // placeholder rather than throwing.
    drawWaveform(ctx, peaks ?? [], {
      width,
      height,
      peaksPerSecond: pps,
      // Peaks are pre-sliced by peaksFor, so don't re-slice in the renderer.
      color,
    });
  }, [materialId, width, height, clipStart, clipEnd, color, state]);

  const isPending = state === 'pending' || state === 'idle';

  return (
    <canvas
      ref={canvasRef}
      width={Math.max(1, Math.floor(width))}
      height={Math.max(1, Math.floor(height))}
      className={`pointer-events-none absolute inset-0 h-full w-full ${
        isPending ? 'opacity-50 animate-pulse' : 'opacity-100'
      }`}
      aria-hidden="true"
    />
  );
};

export default AudioWaveformCanvas;
