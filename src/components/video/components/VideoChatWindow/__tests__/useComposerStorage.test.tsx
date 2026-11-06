import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@/types';
import {
  collectInputHistory, createHistoryNavigator, draftStorageKey, useComposerDraft,
  useStructuredComposerDraft,
} from '../useComposerStorage';
import { createConversationViewCache } from '../conversationViewCache';

describe('结构化草稿同步落盘', () => {
  it('未提供外部缓存时也按项目隔离相同会话 ID', () => {
    const { result, rerender } = renderHook(({ projectKey }) =>
      useStructuredComposerDraft({ projectKey, conversationId: 'a' }),
    { initialProps: { projectKey: 'first' } });
    act(() => result.current.setDraft({ version: 2, text: '项目一草稿',
      skill: null, mentions: [] }));
    rerender({ projectKey: 'second' });
    expect(result.current.draft.text).toBe('');
    act(() => result.current.setDraft({ version: 2, text: '项目二草稿',
      skill: null, mentions: [] }));
    rerender({ projectKey: 'first' });
    expect(result.current.draft.text).toBe('项目一草稿');
  });
  it('不足 300ms 卸载仍保存技能与引用，发送空标记优先于 v1', () => {
    const cache = createConversationViewCache('p');
    const { result, unmount } = renderHook(() => useStructuredComposerDraft({
      projectKey: 'p', conversationId: 'a',
    }, cache));
    act(() => result.current.setDraft({ version: 2, text: '@片段',
      skill: { id: 'edit', name: '编辑' },
      mentions: [{ materialId: 'm', label: '片段' }] }));
    unmount();
    expect(createConversationViewCache('p').getDraft('a').skill?.id).toBe('edit');
    cache.clearDraft('a');
    localStorage.setItem('ecliptrix.agentDraft.v1.p.a', '旧文本');
    expect(createConversationViewCache('p').getDraft('a').text).toBe('');
  });
});

const KEY = draftStorageKey('proj', 'conv');

function user(content: string): ChatMessage {
  return { id: content, role: 'user', content, timestamp: new Date(0) };
}

beforeEach(() => { vi.useFakeTimers(); window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('useComposerDraft (AC-C5)', () => {
  it('restores a stored draft on mount', () => {
    window.localStorage.setItem(KEY, 'half-typed');
    const restore = vi.fn();
    renderHook(() => useComposerDraft(KEY, '', restore));
    expect(restore).toHaveBeenCalledWith('half-typed');
  });

  it('saves after the debounce and deletes the key for an empty text', () => {
    const { rerender } = renderHook(({ text }) => useComposerDraft(KEY, text, vi.fn()),
      { initialProps: { text: '' } });
    rerender({ text: 'hello' });
    expect(window.localStorage.getItem(KEY)).toBeNull();
    act(() => { vi.advanceTimersByTime(300); });
    expect(window.localStorage.getItem(KEY)).toBe('hello');
    rerender({ text: '' });
    act(() => { vi.advanceTimersByTime(300); });
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('never overwrites a stored draft with the empty first render', () => {
    window.localStorage.setItem(KEY, 'keep me');
    renderHook(() => useComposerDraft(KEY, '', vi.fn()));
    act(() => { vi.advanceTimersByTime(1_000); });
    // restore() is a spy here, so the text stays '' — the draft must survive.
    expect(window.localStorage.getItem(KEY)).toBe('keep me');
  });

  it('clearDraft removes the stored draft', () => {
    window.localStorage.setItem(KEY, 'sent');
    const { result } = renderHook(() => useComposerDraft(KEY, '', vi.fn()));
    act(() => result.current.clearDraft());
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('keeps working when localStorage throws (private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const restore = vi.fn();
    const { rerender, result } = renderHook(({ text }) => useComposerDraft(KEY, text, restore),
      { initialProps: { text: '' } });
    expect(() => {
      rerender({ text: 'typing' });
      act(() => { vi.advanceTimersByTime(300); });
      act(() => result.current.clearDraft());
    }).not.toThrow();
    expect(restore).not.toHaveBeenCalled();
  });

  it('does nothing without a conversation scope', () => {
    const restore = vi.fn();
    renderHook(() => useComposerDraft(null, 'x', restore));
    act(() => { vi.advanceTimersByTime(500); });
    expect(restore).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
  });
});

describe('input history (↑ recall)', () => {
  it('collects the latest 20 distinct user messages, newest first, skipping machine messages', () => {
    const messages = [
      user('first'), user('[[ask:q1]] yes'), user('second'), user('first'),
      ...Array.from({ length: 30 }, (_, i) => user(`m${i}`)),
    ];
    const entries = collectInputHistory(messages);
    expect(entries).toHaveLength(20);
    expect(entries[0]).toBe('m29');
    expect(entries.some(entry => entry.startsWith('[[ask:'))).toBe(false);
  });

  it('walks back and forward and restores what was being typed', () => {
    const navigator = createHistoryNavigator(['newest', 'older']);
    expect(navigator.older('draft')).toBe('newest');
    expect(navigator.older('newest')).toBe('older');
    expect(navigator.older('older')).toBeNull();
    expect(navigator.newer()).toBe('newest');
    expect(navigator.newer()).toBe('draft');
    expect(navigator.newer()).toBeNull();
    expect(navigator.isBrowsing()).toBe(false);
  });

  it('leaves browsing mode when reset', () => {
    const navigator = createHistoryNavigator(['a']);
    navigator.older('');
    expect(navigator.isBrowsing()).toBe(true);
    navigator.reset();
    expect(navigator.isBrowsing()).toBe(false);
  });
});
