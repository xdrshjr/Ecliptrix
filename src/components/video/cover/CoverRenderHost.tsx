'use client';
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CoverDocument } from '@/types/videoCover';
import { CoverError } from '@/types/videoCover';
import { CoverCanvas } from './CoverCanvas';
import { coverSize } from './layout';
import { coverAbort, createCoverRenderScope, renderCover,
  waitCoverResource, type CoverRenderScope } from './renderCover';
import { assertCoverStructure, findCoverCanvas } from './coverValidation';

export interface CoverRenderHostRef {
  render(document: CoverDocument, backgroundUrl?: string): Promise<Blob>;
}
interface RenderJob { id: number; document: CoverDocument; url?: string }

async function fetchBackground(url: string, scope: CoverRenderScope) {
  scope.check();
  const response = await waitCoverResource(scope, () => fetch(url, {
    signal: scope.signal, cache: 'no-store',
  }), 'COVER_BACKGROUND_UNREADABLE');
  scope.check();
  if (!response.ok) {
    const code = response.status === 404 || response.status === 410
      ? 'COVER_ASSET_MISSING' : 'COVER_BACKGROUND_UNREADABLE';
    throw new CoverError(code, code);
  }
  const blob = await waitCoverResource(scope, () => response.blob(),
    'COVER_BACKGROUND_UNREADABLE');
  scope.check();
  return URL.createObjectURL(blob);
}

async function executeJob(options: {
  id: number; document: CoverDocument; backgroundUrl?: string;
  signal: AbortSignal; mount(job: RenderJob): HTMLElement;
  clear(id: number): void;
}) {
  const scope = createCoverRenderScope(options.signal);
  let url: string | undefined;
  try {
    scope.check();
    assertCoverStructure(options.document, options.backgroundUrl);
    if (options.document.background.kind === 'asset') {
      url = await fetchBackground(options.backgroundUrl!, scope);
      scope.check();
    }
    const canvas = options.mount({ id: options.id,
      document: options.document, url });
    scope.check();
    const result = await renderCover(canvas, {
      ...coverSize(options.document.aspectRatio), scope,
    });
    scope.check(); return result;
  } finally {
    scope.dispose();
    if (url) URL.revokeObjectURL(url);
    options.clear(options.id);
  }
}

export const CoverRenderHost = forwardRef<CoverRenderHostRef, { projectId: string }>(
function CoverRenderHost({ projectId }, ref) {
  const node = useRef<HTMLDivElement>(null);
  const [job, setJob] = useState<RenderJob>();
  const nextJob = useRef(0);
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const abortRef = useRef(new AbortController());
  const pending = useRef(new Map<string, Promise<Blob>>());
  useEffect(() => {
    const controller = new AbortController();
    const requests = pending.current;
    abortRef.current = controller;
    return () => { controller.abort(); requests.clear(); };
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
        return executeJob({ id: ++nextJob.current, document: frozen,
          backgroundUrl, signal,
          mount(current) {
            flushSync(() => setJob(current));
            const canvas = node.current && findCoverCanvas(node.current);
            if (!canvas) {
              throw new CoverError('COVER_RENDER_FAILED', 'COVER_RENDER_FAILED');
            }
            return canvas;
          },
          clear(id) { setJob(current => current?.id === id ? undefined : current); },
        });
      });
      pending.current.set(key, task); tail.current = task;
      void task.finally(() => {
        if (pending.current.get(key) === task) pending.current.delete(key);
      }).catch(() => undefined);
      return task;
    },
  }), [projectId]);
  return <div ref={node} aria-hidden="true" style={{ position: 'fixed',
    left: -30000, top: 0, pointerEvents: 'none' }}>
    {job && <CoverCanvas key={job.id} document={job.document}
      imageLoadKey={job.id} backgroundUrl={job.url} />}
  </div>;
});
