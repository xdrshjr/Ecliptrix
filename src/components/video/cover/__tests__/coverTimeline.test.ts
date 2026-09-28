import { describe, expect, it } from 'vitest';
import type { CoverRevision } from '@/types/videoCover';
import type { TimelineData } from '../../timeline/domain/types';
import { coverTimelineDigest, normalizeCoverFrames, planCoverTimelineChange } from '../coverTimeline';

const revision = { id: 'r1', projectId: 'p', url: '/api/storage/files/cover.png',
  assetId: 'a1', sha256: 'hash', width: 1920, height: 1080,
  createdAt: '2026-09-28', document: { mode: 'html', fields: { title: '封面' }, durationFrames: 30 },
} as CoverRevision;
const empty: TimelineData = { currentTime: 0, totalDuration: 1,
  zoomLevel: 1, playbackRate: 1, isPlaying: false, snapToGrid: false,
  gridSize: 1, scrollLeft: 0, tracks: [] };
function body(): TimelineData {
  return { ...empty, tracks: [0, 2, 3, 5].map((startTime, index) => ({
    id: `track-${index}`, type: index === 1 ? 'audio' : index === 2 ? 'subtitle' : 'video',
    name: '', height: 56, volume: 100, order: index,
    isLocked: false, isMuted: index === 1, isVisible: index !== 3,
    items: [{ id: `clip-${index}`, trackId: `track-${index}`, name: '',
      type: index === 1 ? 'audio' : index === 2 ? 'subtitle' : 'video',
      color: '#fff', startTime, duration: 2, clipStart: 4, clipEnd: 6,
      originalDuration: 9, text: '字幕',
    }],
  })) };
}
const apply = (timeline: TimelineData, durationFrames = 30) =>
  planCoverTimelineChange({ projectId: 'p', revision, timeline, durationFrames });

describe('封面时间轴事务计划', () => {
  it('Agent摘要忽略视图标志但保留真正内容变更', () => {
    const data = body(); const digest = coverTimelineDigest('p', data.tracks);
    data.tracks[0].height = 100; data.tracks[0].items[0].isSelected = true;
    expect(coverTimelineDigest('p', data.tracks)).toBe(digest);
    data.tracks[0].isVisible = false;
    expect(coverTimelineDigest('p', data.tracks)).not.toBe(digest);
    data.tracks[0].isVisible = true;
    data.tracks[0].items[0].startTime = 1;
    expect(coverTimelineDigest('p', data.tracks)).not.toBe(digest);
  });
  it('同步平移所有正文且保持源剪裁不动', () => {
    const original = body(); const result = apply(original);
    expect(result.timeline.tracks.slice(1).map(t => t.items[0].startTime)).toEqual([1, 3, 4, 6]);
    expect(result.timeline.tracks[1].items[0]).toMatchObject({ clipStart: 4, clipEnd: 6, originalDuration: 9 });
    expect(original.tracks[0].items[0].startTime).toBe(0);
  });
  it('重复应用无历史，改时长只移动差值，收拢恢复正文', () => {
    const first = apply(body());
    expect(apply(first.timeline).status).toBe('noop');
    const longer = apply(first.timeline, 60);
    expect(longer.delta).toBe(1);
    expect(longer.timeline.tracks[0].items[0]).toMatchObject({ duration: 2, clipStart: 0, clipEnd: 2, originalDuration: 2 });
    const removed = planCoverTimelineChange({ projectId: 'p', timeline: longer.timeline, mode: 'remove-collapse' });
    expect(removed.timeline.tracks[1].items[0].startTime).toBe(0);
  });
  it('有内容锁轨阻止移位，等时替换允许', () => {
    const original = body(); original.tracks[0].isLocked = true;
    expect(() => apply(original)).toThrow();
    const applied = apply(body()).timeline; applied.tracks[1].isLocked = true;
    expect(planCoverTimelineChange({ projectId: 'p', timeline: applied, revision: { ...revision, id: 'r2' } }).delta).toBe(0);
  });
  it('不重新显示隐藏空封面轨道或覆盖保留ID', () => {
    const existing = apply(empty).timeline;
    existing.tracks[0].items = []; existing.tracks[0].isVisible = false;
    expect(() => apply(existing)).toThrow();
    existing.tracks[0].isVisible = true;
    existing.tracks[0].items = body().tracks[0].items;
    expect(() => apply(existing)).toThrow();
  });
  it('侵入片头阻止改时长但不阻止等时换图', () => {
    const timeline = apply(body()).timeline; timeline.tracks[1].items[0].startTime = 0.5;
    expect(() => apply(timeline, 60)).toThrow();
    expect(planCoverTimelineChange({ projectId: 'p', timeline, revision: { ...revision, id: 'r2' } }).delta).toBe(0);
  });
  it('异常片段只能显式重建；不推算已有正文的历史偏移', () => {
    const timeline = apply(body()).timeline; timeline.tracks[0].items[0].startTime = 3;
    expect(() => apply(timeline)).toThrow();
    const rebuilt = planCoverTimelineChange({ projectId: 'p', timeline, revision, mode: 'rebuild' });
    expect(rebuilt.timeline.tracks[1].items[0].startTime).toBe(2);
  });
  it('片段秒数准确绑定整数帧', () => {
    expect([0, 0.12, 7].map(normalizeCoverFrames)).toEqual([3, 4, 150]);
    expect(apply(empty, 4).timeline.tracks[0].items[0].duration).toBe(4 / 30);
    expect(() => apply(empty, 4.5)).toThrow();
  });
  it('只移除保留正文时间和空轨道视图标志', () => {
    const timeline = apply(body()).timeline;
    timeline.tracks[0].isMuted = true;
    const removed = planCoverTimelineChange({ projectId: 'p', timeline, mode: 'remove-only' });
    expect(removed.delta).toBe(0);
    expect(removed.timeline.tracks[1].items[0].startTime).toBe(1);
    expect(removed.timeline.tracks[0]).toMatchObject({ items: [], isMuted: true });
  });
  it('封面轨道锁阻止等时替换与移除', () => {
    const timeline = apply(body()).timeline; timeline.tracks[0].isLocked = true;
    expect(() => apply(timeline)).toThrow();
    expect(() => planCoverTimelineChange({ projectId: 'p', timeline, mode: 'remove-only' })).toThrow();
  });
});
