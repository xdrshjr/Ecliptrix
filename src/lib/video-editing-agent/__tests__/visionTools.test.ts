import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { MaterialItem, TimelineState } from '@/types';
import type { ToolContext } from '../types';
import { INLINE_MEDIA_PLACEHOLDER } from '../compactToolResult';
import { RESULT_BYTE_CAP } from '../tools/webToolAdapter';

/**
 * 视觉工具契约（agent-visual-review spec §4.3 / §4.7 / §4.13 / AC-28）。
 *
 * 断言的都是「不变式」而不是文案：模型可见副本里没有像素、结果恒 ≤12 KiB、
 * 失败是信封不是异常、`composition_id` 只从两条合法通路来。
 */

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  const timelineState: TimelineState = {
    currentTime: 0, totalDuration: 0, zoomLevel: 1, selectedItems: [],
    tracks: [], playbackRate: 1, isPlaying: false, snapToGrid: false,
    gridSize: 0.1, scrollLeft: 0,
  };
  return {
    timelineState,
    materials: [],
    apiBaseUrl: 'http://127.0.0.1:3000',
    operations: new Map(),
    updateTimeline: vi.fn(),
    recordOperation: vi.fn(),
    turnState: {}, callBudget: { used: 0 },
    ...overrides,
  };
}

function material(overrides: Partial<MaterialItem> = {}): MaterialItem {
  return {
    id: 'm_12', name: 'chip.jpg', type: 'image', format: 'jpg', size: 1024,
    url: '/api/storage/files/images/chip.jpg',
    cacheUrl: '/api/storage/files/cached_materials/pexels/1234.jpg',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

function bytesOf(value: string): number {
  return new TextEncoder().encode(value).length;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('view_image', () => {
  it('posts to /api/agent-vision/describe with the tool-call id and origin', async () => {
    const { createViewImageTool } = await import('../tools/visionTools');
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: { ok: true, verdict: 'pass', summary: 'ok', observations: [],
        issues: [], images: 1, cached: false, observation_id: 'obs_1' },
    }));
    const context = makeContext({
      projectId: 'p1',
      materials: [material()],
    });
    await createViewImageTool(context).execute('call-7', {
      images: [{ source: 'material', material_id: 'm_12' }],
      question: 'is this the right subject?',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:3000/api/agent-vision/describe');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-tool-call-id'])
      .toBe('call-7');
    expect((init.headers as Record<string, string>).origin)
      .toBe(context.apiBaseUrl);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.project_id).toBe('p1');
    expect(body.mode).toBe('look');
    expect(body.images).toEqual([{
      source: 'material', material_id: 'm_12',
      // 路径 A：模型没带 storage_key 时由 ToolContext.materials 补齐。
      storage_key: 'cached_materials/pexels/1234.jpg',
    }]);
  });

  it('keeps composition_id out of the payload when neither source has one', async () => {
    const { createViewImageTool } = await import('../tools/visionTools');
    fetchMock.mockResolvedValue(jsonResponse({
      success: true, data: { ok: true, verdict: 'pass', summary: 'ok' },
    }));
    await createViewImageTool(makeContext()).execute('call-8', {
      images: [{ source: 'export' }],
      question: 'any black frames?',
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as {
      images: Array<Record<string, unknown>>;
    };
    // AC-28 回归：没有 id 就不发字段，让后端回落到「最近一次完成导出」。
    expect(body.images[0]).toEqual({ source: 'export' });
  });

  it('uses lastCompositionId for frame/export sources', async () => {
    const { createViewImageTool } = await import('../tools/visionTools');
    fetchMock.mockResolvedValue(jsonResponse({
      success: true, data: { ok: true, verdict: 'pass', summary: 'ok' },
    }));
    await createViewImageTool(makeContext({ lastCompositionId: 'comp_9' }))
      .execute('call-9', {
        images: [{ source: 'export' }],
        question: 'any black frames?',
      });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as {
      images: Array<Record<string, unknown>>;
    };
    expect(body.images[0]).toEqual({
      source: 'export', composition_id: 'comp_9',
    });
  });

  it('refuses an empty image list without calling the backend', async () => {
    const { createViewImageTool } = await import('../tools/visionTools');
    const result = await createViewImageTool(makeContext()).execute('call-10', {
      images: [], question: 'anything?',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({
      success: false, error_code: 'invalid_argument',
    });
  });

  it('never puts a data: URL into the model-visible text', async () => {
    const { createViewImageTool } = await import('../tools/visionTools');
    const thumb = 'data:image/jpeg;base64,AAAABBBBCCCC';
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: {
        ok: true, verdict: 'concern', summary: 'watermark bottom right',
        issues: [], images: 1, cached: false, observation_id: 'obs_2',
        // 后端若把缩略图塞进 data（而不是 ui），模型也读不到。
        preview: thumb,
        ui: {
          thumbs: [thumb], source_labels: ['素材：pexels-1234'],
          model: { provider: 'openai', model: 'qwen-vl-plus', source: 'environment' },
          elapsed_ms: 1200,
        },
      },
    }));
    const result = await createViewImageTool(makeContext()).execute('call-11', {
      images: [{ source: 'cover' }], question: 'watermark?',
    });
    const text = (result.content[0] as { text: string }).text;
    expect(text).not.toContain('data:image');
    expect(text).toContain(INLINE_MEDIA_PLACEHOLDER);
    expect(text).not.toContain('elapsed_ms');
    // 卡片侧仍然拿得到缩略图（§4.7）。
    const ui = result.details.ui as { thumbs: string[] };
    expect(ui.thumbs).toEqual([thumb]);
    expect(result.details.untrusted).toBe(true);
  });

  it('shrinks an oversized observation under the result byte cap', async () => {
    const { createViewImageTool } = await import('../tools/visionTools');
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: {
        ok: true, verdict: 'concern', summary: 'x'.repeat(9000),
        observations: Array.from({ length: 60 }, (_, index) => ({
          text: `${index}-${'y'.repeat(400)}`, region: 'center',
        })),
        issues: [], images: 1, cached: false, observation_id: 'obs_3',
      },
    }));
    const result = await createViewImageTool(makeContext()).execute('call-12', {
      images: [{ source: 'workspace', name: 'out/chart.png' }],
      question: 'read the chart',
    });
    expect(bytesOf((result.content[0] as { text: string }).text)).toBeLessThanOrEqual(RESULT_BYTE_CAP);
    expect(result.details.truncated).toBe(true);
    expect(typeof result.details.next_step).toBe('string');
  });

  it('turns a transport failure into a soft, retryable failure', async () => {
    const { createViewImageTool } = await import('../tools/visionTools');
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const result = await createViewImageTool(makeContext()).execute('call-13', {
      images: [{ source: 'cover' }], question: 'watermark?',
    });
    expect(result.details.success).toBe(false);
    // 传输失败不是"没配置模型"：报 vision_unavailable 会把模型引向
    // "让用户去改模型设置"，而实际只需要重试（§4.12）。
    expect(result.details.error_code).toBe('model_failed');
    expect(String(result.details.next_step)).toContain('Retry');
  });

  it('maps a vision timeout to model_timeout', async () => {
    const { createViewImageTool } = await import('../tools/visionTools');
    fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const result = await createViewImageTool(makeContext()).execute('call-14', {
      images: [{ source: 'cover' }], question: 'watermark?',
    });
    expect(result.details.error_code).toBe('model_timeout');
  });
});

describe('review_frames', () => {
  it('samples a window into a contact sheet request', async () => {
    const { createReviewFramesTool } = await import('../tools/visionTools');
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: { ok: true, verdict: 'pass', summary: 'fine',
        sheet: { frame_count: 4, start: 1, end: 9 } },
    }));
    const result = await createReviewFramesTool(
      makeContext({ lastCompositionId: 'comp_9' }),
    ).execute('call-15', {
      source: { kind: 'composition' }, start_seconds: 1, end_seconds: 9,
      count: 4, question: 'any subtitle cut off?',
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as {
      source: Record<string, unknown>; count: number;
    };
    expect(String(fetchMock.mock.calls[0][0]))
      .toBe('http://127.0.0.1:3000/api/agent-vision/frames');
    // kind='composition' 允许不带 id：省略时用 lastCompositionId。
    expect(body.source).toEqual({ kind: 'composition', id: 'comp_9' });
    expect(body.count).toBe(4);
    expect(result.details.success).toBe(true);
  });

  it('rejects an inverted window before spending a vision call', async () => {
    const { createReviewFramesTool } = await import('../tools/visionTools');
    const result = await createReviewFramesTool(makeContext()).execute(
      'call-16',
      { source: { kind: 'material', id: 'm_1' }, start_seconds: 9, end_seconds: 2 },
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({
      success: false, error_code: 'invalid_argument',
    });
  });
});

describe('tool schemas', () => {
  it('keeps every description inside the 180-byte explore_tools budget', async () => {
    const { createViewImageTool, createReviewFramesTool } =
      await import('../tools/visionTools');
    const { createInspectExportTool } = await import('../tools/exportInspectTool');
    const tools = [
      createViewImageTool(makeContext()),
      createReviewFramesTool(makeContext()),
      createInspectExportTool(makeContext()),
    ];
    for (const tool of tools) {
      expect(bytesOf(tool.description)).toBeLessThanOrEqual(180);
    }
    // 模型必须知道「拿到的是文字，不是像素」，否则会以为能直接看图。
    expect(tools[0].description).toContain('TEXT observation');
    // 探测窗口的口径（进程内 1 小时）必须在描述里，否则模型会对旧成片重试。
    expect(tools[2].description).toContain('last hour');
  });
});

describe('inspect_export', () => {
  it('sends the timeline duration and omits an unknown composition id', async () => {
    const { createInspectExportTool } = await import('../tools/exportInspectTool');
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: { ok: true, duration_seconds: 12.5, issues: [], skipped: [],
        next_step: 'Ship it.' },
    }));
    const context = makeContext();
    context.timelineState.tracks = [{
      id: 'v1', type: 'video', name: 'video', isVisible: true, isLocked: false,
      isMuted: false, volume: 100, items: [{
        id: 'c1', materialId: 'm_12', startTime: 0, duration: 12.5,
        clipStart: 0, clipEnd: 12.5, volume: 1,
      }],
    } as unknown as TimelineState['tracks'][number]];
    const result = await createInspectExportTool(context).execute('call-17', {
      check_audio: true,
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as
      Record<string, unknown>;
    expect(body.composition_id).toBeUndefined();
    expect(body.timeline_duration).toBe(12.5);
    expect(body.check_audio).toBe(true);
    expect(body.visual_spot_check).toBe(true);
    expect(String(result.details.next_step)).toContain('export');
  });

  it('forwards an explicit composition id', async () => {
    const { createInspectExportTool } = await import('../tools/exportInspectTool');
    fetchMock.mockResolvedValue(jsonResponse({
      success: true, data: { ok: true, duration_seconds: 3, issues: [], skipped: [] },
    }));
    await createInspectExportTool(makeContext({ lastCompositionId: 'comp_1' }))
      .execute('call-18', { composition_id: 'comp_2' });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as
      Record<string, unknown>;
    expect(body.composition_id).toBe('comp_2');
  });
});
