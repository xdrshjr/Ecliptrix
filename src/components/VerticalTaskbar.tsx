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
  isBlurred?: boolean;
}

const VerticalTaskbar: React.FC<VerticalTaskbarProps> = ({
  tabs,
  onSelectTab,
  onCloseTab,
  isBlurred = false,
}) => {
  const { t } = useLocale();
  const { isAuthenticated } = useAuth();
  const { showWarning } = useNotification();
  const [isExpanded, setIsExpanded] = useState(false);
  const taskbarRef = useRef<HTMLDivElement>(null);
  const collapseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const getTaskIcon = (type: TaskType) => {
    switch (type) {
      case 'video':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
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
      case 'video':
        return t.tasks.videoEditing;
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
  };

  const handleMouseEnter = () => {
    // 鼠标进入时清除折叠定时器
    if (collapseTimeoutRef.current) {
      clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = null;
    }
  };

  const handleMouseLeave = () => {
    // 只有在展开状态下才设置自动折叠
    if (isExpanded) {
      collapseTimeoutRef.current = setTimeout(() => {
        setIsExpanded(false);
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
  };

  const selectTab = (tab: Tab) => {
    if (!isAuthenticated) {
      showWarning(t.auth.loginRequiredForTasks, 4000);
      return;
    }
    if (!isExpanded) {
      setIsExpanded(true);
    }
    onSelectTab(tab.id);
  };

  return (
    <>
      <div 
        ref={taskbarRef}
        className={`vertical-taskbar ${isExpanded ? 'expanded' : 'collapsed'} ${isBlurred ? 'blurred' : ''}`}
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
                role="button"
                tabIndex={0}
                aria-current={tab.isActive ? 'page' : undefined}
                aria-label={getTaskLabel(tab.type)}
                className={`taskbar-tab ${tab.isActive ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  selectTab(tab);
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectTab(tab);
                  }
                }}
                title={!isExpanded ? getTaskLabel(tab.type) : undefined}
              >
                <div className="tab-icon">
                  {getTaskIcon(tab.type)}
                </div>
                <div className={`tab-content ${isExpanded ? 'visible' : 'hidden'}`}>
                  <span className="tab-title">{getTaskLabel(tab.type)}</span>
                  <button
                    type="button"
                    onClick={(e) => handleTabClose(e, tab.id)}
                    aria-label={t.common.closeTab.replace('{title}', getTaskLabel(tab.type))}
                    title={t.common.closeTab.replace('{title}', getTaskLabel(tab.type))}
                    className="tab-close"
                  >
                    <svg aria-hidden="true" className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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