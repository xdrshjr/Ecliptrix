'use client';

/**
 * BrowserWorkspaceProvider — mounts the renderer mirror of the browser
 * workspace (spec §4.6.4) and wires the three things that need the desktop
 * bridge: state/activity subscription, the Ctrl+Alt+B toggle, and the right-click
 * "save to media library" request (R2-2: main process → renderer → BFF).
 *
 * Without a provider (unit tests, a plain browser) the hooks answer from an
 * inert store, so FooterToolbar / EditorWorkbench never need a guard.
 */

import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore,
} from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import { fillCopy } from '@/lib/browserWorkspaceCopy';
import { getBrowserBridge, saveBrowserResource } from '@/lib/api/browserBridge';
import { isBrowserToggleShortcut } from '@/lib/browserShortcut';
import {
  createBrowserWorkspaceStore,
  type BrowserWorkspaceSnapshot,
  type BrowserWorkspaceStore,
} from '@/lib/browserWorkspaceStore';
import type {
  BrowserSaveResourceRequest, BrowserWorkspaceBridge,
} from '@/types/browserWorkspace';

const INERT_STORE = createBrowserWorkspaceStore(null);
const StoreContext = createContext<BrowserWorkspaceStore>(INERT_STORE);

/** Saves one page resource and puts the result into the media library. */
async function saveIntoLibrary(request: BrowserSaveResourceRequest): Promise<void> {
  const material = await saveBrowserResource(request);
  const [{ localMaterial }, { useVideoEditingStore }] = await Promise.all([
    import('@/lib/video-editing-agent/tools/webToolAdapter'),
    import('@/stores/videoEditingStore'),
  ]);
  useVideoEditingStore.getState().addMaterial(localMaterial(material));
}

function useSaveResourceRequests(
  bridge: Partial<BrowserWorkspaceBridge> | null,
): void {
  const { t } = useLocale();
  const { showSuccess, showError, showInfo } = useNotification();
  const copyRef = useRef(t.browserWorkspace.context);
  copyRef.current = t.browserWorkspace.context;
  const notifyRef = useRef({ showSuccess, showError, showInfo });
  notifyRef.current = { showSuccess, showError, showInfo };
  useEffect(() => {
    if (typeof bridge?.onSaveResourceRequest !== 'function') return undefined;
    return bridge.onSaveResourceRequest((request) => {
      notifyRef.current.showInfo(copyRef.current.saving, 1500);
      saveIntoLibrary(request).then(
        () => notifyRef.current.showSuccess(copyRef.current.saved),
        (error: unknown) => notifyRef.current.showError(fillCopy(copyRef.current.saveFailed, {
          reason: error instanceof Error ? error.message : 'unknown',
        })),
      );
    });
  }, [bridge]);
}

export function BrowserWorkspaceProvider({ children, store: injected }: {
  children: React.ReactNode;
  /** Tests inject a store; production creates one per provider. */
  store?: BrowserWorkspaceStore;
}) {
  const store = useMemo(() => injected ?? createBrowserWorkspaceStore(), [injected]);
  const bridge = useMemo(() => getBrowserBridge(), []);

  useEffect(() => {
    store.setHasBridge(bridge !== null);
    if (!bridge) return undefined;
    let cancelled = false;
    bridge.state?.().then((state) => { if (!cancelled) store.setWorkspace(state); })
      .catch(() => { /* leaves workspace null → button shows "unavailable" */ });
    const offState = bridge.onStateChanged?.((state) => store.setWorkspace(state));
    const offActivity = bridge.onActivity?.((entry) => store.pushActivity(entry));
    return () => { cancelled = true; offState?.(); offActivity?.(); };
  }, [bridge, store]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!store.getSnapshot().hasBridge) return;
      if (!isBrowserToggleShortcut(event, document.activeElement)) return;
      event.preventDefault();
      store.toggleDock();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [store]);

  // A locked gate (login / blocker screen) must close the Dock with it (R1-6).
  const locked = useSyncExternalStore(
    store.subscribe, () => store.getSnapshot().workspace?.locked ?? false, () => false);
  useEffect(() => { if (locked) store.closeDock(); }, [locked, store]);

  useSaveResourceRequests(bridge);
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useBrowserWorkspaceStore(): BrowserWorkspaceStore {
  return useContext(StoreContext);
}

/** Subscribes to the whole snapshot; use selectors from the store module on it. */
export function useBrowserWorkspace(): BrowserWorkspaceSnapshot {
  const store = useContext(StoreContext);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Stable Dock actions (no re-render when the snapshot changes). */
export function useBrowserDockActions() {
  const store = useContext(StoreContext);
  return useMemo(() => ({
    open: () => store.openDock(),
    close: () => store.closeDock(),
    toggle: () => store.toggleDock(),
    setExpanded: (value: boolean) => store.setExpanded(value),
    setWidth: (value: number | null) => store.setDockWidth(value),
    ackPrivacy: () => store.ackPrivacy(),
  }), [store]);
}

/** Convenience for components that need the live bridge (re-read each call). */
export function useBrowserBridge(): () => Partial<BrowserWorkspaceBridge> | null {
  return useCallback(() => getBrowserBridge(), []);
}
