'use client';

/**
 * Inline stroke icons for the workbench shell (24px grid, lucide geometry).
 * `lucide-react` is not a dependency of this repo and Iteration 1 adds no
 * packages, so the glyphs the top bar and tool-window rail need live here.
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
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}
        aria-hidden={rest['aria-hidden'] ?? true} focusable="false">
        {paths}
      </svg>
    );
  }
  return Icon;
}

export const AlertTriangle = createIcon(<>
  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
  <path d="M12 9v4" /><path d="M12 17h.01" />
</>);
export const CheckCircle2 = createIcon(<><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>);
export const Circle = createIcon(<circle cx="12" cy="12" r="10" />);
export const Loader2 = createIcon(<path d="M21 12a9 9 0 1 1-6.219-8.56" />);
export const ChevronLeft = createIcon(<path d="m15 18-6-6 6-6" />);
export const Download = createIcon(<>
  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" />
</>);
export const Undo2 = createIcon(<><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>);
export const Redo2 = createIcon(<><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></>);
export const RotateCcw = createIcon(<><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>);
export const Sparkles = createIcon(<>
  <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
  <path d="M20 3v4" /><path d="M22 5h-4" />
</>);
export const Bot = createIcon(<>
  <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" />
  <path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
</>);
export const FileText = createIcon(<>
  <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" />
  <path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" />
</>);
export const FolderOpen = createIcon(
  <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />,
);
export const LayoutTemplate = createIcon(<>
  <rect width="18" height="7" x="3" y="3" rx="1" /><rect width="9" height="7" x="3" y="14" rx="1" />
  <rect width="5" height="7" x="16" y="14" rx="1" />
</>);
export const SlidersHorizontal = createIcon(<>
  <path d="M21 4h-7" /><path d="M10 4H3" /><path d="M21 12h-9" /><path d="M8 12H3" />
  <path d="M21 20h-5" /><path d="M12 20H3" /><path d="M14 2v4" /><path d="M8 10v4" /><path d="M16 18v4" />
</>);
