'use client';

import { useCallback, useRef, useState, type RefObject } from 'react';

import { aspectRatioToSize } from '../utils/aspectRatioToSize';
import type { CoverAspectRatio } from '../types';

export interface UseCoverRenderResult {
  render: () => Promise<{
    blob: Blob;
    dataUrl: string;
    width: number;
    height: number;
  }>;
  isRendering: boolean;
  lastError: Error | null;
}

/**
 * Hook that converts the modal's preview DOM subtree into a high-resolution
 * PNG blob using ``html-to-image``. ``fontEmbedCSS`` is intentionally NOT
 * passed — v1 templates are restricted to web-safe / system stacks (P1-2),
 * so the OS rendering matches the in-app preview faithfully.
 *
 * On render failure, the hook retries ONCE at 720p short-side.
 */
export function useCoverRender(
  previewRef: RefObject<HTMLElement | null>,
  aspectRatio: CoverAspectRatio,
): UseCoverRenderResult {
  const [isRendering, setIsRendering] = useState(false);
  const [lastError, setLastError] = useState<Error | null>(null);
  const inFlightRef = useRef(false);

  const render = useCallback(async () => {
    if (inFlightRef.current) {
      throw new Error('Render already in progress');
    }
    inFlightRef.current = true;
    setIsRendering(true);
    setLastError(null);

    const node = previewRef.current;
    if (!node) {
      inFlightRef.current = false;
      setIsRendering(false);
      const err = new Error('Preview element not mounted');
      setLastError(err);
      throw err;
    }

    // Lazy-import so the dependency only loads when the user actually clicks
    // "Download Cover" (saves a few KB on initial page hydration).
    const htmlToImage = await import('html-to-image');

    const tryRender = async (
      width: number,
      height: number,
    ): Promise<{ blob: Blob; dataUrl: string; width: number; height: number }> => {
      // `--cover-px` is now CSS-derived from `100cqw / nativeW`, so html-to-image
      // can snapshot the subtree at full export width without any JS-side
      // pixel-ratio coordination. pixelRatio:1 keeps bytes proportional to the
      // requested canvas size and prevents accidental 2× upscaling.
      const blob = await htmlToImage.toBlob(node, {
        width,
        height,
        pixelRatio: 1,
        cacheBust: false,
        canvasWidth: width,
        canvasHeight: height,
      });
      if (!blob) throw new Error('html-to-image returned null blob');
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
        reader.readAsDataURL(blob);
      });
      return { blob, dataUrl, width, height };
    };

    const full = aspectRatioToSize(aspectRatio);
    try {
      const result = await tryRender(full.width, full.height);
      inFlightRef.current = false;
      setIsRendering(false);
      return result;
    } catch (firstErr) {
      // Retry at half resolution (720p short side)
      try {
        const half = { width: Math.round(full.width / 1.5), height: Math.round(full.height / 1.5) };
        const result = await tryRender(half.width, half.height);
        inFlightRef.current = false;
        setIsRendering(false);
        return result;
      } catch (secondErr) {
        inFlightRef.current = false;
        setIsRendering(false);
        const err = secondErr instanceof Error ? secondErr : new Error(String(secondErr));
        setLastError(err);
        throw err;
      } finally {
        // Surface the original error in console so debug telemetry stays useful
        if (typeof console !== 'undefined') {
          // eslint-disable-next-line no-console
          console.warn('[useCoverRender] full-resolution render failed; tried 720p fallback', firstErr);
        }
      }
    }
  }, [previewRef, aspectRatio]);

  return { render, isRendering, lastError };
}
