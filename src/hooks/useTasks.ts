'use client';

import { useState, useCallback, useEffect } from 'react';
import { Task, Tab, TaskType, AppState } from '@/types';

export const useTasks = () => {
  const createInitialState = (): AppState => ({
    tasks: [],
    tabs: [],
    activeTabId: null,
  });

  const [appState, setAppState] = useState<AppState>(() => createInitialState());

  const createTask = useCallback((type: TaskType) => {
    const now = new Date();
    const timestamp = now.getTime();

    const taskTypeNames = {
      content: 'Content Creation',
      video: 'Video Editing',
      brainstorm: 'Brainstorming',
      workflow: 'WorkFlow',
      chat: 'AI Chat',
    };

    const isFirstTaskFromLanding = appState.tasks.length === 0;

    if (isFirstTaskFromLanding) {
      // 创建所有四种类型的任务
      const allTaskTypes: TaskType[] = ['chat', 'video', 'workflow', 'brainstorm'];
      const newTasks: Task[] = [];
      const newTabs: Tab[] = [];
      let activeTabId = '';

      allTaskTypes.forEach((taskType) => {
        const taskId = `task-${timestamp}-${taskType}-${Math.random().toString(36).substr(2, 9)}`;
        const tabId = `tab-${timestamp}-${taskType}-${Math.random().toString(36).substr(2, 9)}`;

        const task: Task = {
          id: taskId,
          title: taskTypeNames[taskType],
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
      // 后续创建任务的逻辑（已有任务时）
      const taskId = `task-${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
      const tabId = `tab-${timestamp}-${Math.random().toString(36).substr(2, 9)}`;

      // 计算同类型任务的数量
      const sameTypeTasksCount = appState.tasks.filter(t => t.type === type).length;
      const taskNumber = sameTypeTasksCount + 1;

      // 如果是第一个该类型的任务，不显示数字
      const taskTitle = taskNumber === 1
        ? taskTypeNames[type]
        : `${taskTypeNames[type]} ${taskNumber}`;

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
  }, [appState.tasks, appState.tabs.length]);

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

      // If we're closing the active tab, select another one
      if (prev.activeTabId === tabId && remainingTabs.length > 0) {
        const tabIndex = prev.tabs.findIndex(tab => tab.id === tabId);
        const nextTab = remainingTabs[Math.min(tabIndex, remainingTabs.length - 1)];
        newActiveTabId = nextTab.id;

        // Update isActive for the new active tab
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
