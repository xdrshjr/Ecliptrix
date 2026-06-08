'use client';

import React, { useState, useEffect, useRef } from 'react';
import Header from '@/components/Header';
import VerticalTaskbar from '@/components/VerticalTaskbar';
import Container from '@/components/Container';
import Footer from '@/components/Footer';
import LoginModal from '@/components/LoginModal';
import UserProfilePage from '@/components/UserProfile/UserProfilePage';
import AdminSettingsPage from '@/components/AdminSettings/AdminSettingsPage';
import { SettingsMenuItem } from '@/components/AdminSettings/SettingsSidebar';
import SetupGuideDialog from '@/components/Onboarding/SetupGuideDialog';
import LandingPage from '@/components/HomePage/LandingPage';
import DesktopTitleBar from '@/components/desktop/DesktopTitleBar';
import { useTasks } from '@/hooks/useTasks';
import { useLlmConfigStatus } from '@/hooks/useLlmConfigStatus';
import { useAuth } from '@/contexts/AuthContext';
import { isDesktop } from '@/lib/desktop/isDesktop';

// Session-scoped (not localStorage): re-prompt on next launch if still
// unconfigured, but never twice in one session.
const SETUP_GUIDE_DISMISSED_KEY = 'ecliptrix-setup-guide-dismissed';

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
    hydrated,
  } = useTasks();

  // 获取认证状态
  const { isAuthenticated, isLoading, canManageUsers } = useAuth();

  // 桌面端:水合 + 静默登录完成后,若无持久化标签则自动打开一个视频剪辑任务,
  // 直达剪辑工作区(spec §2.2f)。等待 isAuthenticated 才创建,确保工程列表请求
  // 已携带 token,规避 401。只执行一次。
  const didAutoOpenRef = useRef(false);
  useEffect(() => {
    if (!isDesktop() || didAutoOpenRef.current) return;
    if (!hydrated || isLoading || !isAuthenticated) return; // 等水合 + 等静默登录
    if (tabs.length > 0) return;                            // 已有持久化标签则不打扰
    didAutoOpenRef.current = true;
    createTask('video');
  }, [hydrated, isLoading, isAuthenticated, tabs.length, createTask]);

  // 登录弹窗状态
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  // 用户资料页面状态
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [profileInitialSection, setProfileInitialSection] = useState<'userInfo' | 'otherSettings'>('userInfo');
  // 管理员设置页面状态
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialItem, setSettingsInitialItem] = useState<SettingsMenuItem>('userManagement');
  // Chat modal状态 - 用于模糊taskbar
  const [isChatModalOpen, setIsChatModalOpen] = useState(false);

  // LLM 凭证状态与首次配置引导（仅管理员可修复，故仅为其发请求 — R5）
  const { status: llmStatus, refresh: refreshLlmStatus } =
    useLlmConfigStatus(isAuthenticated && canManageUsers);
  const [setupGuideDismissed, setSetupGuideDismissed] = useState<boolean>(() => {
    // sessionStorage may throw in restricted webviews — degrade to "always
    // remind" instead of crashing (risk #6, same convention as playbackFlags).
    try {
      return typeof window !== 'undefined'
        && window.sessionStorage.getItem(SETUP_GUIDE_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  const dismissSetupGuide = () => {
    try {
      window.sessionStorage.setItem(SETUP_GUIDE_DISMISSED_KEY, '1');
    } catch { /* ignore — degrade to per-render reminder */ }
    setSetupGuideDismissed(true);
  };

  const openSettingsAt = (item: SettingsMenuItem) => {
    setSettingsInitialItem(item);
    setIsProfileOpen(false);
    setIsSettingsOpen(true);
  };

  const showSetupGuide =
    isAuthenticated && canManageUsers && llmStatus === 'unconfigured' &&
    !setupGuideDismissed && !isSettingsOpen && !isProfileOpen; // R6: 不盖个人资料页

  // 跳过着陆页须以 hydrated 为闸门:isDesktop() 在 SSR 期恒为 false,直接写进
  // 渲染期分支会导致水合不一致 + 桌面端闪现一帧 LandingPage(spec §2.2e / R1)。
  // 水合前两端都渲染中性占位;水合后桌面端因 !isDesktop() 恒为 false 落到 Container。
  const ready = hydrated;
  const showBootPlaceholder = !ready;
  const showLandingPage =
    ready && tabs.length === 0 && !isSettingsOpen && !isProfileOpen && !isDesktop();

  // 检查当前是否有活跃任务（活跃任务时隐藏Footer以最大化工作区域）
  const hasActiveTask = !!activeTask;

  // 包装selectTab函数，在选择任务时关闭设置和个人资料页面
  const handleSelectTab = (tabId: string) => {
    setIsSettingsOpen(false);
    setIsProfileOpen(false);
    selectTab(tabId);
  };

  // 处理创建任务
  const handleCreateTask = (type: any) => {
    createTask(type);
  };

  // 处理返回主页（关闭所有任务）
  const handleReturnHome = () => {
    // 关闭所有标签页，返回着陆页
    closeAllTabs();

    // 关闭设置和个人资料页面
    setIsSettingsOpen(false);
    setIsProfileOpen(false);
  };

  // 处理Chat模态框状态变化
  const handleChatModalStateChange = (isOpen: boolean) => {
    setIsChatModalOpen(isOpen);
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {/* 桌面端自绘标题栏 - 浏览器端渲染 null,零影响(spec §2.3e) */}
      <DesktopTitleBar />

      {/* Header - 固定在顶部 */}
      <Header
        onLoginClick={() => setIsLoginModalOpen(true)}
        onProfileClick={() => setIsProfileOpen(true)}
        onSettingsClick={() => setIsSettingsOpen(true)}
        onAccountSettingsClick={() => {
          setIsSettingsOpen(false);
          setProfileInitialSection('otherSettings');
          setIsProfileOpen(true);
        }}
        onHomeClick={handleReturnHome}
        showSettingsAttention={llmStatus === 'unconfigured'}
      />

      {/* Main Layout - Header 下方的内容区域 */}
      <div className="flex-1 flex overflow-hidden">
        {showBootPlaceholder ? (
          /* 水合前的中性占位:纯背景,既非 LandingPage 亦非编辑器,SSR/客户端首帧一致(R1) */
          <div className="flex-1 flex items-center justify-center bg-background" />
        ) : (
          <>
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
            <AdminSettingsPage
              initialItem={settingsInitialItem}
              onClose={() => {
                setIsSettingsOpen(false);
                setSettingsInitialItem('userManagement');
                // 用户可能刚在设置中保存了模型凭证 — 关闭即刷新状态
                refreshLlmStatus();
              }}
            />
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
          </>
        )}
      </div>

      {/* Login Modal - 全屏显示 */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
      />

      {/* 首次配置引导 - 管理员且 LLM 凭证未配置时弹出 */}
      <SetupGuideDialog
        open={showSetupGuide}
        onGoToSettings={() => {
          dismissSetupGuide();
          openSettingsAt('modelSettings');
        }}
        onDismiss={dismissSetupGuide}
      />
    </div>
  );
}