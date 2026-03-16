'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';

export type SettingsMenuItem = 'userManagement' | 'modelSettings' | 'codingPlan' | 'systemSettings';

interface SettingsSidebarProps {
  activeItem: SettingsMenuItem;
  onSelectItem: (item: SettingsMenuItem) => void;
}

const SettingsSidebar: React.FC<SettingsSidebarProps> = ({ activeItem, onSelectItem }) => {
  const { t } = useLocale();

  const menuItems: Array<{
    id: SettingsMenuItem;
    label: string;
    description: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'userManagement',
      label: t.adminSettings.userManagement,
      description: t.adminSettings.userManagementDesc,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
    },
    {
      id: 'modelSettings',
      label: t.adminSettings.modelSettings,
      description: t.adminSettings.modelSettingsDesc,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      id: 'codingPlan',
      label: t.adminSettings.codingPlan,
      description: t.adminSettings.codingPlanDesc,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      ),
    },
    {
      id: 'systemSettings',
      label: t.adminSettings.systemSettings,
      description: t.adminSettings.systemSettingsDesc,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="w-full h-full bg-card border-r border-border overflow-y-auto">
      <div className="p-6">
        <nav className="space-y-1">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelectItem(item.id)}
              className={`w-full text-left px-4 py-3 rounded-md transition-colors duration-150 ${
                activeItem === item.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-accent'
              }`}
            >
              <div className="flex items-start space-x-3">
                <div className={`mt-0.5 ${
                  activeItem === item.id ? 'text-primary' : 'text-muted-foreground'
                }`}>
                  {item.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium ${
                    activeItem === item.id ? 'text-primary' : 'text-foreground'
                  }`}>
                    {item.label}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {item.description}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
};

export default SettingsSidebar;

