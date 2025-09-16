'use client';

import React from 'react';
import Header from '@/components/Header';
import VerticalTaskbar from '@/components/VerticalTaskbar';
import Container from '@/components/Container';
import Footer from '@/components/Footer';
import { useTasks } from '@/hooks/useTasks';

export default function HomePage() {
  const {
    tabs,
    activeTabId,
    activeTask,
    createTask,
    selectTab,
    closeTab,
    updateTask,
  } = useTasks();

  // 检查当前是否为视频编辑任务
  const isVideoEditingTask = activeTask?.type === 'video';

  console.log('[HomePage] Rendering with vertical taskbar layout:', {
    activeTask: activeTask?.type,
    tabsCount: tabs.length,
    isVideoEditingTask,
    timestamp: new Date().toISOString()
  });

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {/* Header - 固定在顶部 */}
      <Header />
      
      {/* Main Layout - Header 下方的内容区域 */}
      <div className="flex-1 flex overflow-hidden">
        {/* Vertical Taskbar - 左侧边栏，在Header之下 */}
        <VerticalTaskbar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={selectTab}
          onCloseTab={closeTab}
        />
        
        {/* Main Content Area - 右侧内容区域 */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <Container activeTask={activeTask} onUpdateTask={updateTask} />
          {/* 条件渲染Footer：视频编辑任务时隐藏，其他任务时显示 */}
          {!isVideoEditingTask && <Footer />}
        </div>
      </div>
    </div>
  );
} 