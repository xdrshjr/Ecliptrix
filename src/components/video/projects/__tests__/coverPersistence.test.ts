import { describe, expect, it, vi } from 'vitest';
import type { CoverRevision } from '@/types/videoCover';
import { createCoverMaterial, planCoverTimelineChange } from '../../cover/coverTimeline';
import { importCoverReferences } from '../../cover/importCoverReferences';
import { TimelineRepository } from '../../timeline/infrastructure/TimelineRepository';
import { withCoverSchemaVersion } from '../hydrateTimeline';

const source = { id: 'r1', projectId: 'source', url: '/api/storage/files/source.png',
  assetId: 'a1', sha256: 'hash', width: 1920, height: 1080,
  createdAt: '2026-09-28', document: { mode: 'html', fields: { title: '封面' }, durationFrames: 60 },
} as CoverRevision;
function fixture() {
  return { materials: [createCoverMaterial(source)],
    timelineData: planCoverTimelineChange({ projectId: 'source', revision: source, timeline: {
      currentTime: 0, totalDuration: 1, zoomLevel: 1, playbackRate: 1,
      isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0, tracks: [],
    } }).timeline };
}
const readBlob = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error); reader.readAsText(blob);
});
describe('封面工程持久化和引用迁移', () => {
  it('JSON往返保留2秒时长、片段和素材metadata与本地URL', async () => {
    const data = fixture(); const repository = new TimelineRepository();
    const exported = await repository.exportToJSON(data.timelineData, data.materials,
      { taskId: 'task', version: '1', exportedAt: 'now' });
    const json = await readBlob(exported.blob);
    const imported = await repository.importFromJSON({ text: async () => json } as File);
    expect(imported.coverSchemaVersion).toBe(2);
    expect(imported.timelineData.tracks[0].items[0]).toMatchObject({
      duration: 2, clipStart: 0, clipEnd: 2, originalDuration: 2,
      metadata: data.timelineData.tracks[0].items[0].metadata,
    });
    expect(imported.materials[0]).toMatchObject({ metadata: data.materials[0].metadata,
      url: source.url, serverUrl: source.url, width: 1920, height: 1080 });
  });
  it('跨项目append先复制资产，再清除特殊标记，原工程不变', async () => {
    const data = fixture(); const before = JSON.stringify(data);
    const target = { ...source, id: 'r2', projectId: 'target', assetId: 'a2', url: '/api/storage/files/target.png' };
    const api = { getRevision: vi.fn(), importRevision: vi.fn(async () => target) };
    const result = await importCoverReferences({ ...data, projectId: 'target', mode: 'append', api });
    expect(api.importRevision).toHaveBeenCalledWith('target', 'source', 'r1', expect.any(String));
    expect(result.materials[0].url).toBe(target.url);
    expect(result.materials[0].metadata?.cover).toBeUndefined();
    expect(result.timelineData.tracks[0].items[0].metadata?.role).toBeUndefined();
    expect(JSON.stringify(data)).toBe(before);
  });
  it('跨项目replace重新绑定保留ID与元数据', async () => {
    const target = { ...source, id: 'r2', projectId: 'target', assetId: 'a2', url: '/api/storage/files/target.png' };
    const result = await importCoverReferences({ ...fixture(), projectId: 'target', mode: 'replace',
      api: { getRevision: vi.fn(), importRevision: vi.fn(async () => target) } });
    expect(result.timelineData.tracks[0].id).toBe('image-track-cover:target');
    expect(result.timelineData.tracks[0].items[0]).toMatchObject({ id: 'cover-clip:target',
      materialId: 'cover-material:r2', metadata: { cover: { projectId: 'target', revisionId: 'r2' } } });
  });
  it('源版本缺失拒绝整个导入且不改变输入', async () => {
    const data = fixture(); const before = JSON.stringify(data);
    await expect(importCoverReferences({ ...data, projectId: 'target', mode: 'append',
      api: { getRevision: vi.fn(), importRevision: vi.fn(async () => { throw new Error('missing'); }) },
    })).rejects.toThrow('missing');
    expect(JSON.stringify(data)).toBe(before);
  });
  it('同项目导入验证本地revision而不复制', async () => {
    const api = { getRevision: vi.fn(async () => source), importRevision: vi.fn() };
    await importCoverReferences({ ...fixture(), projectId: 'source', mode: 'replace', api });
    expect(api.getRevision).toHaveBeenCalledWith('source', 'r1');
    expect(api.importRevision).not.toHaveBeenCalled();
  });
  it('目标保留轨道ID冲突原子拒绝', async () => {
    const data = fixture(); data.timelineData.tracks.push({
      ...data.timelineData.tracks[0], id: 'image-track-cover:target', items: [],
    });
    const revision = { ...source, projectId: 'target' };
    await expect(importCoverReferences({ ...data, projectId: 'target', mode: 'replace',
      api: { getRevision: vi.fn(), importRevision: vi.fn(async () => revision) },
    })).rejects.toThrow('conflicting IDs');
    expect(data.timelineData.tracks[0].id).toBe('image-track-cover:source');
  });
  it('撤销或旧payload遗漏标志不会降回旧版', () => {
    expect(withCoverSchemaVersion({ coverSchemaVersion: 2, value: 1 }, { value: 2 })).toEqual({ coverSchemaVersion: 2, value: 2 });
    expect(withCoverSchemaVersion(null, { value: 2 } as { coverSchemaVersion?: 2; value: number })).toEqual({ value: 2 });
  });
});
