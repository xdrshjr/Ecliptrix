'use client';

import React from 'react';

export interface AspectRatioIconProps {
  variant: 'square' | 'landscape' | 'portrait';
  active?: boolean;
  className?: string;
}

const AspectRatioIcon: React.FC<AspectRatioIconProps> = ({ variant, active, className }) => {
  const cls = active ? 'text-white' : 'text-muted-foreground';
  const svgClass = ['w-3.5', 'h-3.5', cls, className].filter(Boolean).join(' ');

  switch (variant) {
    case 'square':
      return (
        <svg className={svgClass} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
          <rect x="4" y="4" width="16" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case 'landscape':
      return (
        <svg className={svgClass} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
          <rect x="1" y="5" width="22" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case 'portrait':
      return (
        <svg className={svgClass} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
          <rect x="5" y="1" width="14" height="22" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    default:
      return null;
  }
};

export default AspectRatioIcon;
