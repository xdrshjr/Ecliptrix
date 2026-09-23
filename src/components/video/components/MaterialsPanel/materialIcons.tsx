/**
 * materialIcons — 16px stroke icons for the materials page.
 *
 * lucide-react is not a dependency of this repo, so the few glyphs the page
 * needs are inlined here (lucide-style geometry, strokeWidth 1.75) instead of
 * adding a package. Every icon is decorative: the owning control carries the
 * `aria-label` / visible text.
 */

import React from 'react';

export type MaterialIconName =
  | 'search' | 'close' | 'plus' | 'more' | 'chevronDown' | 'eye'
  | 'sparkles' | 'clock' | 'spinner' | 'film' | 'scissors' | 'eraser'
  | 'download' | 'trash' | 'play' | 'pause' | 'video' | 'image' | 'music'
  | 'fileText' | 'upload' | 'wand' | 'tools' | 'alert';

const PATHS: Record<MaterialIconName, string[]> = {
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm21 21-4.3-4.3'],
  close: ['M18 6 6 18', 'm6 6 12 12'],
  plus: ['M12 5v14', 'M5 12h14'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  chevronDown: ['m6 9 6 6 6-6'],
  eye: [
    'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z',
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  ],
  sparkles: [
    'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
    'M19 17v4', 'M17 19h4',
  ],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  spinner: ['M21 12a9 9 0 1 1-6.2-8.56'],
  film: [
    'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
    'M7 3v18', 'M17 3v18', 'M3 12h18',
  ],
  scissors: [
    'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M20 4 8.1 15.9', 'M14.5 14.5 20 20', 'M8.1 8.1 12 12',
  ],
  eraser: [
    'm7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21',
    'M22 21H7', 'm5 11 9 9',
  ],
  download: ['M12 3v12', 'm7 10 5 5 5-5', 'M5 21h14'],
  trash: [
    'M3 6h18', 'M8 6V4h8v2',
    'M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6',
  ],
  play: ['M7 4v16l13-8z'],
  pause: ['M7 4h3v16H7z', 'M14 4h3v16h-3z'],
  video: [
    'M3 6h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z',
    'm16 10 6-3v10l-6-3',
  ],
  image: [
    'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
    'M9 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'm21 15-5-5L5 21',
  ],
  music: [
    'M9 18V5l12-2v13', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  ],
  fileText: [
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z',
    'M14 2v6h6', 'M8 13h8', 'M8 17h6',
  ],
  upload: ['M12 15V3', 'm7 8 5-5 5 5', 'M5 21h14'],
  wand: ['m15 4 5 5', 'M3 21 17.5 6.5', 'M8 3v3', 'M6.5 4.5h3'],
  tools: [
    'M14.7 6.3a4 4 0 0 0-5.4 5.3L3 18l3 3 6.4-6.3a4 4 0 0 0 5.3-5.4l-2.6 2.6-2.8-.6-.6-2.8z',
  ],
  alert: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 8v4', 'M12 16h.01'],
};

interface MaterialIconProps {
  name: MaterialIconName;
  size?: number;
  className?: string;
}

export const MaterialIcon: React.FC<MaterialIconProps> = ({
  name, size = 16, className,
}) => {
  const filled = name === 'play' || name === 'pause';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${name === 'spinner' ? 'animate-spin ' : ''}${className ?? ''}`}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
};

export default MaterialIcon;
