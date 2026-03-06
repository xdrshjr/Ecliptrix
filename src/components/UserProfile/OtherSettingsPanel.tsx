'use client';

import React, { useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';

interface SettingsData {
  notifications: {
    email: boolean;
    push: boolean;
    marketing: boolean;
  };
  privacy: {
    profileVisible: boolean;
    activityVisible: boolean;
  };
  preferences: {
    theme: 'light' | 'dark' | 'auto';
    language: 'en' | 'zh-CN';
  };
}

const OtherSettingsPanel: React.FC = () => {
  const { t, locale, setLocale } = useLocale();
  const { showSuccess, showError } = useNotification();

  const [settings, setSettings] = useState<SettingsData>({
    notifications: {
      email: true,
      push: false,
      marketing: false,
    },
    privacy: {
      profileVisible: true,
      activityVisible: false,
    },
    preferences: {
      theme: 'light',
      language: locale as 'en' | 'zh-CN',
    },
  });
  const [isLoading, setSaving] = useState(false);

  const handleToggle = (section: keyof SettingsData, key: string, value: boolean) => {
    setSettings(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: value
      }
    }));
  };

  const handleLanguageChange = (language: 'en' | 'zh-CN') => {
    setSettings(prev => ({
      ...prev,
      preferences: {
        ...prev.preferences,
        language
      }
    }));
    setLocale(language);
  };

  const handleThemeChange = (theme: 'light' | 'dark' | 'auto') => {
    setSettings(prev => ({
      ...prev,
      preferences: {
        ...prev.preferences,
        theme
      }
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      showSuccess(t.profile.settingsSaveSuccess);
    } catch (error) {
      showError(t.profile.settingsSaveError);
    } finally {
      setSaving(false);
    }
  };

  const ToggleSwitch: React.FC<{ enabled: boolean; onChange: (enabled: boolean) => void; disabled?: boolean }> = ({
    enabled,
    onChange,
    disabled = false
  }) => (
    <button
      onClick={() => !disabled && onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${
        enabled ? 'bg-primary' : 'bg-muted'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      disabled={disabled}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );

  return (
    <div className="p-8 flex justify-center">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-foreground mb-2">
            {t.profile.otherSettings}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t.profile.otherSettingsDescription}
          </p>
        </div>

        {/* Notification Settings */}
        <div className="mb-8">
          <h3 className="text-lg font-medium text-foreground mb-4">
            {t.profile.notifications}
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-foreground">
                  {t.profile.emailNotifications}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t.profile.emailNotificationsDesc}
                </p>
              </div>
              <ToggleSwitch
                enabled={settings.notifications.email}
                onChange={(value) => handleToggle('notifications', 'email', value)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-foreground">
                  {t.profile.pushNotifications}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t.profile.pushNotificationsDesc}
                </p>
              </div>
              <ToggleSwitch
                enabled={settings.notifications.push}
                onChange={(value) => handleToggle('notifications', 'push', value)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-foreground">
                  {t.profile.marketingEmails}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t.profile.marketingEmailsDesc}
                </p>
              </div>
              <ToggleSwitch
                enabled={settings.notifications.marketing}
                onChange={(value) => handleToggle('notifications', 'marketing', value)}
              />
            </div>
          </div>
        </div>

        {/* Privacy Settings */}
        <div className="mb-8">
          <h3 className="text-lg font-medium text-foreground mb-4">
            {t.profile.privacy}
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-foreground">
                  {t.profile.profileVisible}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t.profile.profileVisibleDesc}
                </p>
              </div>
              <ToggleSwitch
                enabled={settings.privacy.profileVisible}
                onChange={(value) => handleToggle('privacy', 'profileVisible', value)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-foreground">
                  {t.profile.activityVisible}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t.profile.activityVisibleDesc}
                </p>
              </div>
              <ToggleSwitch
                enabled={settings.privacy.activityVisible}
                onChange={(value) => handleToggle('privacy', 'activityVisible', value)}
              />
            </div>
          </div>
        </div>

        {/* Preferences */}
        <div className="mb-8">
          <h3 className="text-lg font-medium text-foreground mb-4">
            {t.profile.preferences}
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                {t.profile.language}
              </label>
              <select
                value={settings.preferences.language}
                onChange={(e) => handleLanguageChange(e.target.value as 'en' | 'zh-CN')}
                className="block w-48 px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring text-sm"
              >
                <option value="en">{t.header.english}</option>
                <option value="zh-CN">{t.header.chinese}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                {t.profile.theme}
              </label>
              <select
                value={settings.preferences.theme}
                onChange={(e) => handleThemeChange(e.target.value as 'light' | 'dark' | 'auto')}
                className="block w-48 px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring text-sm"
              >
                <option value="light">{t.profile.lightTheme}</option>
                <option value="dark">{t.profile.darkTheme}</option>
                <option value="auto">{t.profile.autoTheme}</option>
              </select>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="pt-6 border-t border-border">
          <button
            onClick={handleSave}
            disabled={isLoading}
            className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? t.profile.saving : t.profile.saveSettings}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OtherSettingsPanel; 