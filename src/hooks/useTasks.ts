'use client';

import { useState, useCallback, useEffect } from 'react';
import { Task, Tab, TaskType, AppState } from '@/types';

export const useTasks = () => {
  // 创建默认任务和标签页（使用固定时间戳避免水合不匹配）
  const createDefaultTasks = () => {
    // 使用固定的时间戳避免服务端和客户端不一致
    const fixedDate = new Date('2024-01-01T00:00:00.000Z');
    
    // 创建默认的 AI Chat 任务
    const chatTask: Task = {
      id: 'default-chat-task',
      title: 'AI Chat',
      type: 'chat',
      status: 'draft',
      createdAt: fixedDate,
      updatedAt: fixedDate,
      content: null,
    };

    // 创建默认的 Video Editing 任务
    const videoTask: Task = {
      id: 'default-video-task',
      title: 'Video Editing',
      type: 'video',
      status: 'draft',
      createdAt: fixedDate,
      updatedAt: fixedDate,
      content: null,
    };

    // 创建默认的 WorkFlow 任务
    const workflowTask: Task = {
      id: 'default-workflow-task',
      title: 'WorkFlow',
      type: 'workflow',
      status: 'draft',
      createdAt: fixedDate,
      updatedAt: fixedDate,
      content: null,
    };

    // 创建默认的 Brainstorming 任务
    const brainstormTask: Task = {
      id: 'default-brainstorm-task',
      title: 'Brainstorming',
      type: 'brainstorm',
      status: 'draft',
      createdAt: fixedDate,
      updatedAt: fixedDate,
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

    const workflowTab: Tab = {
      id: 'default-workflow-tab',
      taskId: 'default-workflow-task',
      title: 'WorkFlow',
      isActive: false, // 不激活任何任务
      type: 'workflow',
    };

    const brainstormTab: Tab = {
      id: 'default-brainstorm-tab',
      taskId: 'default-brainstorm-task',
      title: 'Brainstorming',
      isActive: false, // 不激活任何任务
      type: 'brainstorm',
    };

    return {
      tasks: [chatTask, videoTask, workflowTask, brainstormTask],
      tabs: [chatTab, videoTab, workflowTab, brainstormTab],
      activeTabId: null, // 不激活任何标签页，显示主界面
    };
  };

  const [appState, setAppState] = useState<AppState>(() => {
    const defaultState = createDefaultTasks();
    return defaultState;
  });

  // 在客户端初始化后记录日志，避免水合不匹配
  useEffect(() => {
    console.log('[useTasks] Initialized with default tasks (showing main interface):', {
      tasksCount: appState.tasks.length,
      tabsCount: appState.tabs.length,
      activeTabId: appState.activeTabId,
      tasks: appState.tasks.map(t => ({ id: t.id, title: t.title, type: t.type })),
      defaultTasks: ['AI Chat', 'Video Editing', 'WorkFlow', 'Brainstorming'],
      showingMainInterface: appState.activeTabId === null,
      timestamp: new Date().toISOString()
    });
  }, []);

  const createTask = useCallback((type: TaskType) => {
    const now = new Date();
    const timestamp = now.getTime();
    const taskId = `task-${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
    const tabId = `tab-${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
    
    const taskTypeNames = {
      content: 'Content Creation',
      video: 'Video Editing',
      brainstorm: 'Brainstorming',
      workflow: 'WorkFlow',
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
      note: 'AI Chat任务已重新添加，提供独立的对话界面'
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