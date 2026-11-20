import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSearchVideoTool } from '@/lib/video-editing-agent/tools/searchVideo';
import { createEgressTools } from '@/lib/video-editing-agent/tools/egressTools';
import { isMetadataOnlyMaterial } from '@/lib/video-editing-agent/tools/stillClip';
import type { ToolContext } from '@/lib/video-editing-agent/types';

const VIDEO_URL = 'https://videos.pexels.com/video-files/10814082/10814082-hd_720_1280_25fps.mp4';

function makeContext(): ToolContext {
  return {
    apiBaseUrl: 'http://127.0.0.1:18320', projectId: 'diagnosis-project',
    taskId: 'diagnosis-task', conversationId: 'diagnosis-conversation',
    userMessageId: 'diagnosis-turn', materials: [], operations: new Map(),
    turnState: {}, callBudget: { used: 0 }, recordOperation: vi.fn(),
  } as unknown as ToolContext;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('video-library routing regression', () => {
  it('search directs video candidates to the dedicated materialization tool', async () => {
    const fetchStub = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({
      success: true, videos: [{ id: 10814082, title: '犬只素材', author: '离线作者',
        width: 720, height: 1280, duration: 12, video_url: VIDEO_URL }],
    }));
    vi.stubGlobal('fetch', fetchStub);
    const context = makeContext();
    const result = await createSearchVideoTool(context).execute('search', {
      query: 'cockapoo puppy cute', count: 1, orientation: 'portrait',
    });
    expect(result.details).toMatchObject({ success: true, materialized: false,
      next_step: expect.stringContaining('materialize_video'),
      materials: [{ id: 'pexels-10814082', url: VIDEO_URL, availability: 'candidate' }],
    });
    expect(context.materials[0].metadata).toMatchObject({
      source: 'pexels', sourceId: '10814082', materialized: false,
    });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(String(fetchStub.mock.calls[0][0])).toContain('/api/video-search');
  });

  it('ordinary download_url keeps its web-policy refusal instead of bypassing robots', async () => {
    const fetchStub = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({
      success: false, error_code: 'robots_disallowed',
      error_details: { failure_class: 'policy', retryable: false, layer: 'robots', sticky: true,
        upstream_status: 403, local_status: 403 },
    }, { status: 403 }));
    vi.stubGlobal('fetch', fetchStub);
    const context = makeContext();
    context.materials.push({ id: 'pexels-10814082', name: '犬只素材', type: 'video',
      format: 'mp4', size: 4096, duration: 12, url: VIDEO_URL, createdAt: new Date(),
      cacheStatus: 'ready', cacheUrl: '/api/storage/files/cached_materials/pexels/10814082.mp4',
      metadata: { source: 'pexels', sourceId: '10814082', materialized: true },
    });
    const tool = createEgressTools(context).find(item => item.name === 'download_url')!;
    const result = await tool.execute('download', { url: VIDEO_URL, kind: 'media', name: '犬只素材' });
    expect(result.details).toMatchObject({ success: false, error_code: 'robots_disallowed' });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [target, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(target).toBe('http://127.0.0.1:18320/api/agent-host/egress/download');
    const body = JSON.parse(String(init.body));
    expect(body.url).toBe(VIDEO_URL);
    expect(body.source).toBeUndefined();
    expect(body.source_id).toBeUndefined();
    expect(context.recordOperation).not.toHaveBeenCalled();
  });

  it('a cache URL alone does not materialize a zero-byte candidate', () => {
    expect(isMetadataOnlyMaterial({ size: 0, url: VIDEO_URL,
      cacheUrl: '/api/storage/files/cached_materials/pexels/10814082.mp4',
      metadata: { source: 'pexels', sourceId: '10814082', materialized: false },
    })).toBe(true);
  });
});
