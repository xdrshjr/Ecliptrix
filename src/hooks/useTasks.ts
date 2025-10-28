'use client';

import { useState, useCallback, useEffect } from 'react';
import { Task, Tab, TaskType, AppState } from '@/types';

export const useTasks = () => {
  // 初始化时不创建任何默认任务，显示着陆页
  const createInitialState = (): AppState => {
    console.log('[useTasks] Creating initial empty state for landing page:', {
      timestamp: new Date().toISOString()
    });
    
    return {
      tasks: [],
      tabs: [],
      activeTabId: null,
    };
  };

  const [appState, setAppState] = useState<AppState>(() => {
    return createInitialState();
  });

  // 在客户端初始化后记录日志
  useEffect(() => {
    console.log('[useTasks] Initialized with empty state (showing landing page):', {
      tasksCount: appState.tasks.length,
      tabsCount: appState.tabs.length,
      activeTabId: appState.activeTabId,
      showingLandingPage: appState.tabs.length === 0,
      timestamp: new Date().toISOString()
    });
  }, []);

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

    // 检查是否是从空状态创建第一个任务（从着陆页）
    const isFirstTaskFromLanding = appState.tasks.length === 0;

    if (isFirstTaskFromLanding) {
      console.log('[useTasks] Creating initial tasks from landing page, clicked type:', type);
      
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
          isActive: taskType === type, // 激活用户点击的类型
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

      console.log('[useTasks] All initial tasks created:', {
        tasks: newTasks.map(t => ({ id: t.id, title: t.title, type: t.type })),
        activeType: type,
        activeTabId,
        timestamp: now.toISOString()
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

      console.log('[useTasks] Additional task created:', {
        taskId: newTask.id,
        taskType: type,
        taskTitle: newTask.title,
        tabId: tabId,
        timestamp: now.toISOString(),
        totalTasks: appState.tasks.length + 1,
        totalTabs: appState.tabs.length + 1
      });
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

  const closeAllTabs = useCallback(() => {
    console.log('[useTasks] Closing all tabs, returning to landing page:', {
      closingTabsCount: appState.tabs.length,
      timestamp: new Date().toISOString()
    });

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