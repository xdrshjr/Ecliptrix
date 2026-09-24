import { describe, it, expect } from 'vitest';
import type { AppState, ChatTaskContent, Task, Tab, TaskType } from '@/types';
import {
  collapseToSingletonTasks,
  mergeChatContents,
  SINGLETON_TAB_ORDER,
} from '../taskSingleton';

const labelFor = (type: TaskType) => (type === 'chat' ? 'AI Chat' : 'Video Editing');

const task = (id: string, type: TaskType, updatedMs = 0, content: unknown = null): Task => ({
  id,
  title: labelFor(type),
  type,
  status: 'draft',
  createdAt: new Date(0),
  updatedAt: new Date(updatedMs),
  content,
});

const tab = (id: string, taskId: string, type: TaskType, isActive = false): Tab => ({
  id, taskId, title: labelFor(type), isActive, type,
});

const chat = (ids: string[], active: string | null = ids[0] ?? null): ChatTaskContent => ({
  conversations: ids.map(id => ({
    id,
    title: id,
    messages: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
  })) as unknown as ChatTaskContent['conversations'],
  activeConversationId: active,
});

describe('collapseToSingletonTasks', () => {
  it('collapses_two_video_tasks_keeping_the_active_one', () => {
    const state: AppState = {
      tasks: [task('v1', 'video', 1), task('v2', 'video', 9)],
      tabs: [tab('t1', 'v1', 'video', true), tab('t2', 'v2', 'video')],
      activeTabId: 't1',
    };
    const next = collapseToSingletonTasks(state, labelFor);
    expect(next.tasks.map(t => t.id)).toEqual(['v1']);
    expect(next.tabs.map(t => t.id)).toEqual(['t1']);
  });

  it('keeps_most_recently_updated_when_none_active', () => {
    const state: AppState = {
      tasks: [task('v1', 'video', 1), task('v2', 'video', 9), task('v3', 'video', 5)],
      tabs: [],
      activeTabId: null,
    };
    expect(collapseToSingletonTasks(state, labelFor).tasks.map(t => t.id)).toEqual(['v2']);
  });

  it('merges_chat_conversations_dedup_by_id', () => {
    const state: AppState = {
      tasks: [
        task('c1', 'chat', 5, chat(['a', 'b'])),
        task('c2', 'chat', 1, chat(['b', 'c'])),
        task('c3', 'chat', 3, chat(['d'])),
      ],
      tabs: [tab('t1', 'c1', 'chat', true)],
      activeTabId: 't1',
    };
    const next = collapseToSingletonTasks(state, labelFor);
    const content = next.tasks[0].content as ChatTaskContent;
    expect(content.conversations.map(c => c.id)).toEqual(['a', 'b', 'd', 'c']);
    expect(content.activeConversationId).toBe('a');
  });

  it('remaps_active_tab_to_kept_task', () => {
    // v2 is active but the duplicate tab for v2 appears after v1's tab; the
    // kept task is the active one, so its tab survives.
    const state: AppState = {
      tasks: [task('v1', 'video', 9), task('v2', 'video', 1)],
      tabs: [tab('t1', 'v1', 'video'), tab('t2', 'v2', 'video', true)],
      activeTabId: 't2',
    };
    const next = collapseToSingletonTasks(state, labelFor);
    expect(next.tasks.map(t => t.id)).toEqual(['v2']);
    expect(next.activeTabId).toBe('t2');
    expect(next.tabs[0].isActive).toBe(true);
  });

  it('drops_orphan_and_duplicate_tabs', () => {
    const state: AppState = {
      tasks: [task('v1', 'video')],
      tabs: [tab('t1', 'v1', 'video', true), tab('t1b', 'v1', 'video'), tab('tx', 'gone', 'chat')],
      activeTabId: 't1',
    };
    const next = collapseToSingletonTasks(state, labelFor);
    expect(next.tabs.map(t => t.id)).toEqual(['t1']);
  });

  it('returns_same_reference_when_already_singleton', () => {
    const state: AppState = {
      tasks: [task('c1', 'chat'), task('v1', 'video')],
      tabs: [tab('tc', 'c1', 'chat'), tab('tv', 'v1', 'video', true)],
      activeTabId: 'tv',
    };
    expect(collapseToSingletonTasks(state, labelFor)).toBe(state);
    const collapsed = collapseToSingletonTasks(
      { ...state, tasks: [...state.tasks, task('v2', 'video')] }, labelFor,
    );
    expect(collapseToSingletonTasks(collapsed, labelFor)).toBe(collapsed);
  });

  it('orders_tabs_chat_then_video', () => {
    const state: AppState = {
      tasks: [task('v1', 'video'), task('c1', 'chat')],
      tabs: [tab('tv', 'v1', 'video', true), tab('tc', 'c1', 'chat')],
      activeTabId: 'tv',
    };
    const next = collapseToSingletonTasks(state, labelFor);
    expect(next.tabs.map(t => t.type)).toEqual([...SINGLETON_TAB_ORDER]);
    expect(next.activeTabId).toBe('tv');
  });

  it('rewrites_titles_to_type_labels', () => {
    const state: AppState = {
      tasks: [{ ...task('v1', 'video'), title: 'Video Editing 3' }],
      tabs: [{ ...tab('tv', 'v1', 'video', true), title: 'Video Editing 3' }],
      activeTabId: 'tv',
    };
    const next = collapseToSingletonTasks(state, labelFor);
    expect(next.tasks[0].title).toBe('Video Editing');
    expect(next.tabs[0].title).toBe('Video Editing');
  });
});

describe('mergeChatContents', () => {
  it('returns_kept_when_nothing_to_merge', () => {
    expect(mergeChatContents(null, [null])).toBeNull();
  });

  it('uses_first_other_when_kept_is_empty', () => {
    const merged = mergeChatContents(null, [chat(['x'])]);
    expect(merged?.conversations.map(c => c.id)).toEqual(['x']);
    expect(merged?.activeConversationId).toBe('x');
  });
});
