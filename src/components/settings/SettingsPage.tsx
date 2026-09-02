'use client';

import React, { useEffect, useState } from 'react';
import SettingsSidebar, { SettingsMenuItem } from './SettingsSidebar';
import GeneralSettingsPanel from './GeneralSettingsPanel';
import ModelSettingsPanel from './ModelSettingsPanel';
import TTSSettingsPanel from './TTSSettingsPanel';
import YouTubeSettingsPanel from './YouTubeSettingsPanel';
import UploadSettingsPanel from './UploadSettingsPanel';
import WatermarkSettingsPanel from './WatermarkSettingsPanel';
import VideoAnalysisSettingsPanel from './VideoAnalysisSettingsPanel';

interface SettingsPageProps {
  onClose: () => void;
  initialItem?: SettingsMenuItem;
}

const SettingsPage: React.FC<SettingsPageProps> = ({ onClose, initialItem }) => {
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
        return <GeneralSettingsPanel />;
      case 'model':
        return <ModelSettingsPanel />;
      case 'tts':
        return <TTSSettingsPanel />;
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
    <div className="h-full flex overflow-hidden bg-background">
      {/* Left Sidebar - 20% width */}
      <div className="w-1/5 flex-shrink-0">
        <SettingsSidebar
          activeItem={activeItem}
          onSelectItem={setActiveItem}
        />
      </div>

      {/* Right Panel - 80% width */}
      <div className="flex-1 overflow-hidden">
        {renderContent()}
      </div>
    </div>
  );
};

export default SettingsPage;
