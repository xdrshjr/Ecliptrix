'use client';

import React, { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { useLocale } from '@/contexts/LocaleContext';
import { useAuth } from '@/contexts/AuthContext';

interface HeaderProps {
  onLoginClick: () => void;
  onProfileClick: () => void;
  onSettingsClick?: () => void;
  onHomeClick?: () => void;
}

const Header: React.FC<HeaderProps> = ({ onLoginClick, onProfileClick, onSettingsClick, onHomeClick }) => {
  const { locale, setLocale, t } = useLocale();
  const { user, isAuthenticated, logout } = useAuth();
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const userDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
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
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleLanguageChange = (newLocale: 'en' | 'zh-CN') => {
    setLocale(newLocale);
    setIsLanguageDropdownOpen(false);
  };

  const handleUserMenuClick = () => {
    if (isAuthenticated) {
      setIsUserDropdownOpen(!isUserDropdownOpen);
    } else {
      onLoginClick();
    }
  };

  const handleLogout = () => {
    logout();
    setIsUserDropdownOpen(false);
  };

  const handleLogoClick = () => {
    console.log('[Header] Logo clicked, returning to home:', {
      timestamp: new Date().toISOString()
    });
    if (onHomeClick) {
      onHomeClick();
    }
  };

  return (
    <header className="h-14 bg-card border-b border-border sticky top-0 z-50">
      <div className="h-full px-6 flex items-center justify-between">
        {/* Logo and Brand - Clickable to return home */}
        <div 
          className="flex items-center space-x-3 cursor-pointer hover:opacity-80 transition-opacity"
          onClick={handleLogoClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              handleLogoClick();
            }
          }}
          aria-label="Return to homepage"
        >
          <div className="w-8 h-8 flex items-center justify-center">
            <Image
              src="/logo-ai.png"
              alt="Ecliptrix Logo"
              width={32}
              height={32}
              className="w-full h-full object-contain"
            />
          </div>
          <div className="flex flex-col">
            <h1 className="text-lg font-semibold text-foreground leading-none">
              Ecliptrix
            </h1>
            <p className="text-xs text-muted-foreground leading-none">
              {t.header.brandSubtitle}
            </p>
          </div>
        </div>

        {/* Navigation - 暂时隐藏默认导航项 */}
        {/* 
        <nav className="hidden md:flex items-center space-x-8">
          <button className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
            Dashboard
          </button>
          <button className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
            Projects
          </button>
          <button className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
            Library
          </button>
        </nav>
        */}

        {/* User Actions */}
        <div className="flex items-center space-x-3">
          {/* Language Selector */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setIsLanguageDropdownOpen(!isLanguageDropdownOpen)}
              className="w-8 h-8 rounded-md bg-muted hover:bg-accent flex items-center justify-center transition-colors"
              title={t.header.languageSelector}
            >
              <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
              </svg>
            </button>
            
            {/* Language Dropdown */}
            {isLanguageDropdownOpen && (
              <div className="absolute right-0 mt-2 w-32 bg-popover rounded-md shadow-lg border border-border py-1 z-50">
                <button
                  onClick={() => handleLanguageChange('en')}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors flex items-center space-x-2 ${
                    locale === 'en' ? 'text-primary bg-primary/10' : 'text-popover-foreground'
                  }`}
                >
                  <span className="text-base">🇺🇸</span>
                  <span>{t.header.english}</span>
                </button>
                <button
                  onClick={() => handleLanguageChange('zh-CN')}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors flex items-center space-x-2 ${
                    locale === 'zh-CN' ? 'text-primary bg-primary/10' : 'text-popover-foreground'
                  }`}
                >
                  <span className="text-base">🇨🇳</span>
                  <span>{t.header.chinese}</span>
                </button>
              </div>
            )}
          </div>

          <button className="w-8 h-8 rounded-md bg-muted hover:bg-accent flex items-center justify-center transition-colors">
            <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-5 5v-5z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7H4l5-5v5z" />
            </svg>
          </button>
          
          {/* Settings button - only visible for admin users */}
          {isAuthenticated && user?.userRole === 'admin' && onSettingsClick && (
            <button 
              onClick={onSettingsClick}
              className="w-8 h-8 rounded-md bg-muted hover:bg-accent flex items-center justify-center transition-colors"
              title="管理员设置"
            >
              <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          )}

          {/* User Menu */}
          <div className="relative" ref={userDropdownRef}>
            {isAuthenticated ? (
              <>
                <button
                  onClick={handleUserMenuClick}
                  className="w-8 h-8 rounded-md bg-primary flex items-center justify-center hover:opacity-90 transition-opacity"
                >
                  <span className="text-xs font-medium text-primary-foreground">
                    {user?.username.charAt(0).toUpperCase()}
                  </span>
                </button>

                {/* User Dropdown */}
                {isUserDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-popover rounded-md shadow-lg border border-border py-1 z-50">
                    <div className="px-3 py-2 border-b border-border">
                      <p className="text-sm font-medium text-foreground">{user?.username}</p>
                      <p className="text-xs text-muted-foreground">{user?.email}</p>
                    </div>
                    <button
                      onClick={() => {
                        setIsUserDropdownOpen(false);
                        onProfileClick();
                      }}
                      className="w-full px-3 py-2 text-left text-sm text-popover-foreground hover:bg-accent transition-colors flex items-center space-x-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <span>{t.auth.personalInfo}</span>
                    </button>
                    <button
                      onClick={() => {
                        setIsUserDropdownOpen(false);
                        onProfileClick();
                      }}
                      className="w-full px-3 py-2 text-left text-sm text-popover-foreground hover:bg-accent transition-colors flex items-center space-x-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span>{t.auth.accountSettings}</span>
                    </button>
                    <div className="border-t border-border mt-1 pt-1">
                      <button
                        onClick={handleLogout}
                        className="w-full px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10 transition-colors flex items-center space-x-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                        <span>{t.auth.logout}</span>
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <button
                onClick={handleUserMenuClick}
                className="px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
              >
                {t.auth.loginRegister}
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header; 