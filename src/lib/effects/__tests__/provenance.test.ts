import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { hashEffectValue, assertEffectSourceMatches } from '../provenance';
import type { EffectAsset, EffectTargetSnapshot } from '@/types/effects';

describe('成品不可变来源', () => {
  it('使用标准 SHA256 且对象键顺序不影响指纹', () => {
    expect(hashEffectValue('abc')).toBe(createHash('sha256')
      .update(JSON.stringify('abc')).digest('hex'));
    expect(hashEffectValue({ a: 1, b: 2 }))
      .toBe(hashEffectValue({ b: 2, a: 1 }));
  });
  it('核对实际源 hash / 入点 / 帧数，不能凭新指纹改源', () => {
    const target = { sourceSha256: 'original', trimStartFrame: 60,
      durationFrames: 102, durationSeconds: 3.37 } as EffectTargetSnapshot;
    const asset = { width: 1920, height: 1080, durationSeconds: 3.4,
      provenance: { durationFrames: 102, fps: 30,
        canvas: { width: 1920, height: 1080 }, baseVideo: {
          sourceSha256: 'original', trimStartFrame: 60, sourceFrameCount: 102,
          displayWidth: 1920, displayHeight: 1080,
        } } } as EffectAsset;
    expect(() => assertEffectSourceMatches(asset, target)).not.toThrow();
    expect(() => assertEffectSourceMatches(asset,
      { ...target, sourceSha256: 'changed' })).toThrow('EFFECT_SOURCE_MISMATCH');
    expect(() => assertEffectSourceMatches({ ...asset,
      provenance: undefined }, target)).toThrow();
  });
});
