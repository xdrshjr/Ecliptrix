'use client';

/**
 * Inline stroke icons for the browser Dock (24px grid, lucide geometry).
 * `lucide-react` is not a dependency of this repo, so — like the workbench
 * `icons.tsx` — the few glyphs the Dock needs are drawn here.
 */

import React from 'react';

export interface BrowserIconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

function createIcon(paths: React.ReactNode) {
  function Icon({ size = 14, strokeWidth = 1.75, className }: BrowserIconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
        className={className} aria-hidden="true" focusable="false">
        {paths}
      </svg>
    );
  }
  return Icon;
}

export const Globe = createIcon(<>
  <circle cx="12" cy="12" r="10" /><path d="M2 12h20" />
  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
</>);
export const Hand = createIcon(<>
  <path d="M18 11V6a2 2 0 0 0-4 0v1" /><path d="M14 10V4a2 2 0 0 0-4 0v2" />
  <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
  <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.4L3.4 16a2 2 0 0 1 3.2-2.4L8 15" />
</>);
export const Plus = createIcon(<><path d="M5 12h14" /><path d="M12 5v14" /></>);
export const X = createIcon(<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>);
export const ArrowLeft = createIcon(<><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></>);
export const ArrowRight = createIcon(<><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>);
export const RotateCw = createIcon(<><path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.7 1 6.3 2.7L21 8" /><path d="M21 3v5h-5" /></>);
export const Lock = createIcon(<><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>);
export const ShieldAlert = createIcon(<>
  <path d="M20 13c0 5-3.5 7.5-7.7 8.9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z" />
  <path d="M12 8v4" /><path d="M12 16h.01" />
</>);
export const User = createIcon(<><circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 0 0-16 0" /></>);
export const ChevronDown = createIcon(<path d="m6 9 6 6 6-6" />);
export const ChevronUp = createIcon(<path d="m18 15-6-6-6 6" />);
export const Maximize2 = createIcon(<>
  <path d="M15 3h6v6" /><path d="m21 3-7 7" /><path d="m3 21 7-7" /><path d="M9 21H3v-6" />
</>);
export const Minimize2 = createIcon(<>
  <path d="m14 10 7-7" /><path d="M20 10h-6V4" /><path d="m3 21 7-7" /><path d="M4 14h6v6" />
</>);
export const Sparkles = createIcon(<>
  <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z" />
</>);
export const Eye = createIcon(<>
  <path d="M2.1 12.1a1 1 0 0 1 0-.2C3.4 8 7.4 5 12 5s8.6 3 9.9 6.9a1 1 0 0 1 0 .2C20.6 16 16.6 19 12 19s-8.6-3-9.9-6.9z" />
  <circle cx="12" cy="12" r="3" />
</>);
export const MousePointer = createIcon(<>
  <path d="M4.04 4.5 10.6 20.2a.5.5 0 0 0 .94-.03l1.9-6.7a.5.5 0 0 1 .34-.34l6.7-1.9a.5.5 0 0 0 .03-.94z" />
</>);
export const Type = createIcon(<><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></>);
export const Keyboard = createIcon(<>
  <rect width="20" height="14" x="2" y="5" rx="2" /><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M8 15h8" />
</>);
export const ArrowUpDown = createIcon(<>
  <path d="m21 16-4 4-4-4" /><path d="M17 20V4" /><path d="m3 8 4-4 4 4" /><path d="M7 4v16" />
</>);
export const Clock = createIcon(<><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>);
export const Image = createIcon(<>
  <rect width="18" height="18" x="3" y="3" rx="2" /><circle cx="9" cy="9" r="2" />
  <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
</>);
export const Compass = createIcon(<>
  <circle cx="12" cy="12" r="10" /><path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3z" />
</>);
export const Check = createIcon(<path d="M20 6 9 17l-5-5" />);
export const AlertCircle = createIcon(<>
  <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />
</>);
export const Trash = createIcon(<>
  <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
</>);
export const Pencil = createIcon(<>
  <path d="M21.2 5.8a2.1 2.1 0 0 0-3-3L3 18l-1 4 4-1z" /><path d="m15 5 4 4" />
</>);
export const Search = createIcon(<><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>);
