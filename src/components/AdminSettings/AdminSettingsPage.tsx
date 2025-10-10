'use client';

import React, { useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import SettingsSidebar, { SettingsMenuItem } from './SettingsSidebar';
import UserManagement from './UserManagement';

interface AdminSettingsPageProps {
  onClose: () => void;
}

const AdminSettingsPage: React.FC<AdminSettingsPageProps> = ({ onClose }) => {
  const { t } = useLocale();
  const [activeItem, setActiveItem] = useState<SettingsMenuItem>('userManagement');

  const renderContent = () => {
    switch (activeItem) {
      case 'userManagement':
        return <UserManagement />;
      case 'systemSettings':
        return (
          <div className="flex items-center justify-center h-full bg-gray-50">
            <div className="text-center">
              <svg className="w-24 h-24 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                {t.adminSettings.systemSettings}
              </h3>
              <p className="text-sm text-gray-500">
                {t.adminSettings.systemSettingsDesc}
              </p>
              <p className="text-sm text-gray-400 mt-4">
                功能开发中...
              </p>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="h-full flex overflow-hidden bg-white">
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

export default AdminSettingsPage;

