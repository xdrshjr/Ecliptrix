'use client';

import React, { useEffect, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useAuth } from '@/contexts/AuthContext';
import UserProfileSidebar from './UserProfileSidebar';
import UserInfoPanel from './UserInfoPanel';
import OtherSettingsPanel from './OtherSettingsPanel';

export type ProfileSection = 'userInfo' | 'otherSettings';

interface UserProfilePageProps {
  onClose: () => void;
  initialSection?: ProfileSection;
}

const UserProfilePage: React.FC<UserProfilePageProps> = ({ onClose, initialSection = 'userInfo' }) => {
  const { t } = useLocale();
  const { user } = useAuth();
  const [activeSection, setActiveSection] = useState<ProfileSection>(initialSection);

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

  if (!user) {
    return null;
  }

  const renderActivePanel = () => {
    switch (activeSection) {
      case 'userInfo':
        return <UserInfoPanel />;
      case 'otherSettings':
        return <OtherSettingsPanel />;
      default:
        return <UserInfoPanel />;
    }
  };

  return (
    <div className="h-full w-full bg-background flex overflow-hidden">
      {/* Left Sidebar - 20% */}
      <UserProfileSidebar
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        onClose={onClose}
      />

      {/* Right Panel - 80% */}
      <div className="flex-1 bg-background overflow-auto">
        {renderActivePanel()}
      </div>
    </div>
  );
};

export default UserProfilePage; 