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

  console.log('HomePage: 页面渲染开始');
  console.log('HomePage: 当前活跃任务:', activeTask?.title || '无');
  console.log('HomePage: 标签页数量:', tabs.length);
  console.log('HomePage: Taskbar任务菜单已更新', {
    removedTask: 'Voice Synthesis (audio类型)',
    newOrder: ['AI Chat (第1位)', 'Video Editing (第2位)', 'Content Creation', 'Brainstorming'],
    availableTaskTypes: ['chat', 'video', 'content', 'brainstorm'],
    modificationReason: '用户需求：移除Voice Synthesis，AI Chat调整为第一项',
    appliedAt: new Date().toISOString(),
  });
  console.log('HomePage: 应用容器滚动已禁用', {
    rootLayout: 'body设置overflow-hidden',
    mainContainer: 'h-screen + overflow-hidden',
    preventScroll: '禁止整个应用上下滚动',
    appliedAt: new Date().toISOString(),
  });
  
  // 新增：视频编辑任务Footer控制日志
  console.log('HomePage: 视频编辑任务Footer控制', {
    activeTaskType: activeTask?.type || 'none',
    isVideoEditingTask: isVideoEditingTask,
    footerVisible: !isVideoEditingTask,
    layoutMode: isVideoEditingTask ? 'Video Editing (无Footer)' : 'Standard (有Footer)',
    reason: isVideoEditingTask ? '视频编辑任务需要面板延伸到屏幕底部' : '标准任务保持Footer显示',
    appliedAt: new Date().toISOString(),
  });

  console.log('HomePage: Footer集成完成', {
    layout: isVideoEditingTask ? 'Header → Taskbar → Container' : 'Header → Taskbar → Container → Footer',
    footerHeight: isVideoEditingTask ? '0px (隐藏)' : 'h-10 (40px)',
    taskArea: isVideoEditingTask ? '任务运行区域延伸到屏幕底部' : '任务运行区域在Taskbar和Footer之间',
    videoEditingOptimization: isVideoEditingTask ? '已优化：面板最大高度到屏幕底部' : '不适用',
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
      {/* 条件渲染Footer：视频编辑任务时隐藏，其他任务时显示 */}
      {!isVideoEditingTask && <Footer />}
    </div>
  );
} 