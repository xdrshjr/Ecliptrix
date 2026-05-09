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
import { renderHook, act } from '@testing-library/react';
import { useTasks } from '../useTasks';

const STORAGE_KEY = 'ecliptrix-tasks-state-v1';

describe('useTasks persistence (iter3 Bug #1)', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
    document.title = 'Ecliptrix - Where light and shadow collide';
  });

  it('createTask persists state to LS, syncs URL, updates title', async () => {
    const { result } = renderHook(() => useTasks());

    act(() => {
      result.current.createTask('chat');
    });

    // Wait for the persist effect to run (microtask + effect flush is sync in act).
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.tasks.length).toBeGreaterThan(0);
    expect(parsed.activeTabId).toBeTruthy();

    // URL must contain ?tab=chat&task=...
    const search = new URLSearchParams(window.location.search);
    expect(search.get('tab')).toBe('chat');
    expect(search.get('task')).toBeTruthy();

    // document.title carries the active task title.
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
    expect(document.title).toBe('Ecliptrix - Where light and shadow collide');
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
      // State still updated in-memory.
      expect(result.current.tasks.length).toBeGreaterThan(0);
    } finally {
      window.localStorage.setItem = original;
      warn.mockRestore();
    }
  });
});
