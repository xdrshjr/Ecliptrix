import { describe, expect, it } from 'vitest';
import type { MaterialItem } from '@/types';
import type { SegmentStatus } from '../../lib/segments/segmentLinks';
import { collectExportAdvisories, type CollectExportAdvisoriesInput } from '../exportAdvisories';

const ready: SegmentStatus = {
  visual: 'configured', voice: 'ready', voiceOnTimeline: 'current', subtitle: 'ready', candidate: null,
};

function input(patch: Partial<CollectExportAdvisoriesInput> = {}): CollectExportAdvisoriesInput {
  const voice = { id: 'v1', type: 'audio', metadata: { segment_id: 's1' } } as unknown as MaterialItem;
  const portrait = { id: 'p1', type: 'video', width: 1080, height: 1920 } as unknown as MaterialItem;
  return {
    segmentIds: ['s1', 's2'],
    statusById: new Map([['s1', ready], ['s2', ready]]),
    tracks: [
      { type: 'video', items: [{ type: 'video', materialId: 'p1' }] },
      { type: 'audio', items: [{ type: 'audio', materialId: 'v1' }] },
      { type: 'subtitle', items: [{ type: 'subtitle' }] },
    ],
    materialsById: new Map([['v1', voice], ['p1', portrait]]),
    fit: 'cover',
    aspectRatioId: '16:9',
    blackTailSeconds: 0,
    blackTailThreshold: 0.5,
    dismissed: [],
    ...patch,
  };
}

const codes = (patch: Partial<CollectExportAdvisoriesInput>) =>
  collectExportAdvisories(input(patch)).map((advisory) => advisory.code);

describe('collectExportAdvisories (T-EXPORT-ADV)', () => {
  it('a finished project has no advisory', () => {
    expect(codes({})).toEqual([]);
  });

  it('lists segments with an unapplied voice-over, with their ordinals', () => {
    const candidate = { materialId: 'v9', duration: 3, deltaFromTimeline: 1, isStale: false };
    const advisories = collectExportAdvisories(input({
      statusById: new Map([['s1', ready], ['s2', { ...ready, candidate }]]),
    }));
    expect(advisories.map((a) => [a.code, a.segmentOrdinals, a.segmentId]))
      .toEqual([['voice-pending', [2], 's2']]);
  });

  it('a stale candidate is not "pending"; a stale voice is reported as stale', () => {
    const candidate = { materialId: 'v9', duration: 3, deltaFromTimeline: 1, isStale: true };
    expect(codes({ statusById: new Map([['s1', { ...ready, voice: 'stale', candidate }]]) }))
      .toEqual(['voice-stale']);
  });

  it('narration without any subtitle and a letterboxed picture are notes, and can be dismissed', () => {
    const noSubtitles = input().tracks.filter((track) => track.type !== 'subtitle');
    expect([
      codes({ tracks: noSubtitles, fit: 'contain' }),
      codes({ tracks: noSubtitles, fit: 'contain', dismissed: ['subtitle-none', 'letterbox'] }),
    ]).toEqual([['subtitle-none', 'letterbox'], []]);
  });

  it('a black tail above the threshold is listed and cannot be dismissed', () => {
    const advisories = collectExportAdvisories(input({ blackTailSeconds: 2 }));
    expect(advisories.map((a) => [a.code, a.dismissible, a.seconds])).toEqual([['black-tail', false, 2]]);
  });
});
