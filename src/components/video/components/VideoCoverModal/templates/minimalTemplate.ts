'use client';

import type { CoverTemplateDefinition } from '../types';

const SAFE_FONT =
  'system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif';

/**
 * "Minimal" template — single thin line of text, no overlay, lower-third.
 */
export const minimalTemplate: CoverTemplateDefinition = {
  id: 'minimal',
  i18nKey: 'minimal',
  thumbnailSvg: `
    <svg viewBox="0 0 160 90" xmlns="http://www.w3.org/2000/svg">
      <rect width="160" height="90" fill="#e2e8f0"/>
      <rect x="20" y="70" width="120" height="2" fill="#0f172a"/>
      <rect x="20" y="58" width="80" height="6" rx="1" fill="#0f172a"/>
    </svg>
  `,
  defaultConfig: {
    version: 1,
    textLayers: [
      {
        key: 'title',
        text: '简约标题',
        fontFamily: SAFE_FONT,
        fontSize: 64,
        color: '#0f172a',
        fontWeight: 600,
        italic: false,
        underline: false,
        align: 'left',
        x: 0.06,
        y: 0.78,
        width: 0.88,
      },
    ],
    decorations: [
      {
        type: 'rect',
        x: 0.06,
        y: 0.92,
        w: 0.88,
        h: 0.005,
        fill: '#0f172a',
      },
    ],
  },
};
