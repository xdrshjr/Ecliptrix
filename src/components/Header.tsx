'use client';

import React from 'react';
import Image from 'next/image';
import { useLocale } from '@/contexts/LocaleContext';
import HeaderActions from '@/components/HeaderActions';

interface HeaderProps {
  onLoginClick: () => void;
  onProfileClick: () => void;
  onSettingsClick?: () => void;
  onAccountSettingsClick?: () => void;
  onHomeClick?: () => void;
  /** Amber pulse dot on the settings gear while LLM credentials are missing. */
  showSettingsAttention?: boolean;
}

const Header: React.FC<HeaderProps> = ({ onLoginClick, onProfileClick, onSettingsClick, onAccountSettingsClick, onHomeClick, showSettingsAttention = false }) => {
  const { t } = useLocale();

  const handleLogoClick = () => {
    onHomeClick?.();
  };

  return (
    <header className="h-14 bg-card border-b border-border sticky top-0 z-[10000]">
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
          aria-label={t.header.returnToHomepage}
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

        {/* User Actions — shared cluster, web variant (spec §2.1) */}
        <HeaderActions
          variant="web"
          onLoginClick={onLoginClick}
          onProfileClick={onProfileClick}
          onSettingsClick={onSettingsClick}
          onAccountSettingsClick={onAccountSettingsClick}
          showSettingsAttention={showSettingsAttention}
        />
      </div>
    </header>
  );
};

export default Header;
