import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffectAsset } from '@/types/effects';
import { useTimelineStore } from '@/components/video/timeline/store/useTimelineStore';
import { createEffectsAgentBridge } from '@/components/video/effects/effectsAgentBridge';
import { createDefaultAgentTimelineState } from '../defaultTimeline';
import { createEffectsApplyTools } from '../tools/effectsApplyTool';
import { AgentEventRouter } from '../AgentEventRouter';
import { AgentStateManager } from '../AgentStateManager';
import { OperationApplier } from '../OperationApplier';
import type { EffectsApplyRequest, ToolContext } from '../types';
import type { TimelineState } from '@/types';

const mocks = vi.hoisted(() => ({ asset: vi.fn(), attach: vi.fn(), ack: vi.fn(),
  get: vi.fn(), job: vi.fn() }));
vi.mock('@/lib/api/effects', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/api/effects')>(),
  getEffectAsset: mocks.asset, attachEffectInput: mocks.attach, getEffectJob: mocks.job }));
vi.mock('@/lib/api/http-client', () => ({ http: { post: mocks.ack, get: mocks.get } }));
const asset = { id: 'a', projectId: 'p', kind: 'output-video',
  url: '/api/storage/files/effects/projects/p/outputs/j/video.mp4',
  storageKey: 'effects/projects/p/outputs/j/video.mp4',
  bytes: 100, width: 640, height: 360, durationSeconds: 1,
  createdAt: '2026-11-17', effects: { schemaVersion: 1, projectId: 'p',
    draftId: 'd', draftVersion: 1, assetId: 'a', jobId: 'j',
    templateId: 'title-rise', templateVersion: 1, documentHash: 'h' },
} as EffectAsset;
const request = (): EffectsApplyRequest => ({ type: 'effects_apply_request',
  runId: 'run', receiptId: 'receipt', token: 't'.repeat(64), expiresAt: Date.now() + 15000,
  operation: { type: 'effects_action', projectId: 'p', operationId: 'apply',
    action: 'apply_asset', assetId: 'a', mode: 'insert', startTime: 2 } });

beforeEach(() => {
  mocks.asset.mockReset().mockResolvedValue(asset);
  mocks.ack.mockReset().mockResolvedValue({});
  mocks.get.mockReset(); mocks.job.mockReset();
  useTimelineStore.getState().setExternalEditLock(null);
  useTimelineStore.setState({ isInteracting: false });
  useTimelineStore.getState().initTimeline(createDefaultAgentTimelineState());
  useTimelineStore.getState().clearHistory();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('特效Agent真实事务与回执', () => {
  it('Router 独立收到取消后拒绝后续特效请求，保留已有后台任务', async () => {
    const cancelOperations = vi.fn();
    const apply = vi.fn().mockResolvedValue({ state: 'not_applied', assetId: 'a' });
    const bridge = { apply, cancelOperations, beginOperation: vi.fn(),
      watch: vi.fn(), registerMaterials: vi.fn() };
    const router = new AgentEventRouter({ stateManager: new AgentStateManager('m'),
      operationApplier: new OperationApplier({
        getTimelineState: createDefaultAgentTimelineState, setTimelineState: vi.fn(),
      }), effectsAgentBridge: bridge, isLeaseValid: () => true,
      isCurrentProject: () => true, acceptCommittedTimeline: vi.fn() });
    await router.handleEvent({ type: 'tool_call', toolCallId: 'apply',
      toolName: 'apply_effect', params: {} });
    await router.handleEvent({ type: 'cancelled', reason: 'server_timeout', timestamp: 0 });
    await router.handleEvent(request());
    expect(cancelOperations).toHaveBeenCalledWith({
      cancelJobs: false, operationIds: ['apply'],
    });
    expect(apply).not.toHaveBeenCalled();
    expect(mocks.ack).toHaveBeenCalledWith(expect.any(String),
      expect.objectContaining({ state: 'not_applied' }), expect.any(Object));
  });

  it('先同步镜像、记录真实patches，再确认；重放不重复上轨', async () => {
    let mirror = createDefaultAgentTimelineState();
    const bridge = createEffectsAgentBridge({ projectId: 'p', getProjectId: () => 'p',
      registerMaterial: vi.fn(), onWatchJob: vi.fn() });
    const applier = new OperationApplier({ getTimelineState: () => mirror,
      setTimelineState: value => { mirror = value; } });
    const state = new AgentStateManager('message');
    state.addToolCall({ id: 'apply', name: 'apply_effect', params: {}, status: 'executing' });
    const router = new AgentEventRouter({ stateManager: state, operationApplier: applier,
      effectsAgentBridge: bridge, isLeaseValid: () => true, isCurrentProject: () => true,
      acceptCommittedTimeline: value => { mirror = value; } });
    mocks.ack.mockImplementation(async () => {
      expect(mirror.tracks.some(track => track.id === 'effect-track:apply')).toBe(true);
      return {};
    });
    const event = request();
    await router.handleEvent(event); await router.handleEvent(event);
    expect(useTimelineStore.getState().tracks.filter(t => t.id === 'effect-track:apply')).toHaveLength(1);
    expect(applier.getOperationHistory()).toHaveLength(1);
    expect(state.getToolCalls()[0].changedTimeline).toBe(true);
    expect(applier.undoOperation('apply').ok).toBe(true);
    expect(mirror.tracks.some(track => track.id === 'effect-track:apply')).toBe(false);
    useTimelineStore.getState().undo();
    expect(useTimelineStore.getState().tracks.some(t => t.id === 'effect-track:apply')).toBe(false);
  });
  it('异步取资产期间stop与过期请求都不能提交', async () => {
    let resolve!: (asset: EffectAsset) => void;
    mocks.asset.mockReturnValue(new Promise(done => { resolve = done; }));
    const bridge = createEffectsAgentBridge({ projectId: 'p', getProjectId: () => 'p',
      registerMaterial: vi.fn(), onWatchJob: vi.fn() });
    let live = true;
    const applying = bridge.apply(request(), () => live);
    live = false; resolve(asset);
    expect((await applying).state).toBe('not_applied');
    expect(useTimelineStore.getState().tracks.some(t => t.id === 'effect-track:apply')).toBe(false);
    expect((await bridge.apply({ ...request(), runId: 'expired',
      expiresAt: Date.now() - 1 }, () => true)).state).toBe('not_applied');
  });
  it('Stop在render入库前到达时有界重查404，晚到watch继续取消而不重新认领任务', async () => {
    vi.useFakeTimers();
    const onWatchJob = vi.fn();
    const bridge = createEffectsAgentBridge({ projectId: 'p', getProjectId: () => 'p',
      registerMaterial: vi.fn(), onWatchJob });
    bridge.beginOperation({ type: 'tool_call', toolCallId: 'render', toolName: 'render_effect',
      params: { requestId: 'request' } });
    mocks.get.mockRejectedValueOnce({ status: 404 }).mockRejectedValueOnce({ status: 404 })
      .mockResolvedValue({ data: { job_id: 'late' } });
    mocks.ack.mockResolvedValue({ data: { job_id: 'late', project_id: 'p', status: 'cancelling' } });
    bridge.cancelOperations({ cancelJobs: true, operationIds: ['render'] });
    await vi.advanceTimersByTimeAsync(301);
    expect(mocks.get).toHaveBeenCalledTimes(3);
    expect(mocks.get.mock.calls[0][1].signal.aborted).toBe(false);
    expect(mocks.ack).toHaveBeenCalledWith(expect.stringContaining('/late/cancel'), {},
      expect.objectContaining({ retries: 0, signal: expect.any(AbortSignal) }));
    await bridge.watch({ type: 'effects_action', action: 'watch_job', projectId: 'p',
      operationId: 'render', jobId: 'late' });
    expect(mocks.job).not.toHaveBeenCalled();
    expect(onWatchJob.mock.calls.every(([job]) => job.status === 'cancelling')).toBe(true);
    expect(onWatchJob).toHaveBeenCalledTimes(2);
  });

  it('A回执剥inline预览后，B旧clip仅凭素材库URL仍可拿目标并真实替换', async () => {
    const initial = createDefaultAgentTimelineState();
    initial.tracks[0].items.push({ id: 'old', materialId: 'source', name: '旧片段',
      type: 'video', trackId: initial.tracks[0].id, startTime: 0, duration: 1,
      clipStart: 0, clipEnd: 1, originalDuration: 1, volume: 1, color: '#000',
      thumbnailUrl: 'data:image/png;base64,AA', metadata: { localProxy: 'blob:preview' } });
    useTimelineStore.getState().initTimeline(initial);
    let mirror = initial; let serverMirror: TimelineState = initial;
    const material = { id: 'source', type: 'video' as const, name: '本地源',
      url: '/api/storage/files/video/old.mp4', format: 'mp4', size: 100,
      createdAt: new Date(0) };
    const sha = 'a'.repeat(64);
    const replacement = { ...asset, id: 'b', effects: { ...asset.effects!, assetId: 'b' },
      provenance: { jobId: 'j', draftId: 'd', draftVersion: 1, documentHash: 'h',
        inputHash: 'ih', durationFrames: 30, fps: 30 as const,
        canvas: { width: 640, height: 360 }, baseVideo: { assetId: 'input',
          sourceSha256: sha, trimStartFrame: 0, sourceFrameCount: 30,
          displayWidth: 640, displayHeight: 360 } } };
    mocks.asset.mockImplementation(async (_, id) => id === 'b' ? replacement : asset);
    mocks.attach.mockResolvedValue({ sha256: sha });
    const bridge = createEffectsAgentBridge({ projectId: 'p', getProjectId: () => 'p',
      getMaterials: () => [material], registerMaterial: vi.fn(), onWatchJob: vi.fn() });
    const applier = new OperationApplier({ getTimelineState: () => mirror,
      setTimelineState: state => { mirror = state; } });
    const router = new AgentEventRouter({ stateManager: new AgentStateManager('m'),
      operationApplier: applier, effectsAgentBridge: bridge,
      isLeaseValid: () => true, isCurrentProject: () => true,
      acceptCommittedTimeline: state => { mirror = state; } });
    mocks.ack.mockImplementation(async (_, ack) => { serverMirror = ack.timeline; return {}; });
    await router.handleEvent(request());
    expect(serverMirror.tracks[0].items[0].thumbnailUrl).toBeUndefined();
    const base = replacement.provenance.baseVideo;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => Response.json({
      success: true, data: url.includes('/inputs') ? { asset: { asset_id: 'input',
        project_id: 'p', kind: 'input-video', sha256: sha, width: 640, height: 360 } }
        : { asset_id: 'b', project_id: 'p', kind: 'output-video', width: 640, height: 360,
          duration_seconds: 1, provenance: { duration_frames: 30,
            base_video: { source_sha256: base.sourceSha256, trim_start_frame: 0,
              source_frame_count: 30, display_width: 640, display_height: 360 } } } })));
    const context = { projectId: 'p', timelineState: serverMirror, materials: [material],
      apiBaseUrl: 'http://agent.test' } as ToolContext;
    const target = await createEffectsApplyTools(context)[0].execute('target', {
      assetId: 'b', targetClipId: 'old' });
    expect(target.details).toMatchObject({ success: true });
    await router.handleEvent({ ...request(), receiptId: 'second', operation: {
      type: 'effects_action', action: 'apply_asset', projectId: 'p', operationId: 'replace',
      mode: 'replace', assetId: 'b', targetClipId: 'old', expectedTargetFingerprint:
        (target.details as { expectedTargetFingerprint: string }).expectedTargetFingerprint } });
    expect(useTimelineStore.getState().tracks[0].items[0].metadata?.effects?.assetId).toBe('b');
    expect(mocks.attach).toHaveBeenCalledWith('p', material.url, material.id);
    expect(applier.getOperationHistory()).toHaveLength(2);
  });
});
