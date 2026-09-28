'use client';
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CoverDocument } from '@/types/videoCover';
import { CoverError } from '@/types/videoCover';
import { CoverCanvas } from './CoverCanvas';
import { coverSize } from './layout';
import { coverAbort, coverDeadline, renderCover } from './renderCover';

export interface CoverRenderHostRef {
  render(document: CoverDocument, backgroundUrl?: string): Promise<Blob>;
}
export const CoverRenderHost = forwardRef<CoverRenderHostRef, { projectId: string }>(
function CoverRenderHost({ projectId }, ref) {
  const node = useRef<HTMLDivElement>(null);
  const [job, setJob] = useState<{ document: CoverDocument; url?: string }>();
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const abortRef = useRef(new AbortController());
  const pending = useRef(new Map<string, Promise<Blob>>());
  useEffect(() => {
    abortRef.current = new AbortController();
    return () => { abortRef.current.abort(); pending.current.clear(); };
  }, [projectId]);
  useImperativeHandle(ref, () => ({
    render(document, backgroundUrl) {
      const frozen = structuredClone(document);
      const key = `${projectId}:${JSON.stringify(frozen)}`;
      const existing = pending.current.get(key);
      if (existing) return existing;
      const signal = abortRef.current.signal;
      const task = tail.current.catch(() => undefined).then(async () => {
        coverAbort(signal);
        const local = new AbortController();
        const abort = () => local.abort();
        signal.addEventListener('abort', abort, { once: true });
        let url: string | undefined;
        try {
          return await coverDeadline((async () => {
          if (frozen.background.kind === 'asset') {
            if (!backgroundUrl?.startsWith('/api/storage/files/')) {
              throw new CoverError('COVER_ASSET_MISSING', 'COVER_ASSET_MISSING');
            }
            const response = await coverDeadline(fetch(backgroundUrl, { signal: local.signal }), 10000, local.signal);
            if (!response.ok) throw new CoverError('COVER_ASSET_MISSING', 'COVER_ASSET_MISSING');
            const blob = await coverDeadline(response.blob(), 10000, local.signal);
            coverAbort(local.signal);
            url = URL.createObjectURL(blob);
          }
          coverAbort(local.signal);
          flushSync(() => setJob({ document: frozen, url }));
          const canvas = node.current?.querySelector<HTMLElement>('[data-cover-canvas]');
          if (!canvas) throw new CoverError('COVER_RENDER_FAILED', 'COVER_RENDER_FAILED');
          return await renderCover(canvas, { ...coverSize(frozen.aspectRatio), signal: local.signal });
          })(), 15000, local.signal);
        } finally {
          local.abort(); signal.removeEventListener('abort', abort);
          if (url) URL.revokeObjectURL(url);
        }
      });
      pending.current.set(key, task); tail.current = task;
      void task.finally(() => pending.current.delete(key)).catch(() => undefined);
      return task;
    },
  }), [projectId]);
  return <div ref={node} aria-hidden="true" style={{ position: 'fixed',
    left: -30000, top: 0, pointerEvents: 'none' }}>
    {job && <CoverCanvas document={job.document} backgroundUrl={job.url} />}
  </div>;
});
