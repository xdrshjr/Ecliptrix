'use client';

/**
 * Inline stroke icons for the inspector (24px grid, lucide geometry).
 * `lucide-react` is not a dependency of this repo, and the brief forbids new
 * packages, so the handful of glyphs the inspector needs live here.
 */

import React from 'react';

export interface IconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
}

function createIcon(paths: React.ReactNode) {
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

export const Lock = createIcon(
  <>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </>,
);
export const AlertTriangle = createIcon(
  <>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </>,
);
export const Captions = createIcon(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M7 15h4" />
    <path d="M15 15h2" />
    <path d="M7 11h2" />
    <path d="M13 11h4" />
  </>,
);
export const Check = createIcon(<path d="M20 6 9 17l-5-5" />);
export const ImageIcon = createIcon(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
  </>,
);
export const Loader = createIcon(<path d="M21 12a9 9 0 1 1-6.2-8.6" />);
export const LocateFixed = createIcon(
  <>
    <path d="M2 12h3" />
    <path d="M19 12h3" />
    <path d="M12 2v3" />
    <path d="M12 19v3" />
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const Mic = createIcon(
  <>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
    <path d="M12 18v4" />
  </>,
);
export const Frame = createIcon(
  <>
    <path d="M22 6H2" />
    <path d="M22 18H2" />
    <path d="M6 2v20" />
    <path d="M18 2v20" />
  </>,
);
export const Move = createIcon(
  <>
    <path d="M5 9 2 12l3 3" />
    <path d="M9 5l3-3 3 3" />
    <path d="M15 19l-3 3-3-3" />
    <path d="M19 9l3 3-3 3" />
    <path d="M2 12h20" />
    <path d="M12 2v20" />
  </>,
);
export const Volume = createIcon(
  <>
    <path d="M11 5 6 9H2v6h4l5 4V5z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M19 5a10 10 0 0 1 0 14" />
  </>,
);
export const VolumeMuted = createIcon(
  <>
    <path d="M11 5 6 9H2v6h4l5 4V5z" />
    <path d="m22 9-6 6" />
    <path d="m16 9 6 6" />
  </>,
);
export const Eye = createIcon(
  <>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const Plus = createIcon(
  <>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </>,
);
