'use client';

import type { CoverTemplateDefinition } from '../types';

const SAFE_FONT =
  'system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif';

/**
 * "Tutorial" template — left-aligned big number + topic, dark sidebar.
 */
export const tutorialTemplate: CoverTemplateDefinition = {
  id: 'tutorial',
  i18nKey: 'tutorial',
  thumbnailSvg: `
    <svg viewBox="0 0 160 90" xmlns="http://www.w3.org/2000/svg">
      <rect width="160" height="90" fill="#0f172a"/>
      <rect x="6" y="6" width="42" height="78" fill="#f97316"/>
      <text x="27" y="56" font-family="sans-serif" font-size="32" font-weight="800" fill="#0f172a" text-anchor="middle">5</text>
      <rect x="58" y="30" width="92" height="10" rx="1" fill="#f8fafc"/>
      <rect x="58" y="46" width="76" height="8" rx="1" fill="#94a3b8"/>
      <rect x="58" y="60" width="60" height="6" rx="1" fill="#64748b"/>
    </svg>
  `,
  defaultConfig: {
    version: 1,
    textLayers: [
      {
        key: 'badge',
        text: '5',
        fontFamily: SAFE_FONT,
        fontSize: 220,
        color: '#0f172a',
        fontWeight: 900,
        italic: false,
        underline: false,
        align: 'center',
        x: 0.04,
        y: 0.18,
        width: 0.22,
      },
      {
        key: 'title',
        text: '教程标题',
        fontFamily: SAFE_FONT,
        fontSize: 84,
        color: '#ffffff',
        fontWeight: 800,
        italic: false,
        underline: false,
        align: 'left',
        x: 0.32,
        y: 0.32,
        width: 0.6,
      },
      {
        key: 'subtitle',
        text: '一步步带你掌握',
        fontFamily: SAFE_FONT,
        fontSize: 38,
        color: '#cbd5f5',
        fontWeight: 500,
        italic: false,
        underline: false,
        align: 'left',
        x: 0.32,
        y: 0.56,
        width: 0.6,
      },
    ],
    decorations: [
      {
        type: 'rect',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        fill: 'rgba(15, 23, 42, 0.65)',
      },
      {
        type: 'rect',
        x: 0.04,
        y: 0.08,
        w: 0.22,
        h: 0.84,
        fill: '#f97316',
      },
    ],
  },
};
