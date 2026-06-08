'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { isDesktop } from '@/lib/desktop/isDesktop';
import RoleBadge, { resolveUserRole } from '@/components/ui/RoleBadge';
import type { Translations } from '@/lib/i18n';
import type { User } from '@/types/auth';

export type HeaderActionsVariant = 'web' | 'titlebar';

export interface HeaderActionsProps {
  /** Visual container the cluster sits in. Defaults to `'web'` (56px Header). */
  variant?: HeaderActionsVariant;
  onLoginClick: () => void;
  onProfileClick: () => void;
  onSettingsClick?: () => void;
  onAccountSettingsClick?: () => void;
  /** Amber pulse dot on the settings gear while LLM credentials are missing. */
  showSettingsAttention?: boolean;
}

/**
 * Per-variant className bundle. Only sizing, spacing and dropdown anchoring
 * differ between the web Header and the desktop title bar — the behaviour
 * (dropdowns, theme, auth gating) is a single shared copy (spec §2.1).
 */
interface VariantClasses {
  iconButton: string;
  avatar: string;
  menuWrapper: string;
  dropdownAlign: string;
}

const ICON_BUTTON_BASE =
  'rounded-md bg-muted hover:bg-accent flex items-center justify-center transition-colors';

function resolveVariantClasses(variant: HeaderActionsVariant): VariantClasses {
  if (variant === 'titlebar') {
    // `h-full` wrapper so the dropdown's `top-full` lands at the 40px bar
    // bottom rather than mid-bar (spec §2.3c / P2-4).
    return {
      iconButton: `w-7 h-7 ${ICON_BUTTON_BASE}`,
      avatar: 'w-7 h-7',
      menuWrapper: 'relative h-full flex items-center',
      dropdownAlign: 'top-full mt-1',
    };
  }
  return {
    iconButton: `w-8 h-8 ${ICON_BUTTON_BASE}`,
    avatar: 'w-8 h-8',
    menuWrapper: 'relative',
    dropdownAlign: 'mt-2',
  };
}

interface LanguageMenuProps {
  classes: VariantClasses;
  locale: string;
  t: Translations;
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (next: 'en' | 'zh-CN') => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

function LanguageMenu({ classes, locale, t, isOpen, onToggle, onSelect, containerRef }: LanguageMenuProps) {
  return (
    <div className={classes.menuWrapper} ref={containerRef}>
      <button
        type="button"
        onClick={onToggle}
        className={classes.iconButton}
        title={t.header.languageSelector}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
        </svg>
      </button>
      {isOpen && (
        <div className={`absolute right-0 ${classes.dropdownAlign} w-32 bg-popover rounded-md shadow-lg border border-border py-1 z-[10001]`} role="menu">
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
        active ? 'text-primary bg-primary/10' : 'text-popover-foreground'
      }`}
    >
      <span className="text-base">{flag}</span>
      <span>{label}</span>
    </button>
  );
}

function ThemeToggle({ classes, isDark, t, onToggle }: { classes: VariantClasses; isDark: boolean; t: Translations; onToggle: () => void }) {
  const label = isDark ? t.header.switchToLightMode : t.header.switchToDarkMode;
  return (
    <button type="button" onClick={onToggle} className={classes.iconButton} title={label} aria-label={label}>
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

function SettingsGear({ classes, showAttention, t, onClick }: { classes: VariantClasses; showAttention: boolean; t: Translations; onClick: () => void }) {
  const label = showAttention ? t.setupGuide.settingsAttentionHint : t.adminSettings.title;
  return (
    <button type="button" onClick={onClick} className={`relative ${classes.iconButton}`} title={label} aria-label={label}>
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

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="w-full px-3 py-2 text-left text-sm text-popover-foreground hover:bg-accent transition-colors flex items-center space-x-2"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

interface UserMenuProps {
  classes: VariantClasses;
  t: Translations;
  user: User | null;
  isAuthenticated: boolean;
  isDesktopShell: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onProfileClick: () => void;
  onAccountSettingsClick: () => void;
  onLogout: () => void;
  onLoginClick: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

function UserMenu(props: UserMenuProps) {
  const { classes, t, isAuthenticated, isDesktopShell, containerRef } = props;
  return (
    <div className={classes.menuWrapper} ref={containerRef}>
      {isAuthenticated ? (
        <UserAvatarMenu {...props} />
      ) : (
        // Desktop is silently logged in, so it never shows a login entry (§2.1).
        !isDesktopShell && (
          <button
            type="button"
            onClick={props.onLoginClick}
            className="px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
          >
            {t.auth.loginRegister}
          </button>
        )
      )}
    </div>
  );
}

function UserAvatarMenu(props: UserMenuProps) {
  const { classes, t, user, isDesktopShell, isOpen, onToggle, onProfileClick, onAccountSettingsClick, onLogout } = props;
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className={`${classes.avatar} rounded-md bg-primary flex items-center justify-center hover:opacity-90 transition-opacity`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <span className="text-xs font-medium text-primary-foreground">{user?.username.charAt(0).toUpperCase()}</span>
      </button>
      {isOpen && (
        <div className={`absolute right-0 ${classes.dropdownAlign} w-48 bg-popover rounded-md shadow-lg border border-border py-1 z-[10001]`} role="menu">
          <div className="px-3 py-2 border-b border-border">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium text-foreground">{user?.username}</p>
              {user && <RoleBadge role={resolveUserRole(user)} size="sm" />}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{user?.email}</p>
          </div>
          <MenuItem
            label={t.auth.personalInfo}
            onClick={onProfileClick}
            icon={(
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            )}
          />
          <MenuItem
            label={t.auth.accountSettings}
            onClick={onAccountSettingsClick}
            icon={(
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
          />
          {!isDesktopShell && (
            <div className="border-t border-border mt-1 pt-1">
              <button
                type="button"
                role="menuitem"
                onClick={onLogout}
                className="w-full px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10 transition-colors flex items-center space-x-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span>{t.auth.logout}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Shared right-side action cluster (language / theme / settings / user menu)
 * consumed by both the web `Header` and the desktop `DesktopTitleBar`. The
 * dropdown, theme and auth logic lives here once; `variant` only swaps styling
 * so the two containers stay behaviourally identical (spec §2.1).
 */
const HeaderActions: React.FC<HeaderActionsProps> = ({
  variant = 'web',
  onLoginClick,
  onProfileClick,
  onSettingsClick,
  onAccountSettingsClick,
  showSettingsAttention = false,
}) => {
  const { locale, setLocale, t } = useLocale();
  const { user, isAuthenticated, logout, canManageUsers } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const userDropdownRef = useRef<HTMLDivElement>(null);

  // Hide login/register + logout on desktop (always silently logged in; hiding
  // logout also avoids the odd "log out → auto re-login" loop). The mount gate
  // keeps SSR and the first client frame identical, dodging a hydration
  // mismatch over `isDesktop()`.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDesktopShell = mounted && isDesktop();

  // Close dropdowns when clicking outside either wrapper.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsLanguageDropdownOpen(false);
      }
      if (userDropdownRef.current && !userDropdownRef.current.contains(event.target as Node)) {
        setIsUserDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Escape closes an open dropdown. Scope per spec §2.1 P1-2: act only while a
  // dropdown is open and never preventDefault/stopPropagation, so LoginModal /
  // SetupGuideDialog keep their own Escape handling.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isLanguageDropdownOpen) setIsLanguageDropdownOpen(false);
      if (isUserDropdownOpen) setIsUserDropdownOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isLanguageDropdownOpen, isUserDropdownOpen]);

  const handleLanguageChange = (next: 'en' | 'zh-CN') => {
    setLocale(next);
    setIsLanguageDropdownOpen(false);
  };

  const handleProfileClick = () => {
    setIsUserDropdownOpen(false);
    onProfileClick();
  };

  const handleAccountSettingsClick = () => {
    setIsUserDropdownOpen(false);
    onAccountSettingsClick?.();
  };

  const handleLogout = () => {
    logout();
    setIsUserDropdownOpen(false);
  };

  const classes = resolveVariantClasses(variant);
  // `h-full` on the titlebar root lets each menu wrapper's `h-full` resolve to
  // the full 40px bar so dropdowns anchor at the bar bottom (spec §2.3c / P2-4).
  const rootClass = variant === 'titlebar' ? 'flex items-center h-full gap-1' : 'flex items-center space-x-3';

  return (
    <div className={rootClass}>
      <LanguageMenu
        classes={classes}
        locale={locale}
        t={t}
        isOpen={isLanguageDropdownOpen}
        onToggle={() => setIsLanguageDropdownOpen((open) => !open)}
        onSelect={handleLanguageChange}
        containerRef={dropdownRef}
      />
      <ThemeToggle classes={classes} isDark={isDark} t={t} onToggle={toggleTheme} />
      {isAuthenticated && canManageUsers && onSettingsClick && (
        <SettingsGear classes={classes} showAttention={showSettingsAttention} t={t} onClick={onSettingsClick} />
      )}
      <UserMenu
        classes={classes}
        t={t}
        user={user}
        isAuthenticated={isAuthenticated}
        isDesktopShell={isDesktopShell}
        isOpen={isUserDropdownOpen}
        onToggle={() => setIsUserDropdownOpen((open) => !open)}
        onProfileClick={handleProfileClick}
        onAccountSettingsClick={handleAccountSettingsClick}
        onLogout={handleLogout}
        onLoginClick={onLoginClick}
        containerRef={userDropdownRef}
      />
    </div>
  );
};

export default HeaderActions;
