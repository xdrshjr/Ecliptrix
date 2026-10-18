'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';

export type SettingsMenuItem =
  | 'general'
  | 'model'
  | 'webResearch'
  | 'tts'
  | 'videoAnalysis'
  | 'upload'
  | 'watermark'
  | 'youtube';

interface SettingsSidebarProps {
  activeItem: SettingsMenuItem;
  onSelectItem: (item: SettingsMenuItem) => void;
}

interface MenuEntry {
  id: SettingsMenuItem;
  label: string;
  description: string;
  icon: React.ReactNode;
}

interface MenuGroup {
  id: string;
  title: string;
  items: MenuEntry[];
}

const SettingsSidebar: React.FC<SettingsSidebarProps> = ({ activeItem, onSelectItem }) => {
  const { t } = useLocale();

  // Three groups instead of nine flat rows: the owner is looking for either an
  // app preference, an AI credential, or a media tool — never all nine at once.
  const groups: MenuGroup[] = [
    {
      id: 'app',
      title: t.adminSettings.groupApp,
      items: [
        {
          id: 'general',
          label: t.adminSettings.general,
          description: t.adminSettings.generalDesc,
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          ),
        },
      ],
    },
    {
      id: 'ai',
      title: t.adminSettings.groupAi,
      items: [
        {
          id: 'webResearch',
          label: t.webResearch.title,
          description: t.webResearch.description,
          icon: <span aria-hidden="true">◎</span>,
        },
        {
          id: 'model',
          label: t.adminSettings.modelSettings,
          description: t.adminSettings.modelSettingsDesc,
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          ),
        },
        {
          id: 'tts',
          label: t.adminSettings.ttsSettings,
          description: t.adminSettings.ttsSettingsDesc,
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          ),
        },
        {
          id: 'videoAnalysis',
          label: t.adminSettings.videoAnalysisSettings,
          description: t.adminSettings.videoAnalysisSettingsDesc,
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          ),
        },
      ],
    },
    {
      id: 'media',
      title: t.adminSettings.groupMedia,
      items: [
        {
          id: 'upload',
          label: t.adminSettings.uploadSettings,
          description: t.adminSettings.uploadSettingsDesc,
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          ),
        },
        {
          id: 'watermark',
          label: t.adminSettings.watermarkSettings,
          description: t.adminSettings.watermarkSettingsDesc,
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 6L6 18" />
            </svg>
          ),
        },
        {
          id: 'youtube',
          label: t.adminSettings.youtubeSettings,
          description: t.adminSettings.youtubeSettingsDesc,
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
        },
      ],
    },
  ];

  return (
    <div className="w-full h-full bg-card border-r border-border overflow-y-auto">
      <div className="p-6 space-y-6">
        {groups.map((group) => (
          <nav key={group.id} aria-label={group.title}>
            <h2 className="px-4 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {group.title}
            </h2>
            <div className="space-y-1">
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectItem(item.id)}
                  aria-current={activeItem === item.id ? 'page' : undefined}
                  className={`w-full text-left px-4 py-3 rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card ${
                    activeItem === item.id
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground hover:bg-accent'
                  }`}
                >
                  <div className="flex items-start space-x-3">
                    <div
                      aria-hidden="true"
                      className={`mt-0.5 ${
                        activeItem === item.id ? 'text-primary' : 'text-muted-foreground'
                      }`}
                    >
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
            </div>
          </nav>
        ))}
      </div>
    </div>
  );
};

export default SettingsSidebar;
