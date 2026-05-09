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
      types: { workflow: 'WorkFlow', video: 'Video Editing', brainstorm: 'Brainstorming', chat: 'AI Chat' },
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

  it('createTask persists state to LS, syncs URL, updates title', async () => {
    const { result } = renderHook(() => useTasks());

    act(() => {
      result.current.createTask('chat');
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
      result.current.createTask('video');
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
          result.current.createTask('workflow');
        });
      }).not.toThrow();
      expect(result.current.tasks.length).toBeGreaterThan(0);
    } finally {
      window.localStorage.setItem = original;
      warn.mockRestore();
    }
  });
});
