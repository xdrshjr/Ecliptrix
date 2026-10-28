'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useTheme } from '@/hooks/useTheme';
import type { Translations } from '@/lib/i18n';

export interface TitleBarActionsProps {
  onSettingsClick?: () => void;
  /** Amber pulse dot on the settings gear while LLM credentials are missing. */
  showSettingsAttention?: boolean;
}

/**
 * Sizing/anchoring for the 40px title bar. `h-full` on the menu wrapper is
 * what makes the dropdown's `top-full` land at the bar's bottom edge rather
 * than mid-bar.
 */
const ICON_BUTTON =
  'w-7 h-7 rounded-md bg-muted hover:bg-accent flex items-center justify-center transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ' +
  'focus-visible:ring-offset-card';
const MENU_WRAPPER = 'relative h-full flex items-center';
const DROPDOWN_ALIGN = 'top-full mt-1';

interface LanguageMenuProps {
  locale: string;
  t: Translations;
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (next: 'en' | 'zh-CN') => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

function LanguageMenu({ locale, t, isOpen, onToggle, onSelect, containerRef }: LanguageMenuProps) {
  return (
    <div className={MENU_WRAPPER} ref={containerRef}>
      <button
        type="button"
        onClick={onToggle}
        className={ICON_BUTTON}
        title={t.header.languageSelector}
        aria-label={t.header.languageSelector}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
        </svg>
      </button>
      {isOpen && (
        <div className={`absolute right-0 ${DROPDOWN_ALIGN} w-32 bg-popover rounded-md shadow-lg border border-border py-1 z-[10001]`} role="menu">
          <LanguageOption flag="🇺🇸" label={t.header.english} active={locale === 'en'} onClick={() => onSelect('en')} />
          <LanguageOption flag="🇨🇳" label={t.header.chinese} active={locale === 'zh-CN'} onClick={() => onSelect('zh-CN')} />
        </div>
      )}
    </div>
  );
}

function LanguageOption({ flag, label, active, onClick }: { flag: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors flex items-center space-x-2 ${
        active ? 'text-foreground bg-accent' : 'text-popover-foreground'
      }`}
    >
      <span className="text-base">{flag}</span>
      <span>{label}</span>
    </button>
  );
}

function ThemeToggle({ isDark, t, onToggle }: { isDark: boolean; t: Translations; onToggle: () => void }) {
  const label = isDark ? t.header.switchToLightMode : t.header.switchToDarkMode;
  return (
    <button type="button" onClick={onToggle} className={ICON_BUTTON} title={label} aria-label={label}>
      {isDark ? (
        <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ) : (
        <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      )}
    </button>
  );
}

function SettingsGear({ showAttention, t, onClick }: { showAttention: boolean; t: Translations; onClick: () => void }) {
  const label = showAttention ? t.setupGuide.settingsAttentionHint : t.adminSettings.title;
  return (
    <button type="button" onClick={onClick} className={`relative ${ICON_BUTTON}`} title={label} aria-label={label}>
      <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
      {showAttention && (
        <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500 animate-pulse motion-reduce:animate-none" />
      )}
    </button>
  );
}

/**
 * The title bar's right-side action cluster: language, theme, settings.
 *
 * There is exactly one container for it now (`AppTitleBar`) — the web `Header`
 * that used to share this component is gone, so the old `variant` switch went
 * with it. The account menu, role badge and login entry went with the user
 * system: a local desktop app has one owner and nothing to log in to.
 */
const TitleBarActions: React.FC<TitleBarActionsProps> = ({
  onSettingsClick,
  showSettingsAttention = false,
}) => {
  const { locale, setLocale, t } = useLocale();
  const { isDark, toggleTheme } = useTheme();
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close the dropdown when clicking outside its wrapper.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsLanguageDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Escape closes an open dropdown. Act only while it is open and never
  // preventDefault/stopPropagation, so the setup wizard keeps its own Escape
  // handling.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isLanguageDropdownOpen) setIsLanguageDropdownOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isLanguageDropdownOpen]);

  const handleLanguageChange = (next: 'en' | 'zh-CN') => {
    setLocale(next);
    setIsLanguageDropdownOpen(false);
  };

  return (
    <div className="flex items-center h-full gap-1">
      <LanguageMenu
        locale={locale}
        t={t}
        isOpen={isLanguageDropdownOpen}
        onToggle={() => setIsLanguageDropdownOpen((open) => !open)}
        onSelect={handleLanguageChange}
        containerRef={dropdownRef}
      />
      <ThemeToggle isDark={isDark} t={t} onToggle={toggleTheme} />
      {onSettingsClick && (
        <SettingsGear showAttention={showSettingsAttention} t={t} onClick={onSettingsClick} />
      )}
    </div>
  );
};

export default TitleBarActions;
