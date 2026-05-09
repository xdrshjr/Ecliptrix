'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import {
  fetchUserPreferences,
  useUserPreferencesMutation,
  type UserPreferences,
} from '@/lib/api/userPreferences';

const STORAGE_KEY_TOGGLES = 'ecliptrix-other-settings';
const STORAGE_KEY_THEME_PREF = 'ecliptrix-theme-pref';

function loadToggles(): { notifications: { email: boolean; push: boolean; marketing: boolean }; privacy: { profileVisible: boolean; activityVisible: boolean } } {
  if (typeof window === 'undefined') {
    return { notifications: { email: true, push: false, marketing: false }, privacy: { profileVisible: true, activityVisible: false } };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TOGGLES);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { notifications: { email: true, push: false, marketing: false }, privacy: { profileVisible: true, activityVisible: false } };
}

function applyTheme(theme: 'light' | 'dark' | 'auto') {
  if (typeof window === 'undefined') return;
  const html = document.documentElement;
  let resolved: 'light' | 'dark';
  if (theme === 'auto') {
    resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } else {
    resolved = theme;
  }
  html.classList.remove('dark', 'light');
  html.classList.add(resolved);
  html.style.colorScheme = resolved;
  // Store resolved value for layout.tsx inline script compatibility
  localStorage.setItem('ecliptrix-theme', resolved);
  // Store raw preference (including 'auto') for dropdown state
  localStorage.setItem(STORAGE_KEY_THEME_PREF, theme);
}

function readCurrentTheme(): 'light' | 'dark' | 'auto' {
  if (typeof window === 'undefined') return 'dark';
  const pref = localStorage.getItem(STORAGE_KEY_THEME_PREF);
  if (pref === 'auto' || pref === 'light' || pref === 'dark') return pref;
  // Fallback: read resolved value (no preference stored yet)
  const stored = localStorage.getItem('ecliptrix-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return 'dark';
}

interface SettingsData {
  notifications: { email: boolean; push: boolean; marketing: boolean };
  privacy: { profileVisible: boolean; activityVisible: boolean };
  preferences: { theme: 'light' | 'dark' | 'auto'; language: 'en' | 'zh-CN' };
}

const OtherSettingsPanel: React.FC = () => {
  const { t, locale, setLocale } = useLocale();
  const { showError } = useNotification();
  const { patch, status } = useUserPreferencesMutation({
    onError: () => showError(t.profile.saveErrorNote),
  });

  const [settings, setSettings] = useState<SettingsData>(() => ({
    ...loadToggles(),
    preferences: {
      theme: readCurrentTheme(),
      language: locale as 'en' | 'zh-CN',
    },
  }));

  // Hydrate from server on mount; server preferences win over localStorage.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const remote = await fetchUserPreferences();
      if (cancelled || !remote) return;
      setSettings({
        notifications: {
          email: remote.notifications.email,
          push: remote.notifications.push,
          marketing: remote.notifications.marketing,
        },
        privacy: {
          profileVisible: remote.privacy.profile_visible,
          activityVisible: remote.privacy.activity_visible,
        },
        preferences: {
          theme: remote.theme,
          language: remote.language,
        },
      });
      try {
        localStorage.setItem(
          STORAGE_KEY_TOGGLES,
          JSON.stringify({
            notifications: remote.notifications,
            privacy: {
              profileVisible: remote.privacy.profile_visible,
              activityVisible: remote.privacy.activity_visible,
            },
          })
        );
      } catch { /* ignore */ }
      if (remote.language !== locale) {
        setLocale(remote.language);
      }
      applyTheme(remote.theme);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync language when locale changes externally
  useEffect(() => {
    setSettings(prev => ({
      ...prev,
      preferences: { ...prev.preferences, language: locale as 'en' | 'zh-CN' },
    }));
  }, [locale]);

  const persistTogglesLocally = (next: SettingsData) => {
    try {
      localStorage.setItem(
        STORAGE_KEY_TOGGLES,
        JSON.stringify({ notifications: next.notifications, privacy: next.privacy })
      );
    } catch { /* ignore */ }
  };

  const handleNotificationToggle = (key: 'email' | 'push' | 'marketing', value: boolean) => {
    setSettings(prev => {
      const prevNotifications = prev.notifications;
      const next = {
        ...prev,
        notifications: { ...prevNotifications, [key]: value },
      };
      persistTogglesLocally(next);
      patch({
        delta: { notifications: next.notifications as UserPreferences['notifications'] },
        rollback: () => setSettings(s => {
          const reverted = { ...s, notifications: prevNotifications };
          persistTogglesLocally(reverted);
          return reverted;
        }),
      });
      return next;
    });
  };

  const handlePrivacyToggle = (key: 'profileVisible' | 'activityVisible', value: boolean) => {
    setSettings(prev => {
      const prevPrivacy = prev.privacy;
      const next = {
        ...prev,
        privacy: { ...prevPrivacy, [key]: value },
      };
      persistTogglesLocally(next);
      patch({
        delta: {
          privacy: {
            profile_visible: next.privacy.profileVisible,
            activity_visible: next.privacy.activityVisible,
          },
        },
        rollback: () => setSettings(s => {
          const reverted = { ...s, privacy: prevPrivacy };
          persistTogglesLocally(reverted);
          return reverted;
        }),
      });
      return next;
    });
  };

  const handleLanguageChange = (language: 'en' | 'zh-CN') => {
    const prevLanguage = settings.preferences.language;
    setSettings(prev => ({
      ...prev,
      preferences: { ...prev.preferences, language },
    }));
    setLocale(language);
    patch({
      delta: { language },
      rollback: () => {
        setSettings(s => ({ ...s, preferences: { ...s.preferences, language: prevLanguage } }));
        setLocale(prevLanguage);
      },
    });
  };

  const handleThemeChange = useCallback((theme: 'light' | 'dark' | 'auto') => {
    const prevTheme = settings.preferences.theme;
    setSettings(prev => ({
      ...prev,
      preferences: { ...prev.preferences, theme },
    }));
    applyTheme(theme);
    patch({
      delta: { theme },
      rollback: () => {
        setSettings(s => ({ ...s, preferences: { ...s.preferences, theme: prevTheme } }));
        applyTheme(prevTheme);
      },
    });
  }, [settings.preferences.theme, patch]);

  // Listen for system color scheme changes when in auto mode
  useEffect(() => {
    if (settings.preferences.theme !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('auto');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [settings.preferences.theme]);

  const ToggleSwitch: React.FC<{ enabled: boolean; onChange: (enabled: boolean) => void; label?: string }> = ({ enabled, onChange, label }) => (
    <button
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${
        enabled ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );

  const noteText =
    status === 'saving'
      ? (t.profile.savingNote || 'Saving…')
      : status === 'saved'
        ? (t.profile.savedNote || 'Saved to your account')
        : status === 'error'
          ? (t.profile.saveErrorNote || 'Failed to save — will retry')
          : (t.profile.autoSaveNote || 'Changes are saved automatically.');

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
                onChange={(value) => handleNotificationToggle('email', value)}
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
                onChange={(value) => handleNotificationToggle('push', value)}
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
                onChange={(value) => handleNotificationToggle('marketing', value)}
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
                onChange={(value) => handlePrivacyToggle('profileVisible', value)}
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
                onChange={(value) => handlePrivacyToggle('activityVisible', value)}
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

        {/* Auto-save note */}
        <div className="pt-6 border-t border-border">
          <p
            role="status"
            aria-live="polite"
            className={`text-xs ${status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {noteText}
          </p>
        </div>
      </div>
    </div>
  );
};

export default OtherSettingsPanel;
