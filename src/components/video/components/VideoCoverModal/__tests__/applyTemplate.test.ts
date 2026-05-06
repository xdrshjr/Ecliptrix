/**
 * applyTemplate — text content carry-over by key + style replacement.
 *
 * Behaviour under test:
 *   - For text layer keys present in BOTH templates and where the user has
 *     typed something, the text is preserved while style fields take the
 *     new template's defaults.
 *   - Decorations are replaced wholesale.
 *   - Non-template fields (imageSource, frame time, uploaded URL, aspect)
 *     are preserved.
 */

import { describe, it, expect } from 'vitest';

import { applyTemplate } from '../utils/applyTemplate';
import type { CoverState, CoverTemplateDefinition, CoverTemplateId } from '../types';

const TEMPLATE_A: CoverTemplateDefinition = {
  id: 'title',
  i18nKey: 'title',
  thumbnailSvg: '',
  defaultConfig: {
    version: 1,
    textLayers: [
      {
        key: 'title',
        text: 'A title',
        fontFamily: 'serif',
        fontSize: 60,
        color: '#000000',
        fontWeight: 600,
        italic: false,
        underline: false,
        align: 'left',
        x: 0,
        y: 0,
        width: 1,
      },
      {
        key: 'subtitle',
        text: 'A sub',
        fontFamily: 'serif',
        fontSize: 30,
        color: '#000000',
        fontWeight: 400,
        italic: false,
        underline: false,
        align: 'left',
        x: 0,
        y: 0.5,
        width: 1,
      },
    ],
    decorations: [{ type: 'rect', x: 0, y: 0, w: 1, h: 0.1, fill: '#ff0000' }],
  },
};

const TEMPLATE_B: CoverTemplateDefinition = {
  id: 'tutorial',
  i18nKey: 'tutorial',
  thumbnailSvg: '',
  defaultConfig: {
    version: 1,
    textLayers: [
      {
        key: 'title',
        text: 'B title',
        fontFamily: 'sans',
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
      // 'badge' is new in B (not present in A)
      {
        key: 'badge',
        text: '5',
        fontFamily: 'sans',
        fontSize: 200,
        color: '#0f172a',
        fontWeight: 900,
        italic: false,
        underline: false,
        align: 'center',
        x: 0,
        y: 0,
        width: 0.2,
      },
    ],
    decorations: [{ type: 'rect', x: 0, y: 0.9, w: 0.4, h: 0.05, fill: '#00ff00' }],
  },
};

const getTemplate = (id: CoverTemplateId): CoverTemplateDefinition => {
  if (id === 'tutorial') return TEMPLATE_B;
  return TEMPLATE_A;
};

function makeState(over?: Partial<CoverState>): CoverState {
  return {
    templateId: 'title',
    coverConfig: {
      version: 1,
      textLayers: TEMPLATE_A.defaultConfig.textLayers.map((l) => ({ ...l })),
      decorations: TEMPLATE_A.defaultConfig.decorations.map((d) => ({ ...d })),
    },
    imageSource: 'frame',
    frameVirtualTimeMs: 1000,
    uploadedImageUrl: null,
    aspectRatio: '16:9',
    ...over,
  };
}

describe('applyTemplate', () => {
  it('carries over user-typed title text into the new template', () => {
    const prev = makeState();
    prev.coverConfig.textLayers[0].text = 'My custom title';
    prev.coverConfig.textLayers[1].text = ''; // user cleared subtitle

    const next = applyTemplate('tutorial', prev, getTemplate);

    const titleLayer = next.coverConfig.textLayers.find((l) => l.key === 'title');
    expect(titleLayer).toBeDefined();
    expect(titleLayer!.text).toBe('My custom title');
    // Style takes the new template's default, NOT prev
    expect(titleLayer!.fontFamily).toBe('sans');
    expect(titleLayer!.fontSize).toBe(96);
    expect(titleLayer!.align).toBe('center');
  });

  it('uses new-template defaults for keys with empty prior text', () => {
    const prev = makeState();
    prev.coverConfig.textLayers[0].text = '';
    const next = applyTemplate('tutorial', prev, getTemplate);
    const titleLayer = next.coverConfig.textLayers.find((l) => l.key === 'title');
    expect(titleLayer!.text).toBe('B title');
  });

  it('uses new-template defaults for keys NOT present in the prior template', () => {
    const prev = makeState();
    const next = applyTemplate('tutorial', prev, getTemplate);
    const badge = next.coverConfig.textLayers.find((l) => l.key === 'badge');
    expect(badge).toBeDefined();
    expect(badge!.text).toBe('5');
  });

  it('replaces decorations wholesale', () => {
    const prev = makeState();
    const next = applyTemplate('tutorial', prev, getTemplate);
    expect(next.coverConfig.decorations).toEqual(TEMPLATE_B.defaultConfig.decorations);
    // No carry-over of A's decoration
    expect(next.coverConfig.decorations.find((d) => d.fill === '#ff0000')).toBeUndefined();
  });

  it('preserves non-template fields (image source / frame time / aspect ratio)', () => {
    const prev = makeState({ frameVirtualTimeMs: 7777, aspectRatio: '9:16' });
    const next = applyTemplate('tutorial', prev, getTemplate);
    expect(next.frameVirtualTimeMs).toBe(7777);
    expect(next.aspectRatio).toBe('9:16');
    expect(next.imageSource).toBe('frame');
    expect(next.templateId).toBe('tutorial');
  });
});
