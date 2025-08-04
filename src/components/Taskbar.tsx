'use client';

import React, { useState } from 'react';
import { Tab, TaskType } from '@/types';

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
  const [showTaskMenu, setShowTaskMenu] = useState(false);

  const handleCreateTask = (type: TaskType) => {
    onCreateTask(type);
    setShowTaskMenu(false);
  };

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
      case 'audio':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        );
      case 'brainstorm':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        );
    }
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
          <span>New Task</span>
        </button>

        {/* Task Type Menu */}
        {showTaskMenu && (
          <div className="absolute top-10 left-0 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
            <button
              onClick={() => handleCreateTask('content')}
              className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center space-x-3"
            >
              {getTaskIcon('content')}
              <span className="text-sm">Content Creation</span>
            </button>
            <button
              onClick={() => handleCreateTask('video')}
              className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center space-x-3"
            >
              {getTaskIcon('video')}
              <span className="text-sm">Video Editing</span>
            </button>
            <button
              onClick={() => handleCreateTask('audio')}
              className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center space-x-3"
            >
              {getTaskIcon('audio')}
              <span className="text-sm">Voice Synthesis</span>
            </button>
            <button
              onClick={() => handleCreateTask('brainstorm')}
              className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center space-x-3"
            >
              {getTaskIcon('brainstorm')}
              <span className="text-sm">Brainstorming</span>
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
            onClick={() => onSelectTab(tab.id)}
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
    </div>
  );
};

export default Taskbar; 