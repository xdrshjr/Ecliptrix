/**
 * Renderer mirror of the browser workspace (spec §4.1 "single truth", §4.6.4).
 *
 * The main process owns browser state; this store only mirrors it and holds the
 * few purely visual choices (is the Dock open, how wide). It is a plain
 * `getSnapshot/subscribe` store so `useSyncExternalStore` can read it, and so
 * the selectors stay pure functions that tests can call without React.
 * Persistence is a per-viewer convenience only — every storage access is
 * wrapped, a blocked localStorage must not break the Dock (AC-D9).
 */

import type {
  BrowserActivityEntry,
  BrowserTabInfo,
  BrowserWorkspaceState,
} from '@/types/browserWorkspace';

export const DOCK_PREFS_KEY = 'ecliptrix-browser-dock-v1';
export const PRIVACY_ACK_KEY = 'ecliptrix-browser-privacy-v1';
export const ACTIVITY_LIMIT = 100;
export const DOCK_MIN_WIDTH = 480;

export interface BrowserWorkspaceSnapshot {
  /** A usable preload bridge exists (false in a plain browser). */
  hasBridge: boolean;
  workspace: BrowserWorkspaceState | null;
  dockOpen: boolean;
  /** "展开": the Dock covers the whole area above the timeline. */
  expanded: boolean;
  /** Persisted drag width in px; null = the CSS default clamp(). */
  dockWidth: number | null;
  privacyAcked: boolean;
}

export type BrowserButtonState = 'idle' | 'open' | 'agent-active' | 'needs-user';

type Listener = () => void;
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function safeStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readPrefs(storage: StorageLike | null): Pick<BrowserWorkspaceSnapshot, 'expanded' | 'dockWidth'> {
  const fallback = { expanded: false, dockWidth: null };
  try {
    const raw = storage?.getItem(DOCK_PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { width?: unknown; expanded?: unknown };
    const width = typeof parsed.width === 'number' && Number.isFinite(parsed.width)
      ? Math.max(DOCK_MIN_WIDTH, Math.round(parsed.width)) : null;
    return { expanded: parsed.expanded === true, dockWidth: width };
  } catch {
    return fallback;
  }
}

function readAck(storage: StorageLike | null): boolean {
  try {
    return storage?.getItem(PRIVACY_ACK_KEY) === '1';
  } catch {
    return false;
  }
}

export interface BrowserWorkspaceStore {
  getSnapshot(): BrowserWorkspaceSnapshot;
  subscribe(listener: Listener): () => void;
  setHasBridge(has: boolean): void;
  setWorkspace(state: BrowserWorkspaceState | null): void;
  pushActivity(entry: BrowserActivityEntry): void;
  openDock(): void;
  closeDock(): void;
  toggleDock(): void;
  setExpanded(expanded: boolean): void;
  setDockWidth(width: number | null): void;
  ackPrivacy(): void;
}

/** Keeps the newest `ACTIVITY_LIMIT` entries; an update to a known id replaces it. */
export function mergeActivity(
  current: BrowserActivityEntry[],
  entry: BrowserActivityEntry,
): BrowserActivityEntry[] {
  const index = current.findIndex((item) => item.id === entry.id);
  const next = index === -1
    ? [...current, entry]
    : current.map((item, position) => (position === index ? entry : item));
  return next.length > ACTIVITY_LIMIT ? next.slice(next.length - ACTIVITY_LIMIT) : next;
}

export function createBrowserWorkspaceStore(
  storage: StorageLike | null = safeStorage(),
): BrowserWorkspaceStore {
  let snapshot: BrowserWorkspaceSnapshot = {
    hasBridge: false,
    workspace: null,
    dockOpen: false,
    privacyAcked: readAck(storage),
    ...readPrefs(storage),
  };
  const listeners = new Set<Listener>();

  const commit = (patch: Partial<BrowserWorkspaceSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };
  const persistPrefs = () => {
    try {
      storage?.setItem(DOCK_PREFS_KEY, JSON.stringify({
        width: snapshot.dockWidth, expanded: snapshot.expanded,
      }));
    } catch { /* blocked storage: the Dock still works, it just forgets */ }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setHasBridge: (has) => commit({ hasBridge: has }),
    setWorkspace: (state) => commit({ workspace: state }),
    pushActivity(entry) {
      if (!snapshot.workspace) return;
      commit({ workspace: {
        ...snapshot.workspace,
        activity: mergeActivity(snapshot.workspace.activity, entry),
      } });
    },
    openDock: () => commit({ dockOpen: true }),
    closeDock: () => commit({ dockOpen: false }),
    toggleDock: () => commit({ dockOpen: !snapshot.dockOpen }),
    setExpanded(expanded) {
      commit({ expanded });
      persistPrefs();
    },
    setDockWidth(width) {
      commit({ dockWidth: width === null ? null : Math.max(DOCK_MIN_WIDTH, Math.round(width)) });
      persistPrefs();
    },
    ackPrivacy() {
      commit({ privacyAcked: true });
      try { storage?.setItem(PRIVACY_ACK_KEY, '1'); } catch { /* per-viewer only */ }
    },
  };
}

// ── selectors (pure) ──

export const selectIsAgentActive = (s: BrowserWorkspaceSnapshot): boolean =>
  s.workspace?.control.holder === 'agent';

export const selectNeedsUser = (s: BrowserWorkspaceSnapshot): boolean =>
  s.workspace?.approvals.some((approval) => approval.status === 'pending') ?? false;

export const selectActiveTab = (s: BrowserWorkspaceSnapshot): BrowserTabInfo | null => {
  const workspace = s.workspace;
  if (!workspace) return null;
  return workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ?? null;
};

/** Agent is working but the user cannot see it (Dock closed): bubble on the button. */
export const selectAgentInBackground = (s: BrowserWorkspaceSnapshot): boolean =>
  selectIsAgentActive(s) && !s.dockOpen;

/** Why the footer button is disabled, or null when usable. */
export function selectDisabledReason(
  s: BrowserWorkspaceSnapshot,
): 'disabled' | 'unavailable' | null {
  const workspace = s.workspace;
  if (!workspace) return 'unavailable';
  if (!workspace.enabled) return 'disabled';
  if (!workspace.available) return 'unavailable';
  return null;
}

/** needs-user > agent-active > open > idle (the Dock being open is only `aria-pressed`). */
export function selectButtonState(s: BrowserWorkspaceSnapshot): BrowserButtonState {
  if (selectNeedsUser(s)) return 'needs-user';
  if (selectIsAgentActive(s)) return 'agent-active';
  return s.dockOpen ? 'open' : 'idle';
}
