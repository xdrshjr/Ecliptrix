'use client';

import { useState, useCallback, useEffect } from 'react';
import { Task, Tab, TaskType, AppState } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import {
  collapseToSingletonTasks,
  resolveSingletonTaskId,
  sortTabsBySingletonOrder,
} from './taskSingleton';

const STORAGE_KEY = 'ecliptrix-tasks-state-v1';
const FALLBACK_TITLE = 'Ecliptrix - Where light and shadow collide';

interface PersistedTask extends Omit<Task, 'createdAt' | 'updatedAt'> {
  createdAt: string;
  updatedAt: string;
}

interface PersistedState {
  tasks: PersistedTask[];
  tabs: Tab[];
  activeTabId: string | null;
}

const reviveConversation = (c: any) => ({
  ...c,
  createdAt: new Date(c.createdAt),
  updatedAt: new Date(c.updatedAt),
  messages: Array.isArray(c.messages)
    ? c.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }))
    : [],
});

const reviveTaskContent = (type: TaskType, raw: any): any => {
  if (!raw) return raw;
  if (type === 'chat' && Array.isArray(raw.conversations)) {
    return { ...raw, conversations: raw.conversations.map(reviveConversation) };
  }
  return raw;
};

const reviveState = (raw: PersistedState): AppState => ({
  tasks: (raw.tasks ?? []).map(t => ({
    ...t,
    createdAt: new Date(t.createdAt),
    updatedAt: new Date(t.updatedAt),
    content: reviveTaskContent(t.type, t.content),
  })) as Task[],
  tabs: raw.tabs ?? [],
  activeTabId: raw.activeTabId ?? null,
});

const serializeState = (state: AppState): PersistedState => ({
  tasks: state.tasks.map(t => ({
    ...t,
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : new Date(t.createdAt as unknown as string).toISOString(),
    updatedAt: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : new Date(t.updatedAt as unknown as string).toISOString(),
  })),
  tabs: state.tabs,
  activeTabId: state.activeTabId,
});

export interface OpenTaskOptions {
  /** 在同一次状态更新中改写目标任务的 content（原子，避免 id 竞态）。 */
  updateContent?: (previous: unknown) => unknown;
}

const randomIdPart = (): string => Math.random().toString(36).slice(2, 11);

// Task types still supported after the workflow/brainstorm feature removal.
// Used to scrub any historical persisted tasks/tabs during hydration.
const ALLOWED_TASK_TYPES = new Set<TaskType>(['chat', 'video']);

export const useTasks = () => {
  const { t } = useLocale();

  const buildTaskTypeLabel = useCallback((type: TaskType): string => {
    switch (type) {
      case 'video':      return t.tasks.types.video;
      case 'chat':       return t.tasks.types.chat;
    }
  }, [t.tasks.types]);

  const createInitialState = (): AppState => ({
    tasks: [],
    tabs: [],
    activeTabId: null,
  });

  const [appState, setAppState] = useState<AppState>(() => createInitialState());
  const [hydrated, setHydrated] = useState(false);

  // Hydration: read LS (and URL ?task=) once on mount.
  useEffect(() => {
    let nextState: AppState | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        nextState = reviveState(JSON.parse(raw) as PersistedState);
      }
    } catch (e) {
      console.warn('[useTasks] Failed to restore state, starting fresh:', e);
    }

    if (nextState) {
      // Hydration scrub: drop any persisted tasks/tabs whose type was removed
      // (workflow / brainstorm). Without this, the taskbar and Container would
      // try to render an unknown task type after the feature removal, yielding
      // a blank tab or a runtime error.
      const keptTasks = nextState.tasks.filter(task => ALLOWED_TASK_TYPES.has(task.type));
      const keptTaskIds = new Set(keptTasks.map(task => task.id));
      const keptTabs = nextState.tabs.filter(
        tab => ALLOWED_TASK_TYPES.has(tab.type) && keptTaskIds.has(tab.taskId)
      );
      let scrubbedActiveTabId = nextState.activeTabId;
      if (!keptTabs.some(tab => tab.id === scrubbedActiveTabId)) {
        scrubbedActiveTabId = keptTabs.length > 0 ? keptTabs[0].id : null;
      }
      nextState = {
        tasks: keptTasks,
        tabs: keptTabs.map(tab => ({ ...tab, isActive: tab.id === scrubbedActiveTabId })),
        activeTabId: scrubbedActiveTabId,
      };

      // Collapse historical multi-instance state to one task per type
      // (editor-shell-ui-consolidation W3). It also rewrites every title to
      // the current-locale type label, which superseded the old English-title
      // migration.
      const beforeCollapse = nextState;
      nextState = collapseToSingletonTasks(nextState, buildTaskTypeLabel);

      try {
        const search = new URLSearchParams(window.location.search);
        const taskParam = search.get('task');
        const taskId = taskParam
          ? resolveSingletonTaskId(beforeCollapse, nextState, taskParam)
          : null;
        if (taskId) {
          const tab = nextState.tabs.find(t => t.taskId === taskId);
          if (tab) {
            nextState = {
              ...nextState,
              tabs: nextState.tabs.map(t => ({ ...t, isActive: t.id === tab.id })),
              activeTabId: tab.id,
            };
          }
        }
      } catch {
        /* search 解析失败不阻塞恢复 */
      }
      setAppState(nextState);
    }
    setHydrated(true);
    // We deliberately want this to run only once on mount; buildTaskTypeLabel
    // depends on locale but the title rewrite should reflect the mount locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist effect: writes LS + replaces URL + updates document.title whenever
  // appState changes. Strict guard on hydrated — initial paint must NOT clobber LS.
  useEffect(() => {
    if (!hydrated) return;
    if (typeof window === 'undefined') return;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState(appState)));
    } catch (e) {
      console.warn('[useTasks] Failed to persist state:', e);
    }

    const activeTab = appState.activeTabId
      ? appState.tabs.find(t => t.id === appState.activeTabId)
      : null;
    const activeTask = activeTab
      ? appState.tasks.find(t => t.id === activeTab.taskId)
      : null;

    try {
      const url = new URL(window.location.href);
      if (activeTab && activeTask) {
        url.searchParams.set('tab', activeTab.type);
        url.searchParams.set('task', activeTask.id);
      } else {
        url.searchParams.delete('tab');
        url.searchParams.delete('task');
      }
      window.history.replaceState(window.history.state, '', url.toString());
    } catch (e) {
      console.warn('[useTasks] Failed to sync URL:', e);
    }

    if (typeof document !== 'undefined') {
      document.title = activeTask
        ? `${activeTask.title} · Ecliptrix`
        : (t.tasks.defaultPageTitle || FALLBACK_TITLE);
    }
  }, [appState, hydrated, t.tasks.defaultPageTitle]);

  /** 打开某类型任务：已存在则切换（Tab 已关则重开），否则新建。每类型至多
   *  一个。查找与创建都在同一个函数式更新里，只读 `prev`：同一 tick 内调用
   *  两次（StrictMode 双 effect、快速连点）也只会得到一个任务。 */
  const openTask = useCallback((type: TaskType, options?: OpenTaskOptions) => {
    setAppState(prev => {
      const now = new Date();
      let tasks = prev.tasks;
      let task = prev.tasks.find(candidate => candidate.type === type);
      if (!task) {
        const suffix = `${now.getTime()}-${type}-${randomIdPart()}`;
        task = {
          id: `task-${suffix}`,
          title: buildTaskTypeLabel(type),
          type,
          status: 'draft',
          createdAt: now,
          updatedAt: now,
          content: null,
        };
        tasks = [...tasks, task];
      }
      if (options?.updateContent) {
        const targetId = task.id;
        const content = options.updateContent(task.content ?? null);
        tasks = tasks.map(candidate => candidate.id === targetId
          ? { ...candidate, content: content as Task['content'], updatedAt: now }
          : candidate);
      }

      const targetTaskId = task.id;
      let tabs = prev.tabs;
      let tab = prev.tabs.find(candidate => candidate.taskId === targetTaskId);
      if (!tab) {
        tab = {
          id: `tab-${now.getTime()}-${type}-${randomIdPart()}`,
          taskId: targetTaskId,
          title: buildTaskTypeLabel(type),
          isActive: true,
          type,
        };
        tabs = sortTabsBySingletonOrder([...tabs, tab]);
      }
      const activeTabId = tab.id;
      return {
        tasks,
        tabs: tabs.map(candidate => ({
          ...candidate,
          isActive: candidate.id === activeTabId,
        })),
        activeTabId,
      };
    });
  }, [buildTaskTypeLabel]);

  const selectTab = useCallback((tabId: string) => {
    setAppState(prev => ({
      ...prev,
      tabs: prev.tabs.map(tab => ({
        ...tab,
        isActive: tab.id === tabId,
      })),
      activeTabId: tabId,
    }));
  }, [appState.tabs]);

  const closeTab = useCallback((tabId: string) => {
    setAppState(prev => {
      const remainingTabs = prev.tabs.filter(tab => tab.id !== tabId);
      let newActiveTabId = prev.activeTabId;

      if (prev.activeTabId === tabId && remainingTabs.length > 0) {
        const tabIndex = prev.tabs.findIndex(tab => tab.id === tabId);
        const nextTab = remainingTabs[Math.min(tabIndex, remainingTabs.length - 1)];
        newActiveTabId = nextTab.id;

        remainingTabs.forEach(tab => {
          tab.isActive = tab.id === newActiveTabId;
        });
      } else if (remainingTabs.length === 0) {
        newActiveTabId = null;
      }

      return {
        ...prev,
        tabs: remainingTabs,
        activeTabId: newActiveTabId,
      };
    });
  }, [appState.tabs]);

  const getActiveTask = useCallback(() => {
    if (!appState.activeTabId) return null;

    const activeTab = appState.tabs.find(tab => tab.id === appState.activeTabId);
    if (!activeTab) return null;

    return appState.tasks.find(task => task.id === activeTab.taskId) || null;
  }, [appState.activeTabId, appState.tabs, appState.tasks]);

  const updateTask = useCallback((taskId: string, updates: Partial<Task>) => {
    setAppState(prev => ({
      ...prev,
      tasks: prev.tasks.map(task =>
        task.id === taskId
          ? { ...task, ...updates, updatedAt: new Date() }
          : task
      ),
    }));
  }, []);

  const closeAllTabs = useCallback(() => {
    setAppState({
      tasks: [],
      tabs: [],
      activeTabId: null,
    });
  }, [appState.tabs.length]);

  return {
    tasks: appState.tasks,
    tabs: appState.tabs,
    activeTabId: appState.activeTabId,
    activeTask: getActiveTask(),
    openTask,
    selectTab,
    closeTab,
    closeAllTabs,
    updateTask,
    // Exposed so the entry point can tell whether localStorage restore finished
    // before deciding to skip the landing page / auto-open a task (spec §2.2f).
    hydrated,
  };
};
