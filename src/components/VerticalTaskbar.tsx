'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Tab, TaskType } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import type { OpenTaskOptions } from '@/hooks/useTasks';
import NewTaskMenu from '@/components/shell/NewTaskMenu';

interface VerticalTaskbarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  /** Opens (or creates) the single task of the given type. Optional so the
   *  taskbar stays usable in isolation (tests, storybook); when absent the
   *  "new task" control is simply not rendered. */
  onOpenTask?: (type: TaskType, options?: OpenTaskOptions) => void;
  isBlurred?: boolean;
}

const AUTO_COLLAPSE_DELAY_MS = 300;

const VerticalTaskbar: React.FC<VerticalTaskbarProps> = ({
  tabs,
  onSelectTab,
  onCloseTab,
  onOpenTask,
  isBlurred = false,
}) => {
  const { t } = useLocale();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const taskbarRef = useRef<HTMLDivElement>(null);
  const newTaskButtonRef = useRef<HTMLButtonElement>(null);
  const collapseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Read by the auto-collapse paths: the menu is portaled to <body>, so moving
  // the pointer onto it fires the taskbar's mouseleave.
  const isMenuOpenRef = useRef(false);
  const isHoveredRef = useRef(false);
  isMenuOpenRef.current = isMenuOpen;

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
    isHoveredRef.current = true;
    // 鼠标进入时清除折叠定时器
    if (collapseTimeoutRef.current) {
      clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = null;
    }
  };

  const scheduleCollapse = () => {
    collapseTimeoutRef.current = setTimeout(() => {
      setIsExpanded(false);
      collapseTimeoutRef.current = null;
    }, AUTO_COLLAPSE_DELAY_MS); // 延迟，给用户足够时间操作
  };

  const handleMouseLeave = () => {
    isHoveredRef.current = false;
    // 新建菜单打开期间暂停自动折叠（菜单在 Portal 里，移上去会触发 mouseleave）
    if (isMenuOpenRef.current) return;
    // 只有在展开状态下才设置自动折叠
    if (isExpanded) {
      scheduleCollapse();
    }
  };

  // 点击外部区域时收缩任务栏，并清理定时器
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isMenuOpenRef.current) return;
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
    if (!isExpanded) {
      setIsExpanded(true);
    }
    onSelectTab(tab.id);
  };

  const closeMenu = () => {
    setIsMenuOpen(false);
    if (isExpanded && !isHoveredRef.current) {
      scheduleCollapse();
    }
  };

  const toggleMenu = () => {
    if (isBlurred) return;
    if (isMenuOpen) {
      closeMenu();
      return;
    }
    setIsMenuOpen(true);
  };

  const chooseTaskType = (type: TaskType) => {
    setIsMenuOpen(false);
    setIsExpanded(false);
    onOpenTask?.(type);
  };

  const existingTypes = new Set<TaskType>(tabs.map(tab => tab.type));

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

        {/* The single new-task control. Without it the taskbar can only ever
            show tabs that already exist, so a second task type is
            unreachable once the first tab is open. It opens a menu that
            either switches to the existing task of a type or creates it. */}
        {onOpenTask && (
          <div className="taskbar-section new-task-section">
            <button
              ref={newTaskButtonRef}
              type="button"
              className="taskbar-tab new-task-button"
              onClick={(e) => {
                e.stopPropagation();
                toggleMenu();
              }}
              disabled={isBlurred}
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
              aria-label={t.common.newTask}
              title={t.common.newTask}
            >
              <div className="tab-icon" aria-hidden="true">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 5v14M5 12h14" />
                </svg>
              </div>
              <div className={`tab-content ${isExpanded ? 'visible' : 'hidden'}`}>
                <span className="tab-title">{t.common.newTask}</span>
              </div>
            </button>
          </div>
        )}

      </div>

      {isMenuOpen && onOpenTask && (
        <NewTaskMenu
          existingTypes={existingTypes}
          onChoose={chooseTaskType}
          onClose={closeMenu}
          returnFocusRef={newTaskButtonRef}
          renderIcon={getTaskIcon}
          labelFor={getTaskLabel}
        />
      )}
    </>
  );
};

export default VerticalTaskbar;