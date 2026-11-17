'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listEffectDraftPage } from '@/lib/api/effects';
import type { EffectDraftSummary } from '@/types/effects';

interface State {
  projectId?: string; active: boolean; listEpoch: number;
  items: EffectDraftSummary[]; nextCursor?: string;
  loading: boolean; loadingMore: boolean; error?: Error;
  errorPhase?: 'first-page' | 'load-more';
}
const initial = (projectId: string | undefined, active: boolean, listEpoch = 0): State =>
  ({ projectId, active, listEpoch, items: [], loading: false, loadingMore: false });

/** Read-only directory ownership is independent of the editor's write lease. */
export function useEffectsDraftList(projectId: string | undefined, active: boolean) {
  const [, render] = useState(0);
  const state = useRef(initial(projectId, active));
  const request = useRef<{ abort: AbortController; cursor?: string;
    promise: Promise<EffectDraftSummary[]> } | undefined>(undefined);
  const summaries = useRef(new Map<string, EffectDraftSummary>());
  const started = useRef(false);
  const invalidate = useCallback(() => {
    state.current.listEpoch++;
    request.current?.abort.abort(); request.current = undefined;
    state.current.loading = false; state.current.loadingMore = false;
    state.current.nextCursor = undefined; started.current = false;
  }, []);
  if (state.current.projectId !== projectId || state.current.active !== active) {
    invalidate();
    const old = state.current;
    state.current = { ...initial(projectId, active, old.listEpoch),
      items: old.projectId === projectId ? old.items : [] };
    if (old.projectId !== projectId) summaries.current.clear();
  }
  const notify = () => render(value => value + 1);
  const merge = (items: EffectDraftSummary[]) => {
    const order = new Map<string, EffectDraftSummary>();
    for (const item of items) {
      const previous = summaries.current.get(item.id);
      const chosen = previous && previous.version > item.version ? previous : item;
      summaries.current.set(item.id, chosen); order.set(item.id, chosen);
    }
    return Array.from(order.values());
  };
  const fetchPage = useCallback((cursor?: string): Promise<EffectDraftSummary[]> => {
    const current = state.current, project = current.projectId;
    if (!current.active || !project) return Promise.resolve([]);
    const epoch = current.listEpoch;
    if (request.current) return request.current.promise;
    if (cursor && current.nextCursor !== cursor) return Promise.resolve(current.items);
    const abort = new AbortController();
    current.loading = !cursor; current.loadingMore = !!cursor;
    current.error = undefined; current.errorPhase = undefined;
    const owns = () => state.current.projectId === project && state.current.active
      && state.current.listEpoch === epoch && request.current?.abort === abort;
    const promise = Promise.resolve().then(() => listEffectDraftPage(project, cursor,
      { signal: abort.signal, retries: 0, timeoutMs: 10000 })).then(page => {
      if (!owns()) return [];
      state.current.items = merge(cursor ? [...state.current.items, ...page.items] : page.items);
      state.current.nextCursor = page.nextCursor;
      return state.current.items;
    }).catch(failure => {
      if (owns()) {
        state.current.error = failure instanceof Error ? failure : Error(String(failure));
        state.current.errorPhase = cursor ? 'load-more' : 'first-page';
      }
      return [];
    }).finally(() => {
      if (owns()) {
        request.current = undefined;
        state.current.loading = false; state.current.loadingMore = false; notify();
      }
    });
    request.current = { abort, cursor, promise }; started.current = true; notify();
    return promise;
    // All ownership and summaries are read from refs, including synchronous invalidation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const refresh = useCallback(() => {
    invalidate(); return fetchPage();
  }, [invalidate, fetchPage]);
  const ensureFirstPage = useCallback(() => {
    if (request.current && !request.current.cursor) return request.current.promise;
    return started.current ? Promise.resolve(state.current.items) : fetchPage();
  }, [fetchPage]);
  const loadMore = useCallback(() => state.current.nextCursor
    ? fetchPage(state.current.nextCursor) : Promise.resolve(state.current.items), [fetchPage]);
  const upsertSummary = useCallback((item: EffectDraftSummary) => {
    const previous = summaries.current.get(item.id);
    if (previous && previous.version > item.version) return;
    summaries.current.set(item.id, item);
    state.current.items = state.current.items.map(old => old.id === item.id ? item : old);
    notify();
  }, []);
  useEffect(() => {
    if (active && projectId) void ensureFirstPage();
    return invalidate;
  }, [active, projectId, ensureFirstPage, invalidate]);
  return { ...state.current, refresh, loadMore, invalidate, upsertSummary, ensureFirstPage };
}
