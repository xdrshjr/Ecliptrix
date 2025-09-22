'use client';

import React, { useState } from 'react';
import { Tab, TaskType } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNotification } from '@/contexts/NotificationContext';
import { shouldRestrictVideoEditing, getDeviceType } from '@/lib/utils/deviceDetection';

interface TaskbarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onCreateTask: (type: TaskType) => void;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
}

const Taskbar: React.FC<TaskbarProps> = ({
  tabs,
  onCreateTask,
  onSelectTab,
  onCloseTab,
}) => {
  const { t } = useLocale();
  const { isAuthenticated, user } = useAuth();
  const { showWarning } = useNotification();
  const [showTaskMenu, setShowTaskMenu] = useState(false);

  const getTaskIcon = (type: TaskType) => {
    switch (type) {
      case 'content':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        );
      case 'video':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        );
      case 'brainstorm':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        );
      case 'chat':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        );
    }
  };

  const handleCreateTask = (type: TaskType) => {
    console.log('[Taskbar] Task creation attempted:', {
      taskType: type,
      isAuthenticated,
      username: user?.username || 'not logged in',
      timestamp: new Date().toISOString()
    });

    // 检查用户是否已登录
    if (!isAuthenticated) {
      console.warn('[Taskbar] Unauthorized task creation attempt:', {
        taskType: type,
        action: 'blocked - user not authenticated',
        timestamp: new Date().toISOString()
      });

      showWarning('请先登录后再创建新任务', 4000);
      setShowTaskMenu(false);
      return;
    }

    // Check for mobile device restriction on video editing tasks
    // Note: Global mobile detection now handles this at app level
    if (type === 'video' && shouldRestrictVideoEditing()) {
      const deviceType = getDeviceType();
      
      console.log('[Taskbar] Video editing task creation blocked on mobile device (handled globally):', {
        taskType: type,
        deviceType,
        username: user?.username,
        timestamp: new Date().toISOString(),
        userAgent: typeof window !== 'undefined' ? navigator.userAgent : 'server-side',
        restriction: 'Video editing not supported on mobile/tablet devices',
        note: 'Global mobile warning dialog is already displayed'
      });
      
      setShowTaskMenu(false);
      return;
    }

    // Proceed with task creation for authorized and non-restricted cases
    console.log('[Taskbar] Task creation authorized, proceeding:', {
      taskType: type,
      username: user?.username,
      deviceType: getDeviceType(),
      timestamp: new Date().toISOString(),
      restriction: 'none'
    });
    
    onCreateTask(type);
    setShowTaskMenu(false);
  };

  const handleTabSelect = (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    
    console.log('[Taskbar] Tab selection attempted:', {
      tabId,
      tabTitle: tab?.title,
      tabType: tab?.type,
      isAuthenticated,
      username: user?.username || 'not logged in',
      timestamp: new Date().toISOString()
    });

    // 检查用户是否已登录
    if (!isAuthenticated) {
      console.warn('[Taskbar] Unauthorized tab selection attempt:', {
        tabId,
        tabTitle: tab?.title,
        tabType: tab?.type,
        action: 'blocked - user not authenticated',
        timestamp: new Date().toISOString()
      });

      showWarning('请先登录后再使用任务功能', 4000);
      return;
    }

    console.log('[Taskbar] Tab selection authorized, proceeding:', {
      tabId,
      tabTitle: tab?.title,
      tabType: tab?.type,
      username: user?.username,
      timestamp: new Date().toISOString()
    });

    onSelectTab(tabId);
  };


  return (
    <div className="h-12 bg-gray-50 border-b border-gray-200 flex items-center px-4 space-x-2">
      {/* New Task Button */}
      <div className="relative">
        <button
          onClick={() => setShowTaskMenu(!showTaskMenu)}
          className="h-8 px-3 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg flex items-center space-x-2 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>{t.common.newTask}</span>
        </button>

        {/* Task Type Menu */}
        {showTaskMenu && (
          <div className="absolute top-10 left-0 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
            <button
              onClick={() => handleCreateTask('chat')}
              className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center space-x-3"
            >
              {getTaskIcon('chat')}
              <span className="text-sm">{t.tasks.aiChat}</span>
            </button>
            <button
              onClick={() => handleCreateTask('video')}
              className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center space-x-3"
            >
              {getTaskIcon('video')}
              <span className="text-sm">{t.tasks.videoEditing}</span>
            </button>
            <button
              onClick={() => handleCreateTask('content')}
              className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center space-x-3"
            >
              {getTaskIcon('content')}
              <span className="text-sm">{t.tasks.contentCreation}</span>
            </button>
            <button
              onClick={() => handleCreateTask('brainstorm')}
              className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center space-x-3"
            >
              {getTaskIcon('brainstorm')}
              <span className="text-sm">{t.tasks.brainstorming}</span>
            </button>
          </div>
        )}
      </div>

      {/* Tab List */}
      <div className="flex-1 flex items-center space-x-1 overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`h-8 px-3 rounded-lg flex items-center space-x-2 cursor-pointer transition-colors ${
              tab.isActive
                ? 'bg-white border border-gray-200 text-gray-900'
                : 'bg-transparent hover:bg-gray-100 text-gray-600'
            }`}
            onClick={() => handleTabSelect(tab.id)}
          >
            {getTaskIcon(tab.type)}
            <span className="text-sm font-medium truncate max-w-32">{tab.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              className="w-4 h-4 rounded-full hover:bg-gray-200 flex items-center justify-center opacity-60 hover:opacity-100"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Click outside to close menu */}
      {showTaskMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowTaskMenu(false)}
        />
      )}

      {/* Mobile Warning Dialog - Now handled globally at app level */}
    </div>
  );
};

export default Taskbar; 