/**
 * AC-28 regression: `ToolContext.lastCompositionId` 是 Agent 唯一能拿到成品 id
 * 的通路。这里钉死三件事：
 *   1. 导出后写入的 id 随请求发出；
 *   2. 没有 id 时**不**编造 `composition_id`（省略让后端回落）；
 *   3. 存储按项目隔离、带保鲜期，过期即失效。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  forgetLastCompositionId,
  readLastCompositionId,
  rememberLastCompositionId,
} from '@/lib/api/agentVision';
import type { ToolContext } from '@/lib/video-editing-agent/types';
import { createReviewFramesTool } from '@/lib/video-editing-agent/tools/visionTools';
import { createInspectExportTool } from '@/lib/video-editing-agent/tools/exportInspectTool';
import type { TimelineState } from '@/types';

const OK_BODY = {
  success: true,
  data: {
    ok: true,
    verdict: 'pass',
    summary: 'looks fine',
    observations: [],
    issues: [],
    images: 1,
    cached: false,
    observation_id: 'obs-1',
  },
};

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    timelineState: {
      tracks: [], totalDuration: 0,
    } as unknown as TimelineState,
    materials: [],
    apiBaseUrl: 'http://127.0.0.1:3088',
    projectId: 'proj-1',
    operations: new Map(),
    updateTimeline: () => {},
    recordOperation: () => {},
    turnState: {},
    ...overrides,
  };
}

type FetchSpy = ReturnType<typeof vi.fn>;

function fetchMock(): FetchSpy {
  return vi.fn(
    async (_url: string, _init?: RequestInit) => new Response(
      JSON.stringify(OK_BODY),
      { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
}

function sentBody(fetchSpy: FetchSpy, index = 0) {
  const call = fetchSpy.mock.calls[index] as unknown as
    [string, RequestInit | undefined] | undefined;
  return JSON.parse(String(call?.[1]?.body ?? '{}')) as Record<string, unknown>;
}

describe('lastCompositionId 存储', () => {
  beforeEach(() => { forgetLastCompositionId(); });
  afterEach(() => { forgetLastCompositionId(); vi.restoreAllMocks(); });

  it('按项目隔离，未导出过的项目读不到别人的 id', () => {
    rememberLastCompositionId('proj-1', 'comp-1');
    expect(readLastCompositionId('proj-1')).toBe('comp-1');
    expect(readLastCompositionId('proj-2')).toBeUndefined();
    expect(readLastCompositionId(undefined)).toBeUndefined();
  });

  it('超过保鲜期即失效', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    rememberLastCompositionId('proj-1', 'comp-1');
    vi.spyOn(Date, 'now').mockReturnValue(now + 3 * 60 * 60 * 1000);
    expect(readLastCompositionId('proj-1')).toBeUndefined();
  });

  it('forget 只清指定项目', () => {
    rememberLastCompositionId('proj-1', 'comp-1');
    rememberLastCompositionId('proj-2', 'comp-2');
    forgetLastCompositionId('proj-1');
    expect(readLastCompositionId('proj-1')).toBeUndefined();
    expect(readLastCompositionId('proj-2')).toBe('comp-2');
  });
});

describe('lastCompositionId 透传', () => {
  let fetchSpy: FetchSpy;

  beforeEach(() => {
    forgetLastCompositionId();
    fetchSpy = fetchMock();
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => { forgetLastCompositionId(); vi.unstubAllGlobals(); });

  it('review_frames(kind=composition) 省略 id 时带上 lastCompositionId', async () => {
    const tool = createReviewFramesTool(
      context({ lastCompositionId: 'comp-42' }));
    await tool.execute('call-1', {
      source: { kind: 'composition' }, count: 4,
    }, undefined as never, undefined as never);
    expect(sentBody(fetchSpy).source).toMatchObject({
      kind: 'composition', id: 'comp-42',
    });
  });

  it('没有 lastCompositionId 时不编造 id', async () => {
    const tool = createReviewFramesTool(context());
    await tool.execute('call-2', {
      source: { kind: 'composition' }, count: 4,
    }, undefined as never, undefined as never);
    const source = sentBody(fetchSpy).source as Record<string, unknown>;
    expect(source.kind).toBe('composition');
    expect(source.id).toBeUndefined();
  });

  it('显式 composition_id 优先于 lastCompositionId', async () => {
    const tool = createReviewFramesTool(
      context({ lastCompositionId: 'comp-42' }));
    await tool.execute('call-3', {
      source: { kind: 'composition', id: 'comp-explicit' }, count: 2,
    }, undefined as never, undefined as never);
    expect((sentBody(fetchSpy).source as Record<string, unknown>).id)
      .toBe('comp-explicit');
  });

  it('inspect_export 省略 composition_id 时用 lastCompositionId', async () => {
    const tool = createInspectExportTool(
      context({ lastCompositionId: 'comp-77' }));
    await tool.execute('call-4', {}, undefined as never, undefined as never);
    expect(sentBody(fetchSpy).composition_id).toBe('comp-77');
  });

  it('inspect_export 无 id 时请求体里不出现 composition_id 键', async () => {
    const tool = createInspectExportTool(context());
    await tool.execute('call-5', {}, undefined as never, undefined as never);
    expect('composition_id' in sentBody(fetchSpy)).toBe(false);
  });
});
