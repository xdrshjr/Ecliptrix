/**
 * Shared fixtures for the browser workspace suites: a state factory, a fake
 * preload bridge (every method a vi.fn, event hooks capturable) and a render
 * helper that mounts the real Provider around an injected store.
 */
import * as React from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { BrowserWorkspaceProvider } from '@/contexts/BrowserWorkspaceContext';
import {
  createBrowserWorkspaceStore, type BrowserWorkspaceStore,
} from '@/lib/browserWorkspaceStore';
import type {
  BrowserApproval, BrowserTabInfo, BrowserWorkspaceState,
} from '@/types/browserWorkspace';

export function makeTab(patch: Partial<BrowserTabInfo> = {}): BrowserTabInfo {
  return {
    id: 'tab-1', owner: 'user', url: 'https://example.com/page', title: 'Example', loading: false,
    canGoBack: false, canGoForward: false, audible: false, crashed: false, secure: 'https', ...patch,
  };
}

export function makeApproval(patch: Partial<BrowserApproval> = {}): BrowserApproval {
  return {
    id: 'ap-1', kind: 'consent', runId: 'run-1', reason: 'reason', createdAt: 1000,
    expiresAt: 121000, status: 'pending', ...patch,
  };
}

export function makeState(patch: Partial<BrowserWorkspaceState> = {}): BrowserWorkspaceState {
  return {
    v: 1, available: true, enabled: true, agentEnabled: true, activeProfileId: 'default',
    profiles: [{ id: 'default', name: '默认', color: '#3ECF8E', loginSiteCount: 1, agentConsent: false }],
    tabs: [makeTab()], activeTabId: 'tab-1', control: { holder: 'idle', since: 0 },
    approvals: [], activity: [], locked: false, ...patch,
  };
}

type Fn = ReturnType<typeof vi.fn>;
export interface FakeBridge {
  [key: string]: unknown;
  profiles: Record<string, Fn>;
  emitState(state: BrowserWorkspaceState): void;
}

const OK = () => Promise.resolve({ ok: true });

/** Installs `window.ecliptrixDesktop.browser`; returns the fake for assertions. */
export function installBridge(state: BrowserWorkspaceState = makeState()): FakeBridge {
  const listeners = new Set<(s: BrowserWorkspaceState) => void>();
  const bridge: FakeBridge = {
    state: vi.fn(() => Promise.resolve(state)),
    onStateChanged: vi.fn((cb: (s: BrowserWorkspaceState) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
    onActivity: vi.fn(() => () => {}),
    onSaveResourceRequest: vi.fn(() => () => {}),
    openTab: vi.fn(() => Promise.resolve({ ok: true, tabId: 'new' })),
    closeTab: vi.fn(OK), activateTab: vi.fn(OK), reorderTabs: vi.fn(OK), navigate: vi.fn(OK),
    back: vi.fn(OK), forward: vi.fn(OK), reload: vi.fn(OK), stop: vi.fn(OK),
    setBounds: vi.fn(OK), setVisible: vi.fn(OK),
    captureFrozen: vi.fn(() => Promise.resolve({ ok: true, dataUrl: 'data:image/jpeg;base64,AAAA' })),
    loginSites: vi.fn(() => Promise.resolve({ ok: true, sites: [{ host: 'weibo.com', cookies: 3 }] })),
    removeSite: vi.fn(OK), takeOver: vi.fn(OK), returnControl: vi.fn(OK), resolveApproval: vi.fn(OK),
    shareUrl: vi.fn(() => Promise.resolve({ ok: true, url: 'https://example.com/page' })),
    revokeConsent: vi.fn(OK),
    profiles: {
      list: vi.fn(OK), create: vi.fn(OK), rename: vi.fn(OK), switch: vi.fn(OK),
      clearData: vi.fn(OK), remove: vi.fn(OK),
    },
    emitState: (next) => listeners.forEach((cb) => cb(next)),
  };
  (window as unknown as { ecliptrixDesktop: unknown }).ecliptrixDesktop = { browser: bridge };
  return bridge;
}

export function removeBridge(): void {
  delete (window as unknown as { ecliptrixDesktop?: unknown }).ecliptrixDesktop;
}

/** A store pre-loaded with `state` and an in-memory storage (no jsdom leakage). */
export function makeStore(
  state: BrowserWorkspaceState | null = makeState(),
  options: { hasBridge?: boolean; open?: boolean } = {},
): BrowserWorkspaceStore {
  const memory = new Map<string, string>();
  const store = createBrowserWorkspaceStore({
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => { memory.set(key, value); },
  });
  store.setHasBridge(options.hasBridge ?? true);
  store.setWorkspace(state);
  if (options.open) store.openDock();
  return store;
}

export function renderWithProviders(ui: React.ReactElement, store: BrowserWorkspaceStore) {
  // The Provider re-reads state() on mount; keep it equal to the injected store
  // so a late-resolving promise cannot overwrite what the test arranged.
  const installed = (window as unknown as { ecliptrixDesktop?: { browser?: Record<string, unknown> } })
    .ecliptrixDesktop?.browser;
  if (installed && store.getSnapshot().workspace) installed.state = vi.fn(() => Promise.resolve(store.getSnapshot().workspace));
  return render(
    <LocaleProvider>
      <NotificationProvider>
        <BrowserWorkspaceProvider store={store}>{ui}</BrowserWorkspaceProvider>
      </NotificationProvider>
    </LocaleProvider>,
  );
}
