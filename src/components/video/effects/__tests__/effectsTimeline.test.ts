import { describe, expect, it } from 'vitest';
import type { EffectAsset, EffectTargetSnapshot } from '@/types/effects';
import type { TimelineData } from '../../timeline/domain/types';
import { fingerprintEffectTarget } from '@/lib/effects/provenance';
import { planEffectsTimelineChange } from '../effectsTimeline';

import { effectsFixture } from './effectsFixture';

describe('源空间特效替换规划', () => {
  it('保持3.37秒区间、外层音量/分离音轨/转场与段落，重建播放身份', () => {
    const options = effectsFixture();
    const plan = planEffectsTimelineChange(options);
    const clip = plan.timeline.tracks[0].items[0];
    expect(clip).toMatchObject({ id: 'clip', startTime: 4, duration: 3.37,
      clipStart: 0, clipEnd: 3.37, originalDuration: 3.4,
      opacity: 0.8, volume: 80, audioDetached: true,
      transitionIn: { type: 'fade', duration: 0.2 },
      url: options.asset.url, cacheUrl: options.asset.url,
      metadata: { linkedSegmentId: 'segment', localResolvedUrl: options.asset.url } });
    expect(plan.material.metadata?.linkedSegmentId).toBeUndefined();
    expect(planEffectsTimelineChange({ ...options, timeline: plan.timeline }).status)
      .toBe('noop');
  });
  it('拒绝目标变化或来源变化，不靠新指纹绕过成品来源', () => {
    const options = effectsFixture();
    options.timeline.tracks[0].items[0].startTime = 5;
    expect(() => planEffectsTimelineChange(options)).toThrow('EFFECT_TARGET_CHANGED');
    options.intent.target.targetFingerprint = fingerprintEffectTarget(
      options.timeline.tracks[0], options.timeline.tracks[0].items[0]);
    options.intent.target.sourceSha256 = 'different-file';
    expect(() => planEffectsTimelineChange(options)).toThrow('EFFECT_SOURCE_MISMATCH');
  });
});
