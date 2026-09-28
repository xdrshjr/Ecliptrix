import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentEventRouter } from '../AgentEventRouter';
import { AgentStateManager } from '../AgentStateManager';
import type { OperationApplier } from '../OperationApplier';
import type { SSEEvent } from '../types';
import { useCoverController } from '@/components/video/cover/useCoverController';
import { createCoverDocument } from '@/components/video/cover/templates';
import { videoCoverV2 } from '@/lib/api/videoCoverV2';
import { translations } from '@/lib/i18n';
import type { CoverAsset, CoverSnapshot } from '@/types/videoCover';
import { applyCoverTimelineAction } from
  '@/components/video/timeline/store/actions/applyCover';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations['zh-CN'] }),
}));
vi.mock('@/lib/api/videoCoverV2', () => ({ videoCoverV2: {
  get: vi.fn(), save: vi.fn(), uploadAsset: vi.fn(), getJob: vi.fn(),
  publish: vi.fn(),
} }));
vi.mock('@/components/video/timeline/store/actions/applyCover', () => ({
  applyCoverTimelineAction: vi.fn(),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const result = {
  type: 'tool_result', toolCallId: 'call', toolName: 'create_video_cover',
  result: { success: true, status: 'queued' },
  operation: {
    type: 'cover_action', projectId: 'p', operationId: 'call',
    action: 'watch_job', jobId: 'j', draftVersion: 1,
    durationFrames: 30, applyWhenReady: true,
  },
} as SSEEvent;

function setup() {
  const stateManager = new AgentStateManager('message');
  const bridge = {
    beginOperation: vi.fn(),
    handleCoverOperation: vi.fn(),
    cancelOperations: vi.fn(),
  };
  const router = new AgentEventRouter({
    stateManager, operationApplier: {} as OperationApplier,
    coverAgentBridge: bridge,
  });
  return { router, bridge, stateManager };
}

describe('封面 SSE 操作', () => {
  it('开始事件立即记录基线，结果去重，watch 不阻塞 SSE', async () => {
    const { router, bridge } = setup();
    bridge.handleCoverOperation.mockReturnValue(new Promise(() => {}));
    await router.handleEvent({
      type: 'tool_call', toolCallId: 'call',
      toolName: 'create_video_cover', params: {},
    });
    expect(bridge.beginOperation).toHaveBeenCalledWith('call', 'create_video_cover', expect.any(Function));
    await router.handleEvent(result);
    await router.handleEvent(result);
    expect(bridge.handleCoverOperation).toHaveBeenCalledTimes(1);
  });

  it('只重放结果没有开始基线，不执行封面操作', async () => {
    const { router, bridge } = setup();
    await router.handleEvent(result);
    expect(bridge.handleCoverOperation).not.toHaveBeenCalled();
  });

  it('停止后迟到的开始及结果不能恢复自动应用', async () => {
    const { router, bridge } = setup();
    router.cancelCoverOperations(true);
    await router.handleEvent({
      type: 'tool_call', toolCallId: 'call',
      toolName: 'create_video_cover', params: {},
    });
    await router.handleEvent(result);
    expect(bridge.beginOperation).not.toHaveBeenCalled();
    expect(bridge.handleCoverOperation).not.toHaveBeenCalled();
    expect(bridge.cancelOperations).toHaveBeenCalledWith({ cancelJobs: true, operationIds: [] });
  });

  it('客户端失败写入可见错误而非已完成', async () => {
    const { router, bridge, stateManager } = setup();
    bridge.handleCoverOperation.mockImplementation((_operation, onStatus) => {
      onStatus({ state: 'error', error: 'COVER_TIMELINE_CONFLICT' });
    });
    await router.handleEvent({ type: 'tool_call', toolCallId: 'call',
      toolName: 'create_video_cover', params: {} });
    await router.handleEvent(result);
    expect(stateManager.getToolCalls()[0]).toMatchObject({ status: 'error',
      result: { success: false, coverStatus: {
        state: 'error', error: 'COVER_TIMELINE_CONFLICT',
      } } });
  });

  it('项目切换后异步成功回调不能显示已应用', async () => {
    const { router, bridge, stateManager } = setup();
    let status: (value: { state: string }) => void = () => {};
    bridge.handleCoverOperation.mockImplementation((_operation, onStatus) => {
      status = onStatus;
    });
    await router.handleEvent({ type: 'tool_call', toolCallId: 'call',
      toolName: 'create_video_cover', params: {} });
    await router.handleEvent(result);
    router.cancelCoverOperations(false);
    status({ state: 'applied' });
    expect(stateManager.getToolCalls()[0].result).not.toMatchObject({
      coverStatus: { state: 'applied' },
    });
  });
});

describe('SSE 与真实控制器的人工意图权限', () => {
  const asset: CoverAsset = { assetId: 'upload',
    url: '/api/storage/files/projects/p/covers/assets/upload.png',
    width: 1920, height: 1080, sha256: 'a'.repeat(64) };
  const snapshot: CoverSnapshot = {
    document: createCoverDocument({ mode: 'html', title: '标题' }),
    version: 1, documentHash: 'h1', assets: [], revisions: [], jobs: [],
    appliedRevision: null, legacyAvailable: false, generationConfigured: true,
  };
  async function realController() {
    vi.mocked(videoCoverV2.get).mockResolvedValue(structuredClone(snapshot));
    vi.mocked(videoCoverV2.save).mockImplementation(async (_id, document,
      version) => ({ document, version: version + 1, documentHash: 'saved' }));
    const renderer = { current: { render: vi.fn(async () => new Blob()) } };
    vi.mocked(videoCoverV2.publish).mockResolvedValue({
      id: 'revision', projectId: 'p', document: snapshot.document!,
      documentHash: 'h1', assetId: 'png', sha256: 'b'.repeat(64),
      url: '/api/storage/files/projects/p/covers/revisions/png.png',
      width: 1920, height: 1080, createdAt: '2026-09-28T10:00:00Z',
    });
    const hook = renderHook(() => useCoverController({ projectId: 'p',
      projectName: '项目', aspectRatio: '16:9', renderer,
      registerMaterial: vi.fn(), onApplied: vi.fn() }));
    await act(async () => {});
    const stateManager = new AgentStateManager('real');
    const router = new AgentEventRouter({ stateManager,
      operationApplier: {} as OperationApplier,
      coverAgentBridge: hook.result.current.bridge });
    await act(async () => router.handleEvent({ type: 'tool_call',
      toolCallId: 'call', toolName: 'create_video_cover', params: {} }));
    return { hook, router, renderer, stateManager };
  }
  const prepared: SSEEvent = { ...result, type: 'tool_result',
    toolCallId: 'call', toolName: 'create_video_cover',
    result: { success: true }, operation: { type: 'cover_action',
      projectId: 'p', operationId: 'call', action: 'prepare_draft',
      draftVersion: 1, durationFrames: 30, applyWhenReady: true } };

  it('开始上传尚未返回就撤销旧 Agent 的自动应用权限', async () => {
    let finish!: (value: CoverAsset) => void;
    vi.mocked(videoCoverV2.uploadAsset).mockImplementation(() =>
      new Promise(resolve => { finish = resolve; }));
    const { hook, router, renderer, stateManager } = await realController();
    let upload!: Promise<void>;
    act(() => { upload = hook.result.current.upload(new Blob()); });
    await act(async () => router.handleEvent(prepared));
    expect(renderer.current.render).not.toHaveBeenCalled();
    expect(applyCoverTimelineAction).not.toHaveBeenCalled();
    expect(stateManager.getToolCalls()[0].result).toMatchObject({
      coverStatus: { state: 'not_applied' },
    });
    await act(async () => { finish(asset); await upload; });
  });

  it('只读刷新最近成品不改变 Agent 开始时的权限基线', async () => {
    const { hook, router, renderer } = await realController();
    await act(async () => hook.result.current.refreshResources());
    await act(async () => router.handleEvent(prepared));
    expect(renderer.current.render).toHaveBeenCalledTimes(1);
    expect(applyCoverTimelineAction).toHaveBeenCalledTimes(1);
  });
});
