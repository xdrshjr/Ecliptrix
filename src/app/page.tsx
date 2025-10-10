'use client';

import React, { useState } from 'react';
import Header from '@/components/Header';
import VerticalTaskbar from '@/components/VerticalTaskbar';
import Container from '@/components/Container';
import Footer from '@/components/Footer';
import LoginModal from '@/components/LoginModal';
import UserProfilePage from '@/components/UserProfile/UserProfilePage';
import AdminSettingsPage from '@/components/AdminSettings/AdminSettingsPage';
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

  // 登录弹窗状态
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  // 用户资料页面状态
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  // 管理员设置页面状态
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // 检查当前是否为视频编辑任务
  const isVideoEditingTask = activeTask?.type === 'video';

  console.log('[HomePage] Rendering with vertical taskbar layout:', {
    activeTask: activeTask?.type,
    tabsCount: tabs.length,
    isVideoEditingTask,
    timestamp: new Date().toISOString()
  });

  // 包装selectTab函数，在选择任务时关闭设置和个人资料页面
  const handleSelectTab = (tabId: string) => {
    console.log('[HomePage] Tab selected, closing settings/profile pages:', { tabId });
    setIsSettingsOpen(false);
    setIsProfileOpen(false);
    selectTab(tabId);
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {/* Header - 固定在顶部 */}
      <Header 
        onLoginClick={() => setIsLoginModalOpen(true)}
        onProfileClick={() => setIsProfileOpen(true)}
        onSettingsClick={() => setIsSettingsOpen(true)}
      />
      
      {/* Main Layout - Header 下方的内容区域 */}
      <div className="flex-1 flex overflow-hidden">
        {/* Vertical Taskbar - 左侧边栏，始终显示 */}
        <VerticalTaskbar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={handleSelectTab}
          onCloseTab={closeTab}
        />
        
        {/* Main Content Area - 右侧内容区域 */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {isSettingsOpen ? (
            /* Admin Settings Page - 占据右侧内容区域 */
            <AdminSettingsPage onClose={() => setIsSettingsOpen(false)} />
          ) : isProfileOpen ? (
            /* User Profile Page - 占据右侧内容区域 */
            <UserProfilePage onClose={() => setIsProfileOpen(false)} />
          ) : (
            <>
              <Container activeTask={activeTask} onUpdateTask={updateTask} />
              {/* 条件渲染Footer：视频编辑任务时隐藏，其他任务时显示 */}
              {!isVideoEditingTask && <Footer />}
            </>
          )}
        </div>
      </div>

      {/* Login Modal - 全屏显示 */}
      <LoginModal 
        isOpen={isLoginModalOpen} 
        onClose={() => setIsLoginModalOpen(false)} 
      />
    </div>
  );
} 