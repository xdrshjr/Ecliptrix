import { afterEach, describe, expect, it, vi } from 'vitest';
import { createToolRegistry } from '../index';
import { createSearchVideoTool } from '../searchVideo';
import type { ToolContext } from '../../types';
import type { MaterialItem } from '@/types';
import { CORE_TOOLKIT_TOOL_NAMES } from '../../promptParts';
import { AgentEventRouter } from '../../AgentEventRouter';
import { AgentStateManager } from '../../AgentStateManager';
import { OperationApplier } from '../../OperationApplier';
import { createDefaultAgentTimelineState } from '../../defaultTimeline';
import { useVideoEditingStore } from '@/stores';
import type { AgentOperation } from '../../types';
import { POST as materializeProxy } from '@/app/api/material/materialize-video/route';
import type { NextRequest } from 'next/server';

const VIDEO_URL = 'https://videos.pexels.com/video-files/123/video.mp4';
const LOCAL_URL = '/api/storage/files/cached_materials/pexels/123.mp4';
const searchVideo = { id: 123, title: 'Puppy', author: 'Photographer', width: 720,
  height: 1280, duration: 12, thumbnail: '', video_url: VIDEO_URL,
  candidate_ref: 'trusted-reference', download_mode: 'router', config_revision: 'revision' };
const receipt = { success: true, material_id: 'pexels-123', source: 'pexels', source_id: '123',
  local_url: LOCAL_URL, size: 4096, format: 'mp4', duration: 12, width: 720,
  height: 1280, download_mode: 'router' };

function candidate(): MaterialItem {
  return { id: 'pexels-123', name: 'Puppy', type: 'video', format: 'mp4', size: 0,
    url: VIDEO_URL, tags: ['puppy'], description: 'Photographer attribution', createdAt: new Date(),
    metadata: { candidate: true, materialized: false, source: 'pexels', sourceId: '123',
      candidateRef: 'trusted-reference', downloadMode: 'router', linkedSegmentId: 'segment-1' } };
}

function context(): ToolContext {
  return { apiBaseUrl: 'http://127.0.0.1:18320', projectId: 'project-1', materials: [candidate()],
    operations: new Map(), recordOperation: vi.fn(), turnState: {}, callBudget: { used: 0 },
  } as unknown as ToolContext;
}

function tool(ctx: ToolContext) {
  const found = createToolRegistry(ctx).getCategoryTools('search_tools')
    .find(item => item.name === 'materialize_video');
  expect(found, 'video-library materialization must be discoverable with search_video').toBeDefined();
  return found!;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('video library materialization', () => {
  it('preserves gateway backoff through the dedicated BFF', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false,
      error_code: 'provider_rate_limited', retryable: true },
    { status: 429, headers: { 'Retry-After': '90', 'set-cookie': 'private=backend' } })));
    const url = new URL('http://127.0.0.1:3000/api/material/materialize-video');
    const request = { headers: new Headers({ 'content-type': 'application/json' }), nextUrl: url,
      text: async () => JSON.stringify({ material_id: 'pexels-123' }), signal: new AbortController().signal,
    } as unknown as NextRequest;
    const response = await materializeProxy(request, { params: Promise.resolve({}) });
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('90');
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(await response.json()).toMatchObject({ error_code: 'provider_rate_limited', retryable: true });
  });

  it('is available whenever the resident search_video tool is available', () => {
    expect(CORE_TOOLKIT_TOOL_NAMES).toContain('materialize_video');
  });

  it('directs candidates to the video-library tool and preserves the trusted reference', async () => {
    const ctx = context(); ctx.materials = [];
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, videos: [searchVideo] })));
    const result = await createSearchVideoTool(ctx).execute('search', { query: 'puppy' });
    expect(result.details).toMatchObject({ next_step: expect.stringContaining('materialize_video') });
    expect(ctx.materials[0].metadata).toMatchObject({ candidateRef: 'trusted-reference',
      downloadMode: 'router', configRevision: 'revision' });
  });

  it('updates the original candidate in the operation and same-turn context', async () => {
    const ctx = context();
    const fetchStub = vi.fn<typeof fetch>(async () => Response.json(receipt)); vi.stubGlobal('fetch', fetchStub);
    const result = await tool(ctx).execute('download', { material_id: 'pexels-123' });
    expect(result.details).toMatchObject({ success: true, material_id: 'pexels-123', materialized: true });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0][0]).toBe('http://127.0.0.1:18320/api/material/materialize-video');
    expect(JSON.parse(String(fetchStub.mock.calls[0][1]?.body))).toEqual({ material_id: 'pexels-123' });
    expect(ctx.materials).toHaveLength(1);
    expect(ctx.materials[0]).toMatchObject({ id: 'pexels-123', size: 4096, cacheUrl: LOCAL_URL,
      storageKey: 'cached_materials/pexels/123.mp4', cacheStatus: 'ready', tags: ['puppy'],
      description: 'Photographer attribution', metadata: { candidate: false, materialized: true,
        sourceId: '123', linkedSegmentId: 'segment-1' } });
    expect(ctx.recordOperation).toHaveBeenCalledWith('download', expect.objectContaining({
      type: 'update_material', materialId: 'pexels-123', patch: expect.objectContaining({ size: 4096 }),
    }));
  });

  it('does not downgrade or re-add a materialized item during repeated search', async () => {
    const ctx = context();
    ctx.materials[0] = { ...candidate(), size: 4096, cacheUrl: LOCAL_URL, cacheStatus: 'ready',
      storageKey: 'cached_materials/pexels/123.mp4', metadata: { materialized: true, candidate: false } };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, videos: [searchVideo] })));
    const result = await createSearchVideoTool(ctx).execute('search', { query: 'puppy' });
    expect(ctx.materials[0].size).toBe(4096);
    expect(ctx.recordOperation).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({ materials: [{ id: 'pexels-123', materialized: true }] });
  });

  it('does not publish search results to a different project', async () => {
    const ctx = context(); ctx.materials = [];
    vi.stubGlobal('fetch', vi.fn(async () => {
      ctx.projectId = 'different-project';
      return Response.json({ success: true, videos: [searchVideo] });
    }));
    const result = await createSearchVideoTool(ctx).execute('search', { query: 'puppy' });
    expect(result.details).toMatchObject({ success: false, error_code: 'video_project_changed' });
    expect(ctx.recordOperation).not.toHaveBeenCalled();
    expect(ctx.materials).toHaveLength(0);
  });

  it('resolves a new turn by trusted identity instead of reusing its stale persisted reference', async () => {
    const ctx = context(); ctx.materials[0].metadata!.candidateRef = 'expired-old-mode-reference';
    const fetchStub = vi.fn<typeof fetch>(async () => Response.json(receipt));
    vi.stubGlobal('fetch', fetchStub);
    await tool(ctx).execute('download', { material_id: 'pexels-123' });
    expect(JSON.parse(String(fetchStub.mock.calls[0][1]?.body))).toEqual({ material_id: 'pexels-123' });
    await tool(ctx).execute('explicit', { material_id: 'pexels-123', candidate_ref: 'fresh-search-reference' });
    expect(JSON.parse(String(fetchStub.mock.calls[1][1]?.body))).toEqual({
      material_id: 'pexels-123', candidate_ref: 'fresh-search-reference' });
  });

  it('applies a download receipt to the real store and undo keeps the original candidate', async () => {
    const ctx = context();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(receipt)));
    const download = await tool(ctx).execute('download', { material_id: 'pexels-123' });
    const operation = vi.mocked(ctx.recordOperation).mock.calls[0][1] as AgentOperation;
    const previous = useVideoEditingStore.getState().materials;
    const original = candidate();
    useVideoEditingStore.setState({ materials: [original] });
    const applier = new OperationApplier({ getTimelineState: createDefaultAgentTimelineState, setTimelineState: () => {} });
    const stateManager = new AgentStateManager('download');
    stateManager.addToolCall({ id: 'download', name: 'materialize_video', params: {}, status: 'executing' });
    const router = new AgentEventRouter({ stateManager, operationApplier: applier });
    const event = { type: 'tool_result' as const, toolCallId: 'download', toolName: 'materialize_video',
      result: download.details, operation };
    try {
      await router.handleEvent(event);
      await router.handleEvent(event);
      expect(useVideoEditingStore.getState().materials).toHaveLength(1);
      expect(useVideoEditingStore.getState().materials[0]).toMatchObject({ size: 4096, cacheUrl: LOCAL_URL,
        metadata: { materialized: true, linkedSegmentId: 'segment-1' } });
      expect(applier.undoNonTimelineOperation('download')).toBe(true);
      expect(useVideoEditingStore.getState().materials).toEqual([original]);
    } finally { useVideoEditingStore.setState({ materials: previous }); }
  });

  it.each([{ size: 0 }, { local_url: VIDEO_URL }, { material_id: 'pexels-999' }])(
    'rejects an unusable receipt without publishing: %j', async invalid => {
      const ctx = context(); vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...receipt, ...invalid })));
      const result = await tool(ctx).execute('download', { material_id: 'pexels-123' });
      expect(result.details).toMatchObject({ success: false });
      expect(ctx.recordOperation).not.toHaveBeenCalled(); expect(ctx.materials[0].size).toBe(0);
    },
  );

  it('does not publish late results after cancellation', async () => {
    const ctx = context(); const cancel = new AbortController(); ctx.abortSignal = cancel.signal;
    vi.stubGlobal('fetch', vi.fn(async () => { cancel.abort(); return Response.json(receipt); }));
    const result = await tool(ctx).execute('download', { material_id: 'pexels-123' });
    expect(result.details).toMatchObject({ success: false, error_code: 'cancelled' });
    expect(ctx.recordOperation).not.toHaveBeenCalled(); expect(ctx.materials[0].size).toBe(0);
  });

  it('does not retry an ambiguous network failure or publish stale project results', async () => {
    const ctx = context(); const fetchStub = vi.fn(async () => { throw new TypeError('network'); });
    vi.stubGlobal('fetch', fetchStub);
    expect((await tool(ctx).execute('download', { material_id: 'pexels-123' })).details).toMatchObject({
      success: false, error_code: 'video_download_outcome_unknown', next_step: expect.stringContaining('materialize_video') });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    vi.stubGlobal('fetch', vi.fn(async () => { ctx.projectId = 'different-project'; return Response.json(receipt); }));
    expect((await tool(ctx).execute('download', { material_id: 'pexels-123' })).details).toMatchObject({ success: false });
    expect(ctx.recordOperation).not.toHaveBeenCalled();
  });

  it('preserves rate-limit backoff without automatically retrying the paid operation', async () => {
    const ctx = context();
    const fetchStub = vi.fn(async () => Response.json({ success: false,
      error_code: 'provider_rate_limited', retryable: true }, { status: 429, headers: { 'Retry-After': '90' } }));
    vi.stubGlobal('fetch', fetchStub);
    const outcome = await tool(ctx).execute('download', { material_id: 'pexels-123' });
    expect(outcome.details).toMatchObject({ success: false, error_code: 'provider_rate_limited',
      retryable: true, error_details: { retry_after_seconds: 90, local_status: 429 } });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(ctx.recordOperation).not.toHaveBeenCalled();
  });
});
