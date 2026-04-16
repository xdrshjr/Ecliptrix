'use client';

import React, { useState } from 'react';
import Header from '@/components/Header';
import VerticalTaskbar from '@/components/VerticalTaskbar';
import Container from '@/components/Container';
import Footer from '@/components/Footer';
import LoginModal from '@/components/LoginModal';
import UserProfilePage from '@/components/UserProfile/UserProfilePage';
import AdminSettingsPage from '@/components/AdminSettings/AdminSettingsPage';
import LandingPage from '@/components/HomePage/LandingPage';
import { useTasks } from '@/hooks/useTasks';
import { useAuth } from '@/contexts/AuthContext';

export default function HomePage() {
  const {
    tasks,
    tabs,
    activeTabId,
    activeTask,
    createTask,
    selectTab,
    closeTab,
    closeAllTabs,
    updateTask,
  } = useTasks();

  // 获取认证状态
  const { isAuthenticated, isLoading } = useAuth();

  // 登录弹窗状态
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  // 用户资料页面状态
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [profileInitialSection, setProfileInitialSection] = useState<'userInfo' | 'otherSettings'>('userInfo');
  // 管理员设置页面状态
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // Chat modal状态 - 用于模糊taskbar
  const [isChatModalOpen, setIsChatModalOpen] = useState(false);

  // 检查是否显示着陆页（无任务时显示）
  const showLandingPage = tabs.length === 0 && !isSettingsOpen && !isProfileOpen;
  
  // 检查当前是否有活跃任务（活跃任务时隐藏Footer以最大化工作区域）
  const hasActiveTask = !!activeTask;

  console.log('[HomePage] Rendering with layout:', {
    showLandingPage,
    activeTask: activeTask?.type,
    tabsCount: tabs.length,
    hasActiveTask,
    isSettingsOpen,
    isProfileOpen,
    timestamp: new Date().toISOString()
  });

  // 包装selectTab函数，在选择任务时关闭设置和个人资料页面
  const handleSelectTab = (tabId: string) => {
    console.log('[HomePage] Tab selected, closing settings/profile pages:', { tabId });
    setIsSettingsOpen(false);
    setIsProfileOpen(false);
    selectTab(tabId);
  };

  // 处理创建任务
  const handleCreateTask = (type: any) => {
    console.log('[HomePage] Creating task from landing page:', {
      taskType: type,
      timestamp: new Date().toISOString()
    });
    createTask(type);
  };

  // 处理返回主页（关闭所有任务）
  const handleReturnHome = () => {
    console.log('[HomePage] Returning to home, closing all tabs:', {
      currentTabsCount: tabs.length,
      timestamp: new Date().toISOString()
    });
    
    // 关闭所有标签页，返回着陆页
    closeAllTabs();
    
    // 关闭设置和个人资料页面
    setIsSettingsOpen(false);
    setIsProfileOpen(false);
  };

  // 处理Chat模态框状态变化
  const handleChatModalStateChange = (isOpen: boolean) => {
    console.log('[HomePage] Chat modal state changed:', {
      isOpen,
      timestamp: new Date().toISOString()
    });
    setIsChatModalOpen(isOpen);
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {/* Header - 固定在顶部 */}
      <Header
        onLoginClick={() => setIsLoginModalOpen(true)}
        onProfileClick={() => setIsProfileOpen(true)}
        onSettingsClick={() => setIsSettingsOpen(true)}
        onAccountSettingsClick={() => {
          setProfileInitialSection('otherSettings');
          setIsProfileOpen(true);
        }}
        onHomeClick={handleReturnHome}
      />
      
      {/* Main Layout - Header 下方的内容区域 */}
      <div className="flex-1 flex overflow-hidden">
        {/* Vertical Taskbar - 左侧边栏，仅在有任务时显示 */}
        {!showLandingPage && (
          <VerticalTaskbar
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={handleSelectTab}
            onCloseTab={closeTab}
            isBlurred={isChatModalOpen}
          />
        )}
        
        {/* Main Content Area - 右侧内容区域 */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {showLandingPage ? (
            /* Landing Page - 首次访问时显示 */
            <LandingPage 
              onCreateTask={handleCreateTask}
              isAuthenticated={isAuthenticated}
              isAuthLoading={isLoading}
              onLoginRequired={() => setIsLoginModalOpen(true)}
            />
          ) : isSettingsOpen ? (
            /* Admin Settings Page - 占据右侧内容区域 */
            <AdminSettingsPage onClose={() => setIsSettingsOpen(false)} />
          ) : isProfileOpen ? (
            /* User Profile Page - 占据右侧内容区域 */
            <UserProfilePage
              onClose={() => {
                setIsProfileOpen(false);
                setProfileInitialSection('userInfo');
              }}
              initialSection={profileInitialSection}
            />
          ) : (
            <>
              <Container 
                activeTask={activeTask} 
                onUpdateTask={updateTask}
                onChatModalStateChange={handleChatModalStateChange}
                tasks={tasks}
                tabs={tabs}
                onSelectTab={selectTab}
              />
              {/* 条件渲染Footer：有活跃任务时隐藏，仅无任务时显示 */}
              {!hasActiveTask && <Footer />}
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