import { describe, expect, it } from 'vitest';
import type { CoverAsset, CoverRevision } from '@/types/videoCover';
import { createCoverDocument } from '../templates';
import { mergeCoverAssets, mergeCoverRevisions, parseCoverCreatedAt,
  selectCoverAssets, selectCoverRevisions } from '../coverResourceUtils';

const asset = (id: string): CoverAsset => ({ assetId: id,
  url: `/api/storage/files/projects/p/covers/assets/${id}.png`,
  sha256: id, width: 1920, height: 1080 });
const revision = (id: string, createdAt: string): CoverRevision => ({
  id, createdAt, projectId: 'p', document: createCoverDocument(),
  documentHash: id, assetId: id, url: asset(id).url,
  sha256: id, width: 1920, height: 1080,
});
describe('封面资源稳定合并', () => {
  it('并集保留迟到上传与当前资源且不重复', () => {
    expect(mergeCoverAssets([asset('b')], [asset('a'), asset('b')])
      .map(item => item.assetId)).toEqual(['b', 'a']);
  });
  it.each(['sha256', 'width', 'height', 'url'] as const)(
    '同ID的不可变%s冲突拒绝覆盖', key => {
      const changed = { ...asset('a'), [key]: key === 'width' ||
        key === 'height' ? 1 : 'changed' };
      expect(() => mergeCoverAssets([asset('a')], [changed])).toThrow();
    });
  it('选中置顶，其他保持首次出现顺序，只展示本地地址', () => {
    const assets = [asset('a'), asset('b'), { ...asset('remote'),
      url: 'https://example.com/image.png' }];
    expect(selectCoverAssets(assets, [{ jobId: 'j', baseVersion: 1,
      status: 'succeeded', assets: [asset('c'), asset('a')] }], 'b')
      .map(item => item.assetId)).toEqual(['b', 'a', 'c']);
  });
  it('最近20条额外保留实时引用，唯一置顶', () => {
    const revisions = Array.from({ length: 25 }, (_, i) => revision(
      String(i), new Date(Date.UTC(2026, 0, i + 1)).toISOString()));
    const selected = selectCoverRevisions(revisions, '0');
    expect(selected).toHaveLength(21);
    expect(selected[0].id).toBe('0');
    expect(new Set(selected.map(item => item.id)).size).toBe(21);
    expect(selectCoverRevisions(revisions, '24')).toHaveLength(20);
  });
  it('版本合并不删除本会话已知版本', () => {
    const first = revision('a', '2026-09-28T10:00:00');
    expect(mergeCoverRevisions([first], [first,
      revision('b', '2026-09-28T11:00:00')])).toHaveLength(2);
  });
  it('无时区当UTC，无效排末尾，同时间按ID稳定排序', () => {
    expect(parseCoverCreatedAt('2026-09-28T10:00:00'))
      .toBe(Date.parse('2026-09-28T10:00:00Z'));
    expect(parseCoverCreatedAt('broken')).toBeNull();
    expect(selectCoverRevisions([
      revision('bad', 'broken'), revision('b', '2026-09-28T10:00:00Z'),
      revision('a', '2026-09-28T10:00:00'),
    ]).map(item => item.id)).toEqual(['a', 'b', 'bad']);
  });
});
