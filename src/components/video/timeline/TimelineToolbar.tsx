'use client';

import React, { useRef, useCallback } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import { useTimelineStore, removeItemsAction } from './store';
import type { TimelineToolType } from './store';
import { useShallow } from 'zustand/react/shallow';

interface TimelineToolbarProps {
  onExportJSON: () => void;
  onImportJSON: (file: File) => void;
  onOrganizeMaterials: () => void;
  onCopy: () => void;
  onAddEffect: () => void;
  onAddTransition: () => void;
  onAddSubtitle: () => void;
}

const TimelineToolbar: React.FC<TimelineToolbarProps> = ({
  onExportJSON,
  onImportJSON,
  onOrganizeMaterials,
  onCopy,
  onAddEffect,
  onAddTransition,
  onAddSubtitle,
}) => {
  const { t } = useLocale();
  const { showError } = useNotification();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Read from store
  const { canUndo, canRedo, isExporting, isImporting, isExtractingSubtitles, selectedItemsCount } = useTimelineStore(
    useShallow((state) => ({
      canUndo: state.canUndo,
      canRedo: state.canRedo,
      isExporting: state.isExporting,
      isImporting: state.isImporting,
      isExtractingSubtitles: state.isExtractingSubtitles,
      selectedItemsCount: state.selectedItems.length,
    })),
  );

  // Store actions
  const undo = useTimelineStore((state) => state.undo);
  const redo = useTimelineStore((state) => state.redo);

  const handleDelete = useCallback(() => {
    const state = useTimelineStore.getState();
    if (state.selectedItems.length > 0) {
      removeItemsAction(() => useTimelineStore.getState(), state.selectedItems);
    }
  }, []);

  // 处理导入文件选择
  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  // 处理文件选择
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
        showError(t.timeline.toolbar.invalidJsonFile);
        event.target.value = '';
        return;
      }
      onImportJSON(file);
    }
    event.target.value = '';
  };

  // 导入项目按钮配置
  const importButton = {
    id: 'import',
    action: handleImportClick,
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
        <path d="M12,11L8,15H10.5V19H13.5V15H16L12,11Z"/>
      </svg>
    ),
    label: t.timeline.toolbar.importProject,
    shortcut: '',
    disabled: isImporting,
    loading: isImporting
  };

  // 基础编辑按钮配置
  const basicEditButtons = [
    {
      id: 'copy',
      action: onCopy,
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
        </svg>
      ),
      label: t.timeline.toolbar.copy,
      shortcut: t.timeline.shortcuts.copyShortcut,
      disabled: selectedItemsCount === 0
    },
    {
      id: 'delete',
      action: handleDelete,
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
        </svg>
      ),
      label: t.timeline.toolbar.delete,
      shortcut: t.timeline.shortcuts.deleteShortcut,
      disabled: selectedItemsCount === 0
    }
  ];

  // 历史操作按钮
  const historyButtons = [
    {
      id: 'undo',
      action: undo,
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/>
        </svg>
      ),
      label: t.timeline.toolbar.undo,
      shortcut: t.timeline.shortcuts.undoShortcut,
      disabled: !canUndo
    },
    {
      id: 'redo',
      action: redo,
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/>
        </svg>
      ),
      label: t.timeline.toolbar.redo,
      shortcut: t.timeline.shortcuts.redoShortcut,
      disabled: !canRedo
    },
    {
      id: 'organize',
      action: onOrganizeMaterials,
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>
        </svg>
      ),
      label: t.timeline.toolbar.organizeMaterials,
      disabled: false
    }
  ];

  // 高级功能按钮
  const advancedButtons = [
    {
      id: 'export-json',
      action: onExportJSON,
      icon: isExporting ? (
        <div className="relative w-4 h-4">
          <svg className="w-4 h-4 animate-spin" fill="currentColor" viewBox="0 0 24 24">
            <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
          </svg>
        </div>
      ) : (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
          <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
        </svg>
      ),
      label: isExporting ? t.timeline.toolbar.exportingJson : t.timeline.toolbar.exportJson,
      shortcut: t.timeline.shortcuts.exportShortcut,
      disabled: isExporting
    },
    {
      id: 'effects',
      action: onAddEffect,
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
      ),
      label: t.timeline.toolbar.effects,
      shortcut: t.timeline.shortcuts.effectsShortcut
    },
    {
      id: 'transitions',
      action: onAddTransition,
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H3v16h2l2-4h3l2 4h2l-2-4h3l2 4h2l-2-4h3l2 4h2V4z"/>
        </svg>
      ),
      label: t.timeline.toolbar.transitions,
      shortcut: t.timeline.shortcuts.transitionsShortcut
    },
    {
      id: 'subtitles',
      action: onAddSubtitle,
      icon: isExtractingSubtitles ? (
        <div className="relative w-4 h-4">
          <svg className="w-4 h-4 animate-spin" fill="currentColor" viewBox="0 0 24 24">
            <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
          </svg>
        </div>
      ) : (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/>
        </svg>
      ),
      label: isExtractingSubtitles ? t.timeline.toolbar.extractingSubtitles : t.timeline.toolbar.subtitles,
      shortcut: t.timeline.shortcuts.subtitlesShortcut,
      disabled: isExtractingSubtitles
    }
  ];

  // 渲染图标按钮
  const renderIconButton = (button: any, isActive = false) => (
    <div key={button.id} className="relative group">
      <button
        onClick={() => {
          if (!button.disabled) {
            button.action();
          }
        }}
        className={`
          relative p-2 rounded-md transition-all duration-200 flex items-center justify-center w-8 h-8
          ${button.disabled
            ? 'text-muted-foreground cursor-not-allowed bg-muted'
            : isActive
              ? 'text-primary bg-primary/10 border border-primary'
              : button.className || 'text-foreground hover:text-foreground hover:bg-muted border border-transparent'
          }
        `}
        disabled={button.disabled}
        aria-label={button.shortcut ? `${button.label} (${button.shortcut})` : button.label}
        title={button.shortcut ? `${button.label} (${button.shortcut})` : button.label}
      >
        <span className={button.disabled ? 'opacity-50' : ''}>
          {button.icon}
        </span>

        {/* 悬停提示 */}
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-[9999] pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
          <div className="bg-background text-foreground text-xs px-3 py-2 rounded-md whitespace-nowrap border border-border">
            {button.shortcut ? `${button.label} (${button.shortcut})` : button.label}
            <div className="absolute top-full left-1/2 transform -translate-x-1/2">
              <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-background"></div>
            </div>
          </div>
        </div>
      </button>
    </div>
  );

  return (
    <div className="timeline-toolbar h-8 bg-card border-b border-border flex items-center justify-between px-4 relative overflow-visible">
      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* 左侧基础编辑工具 */}
      <div className="flex items-center space-x-1">
        {/* 导入项目文件按钮 */}
        <div className="flex items-center space-x-1">
          {renderIconButton(importButton)}
        </div>

        <div className="w-px h-4 bg-border mx-1" />

        <div className="flex items-center space-x-1">
          {basicEditButtons.map(button => renderIconButton(button))}
        </div>

        <div className="w-px h-4 bg-border mx-2" />

        <div className="flex items-center space-x-1">
          {historyButtons.map(button => renderIconButton(button))}
        </div>
      </div>

      {/* 中间状态显示 */}
      <div className="flex items-center space-x-3 text-xs text-muted-foreground">
        {selectedItemsCount > 0 && (
          <div className="flex items-center space-x-1 bg-primary/10 px-2 py-1 rounded-full">
            <svg className="w-3 h-3 text-primary" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
            <span className="text-primary font-medium text-xs">
              {t.timeline.status.selectedItems.replace('{count}', selectedItemsCount.toString())}
            </span>
          </div>
        )}

        <div className="hidden md:flex items-center space-x-1 text-xs">
          <span>{t.timeline.status.currentTool.replace('{tool}', t.timeline.toolbar.select)}</span>
        </div>
      </div>

      {/* 右侧高级功能 */}
      <div className="flex items-center space-x-1">
        {advancedButtons.map(button => renderIconButton(button))}
      </div>
    </div>
  );
};

export default TimelineToolbar;
