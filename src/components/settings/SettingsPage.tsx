'use client';

import React, { Suspense, lazy, useEffect, useState } from 'react';
import SettingsSidebar, { SettingsMenuItem } from './SettingsSidebar';
import GeneralSettingsPanel from './GeneralSettingsPanel';
import ModelSettingsPanel from './ModelSettingsPanel';
import WebResearchSettingsPanel from './WebResearchSettingsPanel';
import BrowserWorkspaceSettingsPanel from './BrowserWorkspaceSettingsPanel';
import AgentToolkitSettingsPanel from './AgentToolkitSettingsPanel';
import AgentHostSettingsPanel from './AgentHostSettingsPanel';
import AgentSkillsSettingsPanel from './AgentSkillsSettingsPanel';
import AgentVisionSettingsPanel from './AgentVisionSettingsPanel';
import TTSSettingsPanel from './TTSSettingsPanel';
import IntegrationsSettingsPanel from './IntegrationsSettingsPanel';
import YouTubeSettingsPanel from './YouTubeSettingsPanel';
import UploadSettingsPanel from './UploadSettingsPanel';
import WatermarkSettingsPanel from './WatermarkSettingsPanel';
import VideoAnalysisSettingsPanel from './VideoAnalysisSettingsPanel';

// Loaded on demand: most sessions never open the AI-source screen.
const SkillRouterSettingsPanel = lazy(() => import('./SkillRouterSettingsPanel'));

const PanelFallback: React.FC = () => (
  <div className="sr-scope h-full p-4 sm:p-8" style={{ background: 'var(--sr-bg)' }} aria-busy="true">
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="sr-skeleton h-7 w-40" />
      <div className="sr-skeleton h-28" />
      <div className="sr-skeleton h-36" />
    </div>
  </div>
);

interface SettingsPageProps {
  onClose: () => void;
  initialItem?: SettingsMenuItem;
  /** Sidebar entries that still need setup (same verdict as the wizard). */
  attentionItems?: SettingsMenuItem[];
  onRerunSetupWizard?: () => void;
}

const SettingsPage: React.FC<SettingsPageProps> = ({
  onClose,
  initialItem,
  attentionItems,
  onRerunSetupWizard,
}) => {
  const [activeItem, setActiveItem] = useState<SettingsMenuItem>(initialItem ?? 'general');

  useEffect(() => {
    const trigger =
      typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) {
        return;
      }
      e.preventDefault();
      onClose();
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (trigger && document.body.contains(trigger)) {
        try { trigger.focus(); } catch { /* ignore */ }
      }
    };
  }, [onClose]);

  const renderContent = () => {
    switch (activeItem) {
      case 'general':
        return <GeneralSettingsPanel onRerunSetupWizard={onRerunSetupWizard} />;
      case 'skillrouter':
        return (
          <Suspense fallback={<PanelFallback />}>
            <SkillRouterSettingsPanel />
          </Suspense>
        );
      case 'model':
        return <ModelSettingsPanel />;
      case 'webResearch':
        return <WebResearchSettingsPanel onOpenModels={() => setActiveItem('model')} />;
      case 'browser':
        return <BrowserWorkspaceSettingsPanel />;
      case 'agentToolkit':
        return <AgentToolkitSettingsPanel onOpenModels={() => setActiveItem('model')} />;
      case 'agentHost':
        return <AgentHostSettingsPanel />;
      case 'agentSkills':
        return <AgentSkillsSettingsPanel />;
      case 'agentVision':
        return <AgentVisionSettingsPanel onOpenModels={() => setActiveItem('model')} />;
      case 'tts':
        return <TTSSettingsPanel />;
      case 'integrations':
        return <IntegrationsSettingsPanel onOpenWebResearch={() => setActiveItem('webResearch')} />;
      case 'videoAnalysis':
        return <VideoAnalysisSettingsPanel />;
      case 'upload':
        return <UploadSettingsPanel />;
      case 'watermark':
        return <WatermarkSettingsPanel />;
      case 'youtube':
        return <YouTubeSettingsPanel />;
      default:
        return null;
    }
  };

  return (
    <div className="h-full flex flex-col sm:flex-row overflow-hidden bg-background motion-reduce:[&_*]:!transition-none">
      {/* Left Sidebar - 20% width */}
      <div className="h-40 w-full sm:h-auto sm:w-1/5 flex-shrink-0">
        <SettingsSidebar
          activeItem={activeItem}
          onSelectItem={setActiveItem}
          attentionItems={attentionItems}
        />
      </div>

      {/* Right Panel - 80% width */}
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
        {renderContent()}
      </div>
    </div>
  );
};

export default SettingsPage;
