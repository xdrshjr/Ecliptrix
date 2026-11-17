import { describe, expect, it } from 'vitest';
import { EFFECT_CATALOG, createEffectDocument } from '../catalog';
import { validateEffectDocument } from '../validation';
import { getMotionProgress } from '../compositions/layout';

describe('内置特效目录', () => {
  it('最慢节奏的完整内容仍停留至少半个片段', () => {
    for (const frames of [15, 150, 1800]) {
      const readable = Array.from({ length: frames }, (_, frame) =>
        getMotionProgress({ frame, durationFrames: frames, speed: 0.5 }))
        .filter(timing => timing.enter === 1 && timing.exit === 1);
      expect(readable.length).toBeGreaterThanOrEqual(Math.floor(frames / 2));
    }
  });
  it('提供十二个库和二十四个可验证的默认模板', () => {
    expect(EFFECT_CATALOG.libraries).toHaveLength(12);
    expect(EFFECT_CATALOG.templates).toHaveLength(24);
    const ids = EFFECT_CATALOG.templates.map(template => template.id);
    expect(new Set(ids).size).toBe(24);
    for (const library of EFFECT_CATALOG.libraries) {
      expect(EFFECT_CATALOG.templates.filter(template =>
        template.libraryId === library.id)).toHaveLength(2);
    }
    for (const id of ids) {
      expect(validateEffectDocument(createEffectDocument(id)).templateId)
        .toBe(id);
    }
  });
});
