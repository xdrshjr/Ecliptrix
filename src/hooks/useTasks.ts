'use client';

import { useState, useCallback } from 'react';
import { Task, Tab, TaskType, AppState } from '@/types';

export const useTasks = () => {
  // 创建默认任务和标签页
  const createDefaultTasks = () => {
    const now = new Date();
    
    // 创建默认的 AI Chat 任务
    const chatTask: Task = {
      id: 'default-chat-task',
      title: 'AI Chat',
      type: 'chat',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      content: null,
    };

    // 创建默认的 Video Editing 任务
    const videoTask: Task = {
      id: 'default-video-task',
      title: 'Video Editing',
      type: 'video',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      content: null,
    };

    // 创建默认的 Content Creation 任务
    const contentTask: Task = {
      id: 'default-content-task',
      title: 'Content Creation',
      type: 'content',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      content: null,
    };

    // 创建默认的 Brainstorming 任务
    const brainstormTask: Task = {
      id: 'default-brainstorm-task',
      title: 'Brainstorming',
      type: 'brainstorm',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      content: null,
    };

    // 创建对应的标签页，但都不激活
    const chatTab: Tab = {
      id: 'default-chat-tab',
      taskId: 'default-chat-task',
      title: 'AI Chat',
      isActive: false, // 不激活任何任务
      type: 'chat',
    };

    const videoTab: Tab = {
      id: 'default-video-tab',
      taskId: 'default-video-task',
      title: 'Video Editing',
      isActive: false, // 不激活任何任务
      type: 'video',
    };

    const contentTab: Tab = {
      id: 'default-content-tab',
      taskId: 'default-content-task',
      title: 'Content Creation',
      isActive: false, // 不激活任何任务
      type: 'content',
    };

    const brainstormTab: Tab = {
      id: 'default-brainstorm-tab',
      taskId: 'default-brainstorm-task',
      title: 'Brainstorming',
      isActive: false, // 不激活任何任务
      type: 'brainstorm',
    };

    return {
      tasks: [chatTask, videoTask, contentTask, brainstormTask],
      tabs: [chatTab, videoTab, contentTab, brainstormTab],
      activeTabId: null, // 不激活任何标签页，显示主界面
    };
  };

  const [appState, setAppState] = useState<AppState>(() => {
    const defaultState = createDefaultTasks();
    console.log('[useTasks] Initialized with default tasks (showing main interface):', {
      tasksCount: defaultState.tasks.length,
      tabsCount: defaultState.tabs.length,
      activeTabId: defaultState.activeTabId,
      tasks: defaultState.tasks.map(t => ({ id: t.id, title: t.title, type: t.type })),
      showingMainInterface: defaultState.activeTabId === null,
      timestamp: new Date().toISOString()
    });
    return defaultState;
  });

  const createTask = useCallback((type: TaskType) => {
    const now = new Date();
    const taskId = `task-${Date.now()}`;
    const tabId = `tab-${Date.now()}`;
    
    const taskTypeNames = {
      content: 'Content Creation',
      video: 'Video Editing',
      brainstorm: 'Brainstorming',
      chat: 'AI Chat',
    };

    // 计算同类型任务的数量，包括默认任务
    const sameTypeTasksCount = appState.tasks.filter(t => t.type === type).length;
    const taskNumber = sameTypeTasksCount + 1;

    const newTask: Task = {
      id: taskId,
      title: `${taskTypeNames[type]} ${taskNumber}`,
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

    console.log(`Taskbar 任务创建: 新建${type}任务 - ${newTask.title}`, {
      taskId: newTask.id,
      taskType: type,
      taskTitle: newTask.title,
      tabId: tabId,
      timestamp: now.toISOString(),
      availableTypes: Object.keys(taskTypeNames),
      note: 'Voice Synthesis已从可用任务类型中移除'
    });
  }, [appState.tasks]);

  const selectTab = useCallback((tabId: string) => {
    setAppState(prev => ({
      ...prev,
      tabs: prev.tabs.map(tab => ({
        ...tab,
        isActive: tab.id === tabId,
      })),
      activeTabId: tabId,
    }));

    const selectedTab = appState.tabs.find(tab => tab.id === tabId);
    if (selectedTab) {
      console.log(`Selected tab: ${selectedTab.title}`);
    }
  }, [appState.tabs]);

  const closeTab = useCallback((tabId: string) => {
    const tabToClose = appState.tabs.find(tab => tab.id === tabId);
    
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

    if (tabToClose) {
      console.log(`Closed tab: ${tabToClose.title}`);
    }
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

    console.log(`Updated task: ${taskId}`);
  }, []);

  return {
    tasks: appState.tasks,
    tabs: appState.tabs,
    activeTabId: appState.activeTabId,
    activeTask: getActiveTask(),
    createTask,
    selectTab,
    closeTab,
    updateTask,
  };
};