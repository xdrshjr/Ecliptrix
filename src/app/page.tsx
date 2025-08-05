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

  console.log('HomePage: 页面渲染开始');
  console.log('HomePage: 当前活跃任务:', activeTask?.title || '无');
  console.log('HomePage: 标签页数量:', tabs.length);
  console.log('HomePage: 应用容器滚动已禁用', {
    rootLayout: 'body设置overflow-hidden',
    mainContainer: 'h-screen + overflow-hidden',
    preventScroll: '禁止整个应用上下滚动',
    appliedAt: new Date().toISOString(),
  });
  console.log('HomePage: Footer集成完成', {
    layout: 'Header → Taskbar → Container → Footer',
    footerHeight: 'h-10 (40px)',
    taskArea: '任务运行区域在Taskbar和Footer之间',
    appliedAt: new Date().toISOString(),
  });

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
      <Footer />
    </div>
  );
} 