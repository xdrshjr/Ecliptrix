import { describe, expect, it, vi } from 'vitest';
import {
  ACTIVITY_LIMIT, DOCK_MIN_WIDTH, DOCK_PREFS_KEY, createBrowserWorkspaceStore, mergeActivity,
  selectActiveTab, selectAgentInBackground, selectButtonState, selectDisabledReason,
  selectIsAgentActive, selectNeedsUser,
} from '../browserWorkspaceStore';
import type { BrowserActivityEntry } from '@/types/browserWorkspace';
import { makeApproval, makeState } from '@/components/browser/__tests__/testUtils';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
}
const entry = (id: string, patch: Partial<BrowserActivityEntry> = {}): BrowserActivityEntry =>
  ({ id, ts: 1, kind: 'click', label: id, status: 'ok', ...patch });

describe('browserWorkspaceStore', () => {
  it('notifies_subscribers_and_returns_a_new_snapshot_on_change', () => {
    const store = createBrowserWorkspaceStore(memoryStorage());
    const listener = vi.fn();
    const off = store.subscribe(listener);
    const before = store.getSnapshot();
    store.openDock();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).not.toBe(before);
    expect(store.getSnapshot().dockOpen).toBe(true);
    off();
    store.closeDock();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('persists_width_and_expanded_and_clamps_to_the_minimum', () => {
    const storage = memoryStorage();
    const store = createBrowserWorkspaceStore(storage);
    store.setDockWidth(100);
    store.setExpanded(true);
    expect(store.getSnapshot().dockWidth).toBe(DOCK_MIN_WIDTH);
    expect(JSON.parse(storage.data.get(DOCK_PREFS_KEY)!)).toEqual({ width: DOCK_MIN_WIDTH, expanded: true });
    const reloaded = createBrowserWorkspaceStore(storage);
    expect(reloaded.getSnapshot()).toMatchObject({ dockWidth: DOCK_MIN_WIDTH, expanded: true });
  });

  it('survives_a_missing_or_throwing_storage', () => {
    const broken = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    const store = createBrowserWorkspaceStore(broken);
    expect(() => { store.setDockWidth(700); store.ackPrivacy(); }).not.toThrow();
    expect(store.getSnapshot().dockWidth).toBe(700);
    expect(createBrowserWorkspaceStore(null).getSnapshot().dockWidth).toBeNull();
  });

  it('ignores_corrupt_persisted_prefs', () => {
    const store = createBrowserWorkspaceStore(memoryStorage({ [DOCK_PREFS_KEY]: '{not json' }));
    expect(store.getSnapshot()).toMatchObject({ dockWidth: null, expanded: false });
  });

  it('caps_activity_at_100_and_replaces_an_updated_entry_by_id', () => {
    let list: BrowserActivityEntry[] = [];
    for (let i = 0; i < ACTIVITY_LIMIT + 20; i += 1) list = mergeActivity(list, entry(`e${i}`));
    expect(list).toHaveLength(ACTIVITY_LIMIT);
    expect(list[0].id).toBe('e20');
    list = mergeActivity(list, entry('e50', { status: 'error' }));
    expect(list).toHaveLength(ACTIVITY_LIMIT);
    expect(list.find((item) => item.id === 'e50')?.status).toBe('error');
  });

  it('ignores_activity_before_any_workspace_state_arrives', () => {
    const store = createBrowserWorkspaceStore(memoryStorage());
    store.pushActivity(entry('x'));
    expect(store.getSnapshot().workspace).toBeNull();
  });
});

describe('selectors', () => {
  const snapshotWith = (state: ReturnType<typeof makeState> | null, dockOpen = false) => {
    const store = createBrowserWorkspaceStore(memoryStorage());
    store.setHasBridge(true);
    store.setWorkspace(state);
    if (dockOpen) store.openDock();
    return store.getSnapshot();
  };

  it('button_state_priority_is_needs_user_then_agent_then_open_then_idle', () => {
    expect(selectButtonState(snapshotWith(makeState()))).toBe('idle');
    expect(selectButtonState(snapshotWith(makeState(), true))).toBe('open');
    const agent = makeState({ control: { holder: 'agent', since: 1 } });
    expect(selectButtonState(snapshotWith(agent, true))).toBe('agent-active');
    const both = makeState({ control: { holder: 'agent', since: 1 }, approvals: [makeApproval()] });
    expect(selectButtonState(snapshotWith(both, true))).toBe('needs-user');
  });

  it('resolved_approvals_do_not_count_as_needing_the_user', () => {
    const state = makeState({ approvals: [makeApproval({ status: 'approved' })] });
    expect(selectNeedsUser(snapshotWith(state))).toBe(false);
  });

  it('agent_in_background_only_when_the_dock_is_closed', () => {
    const state = makeState({ control: { holder: 'agent', since: 1 } });
    expect(selectIsAgentActive(snapshotWith(state))).toBe(true);
    expect(selectAgentInBackground(snapshotWith(state, false))).toBe(true);
    expect(selectAgentInBackground(snapshotWith(state, true))).toBe(false);
  });

  it('disabled_reason_distinguishes_off_from_unreachable', () => {
    expect(selectDisabledReason(snapshotWith(null))).toBe('unavailable');
    expect(selectDisabledReason(snapshotWith(makeState({ enabled: false })))).toBe('disabled');
    expect(selectDisabledReason(snapshotWith(makeState({ available: false })))).toBe('unavailable');
    expect(selectDisabledReason(snapshotWith(makeState()))).toBeNull();
  });

  it('active_tab_is_looked_up_by_id', () => {
    expect(selectActiveTab(snapshotWith(makeState()))?.id).toBe('tab-1');
    expect(selectActiveTab(snapshotWith(makeState({ activeTabId: 'nope' })))).toBeNull();
  });
});
