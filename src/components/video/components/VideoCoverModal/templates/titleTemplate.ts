'use client';

import type { CoverTemplateDefinition } from '../types';

const SAFE_FONT =
  'system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif';

/**
 * "Title" template — bold centred title with a subtle subtitle below.
 */
export const titleTemplate: CoverTemplateDefinition = {
  id: 'title',
  i18nKey: 'title',
  thumbnailSvg: `
    <svg viewBox="0 0 160 90" xmlns="http://www.w3.org/2000/svg">
      <rect width="160" height="90" fill="#1f2937"/>
      <rect x="14" y="34" width="132" height="14" rx="2" fill="#f8fafc"/>
      <rect x="34" y="54" width="92" height="6" rx="1" fill="#94a3b8"/>
    </svg>
  `,
  defaultConfig: {
    version: 1,
    textLayers: [
      {
        key: 'title',
        text: '我的视频标题',
        fontFamily: SAFE_FONT,
        fontSize: 96,
        color: '#ffffff',
        fontWeight: 800,
        italic: false,
        underline: false,
        align: 'center',
        x: 0.1,
        y: 0.4,
        width: 0.8,
      },
      {
        key: 'subtitle',
        text: '副标题',
        fontFamily: SAFE_FONT,
        fontSize: 36,
        color: '#cbd5f5',
        fontWeight: 500,
        italic: false,
        underline: false,
        align: 'center',
        x: 0.2,
        y: 0.62,
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
        fill: 'rgba(15, 23, 42, 0.45)',
      },
    ],
  },
};
