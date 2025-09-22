'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Tab, TaskType } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNotification } from '@/contexts/NotificationContext';

interface VerticalTaskbarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
}

const VerticalTaskbar: React.FC<VerticalTaskbarProps> = ({
  tabs,
  onSelectTab,
  onCloseTab,
}) => {
  const { t } = useLocale();
  const { isAuthenticated, user } = useAuth();
  const { showWarning } = useNotification();
  const [isExpanded, setIsExpanded] = useState(false);
  const taskbarRef = useRef<HTMLDivElement>(null);
  const collapseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const getTaskIcon = (type: TaskType) => {
    switch (type) {
      case 'content':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        );
      case 'video':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        );
      case 'brainstorm':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        );
      case 'chat':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        );
    }
  };

  const getTaskLabel = (type: TaskType) => {
    switch (type) {
      case 'content':
        return t.tasks.contentCreation;
      case 'video':
        return t.tasks.videoEditing;
      case 'brainstorm':
        return t.tasks.brainstorming;
      case 'chat':
        return t.tasks.aiChat;
    }
  };



  const handleTaskbarClick = () => {
    // 清除任何待执行的折叠操作
    if (collapseTimeoutRef.current) {
      clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = null;
    }
    
    setIsExpanded(!isExpanded);
    console.log('[VerticalTaskbar] Taskbar clicked, toggling expansion:', !isExpanded);
  };

  const handleMouseEnter = () => {
    // 鼠标进入时清除折叠定时器
    if (collapseTimeoutRef.current) {
      clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = null;
    }
    console.log('[VerticalTaskbar] Mouse entered, canceling auto-collapse');
  };

  const handleMouseLeave = () => {
    // 只有在展开状态下才设置自动折叠
    if (isExpanded) {
      collapseTimeoutRef.current = setTimeout(() => {
        setIsExpanded(false);
        console.log('[VerticalTaskbar] Mouse left, auto-collapsing taskbar');
        collapseTimeoutRef.current = null;
      }, 300); // 300ms 延迟，给用户足够时间操作
    }
  };

  // 点击外部区域时收缩任务栏，并清理定时器
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (taskbarRef.current && !taskbarRef.current.contains(event.target as Node)) {
        // 清除自动折叠定时器
        if (collapseTimeoutRef.current) {
          clearTimeout(collapseTimeoutRef.current);
          collapseTimeoutRef.current = null;
        }
        
        setIsExpanded(false);
        console.log('[VerticalTaskbar] Clicked outside, collapsing taskbar');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      // 清理定时器
      if (collapseTimeoutRef.current) {
        clearTimeout(collapseTimeoutRef.current);
      }
    };
  }, []);

  const handleTabClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    onCloseTab(tabId);
    console.log('[VerticalTaskbar] Tab closed:', {
      tabId,
      timestamp: new Date().toISOString()
    });
  };

  const handleTabClick = (e: React.MouseEvent, tab: Tab) => {
    e.stopPropagation();
    
    console.log('[VerticalTaskbar] Tab click attempted:', {
      tabId: tab.id,
      tabTitle: tab.title,
      tabType: tab.type,
      isAuthenticated,
      username: user?.username || 'not logged in',
      timestamp: new Date().toISOString()
    });

    // 检查用户是否已登录
    if (!isAuthenticated) {
      console.warn('[VerticalTaskbar] Unauthorized task access attempt:', {
        tabId: tab.id,
        tabTitle: tab.title,
        tabType: tab.type,
        action: 'blocked - user not authenticated',
        timestamp: new Date().toISOString()
      });

      showWarning('请先登录后再使用任务功能', 4000);
      return;
    }

    console.log('[VerticalTaskbar] Task access authorized:', {
      tabId: tab.id,
      tabTitle: tab.title,
      tabType: tab.type,
      username: user?.username,
      action: 'proceeding with task selection',
      timestamp: new Date().toISOString()
    });

    // 如果任务栏未展开，先展开任务栏
    if (!isExpanded) {
      setIsExpanded(true);
      console.log('[VerticalTaskbar] Tab clicked, expanding taskbar first');
    }
    onSelectTab(tab.id);
  };

  return (
    <>
      <div 
        ref={taskbarRef}
        className={`vertical-taskbar ${isExpanded ? 'expanded' : 'collapsed'}`}
        onClick={handleTaskbarClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >

        {/* Tabs Section */}
        <div className="taskbar-section tabs-section">
          <div className="tabs-container">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`taskbar-tab ${tab.isActive ? 'active' : ''}`}
                onClick={(e) => handleTabClick(e, tab)}
                title={!isExpanded ? tab.title : undefined}
              >
                <div className="tab-icon">
                  {getTaskIcon(tab.type)}
                </div>
                <div className={`tab-content ${isExpanded ? 'visible' : 'hidden'}`}>
                  <span className="tab-title">{tab.title}</span>
                  <button
                    onClick={(e) => handleTabClose(e, tab.id)}
                    className="tab-close"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </>
  );
};

export default VerticalTaskbar;