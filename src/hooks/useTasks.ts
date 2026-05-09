'use client';

import { useState, useCallback, useEffect } from 'react';
import { Task, Tab, TaskType, AppState } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';

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

const reviveState = (raw: PersistedState): AppState => ({
  tasks: (raw.tasks ?? []).map(t => ({
    ...t,
    createdAt: new Date(t.createdAt),
    updatedAt: new Date(t.updatedAt),
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

const LEGACY_TITLE_TO_TYPE: Record<string, TaskType> = {
  'Video Editing': 'video',
  'AI Chat': 'chat',
  'Brainstorming': 'brainstorm',
  'WorkFlow': 'workflow',
  'Workflow': 'workflow',
};

export const useTasks = () => {
  const { t } = useLocale();

  const buildTaskTypeLabel = useCallback((type: TaskType): string => {
    switch (type) {
      case 'workflow':   return t.tasks.types.workflow;
      case 'video':      return t.tasks.types.video;
      case 'brainstorm': return t.tasks.types.brainstorm;
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
      // Legacy LS migration: rewrite canonical English task titles to current locale.
      // Idempotent: after rewrite, titles no longer match the legacy clinic, so the
      // mapping is a one-shot. User-customized names are left untouched.
      nextState = {
        ...nextState,
        tasks: nextState.tasks.map(task => {
          const matchedType = LEGACY_TITLE_TO_TYPE[task.title];
          if (matchedType && matchedType === task.type) {
            return { ...task, title: buildTaskTypeLabel(task.type) };
          }
          return task;
        }),
        tabs: nextState.tabs.map(tab => {
          const matchedType = LEGACY_TITLE_TO_TYPE[tab.title];
          if (matchedType && matchedType === tab.type) {
            return { ...tab, title: buildTaskTypeLabel(tab.type) };
          }
          return tab;
        }),
      };

      try {
        const search = new URLSearchParams(window.location.search);
        const taskParam = search.get('task');
        if (taskParam) {
          const tab = nextState.tabs.find(t => t.taskId === taskParam);
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
    // depends on locale but legacy migration should reflect the locale at mount time.
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

  const createTask = useCallback((type: TaskType) => {
    const now = new Date();
    const timestamp = now.getTime();

    const isFirstTaskFromLanding = appState.tasks.length === 0;

    if (isFirstTaskFromLanding) {
      const allTaskTypes: TaskType[] = ['chat', 'video', 'workflow', 'brainstorm'];
      const newTasks: Task[] = [];
      const newTabs: Tab[] = [];
      let activeTabId = '';

      allTaskTypes.forEach((taskType) => {
        const taskId = `task-${timestamp}-${taskType}-${Math.random().toString(36).substr(2, 9)}`;
        const tabId = `tab-${timestamp}-${taskType}-${Math.random().toString(36).substr(2, 9)}`;

        const task: Task = {
          id: taskId,
          title: buildTaskTypeLabel(taskType),
          type: taskType,
          status: 'draft',
          createdAt: now,
          updatedAt: now,
          content: null,
        };

        const tab: Tab = {
          id: tabId,
          taskId,
          title: task.title,
          isActive: taskType === type,
          type: taskType,
        };

        newTasks.push(task);
        newTabs.push(tab);

        if (taskType === type) {
          activeTabId = tabId;
        }
      });

      setAppState({
        tasks: newTasks,
        tabs: newTabs,
        activeTabId,
      });
    } else {
      const taskId = `task-${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
      const tabId = `tab-${timestamp}-${Math.random().toString(36).substr(2, 9)}`;

      const sameTypeTasksCount = appState.tasks.filter(t => t.type === type).length;
      const taskNumber = sameTypeTasksCount + 1;

      const baseLabel = buildTaskTypeLabel(type);
      const taskTitle = taskNumber === 1
        ? baseLabel
        : `${baseLabel} ${taskNumber}`;

      const newTask: Task = {
        id: taskId,
        title: taskTitle,
        type,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
        content: null,
      };

      const newTab: Tab = {
        id: tabId,
        taskId,
        title: newTask.title,
        isActive: true,
        type,
      };

      setAppState(prev => ({
        tasks: [...prev.tasks, newTask],
        tabs: prev.tabs.map(tab => ({ ...tab, isActive: false })).concat(newTab),
        activeTabId: tabId,
      }));
    }
  }, [appState.tasks, appState.tabs.length, buildTaskTypeLabel]);

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
    createTask,
    selectTab,
    closeTab,
    closeAllTabs,
    updateTask,
  };
};
