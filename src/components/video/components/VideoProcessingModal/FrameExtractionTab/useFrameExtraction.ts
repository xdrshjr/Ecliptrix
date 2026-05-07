'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { MaterialItem } from '@/types';

/** Default cap on captured frames per pack. Mirrors backend
 *  ``frame-pack-config.yaml > max_frames_per_pack``. */
export const DEFAULT_FRAME_CAP = 200;
const DEFAULT_JPEG_QUALITY_PERCENT = 92;
const THUMB_LONG_EDGE = 256;

/** Convert a percent-integer JPEG quality (1-100) to the 0-1 scale that
 *  ``HTMLCanvasElement.toBlob`` expects. (P1-7 in spec.) */
export function qualityToCanvasScale(percent: number): number {
  const clamped = Math.max(1, Math.min(100, Math.round(percent)));
  return clamped / 100;
}

export interface CapturedFrame {
  id: string;
  timestampSec: number;
  width: number;
  height: number;
  blob: Blob;
  thumbDataUrl: string;
}

export interface UseFrameExtractionOptions {
  source: MaterialItem | null;
  maxFrames?: number;
  jpegQualityPercent?: number;
}

export interface UseFrameExtractionReturn {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  frames: CapturedFrame[];
  capture: () => Promise<void>;
  remove: (id: string) => void;
  reorder: (fromIndex: number, toIndex: number) => void;
  clear: () => void;
  isAtCap: boolean;
  totalBytes: number;
}

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function blobToThumbDataUrl(
  videoEl: HTMLVideoElement,
  longEdge: number,
): Promise<string> {
  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  if (!vw || !vh) return '';
  const scale = Math.min(1, longEdge / Math.max(vw, vh));
  const tw = Math.max(1, Math.round(vw * scale));
  const th = Math.max(1, Math.round(vh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(videoEl, 0, 0, tw, th);
  return canvas.toDataURL('image/jpeg', 0.7);
}

export default function useFrameExtraction(
  opts: UseFrameExtractionOptions,
): UseFrameExtractionReturn {
  const { maxFrames = DEFAULT_FRAME_CAP, jpegQualityPercent = DEFAULT_JPEG_QUALITY_PERCENT } = opts;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [frames, setFrames] = useState<CapturedFrame[]>([]);

  const isAtCap = frames.length >= maxFrames;
  const totalBytes = useMemo(
    () => frames.reduce((sum, f) => sum + (f.blob.size || 0), 0),
    [frames],
  );

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    if (frames.length >= maxFrames) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    let canvas = offscreenCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      offscreenCanvasRef.current = canvas;
    }
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    const quality = qualityToCanvasScale(jpegQualityPercent);
    const blob: Blob | null = await new Promise((resolve) => {
      canvas!.toBlob((b) => resolve(b), 'image/jpeg', quality);
    });
    if (!blob) return;

    const thumbDataUrl = await blobToThumbDataUrl(video, THUMB_LONG_EDGE);

    setFrames((prev) => [
      ...prev,
      {
        id: genId(),
        timestampSec: video.currentTime,
        width: vw,
        height: vh,
        blob,
        thumbDataUrl,
      },
    ]);
  }, [frames.length, maxFrames, jpegQualityPercent]);

  const remove = useCallback((id: string) => {
    setFrames((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    setFrames((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.length) return prev;
      if (toIndex < 0 || toIndex >= prev.length) return prev;
      if (fromIndex === toIndex) return prev;
      const next = prev.slice();
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const clear = useCallback(() => setFrames([]), []);

  return {
    videoRef,
    frames,
    capture,
    remove,
    reorder,
    clear,
    isAtCap,
    totalBytes,
  };
}
