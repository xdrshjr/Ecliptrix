'use client';

import React from 'react';
import { TimelineToolType } from '@/types';

interface TimelineToolbarProps {
  activeTool: TimelineToolType;
  onToolChange: (tool: TimelineToolType) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  selectedItemsCount: number;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onAddEffect: () => void;
  onAddTransition: () => void;
  onAddSubtitle: () => void;
  onExport: () => void;
  isExporting?: boolean; // 导出状态
  exportProgress?: number; // 导出进度
}

const TimelineToolbar: React.FC<TimelineToolbarProps> = ({
  activeTool,
  onToolChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  selectedItemsCount,
  onCut,
  onCopy,
  onPaste,
  onDelete,
  onAddEffect,
  onAddTransition,
  onAddSubtitle,
  onExport,
  isExporting = false,
  exportProgress = 0
}) => {

  // 工具按钮配置
  const toolButtons = [
    {
      id: 'select' as TimelineToolType,
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
      ),
      label: '选择',
      shortcut: 'V'
    },
    {
      id: 'cut' as TimelineToolType,
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M9.64 7.64c.23-.5.36-1.05.36-1.64 0-2.21-1.79-4-4-4S2 3.79 2 6s1.79 4 4 4c.59 0 1.14-.13 1.64-.36L10 12l-2.36 2.36C7.14 14.13 6.59 14 6 14c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4c0-.59-.13-1.14-.36-1.64L12 14l7 7h3v-1L9.64 7.64zM6 8c-1.1 0-2-.89-2-2s.89-2 2-2 2 .89 2 2-.89 2-2 2zm0 12c-1.1 0-2-.89-2-2s.89-2 2-2 2 .89 2 2-.89 2-2 2zm6-7.5c-.28 0-.5-.22-.5-.5s.22-.5.5-.5.5.22.5.5-.22.5-.5.5zM19 3l-6 6 2 2 7-7V3z"/>
        </svg>
      ),
      label: '剪切',
      shortcut: 'Ctrl+X',
      disabled: selectedItemsCount === 0
    }
  ];

  // 基础编辑按钮
  const basicEditButtons = [
    {
      action: onCut,
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M9.64 7.64c.23-.5.36-1.05.36-1.64 0-2.21-1.79-4-4-4S2 3.79 2 6s1.79 4 4 4c.59 0 1.14-.13 1.64-.36L10 12l-2.36 2.36C7.14 14.13 6.59 14 6 14c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4c0-.59-.13-1.14-.36-1.64L12 14l7 7h3v-1L9.64 7.64zM6 8c-1.1 0-2-.89-2-2s.89-2 2-2 2 .89 2 2-.89 2-2 2zm0 12c-1.1 0-2-.89-2-2s.89-2 2-2 2 .89 2 2-.89 2-2 2zm6-7.5c-.28 0-.5-.22-.5-.5s.22-.5.5-.5.5.22.5.5-.22.5-.5.5zM19 3l-6 6 2 2 7-7V3z"/>
        </svg>
      ),
      label: '剪切',
      shortcut: 'Ctrl+X',
      disabled: selectedItemsCount === 0
    },
    {
      action: onCopy,
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
        </svg>
      ),
      label: '复制',
      shortcut: 'Ctrl+C',
      disabled: selectedItemsCount === 0
    },
    {
      action: onPaste,
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M19 2h-4.18C14.4.84 13.3 0 12 0c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm7 18H5V4h2v3h10V4h2v16z"/>
        </svg>
      ),
      label: '粘贴',
      shortcut: 'Ctrl+V',
      disabled: false // 这里可以根据剪贴板状态来控制
    },
    {
      action: onDelete,
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
        </svg>
      ),
      label: '删除',
      shortcut: 'Del',
      disabled: selectedItemsCount === 0
    }
  ];

  // 历史操作按钮
  const historyButtons = [
    {
      action: onUndo,
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/>
        </svg>
      ),
      label: '撤销',
      shortcut: 'Ctrl+Z',
      disabled: !canUndo
    },
    {
      action: onRedo,
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/>
        </svg>
      ),
      label: '重做',
      shortcut: 'Ctrl+Y',
      disabled: !canRedo
    }
  ];

  // 高级功能按钮
  const advancedButtons = [
    {
      action: onAddEffect,
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
      ),
      label: '特效',
      shortcut: 'E'
    },
    {
      action: onAddTransition,
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H3v16h2l2-4h3l2 4h2l-2-4h3l2 4h2l-2-4h3l2 4h2V4z"/>
        </svg>
      ),
      label: '转场',
      shortcut: 'T'
    },
    {
      action: onAddSubtitle,
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/>
        </svg>
      ),
      label: '字幕',
      shortcut: 'S'
    },
    {
      action: onExport,
      icon: isExporting ? (
        <div className="relative w-4 h-4">
          <svg className="w-4 h-4 animate-spin" fill="currentColor" viewBox="0 0 24 24">
            <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
          </svg>
          {exportProgress > 0 && (
            <div className="absolute -top-1 -right-1 text-xs bg-blue-500 text-white rounded-full w-3 h-3 flex items-center justify-center text-[8px]">
              {Math.round(exportProgress)}
            </div>
          )}
        </div>
      ) : (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/>
        </svg>
      ),
      label: isExporting ? `导出中 ${exportProgress > 0 ? `(${Math.round(exportProgress)}%)` : ''}` : '导出',
      shortcut: 'Ctrl+E',
      disabled: isExporting
    }
  ];

  // 渲染工具按钮
  const renderButton = (button: any, isActive = false) => (
    <button
      key={button.label}
      onClick={() => {
        console.log(`[TimelineToolbar] 点击工具按钮`, {
          buttonLabel: button.label,
          isDisabled: button.disabled,
          timestamp: new Date().toISOString()
        });
        
        if (!button.disabled) {
          button.action();
        }
      }}
      className={`
        flex items-center space-x-1 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200
        ${button.disabled 
          ? 'text-gray-400 cursor-not-allowed bg-gray-100' 
          : isActive
            ? 'text-blue-700 bg-blue-100 border border-blue-300 shadow-sm'
            : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100 border border-transparent'
        }
      `}
      disabled={button.disabled}
      title={`${button.label} (${button.shortcut})`}
    >
      <span className={button.disabled ? 'opacity-50' : ''}>
        {button.icon}
      </span>
      <span className="hidden lg:inline">{button.label}</span>
    </button>
  );

  return (
    <div className="timeline-toolbar h-12 bg-white border-b border-gray-200 flex items-center justify-between px-4">
      {/* 左侧基础编辑工具 */}
      <div className="flex items-center space-x-2">
        <div className="flex items-center space-x-1">
          {basicEditButtons.map(button => renderButton(button))}
        </div>
        
        <div className="w-px h-6 bg-gray-300" />
        
        <div className="flex items-center space-x-1">
          {historyButtons.map(button => renderButton(button))}
        </div>
      </div>

      {/* 中间状态显示 */}
      <div className="flex items-center space-x-4 text-sm text-gray-600">
        {selectedItemsCount > 0 && (
          <div className="flex items-center space-x-2 bg-blue-50 px-3 py-1 rounded-full">
            <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
            <span className="text-blue-700 font-medium">
              已选中 {selectedItemsCount} 个素材
            </span>
          </div>
        )}
        
        <div className="hidden md:flex items-center space-x-2">
          <span>当前工具:</span>
          <span className="font-medium text-blue-600">
            {activeTool === 'select' ? '选择' : 
             activeTool === 'cut' ? '剪切' : 
             activeTool === 'copy' ? '复制' : '未知'}
          </span>
        </div>
      </div>

      {/* 右侧高级功能 */}
      <div className="flex items-center space-x-2">
        <div className="flex items-center space-x-1">
          {advancedButtons.map(button => renderButton(button))}
        </div>
      </div>
    </div>
  );
};

export default TimelineToolbar; 