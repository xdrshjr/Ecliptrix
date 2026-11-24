/**
 * 诊断用「特征化」测试（characterization repro）——断言的是**当前有缺陷的行为**，
 * 用来给 docs/diagnoses/youtube-desktop-add-material-download-failed/analysis.md
 * 的根因提供可执行的证据；修复节点应把这里的期望值改成修复后的行为。
 *
 * 它复现两件事：
 *   1. `youtubeVideoSearchService.convertToMaterials()` 造出的 YouTube 素材，
 *      其 composite key 退化成 ('url', hashUrl(watchUrl))；
 *   2. `useRemoteMaterialPrefetch()` 会把这条素材当成「通用远程媒体」接管，
 *      立刻向 /api/material/ingest 登记，于是后端用 ffmpeg 去抓观看页并永久失败。
 *
 * 运行：
 *   npx vitest run --config docs/diagnoses/youtube-desktop-add-material-download-failed/repro/vitest.repro.config.ts
 */

import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useRemoteMaterialPrefetch } from '@/components/video/hooks/useRemoteMaterialPrefetch';
import { YoutubeVideoSearchServiceImpl } from '@/components/video/services/youtubeVideoSearchService';
import { materialCompositeKey, hashUrl } from '@/components/video/lib/materialKey';
import type {
  IRemoteMaterialPrefetchPort,
  RemoteMaterialKey,
  RemoteMaterialResult,
} from '@/components/video/timeline/domain/ports';
import type { YoutubeVideoSearchResult } from '@/components/video/types';

/** 与桌面端实测失败的那条一致（cached_materials.source_id = 73b0fcdb）。 */
const WATCH_URL = 'https://www.youtube.com/watch?v=Rsh8TmczwrM';

function searchResult(): YoutubeVideoSearchResult {
  return {
    id: 'Rsh8TmczwrM',
    title: 'data center servers computer code on screen artificial intelligence',
    channelTitle: 'asamiile',
    description: '4K data center b-roll',
    thumbnailUrl: 'https://img.youtube.com/vi/Rsh8TmczwrM/maxresdefault.jpg',
    videoUrl: WATCH_URL,
    duration: 25.008,
    publishedAt: '2024-01-01T00:00:00Z',
    viewCount: 54,
    likeCount: 1,
    width: 1280,
    height: 720,
  } as YoutubeVideoSearchResult;
}

/** 用真实的生产转换器造素材，避免手抄字段导致与线上不一致。 */
function youtubeMaterial() {
  const service = new YoutubeVideoSearchServiceImpl('diag-task');
  const [material] = service.convertToMaterials([searchResult()]);
  return material;
}

interface RecordingAdapter extends IRemoteMaterialPrefetchPort {
  keys: RemoteMaterialKey[];
}

function makeAdapter(result: RemoteMaterialResult): RecordingAdapter {
  const adapter: RecordingAdapter = {
    keys: [],
    async ingest(items) {
      adapter.keys.push(...items);
      return [result];
    },
    async pollUntilReady(key) {
      adapter.keys.push(key);
      return result;
    },
  };
  return adapter;
}

describe('YouTube 素材被通用缓存管线接管（缺陷特征化）', () => {
  it('① convertToMaterials 产出的素材 url 是观看页，而不是可直接下载的媒体地址', () => {
    const material = youtubeMaterial();
    expect(material.id).toBe('youtube-Rsh8TmczwrM');
    expect(material.url).toBe(WATCH_URL);
    // 这是用户点「添加」到 /api/youtube/download-and-upload 返回前的初始状态。
    expect(material.serverUrl).toBeUndefined();
  });

  it('② composite key 退化成 (\'url\', hashUrl(watchUrl))，与桌面端失败行 73b0fcdb 完全一致', () => {
    const key = materialCompositeKey(youtubeMaterial());
    // metadata 里写的是 youtubeId，而 materialKey 只读 sourceId / id / video_id。
    expect(key).toEqual({ source: 'url', source_id: '73b0fcdb' });
    expect(hashUrl(WATCH_URL)).toBe('73b0fcdb');
  });

  it('③ useRemoteMaterialPrefetch 不再对观看页发起 ingest + poll（修复后：通用缓存管线不接管 YouTube）', async () => {
    const adapter = makeAdapter({
      source: 'url',
      source_id: '73b0fcdb',
      material_id: '8b2612f948764a4dbf1e40c5166657bc',
      status: 'failed',
      local_url: null,
      error_message:
        '[in#0 @ 0000022857044340] Error opening input: Invalid data found when processing input\n'
        + `Error opening input file ${WATCH_URL}`,
    });
    const onPatch = vi.fn();

    renderHook(() =>
      useRemoteMaterialPrefetch([youtubeMaterial()], onPatch, { adapter }),
    );

    // Flush a microtask turn so an eager (pre-fix) effect would have fired.
    await act(async () => {
      await Promise.resolve();
    });

    // 修复 A 之后：`shouldPrefetch` 判定该来源需要专用抽取器 → 一条 ingest 都不发，
    // 素材也不会被写上 cacheStatus / cacheError（后端那次必败的 ffmpeg 调用消失）。
    expect(adapter.keys).toEqual([]);
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('④ 下载完成后 url 变成同源 storage 路径时，管线就不再接管（说明失败只发生在下载前）', () => {
    const done = {
      ...youtubeMaterial(),
      url: '/api/storage/files/video/2026/11/24/user_anonymous/task-x/youtube_media.mp4',
      serverUrl: '/api/storage/files/video/2026/11/24/user_anonymous/task-x/youtube_media.mp4',
      downloadStatus: 'completed' as const,
    };
    const adapter = makeAdapter({
      source: 'url',
      source_id: 'x',
      material_id: '',
      status: 'pending',
    });
    const onPatch = vi.fn();
    // 修复 A 之后这条素材同样会命中「专用抽取器」守卫，两重闸门都成立：
    // 因此 ④ 的含义从「证明失败只发生在下载前」收窄为「完成后同样不接管」。
    renderHook(() => useRemoteMaterialPrefetch([done], onPatch, { adapter }));
    expect(adapter.keys).toEqual([]);
  });
});
