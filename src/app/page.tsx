'use client';

import React, { useState, useEffect, useRef } from 'react';
import AppTitleBar from '@/components/shell/AppTitleBar';
import VerticalTaskbar from '@/components/VerticalTaskbar';
import Container from '@/components/Container';
import SettingsPage from '@/components/settings/SettingsPage';
import { SettingsMenuItem } from '@/components/settings/SettingsSidebar';
import SetupWizard from '@/components/Onboarding/SetupWizard';
import {
  settingsAttentionItems,
  type WizardMode,
} from '@/components/Onboarding/wizard/wizardSteps';
import { useTasks } from '@/hooks/useTasks';
import { useSetupStatus } from '@/hooks/useSetupStatus';
import { useDesktopCloseGuard } from '@/hooks/useDesktopCloseGuard';

// Session-scoped (not localStorage): re-prompt on next launch if still
// unconfigured, but never twice in one session.
const SETUP_GUIDE_DISMISSED_KEY = 'ecliptrix-setup-guide-dismissed';

export default function HomePage() {
  const {
    tabs,
    activeTabId,
    activeTask,
    openTask,
    selectTab,
    closeTab,
    updateTask,
    hydrated,
  } = useTasks();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsItem, setSettingsItem] = useState<SettingsMenuItem>('general');
  const [isChatModalOpen, setIsChatModalOpen] = useState(false);

  // Flush pending project autosaves before the desktop window closes (ME-08).
  useDesktopCloseGuard();

  // No RBAC any more — the single local owner may always fix credentials.
  const {
    status: setupStatus,
    capabilities,
    optOuts,
    refresh: refreshSetupStatus,
  } = useSetupStatus();

  // Straight to the editing workspace once the tab store has hydrated. The
  // gate is `hydrated` alone — SSR and the first client frame both render the
  // neutral placeholder, so there is no hydration mismatch.
  const didAutoOpenRef = useRef(false);
  useEffect(() => {
    if (!hydrated || didAutoOpenRef.current || tabs.length > 0) return;
    didAutoOpenRef.current = true;
    openTask('video');
  }, [hydrated, tabs.length, openTask]);

  const [setupGuideDismissed, setSetupGuideDismissed] = useState<boolean>(() => {
    // sessionStorage may throw in restricted webviews — degrade to "always
    // remind" instead of crashing (same convention as playbackFlags).
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
    } catch { /* ignore — degrade to per-session reminder */ }
    setSetupGuideDismissed(true);
  };

  // The wizard stays open once started: its own writes make the status turn
  // 'complete' mid-flow, and the done page must not be yanked away.
  const [wizardMode, setWizardMode] = useState<WizardMode | null>(null);
  useEffect(() => {
    const shouldAutoOpen =
      hydrated
      && setupStatus === 'needs-setup'
      && !setupGuideDismissed
      && !isSettingsOpen;
    if (shouldAutoOpen) setWizardMode((current) => current ?? 'auto');
  }, [hydrated, setupStatus, setupGuideDismissed, isSettingsOpen]);

  const handleSelectTab = (tabId: string) => {
    setIsSettingsOpen(false);
    selectTab(tabId);
  };

  const closeSettings = () => {
    setIsSettingsOpen(false);
    setSettingsItem('general');
    // The owner may have just saved credentials — re-read the status so the
    // gear's attention dot clears immediately.
    refreshSetupStatus();
  };

  const handleWizardClose = () => {
    // Any exit from the automatic prompt (including "enter the app" with gaps
    // left) is remembered for the session, or the effect above would reopen it
    // at once. A manual re-run is the owner's own request and is not.
    if (wizardMode === 'auto') dismissSetupGuide();
    setWizardMode(null);
    refreshSetupStatus();
  };

  const openSettingsFromWizard = (item: SettingsMenuItem) => {
    if (wizardMode === 'auto') dismissSetupGuide();
    setWizardMode(null);
    setSettingsItem(item);
    setIsSettingsOpen(true);
  };

  const rerunSetupWizard = () => {
    setIsSettingsOpen(false);
    setWizardMode('manual');
  };

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <AppTitleBar
        onSettingsClick={() => setIsSettingsOpen(true)}
        showSettingsAttention={setupStatus === 'needs-setup'}
      />

      <div className="flex-1 flex overflow-hidden">
        {!hydrated ? (
          /* Neutral boot placeholder: identical on SSR and the first client
             frame, so the tab store can hydrate without a mismatch. */
          <div className="flex-1 flex items-center justify-center bg-background" />
        ) : (
          <>
            <VerticalTaskbar
              tabs={tabs}
              activeTabId={activeTabId}
              onSelectTab={handleSelectTab}
              onCloseTab={closeTab}
              onOpenTask={openTask}
              isBlurred={isChatModalOpen}
            />

            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {isSettingsOpen ? (
                <SettingsPage
                  initialItem={settingsItem}
                  onClose={closeSettings}
                  attentionItems={settingsAttentionItems(capabilities, optOuts)}
                  onRerunSetupWizard={rerunSetupWizard}
                />
              ) : (
                <Container
                  activeTask={activeTask}
                  onUpdateTask={updateTask}
                  onChatModalStateChange={setIsChatModalOpen}
                  /* The empty state is the only "new task" entry point once the
                     last tab is closed. Dropping this prop bricks the app. */
                  onOpenTask={openTask}
                />
              )}
            </div>
          </>
        )}
      </div>

      {wizardMode && (
        <SetupWizard
          mode={wizardMode}
          capabilities={capabilities}
          optOuts={optOuts}
          onClose={handleWizardClose}
          onOpenSettings={openSettingsFromWizard}
        />
      )}
    </div>
  );
}
