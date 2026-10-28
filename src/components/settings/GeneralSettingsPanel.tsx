'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';

type ThemePreference = 'light' | 'dark' | 'auto';
type Language = 'en' | 'zh-CN';

/** Resolved theme, read by the inline script in `layout.tsx` on first paint. */
const STORAGE_KEY_THEME = 'ecliptrix-theme';
/** Raw preference (may be `auto`), read back to populate the dropdown. */
const STORAGE_KEY_THEME_PREF = 'ecliptrix-theme-pref';

/**
 * Apply a theme preference and persist BOTH keys.
 *
 * `ecliptrix-theme` holds the *resolved* light/dark value because the inline
 * script in `layout.tsx` reads it before React mounts — writing only the raw
 * preference there would make `auto` paint the wrong theme for one frame.
 * `ecliptrix-theme-pref` holds the raw choice so "follow system" survives a
 * restart instead of degrading into whatever it resolved to last time.
 */
function applyTheme(theme: ThemePreference) {
  if (typeof window === 'undefined') return;
  const html = document.documentElement;
  const resolved: 'light' | 'dark' =
    theme === 'auto'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;

  html.classList.remove('dark', 'light');
  html.classList.add(resolved);
  html.style.colorScheme = resolved;

  try {
    localStorage.setItem(STORAGE_KEY_THEME, resolved);
    localStorage.setItem(STORAGE_KEY_THEME_PREF, theme);
  } catch {
    // Restricted webviews can throw on write — the theme still applies for
    // this session, it just will not be remembered.
  }
}

function readCurrentTheme(): ThemePreference {
  if (typeof window === 'undefined') return 'dark';
  try {
    const pref = localStorage.getItem(STORAGE_KEY_THEME_PREF);
    if (pref === 'auto' || pref === 'light' || pref === 'dark') return pref;
    const resolved = localStorage.getItem(STORAGE_KEY_THEME);
    if (resolved === 'light' || resolved === 'dark') return resolved;
  } catch {
    // Fall through to the default below.
  }
  return 'dark';
}

const SELECT_CLASS =
  'block w-48 px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground ' +
  'focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring';

/**
 * Application-level preferences: language and appearance.
 *
 * localStorage is the single source of truth. The old panel this replaced
 * mirrored the same two values into `users.preferences` over the network,
 * which produced two sources of truth for one local setting; a single-owner
 * desktop app has nowhere to sync them to.
 */
interface GeneralSettingsPanelProps {
  /** Re-open the first-run setup wizard (all capabilities, manual mode). */
  onRerunSetupWizard?: () => void;
}

const GeneralSettingsPanel: React.FC<GeneralSettingsPanelProps> = ({
  onRerunSetupWizard,
}) => {
  const { t, locale, setLocale } = useLocale();
  const [theme, setTheme] = useState<ThemePreference>(() => readCurrentTheme());

  const handleLanguageChange = (language: Language) => {
    setLocale(language);
  };

  const handleThemeChange = useCallback((next: ThemePreference) => {
    setTheme(next);
    applyTheme(next);
  }, []);

  // In `auto` mode, keep following the OS while the app is running. Without
  // this listener "follow system" only takes effect at the next launch.
  useEffect(() => {
    if (theme !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('auto');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  return (
    <div className="h-full overflow-y-auto p-8 flex justify-center bg-background">
      <div className="w-full max-w-2xl">
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-foreground mb-2">
            {t.adminSettings.general}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t.adminSettings.generalDesc}
          </p>
        </div>

        <div className="space-y-6">
          <div>
            <label
              htmlFor="general-language"
              className="block text-sm font-medium text-foreground mb-2"
            >
              {t.adminSettings.language}
            </label>
            <select
              id="general-language"
              value={locale}
              onChange={(e) => handleLanguageChange(e.target.value as Language)}
              className={SELECT_CLASS}
            >
              <option value="en">{t.header.english}</option>
              <option value="zh-CN">{t.header.chinese}</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="general-theme"
              className="block text-sm font-medium text-foreground mb-2"
            >
              {t.adminSettings.theme}
            </label>
            <select
              id="general-theme"
              value={theme}
              onChange={(e) => handleThemeChange(e.target.value as ThemePreference)}
              className={SELECT_CLASS}
            >
              <option value="light">{t.adminSettings.lightTheme}</option>
              <option value="dark">{t.adminSettings.darkTheme}</option>
              <option value="auto">{t.adminSettings.autoTheme}</option>
            </select>
          </div>
        </div>

        {onRerunSetupWizard && (
          <div className="mt-6 flex items-center justify-between gap-4 rounded-lg border border-border p-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">
                {t.setupWizard.rerun}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t.setupWizard.rerunDesc}
              </p>
            </div>
            <button
              type="button"
              onClick={onRerunSetupWizard}
              className="flex-shrink-0 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            >
              {t.setupWizard.rerun}
            </button>
          </div>
        )}

        <div className="pt-6 mt-6 border-t border-border">
          <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {t.adminSettings.generalAutoSaveNote}
          </p>
        </div>
      </div>
    </div>
  );
};

export default GeneralSettingsPanel;
