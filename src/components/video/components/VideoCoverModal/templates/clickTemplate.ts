'use client';

import type { CoverTemplateDefinition } from '../types';

const SAFE_FONT =
  'system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif';

/**
 * "Click-bait" template — high-contrast yellow word + huge red headline.
 */
export const clickTemplate: CoverTemplateDefinition = {
  id: 'click',
  i18nKey: 'click',
  thumbnailSvg: `
    <svg viewBox="0 0 160 90" xmlns="http://www.w3.org/2000/svg">
      <rect width="160" height="90" fill="#0b1220"/>
      <text x="80" y="42" font-family="sans-serif" font-size="22" font-weight="900" fill="#facc15" text-anchor="middle">SHOCK</text>
      <text x="80" y="68" font-family="sans-serif" font-size="14" font-weight="800" fill="#f8fafc" text-anchor="middle">惊人的真相</text>
    </svg>
  `,
  defaultConfig: {
    version: 1,
    textLayers: [
      {
        key: 'eyebrow',
        text: 'SHOCK',
        fontFamily: SAFE_FONT,
        fontSize: 96,
        color: '#facc15',
        fontWeight: 900,
        italic: false,
        underline: false,
        align: 'center',
        x: 0.1,
        y: 0.16,
        width: 0.8,
      },
      {
        key: 'title',
        text: '你绝对想不到的真相',
        fontFamily: SAFE_FONT,
        fontSize: 110,
        color: '#ffffff',
        fontWeight: 900,
        italic: false,
        underline: false,
        align: 'center',
        x: 0.05,
        y: 0.44,
        width: 0.9,
      },
      {
        key: 'cta',
        text: '点击观看 →',
        fontFamily: SAFE_FONT,
        fontSize: 44,
        color: '#fef08a',
        fontWeight: 800,
        italic: false,
        underline: false,
        align: 'center',
        x: 0.2,
        y: 0.78,
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
        fill: 'rgba(127, 29, 29, 0.55)',
      },
      {
        type: 'rect',
        x: 0.04,
        y: 0.4,
        w: 0.92,
        h: 0.22,
        fill: 'rgba(0, 0, 0, 0.55)',
      },
    ],
  },
};
