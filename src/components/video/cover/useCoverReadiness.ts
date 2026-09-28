'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CoverDocument, CoverReadinessIssue,
  CoverReadinessResult } from '@/types/videoCover';
import { findCoverCanvas, measureCoverText,
  validateCoverStructure } from './coverValidation';
import { coverDeadline } from './renderCover';

interface Options {
  document: CoverDocument | null;
  backgroundUrl?: string;
  readinessKey?: string;
  enabled: boolean;
  canvasNode: HTMLElement | null;
}
function previewUrl(url: string | undefined, key: number) {
  if (!url || !key || !url.startsWith('/api/storage/files/')) return url;
  const parsed = new URL(url, 'http://localhost');
  parsed.searchParams.set('cover_preview_retry', String(key));
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** All state is local observation; no editing or business writes belong here. */
export function useCoverReadiness(options: Options) {
  const { document: doc, backgroundUrl, readinessKey, enabled, canvasNode } = options;
  const [imageLoadKey, setImageLoadKey] = useState(0);
  const [fontEpoch, setFontEpoch] = useState(0);
  const sequence = useRef(0);
  const immediate = useRef(false);
  const identity = useMemo(() => ({ document: doc, backgroundUrl,
    readinessKey, enabled, canvasNode, imageLoadKey, fontEpoch }),
  [doc, backgroundUrl, readinessKey, enabled, canvasNode, imageLoadKey, fontEpoch]);
  const [stored, setStored] = useState<{
    identity: typeof identity; result: CoverReadinessResult;
  }>();
  const previewBackgroundUrl = previewUrl(backgroundUrl, imageLoadKey);
  const retry = useCallback(() => {
    immediate.current = true; setImageLoadKey(key => key + 1);
  }, []);

  // This effect owns the dependency wait and its observer. Layout-only changes
  // reuse settled resources so a taller issue panel cannot restart checking.
  useEffect(() => {
    const token = ++sequence.current;
    const abort = new AbortController();
    let frame = 0;
    let settled = false;
    let resourceIssues: CoverReadinessIssue[] = [];
    const valid = () => !abort.signal.aborted && token === sequence.current &&
      !!canvasNode?.isConnected;
    const publish = (status: CoverReadinessResult['status'],
      issues: CoverReadinessIssue[]) => {
      if (!valid()) return;
      setStored(previous => {
        if (previous?.identity === identity && previous.result.status === status &&
          JSON.stringify(previous.result.issues) === JSON.stringify(issues)) return previous;
        return { identity, result: { ...identity, sequence: token, status, issues } };
      });
    };
    const measure = () => {
      if (!valid() || !settled || !canvasNode) return;
      if (resourceIssues.length) { publish('blocked', resourceIssues); return; }
      const measured = measureCoverText(canvasNode);
      const issues = measured.overflowFields.map(field =>
        ({ code: 'text-overflow' as const, field }));
      publish(!measured.measurable ? 'checking' : issues.length ? 'blocked' : 'ready', issues);
    };
    const canvas = canvasNode && findCoverCanvas(canvasNode);
    if (!enabled || !doc || !readinessKey || !canvas ||
      validateCoverStructure(doc, backgroundUrl).length) return () => abort.abort();
    const waitFor = async (promise: Promise<unknown>, code: CoverReadinessIssue['code']) => {
      try { await coverDeadline(promise, 10000, abort.signal); return []; }
      catch { return [{ code }]; }
    };
    const check = async () => {
      const image = canvas.querySelector('img');
      // Explicit retry must inspect the newly committed img, never its predecessor.
      const imageReady = doc.background.kind !== 'asset' ? Promise.resolve([])
        : waitFor(image && image.getAttribute('src') === previewBackgroundUrl
          ? Promise.resolve().then(() => image.decode()) : Promise.reject(),
        'background-unreadable');
      const fontsReady = doc.mode === 'ai' ? Promise.resolve([])
        : waitFor(Promise.resolve(canvas.ownerDocument.fonts?.ready), 'font-unavailable');
      const results = await Promise.all([imageReady, fontsReady]);
      if (!valid()) return;
      resourceIssues = results.flat(); settled = true; measure();
    };
    const timer = setTimeout(() => { void check(); }, immediate.current ? 0 : 150);
    immediate.current = false;
    let bounds = '';
    const observer = new ResizeObserver(() => {
      const rect = canvasNode!.getBoundingClientRect();
      const next = `${rect.width}:${rect.height}:${canvas.clientWidth}:${canvas.clientHeight}`;
      if (next === bounds) return;
      bounds = next;
      if (!rect.width || !rect.height) publish('checking', []);
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); });
    });
    observer.observe(canvasNode!); observer.observe(canvas);
    const fonts = canvas.ownerDocument.fonts;
    const refreshFonts = () => setFontEpoch(epoch => epoch + 1);
    if (doc.mode !== 'ai') {
      fonts?.addEventListener?.('loadingdone', refreshFonts);
      fonts?.addEventListener?.('loadingerror', refreshFonts);
    }
    return () => {
      abort.abort(); clearTimeout(timer); cancelAnimationFrame(frame);
      observer.disconnect();
      fonts?.removeEventListener?.('loadingdone', refreshFonts);
      fonts?.removeEventListener?.('loadingerror', refreshFonts);
    };
  }, [identity, doc, backgroundUrl, readinessKey, enabled, canvasNode, previewBackgroundUrl]);

  const issues = enabled && doc && readinessKey
    ? validateCoverStructure(doc, backgroundUrl) : [];
  const fallback: CoverReadinessResult = { ...identity, sequence: sequence.current,
    status: issues.length ? 'blocked' : 'checking', issues };
  const result = stored?.identity === identity ? stored.result : fallback;
  return { result, retry, imageLoadKey, previewBackgroundUrl };
}
