'use client';

import React from 'react';
import Header from '@/components/Header';
import Taskbar from '@/components/Taskbar';
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

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      <Header />
      <Taskbar
        tabs={tabs}
        activeTabId={activeTabId}
        onCreateTask={createTask}
        onSelectTab={selectTab}
        onCloseTab={closeTab}
      />
      <Container activeTask={activeTask} onUpdateTask={updateTask} />
      {/* 条件渲染Footer：视频编辑任务时隐藏，其他任务时显示 */}
      {!isVideoEditingTask && <Footer />}
    </div>
  );
} 