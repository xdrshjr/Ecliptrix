'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearSkillRouterKey,
  getSkillRouter,
  getSkillRouterCatalog,
  updateSkillRouter,
  verifySkillRouter,
  type SkillRouterCatalog,
  type SkillRouterPatch,
  type SkillRouterStatus,
  type SkillRouterVerifyInput,
  type SkillRouterVerifyResult,
} from '@/lib/api/skillrouter';
import { SETUP_CONFIG_UPDATED_EVENT } from '@/lib/setupEvents';

export type LoadState = 'loading' | 'ready' | 'error';

export type SaveResult =
  | { ok: true; status: SkillRouterStatus }
  | { ok: false; error: unknown };

export interface UseSkillRouterOptions {
  /** Also load models + gateway capabilities (settings panel, wizard). */
  withCatalog?: boolean;
}

export interface UseSkillRouter {
  status: SkillRouterStatus | null;
  catalog: SkillRouterCatalog | null;
  loadState: LoadState;
  catalogState: LoadState;
  reload: () => Promise<void>;
  refreshCatalog: (force?: boolean) => Promise<void>;
  /** Optimistic write: rolls back (and re-reads the server) when it fails. */
  save: (patch: SkillRouterPatch) => Promise<SaveResult>;
  clearKey: () => Promise<SaveResult>;
  verify: (input?: SkillRouterVerifyInput) => Promise<SkillRouterVerifyResult>;
}

/**
 * What the screen can already show before the server answers. The key itself
 * is never part of the optimistic state: only the server decides whether it
 * is configured.
 */
export function applyPatchOptimistically(
  status: SkillRouterStatus,
  patch: SkillRouterPatch,
): SkillRouterStatus {
  return {
    ...status,
    mode: patch.mode ?? status.mode,
    modeState: patch.mode ?? status.modeState,
    baseUrl: patch.baseUrl ?? status.baseUrl,
    manualCapabilities: patch.manualCapabilities ?? status.manualCapabilities,
    slotModels: patch.slotModels ? { ...status.slotModels, ...patch.slotModels } : status.slotModels,
  };
}

/**
 * Status + catalogue of the AI relay with optimistic saves. Writes are chained
 * so a quick second toggle can never overtake the first one, and every
 * setup-config event (from the wizard or another panel) re-reads the status.
 *
 * Longer than the usual 50 lines on purpose: reads, the write chain and the
 * event subscription share the same refs (alive / own-writes / write chain).
 */
export function useSkillRouter(options: UseSkillRouterOptions = {}): UseSkillRouter {
  const { withCatalog = false } = options;
  const [status, setStatus] = useState<SkillRouterStatus | null>(null);
  const [catalog, setCatalog] = useState<SkillRouterCatalog | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [catalogState, setCatalogState] = useState<LoadState>('loading');
  const statusRef = useRef<SkillRouterStatus | null>(null);
  const writeChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const ownWritesRef = useRef(0);
  const aliveRef = useRef(true);

  const commit = useCallback((next: SkillRouterStatus | null) => {
    statusRef.current = next;
    if (aliveRef.current) setStatus(next);
  }, []);

  const reload = useCallback(async () => {
    try {
      commit(await getSkillRouter());
      if (aliveRef.current) setLoadState('ready');
    } catch {
      // Keep whatever is on screen: a failed refresh must not blank a card.
      if (aliveRef.current) setLoadState(statusRef.current ? 'ready' : 'error');
    }
  }, [commit]);

  const refreshCatalog = useCallback(async (force = false) => {
    if (aliveRef.current) setCatalogState((prev) => (prev === 'ready' ? prev : 'loading'));
    try {
      const next = await getSkillRouterCatalog(force);
      if (!aliveRef.current) return;
      setCatalog(next);
      setCatalogState('ready');
    } catch {
      if (aliveRef.current) setCatalogState('error');
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void reload();
    return () => {
      aliveRef.current = false;
    };
  }, [reload]);

  useEffect(() => {
    if (withCatalog) void refreshCatalog(false);
  }, [withCatalog, refreshCatalog]);

  useEffect(() => {
    const onConfigUpdated = () => {
      if (ownWritesRef.current > 0) return;
      void reload();
      if (withCatalog) void refreshCatalog(false);
    };
    window.addEventListener(SETUP_CONFIG_UPDATED_EVENT, onConfigUpdated);
    return () => window.removeEventListener(SETUP_CONFIG_UPDATED_EVENT, onConfigUpdated);
  }, [reload, refreshCatalog, withCatalog]);

  const runWrite = useCallback(
    (write: () => Promise<SkillRouterStatus>, optimistic?: SkillRouterStatus) => {
      const previous = statusRef.current;
      if (optimistic) commit(optimistic);
      const task = writeChainRef.current.then(async (): Promise<SaveResult> => {
        ownWritesRef.current += 1;
        try {
          const next = await write();
          commit(next);
          if (withCatalog) void refreshCatalog(false);
          return { ok: true, status: next };
        } catch (error) {
          commit(previous);
          void reload();
          return { ok: false, error };
        } finally {
          ownWritesRef.current -= 1;
        }
      });
      writeChainRef.current = task;
      return task;
    },
    [commit, reload, refreshCatalog, withCatalog],
  );

  const save = useCallback(
    (patch: SkillRouterPatch) => {
      const current = statusRef.current;
      return runWrite(
        () => updateSkillRouter(patch),
        current ? applyPatchOptimistically(current, patch) : undefined,
      );
    },
    [runWrite],
  );

  const clearKey = useCallback(() => runWrite(() => clearSkillRouterKey()), [runWrite]);

  const verify = useCallback(
    async (input: SkillRouterVerifyInput = {}) => {
      const result = await verifySkillRouter(input);
      // A saved-key verification updates `lastVerified` server-side.
      if (!input.apiKey) {
        void reload();
        if (withCatalog) void refreshCatalog(true);
      }
      return result;
    },
    [reload, refreshCatalog, withCatalog],
  );

  return {
    status,
    catalog,
    loadState,
    catalogState,
    reload,
    refreshCatalog,
    save,
    clearKey,
    verify,
  };
}
