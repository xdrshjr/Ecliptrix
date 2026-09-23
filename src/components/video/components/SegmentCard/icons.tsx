'use client';

/**
 * Inline stroke icons for the script panel (24px grid, lucide geometry).
 * `lucide-react` is not a dependency of this repo and the workbench adds no
 * packages, so the glyphs the segment cards need live here.
 */

import React from 'react';

export interface IconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
}

export type IconComponent = React.FC<IconProps>;

function createIcon(paths: React.ReactNode): IconComponent {
  function Icon({ size = 16, strokeWidth = 1.75, className, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden={rest['aria-hidden'] ?? true}
        focusable="false"
      >
        {paths}
      </svg>
    );
  }
  return Icon;
}

export const Check = createIcon(<path d="M20 6 9 17l-5-5" />);
export const Circle = createIcon(<circle cx="12" cy="12" r="9" />);
export const AlertTriangle = createIcon(
  <>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </>,
);
export const RefreshCw = createIcon(
  <>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </>,
);
export const Loader2 = createIcon(<path d="M21 12a9 9 0 1 1-6.22-8.56" />);
export const Play = createIcon(<polygon points="6 3 20 12 6 21 6 3" />);
export const Square = createIcon(<rect width="14" height="14" x="5" y="5" rx="2" />);
export const ArrowLeftRight = createIcon(
  <>
    <path d="M8 3 4 7l4 4" />
    <path d="M4 7h16" />
    <path d="m16 21 4-4-4-4" />
    <path d="M20 17H4" />
  </>,
);
export const Clock = createIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>,
);
export const ImageIcon = createIcon(
  <>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" />
  </>,
);
export const MoreHorizontal = createIcon(
  <>
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
    <circle cx="5" cy="12" r="1" />
  </>,
);
export const Mic = createIcon(
  <>
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <path d="M12 19v3" />
  </>,
);
export const Sparkles = createIcon(
  <>
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    <path d="M20 3v4" />
    <path d="M22 5h-4" />
  </>,
);
export const Plus = createIcon(
  <>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </>,
);
export const FileText = createIcon(
  <>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M10 9H8" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
  </>,
);
