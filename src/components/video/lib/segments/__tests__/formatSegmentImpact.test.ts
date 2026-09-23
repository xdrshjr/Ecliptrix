import { describe, expect, it } from 'vitest';
import { getTranslations } from '@/lib/i18n';
import { formatSegmentImpact, formatSignedSeconds } from '../formatSegmentImpact';
import type { SegmentImpact } from '../segmentCommands';

const copy = getTranslations('zh-CN').workbench.segmentCommands;

function impact(patch: Partial<SegmentImpact> = {}): SegmentImpact {
  return {
    durationDelta: 2, shiftedSegmentOrdinals: [3], shiftedLooseItemCount: 0,
    lockedTrackNames: [], untouchedMusicTrackNames: ['音频 2'], removedItems: [],
    keptLockedItems: [], gapSeconds: 0, totalDurationBefore: 25.6, totalDurationAfter: 27.6,
    ...patch,
  };
}

describe('formatSegmentImpact', () => {
  it('says which segments move, what stays and the new total', () => {
    expect(formatSegmentImpact(impact({ lockedTrackNames: ['字幕'] }), {
      copy, titleOf: () => '亲密陪伴',
    })).toEqual([
      '第 3 段「亲密陪伴」及之后内容将后移 2.0 秒',
      '背景音乐「音频 2」保持原位',
      '轨道「字幕」已锁定，不会移动',
      '工程总时长 25.6s → 27.6s',
    ]);
  });

  it('a removal reports the gap only when asked', () => {
    const removal = impact({ durationDelta: 0, shiftedSegmentOrdinals: [], untouchedMusicTrackNames: [],
      gapSeconds: 8, totalDurationAfter: 25.6 });
    expect([
      formatSegmentImpact(removal, { copy, titleOf: () => '', includeGap: true }),
      formatSegmentImpact(removal, { copy, titleOf: () => '' }),
    ]).toEqual([['时间轴上会留下 8.0 秒空隙，可用「整理素材」收紧'], []]);
  });

  it('signed seconds use a real minus sign', () => {
    expect([formatSignedSeconds(2), formatSignedSeconds(-1.24), formatSignedSeconds(0)])
      .toEqual(['+2.0', '−1.2', '+0.0']);
  });
});
