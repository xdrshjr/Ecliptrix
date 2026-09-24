/**
 * Tests for `useTasks` persistence (LS + URL + document.title) — iter3 Bug #1.
 *
 * The mount effect must:
 *   - hydrate from localStorage when present
 *   - apply ?task=<id> URL param to activate the matching tab (when LS has it)
 *   - never clobber LS during initial paint (hydrated guard)
 *
 * The persist effect must:
 *   - serialize state to localStorage
 *   - sync ?tab=<type>&task=<id> via history.replaceState
 *   - update document.title to the active task title
 *   - clear all of the above when closeAllTabs() runs
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// vitest in this project does not include @vitejs/plugin-react, so we cannot
// import the real LocaleContext.tsx (it would trip vite's import-analysis JSX
// parser). useTasks only reads `t` from this hook, so a static stub at the
// module boundary is sufficient for the persistence contract under test.
vi.mock('@/contexts/LocaleContext', () => {
  const en = {
    tasks: {
      types: { video: 'Video Editing', chat: 'AI Chat' },
      defaultPageTitle: 'Ecliptrix - Where light and shadow collide',
    },
  };
  return {
    useLocale: () => ({ locale: 'en', setLocale: () => {}, t: en }),
  };
});

import { renderHook, act } from '@testing-library/react';
import { useTasks } from '../useTasks';

const STORAGE_KEY = 'ecliptrix-tasks-state-v1';
const DEFAULT_EN_TITLE = 'Ecliptrix - Where light and shadow collide';

describe('useTasks persistence (iter3 Bug #1)', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
    document.title = DEFAULT_EN_TITLE;
  });

  it('openTask persists state to LS, syncs URL, updates title', async () => {
    const { result } = renderHook(() => useTasks());

    act(() => {
      result.current.openTask('chat');
    });

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.tasks.length).toBeGreaterThan(0);
    expect(parsed.activeTabId).toBeTruthy();

    const search = new URLSearchParams(window.location.search);
    expect(search.get('tab')).toBe('chat');
    expect(search.get('task')).toBeTruthy();

    expect(document.title.startsWith('AI Chat')).toBe(true);
  });

  it('hydrates from LS on mount when LS contains valid PersistedState', () => {
    const persisted = {
      tasks: [
        {
          id: 'task-x',
          title: 'Restored Video',
          type: 'video',
          status: 'draft',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          content: null,
        },
      ],
      tabs: [{ id: 'tab-x', taskId: 'task-x', title: 'Restored Video', isActive: true, type: 'video' }],
      activeTabId: 'tab-x',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));

    const { result } = renderHook(() => useTasks());

    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0].id).toBe('task-x');
    expect(result.current.activeTabId).toBe('tab-x');
  });

  it('URL ?task=<id> activates the matching tab (when LS already has tabs)', () => {
    const persisted = {
      tasks: [
        { id: 't-a', title: 'A', type: 'chat', status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), content: null },
        { id: 't-b', title: 'B', type: 'video', status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), content: null },
      ],
      tabs: [
        { id: 'tab-a', taskId: 't-a', title: 'A', isActive: true, type: 'chat' },
        { id: 'tab-b', taskId: 't-b', title: 'B', isActive: false, type: 'video' },
      ],
      activeTabId: 'tab-a',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    window.history.replaceState({}, '', '/?task=t-b');

    const { result } = renderHook(() => useTasks());

    expect(result.current.activeTabId).toBe('tab-b');
    expect(result.current.tabs.find(t => t.id === 'tab-b')?.isActive).toBe(true);
  });

  it('URL ?task=<unknown> falls back to LS state without throwing', () => {
    const persisted = {
      tasks: [
        { id: 't-a', title: 'A', type: 'chat', status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), content: null },
      ],
      tabs: [{ id: 'tab-a', taskId: 't-a', title: 'A', isActive: true, type: 'chat' }],
      activeTabId: 'tab-a',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    window.history.replaceState({}, '', '/?task=does-not-exist');

    const { result } = renderHook(() => useTasks());
    expect(result.current.activeTabId).toBe('tab-a');
  });

  it('closeAllTabs clears LS state and URL params and resets title', () => {
    const { result } = renderHook(() => useTasks());

    act(() => {
      result.current.openTask('video');
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy();
    expect(window.location.search).toContain('task=');

    act(() => {
      result.current.closeAllTabs();
    });

    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed.tabs).toHaveLength(0);
    expect(parsed.tasks).toHaveLength(0);
    expect(parsed.activeTabId).toBeNull();

    const search = new URLSearchParams(window.location.search);
    expect(search.get('tab')).toBeNull();
    expect(search.get('task')).toBeNull();
    expect(document.title).toBe(DEFAULT_EN_TITLE);
  });

  it('JSON.parse failure does not throw and starts fresh', () => {
    localStorage.setItem(STORAGE_KEY, '{ this is not valid json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useTasks());

    expect(result.current.tasks).toHaveLength(0);
    expect(result.current.tabs).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('reviveState recursively revives chat conversation timestamps (iter10 Bug #1)', () => {
    const conversation = {
      id: 'c1',
      title: 'Conv 1',
      createdAt: '2026-05-10T12:00:00.000Z',
      updatedAt: '2026-05-10T13:00:00.000Z',
      messages: [
        { id: 'm1', content: 'hi', timestamp: '2026-05-10T12:30:00.000Z' },
        { id: 'm2', content: 'hello', timestamp: '2026-05-10T12:31:00.000Z' },
      ],
    };
    const persisted = {
      tasks: [
        {
          id: 't-chat',
          title: 'Chat',
          type: 'chat',
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          content: { conversations: [conversation], activeConversationId: 'c1' },
        },
      ],
      tabs: [{ id: 'tab-chat', taskId: 't-chat', title: 'Chat', isActive: true, type: 'chat' }],
      activeTabId: 'tab-chat',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));

    const { result } = renderHook(() => useTasks());

    const task = result.current.tasks[0] as any;
    expect(task.content).toBeTruthy();
    const conv = task.content.conversations[0];
    expect(conv.createdAt).toBeInstanceOf(Date);
    expect(conv.updatedAt).toBeInstanceOf(Date);
    expect(conv.messages[0].timestamp).toBeInstanceOf(Date);
    expect(conv.messages[1].timestamp).toBeInstanceOf(Date);
  });

  it('reviveState handles chat task with missing/empty messages array', () => {
    const persisted = {
      tasks: [
        {
          id: 't-chat',
          title: 'Chat',
          type: 'chat',
          status: 'draft',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          content: {
            conversations: [
              {
                id: 'c1',
                title: 'No msgs',
                createdAt: '2026-05-10T12:00:00.000Z',
                updatedAt: '2026-05-10T12:00:00.000Z',
              },
            ],
          },
        },
      ],
      tabs: [{ id: 'tab-chat', taskId: 't-chat', title: 'Chat', isActive: true, type: 'chat' }],
      activeTabId: 'tab-chat',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));

    const { result } = renderHook(() => useTasks());
    const task = result.current.tasks[0] as any;
    const conv = task.content.conversations[0];
    expect(Array.isArray(conv.messages)).toBe(true);
    expect(conv.messages).toHaveLength(0);
  });

  it('localStorage.setItem throwing (quota) does not crash the persist effect', () => {
    const original = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = (key: string, value: string) => {
      if (key === STORAGE_KEY) throw new DOMException('QuotaExceededError');
      original(key, value);
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const { result } = renderHook(() => useTasks());
      expect(() => {
        act(() => {
          result.current.openTask('video');
        });
      }).not.toThrow();
      expect(result.current.tasks.length).toBeGreaterThan(0);
    } finally {
      window.localStorage.setItem = original;
      warn.mockRestore();
    }
  });
});

const iso = (ms: number) => new Date(ms).toISOString();
const persistedTask = (id: string, type: 'chat' | 'video', updatedMs = 0, content: unknown = null) => ({
  id, title: id, type, status: 'draft', createdAt: iso(0), updatedAt: iso(updatedMs), content,
});

describe('useTasks single instance per type (editor-shell-ui-consolidation W3)', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('open_task_twice_does_not_duplicate', () => {
    const { result } = renderHook(() => useTasks());
    act(() => { result.current.openTask('video'); });
    act(() => { result.current.openTask('video'); });
    expect(result.current.tasks.filter(t => t.type === 'video')).toHaveLength(1);
    expect(result.current.tabs).toHaveLength(1);
  });

  it('open_task_called_twice_in_same_tick_creates_one', () => {
    const { result } = renderHook(() => useTasks());
    act(() => {
      result.current.openTask('video');
      result.current.openTask('video');
    });
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tabs).toHaveLength(1);
  });

  it('first_open_creates_only_requested_type', () => {
    const { result } = renderHook(() => useTasks());
    act(() => { result.current.openTask('chat'); });
    expect(result.current.tasks.map(t => t.type)).toEqual(['chat']);
    expect(result.current.tasks[0].title).toBe('AI Chat');
  });

  it('open_task_reopens_closed_tab_with_same_content', () => {
    const { result } = renderHook(() => useTasks());
    act(() => { result.current.openTask('chat'); });
    const taskId = result.current.tasks[0].id;
    act(() => { result.current.updateTask(taskId, { content: { marker: 1 } }); });
    act(() => { result.current.closeTab(result.current.tabs[0].id); });
    expect(result.current.tabs).toHaveLength(0);
    act(() => { result.current.openTask('chat'); });
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tabs[0].taskId).toBe(taskId);
    expect(result.current.activeTask?.content).toEqual({ marker: 1 });
  });

  it('open_task_update_content_applies_to_new_task', () => {
    const { result } = renderHook(() => useTasks());
    act(() => {
      result.current.openTask('video', {
        updateContent: previous => ({ previous, pendingMaterials: ['m1'] }),
      });
    });
    expect(result.current.activeTask?.type).toBe('video');
    expect(result.current.activeTask?.content).toEqual({ previous: null, pendingMaterials: ['m1'] });
  });

  it('tab_is_active_matches_active_tab_id', () => {
    const { result } = renderHook(() => useTasks());
    act(() => { result.current.openTask('video'); });
    act(() => { result.current.openTask('chat'); });
    for (const tab of result.current.tabs) {
      expect(tab.isActive).toBe(tab.id === result.current.activeTabId);
    }
    expect(result.current.tabs.map(tab => tab.type)).toEqual(['chat', 'video']);
  });

  it('legacy_multi_task_state_is_collapsed_on_load', () => {
    const persisted = {
      tasks: [
        persistedTask('v1', 'video', 1),
        persistedTask('v2', 'video', 3),
        persistedTask('v3', 'video', 2),
        persistedTask('c1', 'chat', 1, { conversations: [{ id: 'a', createdAt: iso(0), updatedAt: iso(0), messages: [] }], activeConversationId: 'a' }),
        persistedTask('c2', 'chat', 2, { conversations: [{ id: 'b', createdAt: iso(0), updatedAt: iso(0), messages: [] }], activeConversationId: 'b' }),
      ],
      tabs: [
        { id: 'tv1', taskId: 'v1', title: 'Video Editing 1', isActive: true, type: 'video' },
        { id: 'tv2', taskId: 'v2', title: 'Video Editing 2', isActive: false, type: 'video' },
        { id: 'tc2', taskId: 'c2', title: 'AI Chat 2', isActive: false, type: 'chat' },
      ],
      activeTabId: 'tv1',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));

    const { result } = renderHook(() => useTasks());

    expect(result.current.tasks.map(t => t.id).sort()).toEqual(['c2', 'v1']);
    const chat = result.current.tasks.find(t => t.type === 'chat') as any;
    expect(chat.content.conversations.map((c: any) => c.id)).toEqual(['b', 'a']);
    expect(result.current.tabs.map(t => t.id)).toEqual(['tc2', 'tv1']);
    expect(result.current.activeTabId).toBe('tv1');
  });
});
