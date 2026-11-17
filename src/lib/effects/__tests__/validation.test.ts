import { describe, expect, it } from 'vitest';
import { createEffectDocument } from '../catalog';
import {
  getEffectRenderability, validateEffectDocument,
} from '../validation';

const assetId = 'c85cb9fe-9fd3-4ac9-b71b-18adb096657d';

describe('特效文档保存与生成边界', () => {
  it('允许保存未填完的图片草稿，同时报告缺失字段', () => {
    const document = createEffectDocument('product-float');
    document.content.title = '';
    expect(validateEffectDocument(document)).toEqual(document);
    const result = getEffectRenderability(document);
    expect(result.ready).toBe(false);
    expect(result.errors.map(error => error.path))
      .toEqual(expect.arrayContaining(['content.title', 'inputs.hero']));
    document.content.title = '新品';
    document.inputs = [{ slot: 'hero', kind: 'image', assetId,
      fit: 'cover', focalX: 0.5, focalY: 0.5 }];
    expect(getEffectRenderability(document).ready).toBe(true);
  });

  it('拒绝未知参数、额外字段和非有限数值', () => {
    const document = createEffectDocument('title-rise');
    expect(() => validateEffectDocument({ ...document, unsafe: true }))
      .toThrow();
    expect(() => validateEffectDocument({ ...document,
      params: { distance: 0.08, executable: 'x' } })).toThrow();
    expect(() => validateEffectDocument({ ...document,
      motion: { speed: Infinity, intensity: 1 } })).toThrow();
    expect(() => validateEffectDocument({ ...document,
      durationFrames: 14 })).toThrow();
  });

  it('按 Unicode code points 计算文字上限', () => {
    const document = createEffectDocument('title-rise');
    document.content.title = '🌙'.repeat(120);
    expect(validateEffectDocument(document).content.title).toHaveLength(240);
    document.content.title += '新';
    expect(() => validateEffectDocument(document)).toThrow();
  });

  it('拒绝缺 kind、图片裁剪、非相册索引及非连续相册槽位', () => {
    const document = createEffectDocument('image-zoom');
    const input = { slot: 'hero', assetId, fit: 'cover',
      focalX: 0.5, focalY: 0.5 };
    expect(() => validateEffectDocument({ ...document,
      inputs: [input] })).toThrow();
    expect(() => validateEffectDocument({ ...document,
      inputs: [{ ...input, kind: 'image', trimStartSeconds: 0 }] }))
      .toThrow();
    expect(() => validateEffectDocument({ ...document,
      inputs: [{ ...input, kind: 'image', index: 0 }] })).toThrow();
    expect(() => validateEffectDocument({
      ...createEffectDocument('slides-stack'),
      inputs: [{ ...input, slot: 'images', kind: 'image', index: 1 }],
    })).toThrow();
  });
});
