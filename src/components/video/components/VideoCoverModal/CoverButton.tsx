'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';

interface CoverButtonProps {
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}

/**
 * Small button that lives in the Player Console "settings row" next to the
 * aspect-ratio segmented control inside ``VideoPlayerPanel``. Styled via
 * ``console-cover-btn`` to match that control (CSS variables only — no
 * hard-coded hex). Inline SVG icon to match the project's existing icon
 * convention (no lucide-react / icon dep).
 */
export const CoverButton: React.FC<CoverButtonProps> = ({ onClick, className, disabled }) => {
  const { t } = useLocale();
  const label = t.videoCoverModal?.button ?? 'Cover';

  return (
    <button
      type="button"
      className={['console-cover-btn', className ?? ''].filter(Boolean).join(' ')}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <svg
        className="w-3.5 h-3.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="16" rx="2" strokeWidth="2" />
        <circle cx="8.5" cy="9.5" r="1.5" strokeWidth="2" />
        <path d="M21 16l-5-5L5 20" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{label}</span>
    </button>
  );
};

export default CoverButton;
