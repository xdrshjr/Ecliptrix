import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import { videoCoverV2 } from '@/lib/api/videoCoverV2';
import { useCoverJobs } from '../useCoverJobs';
import { useCoverController } from '../useCoverController';
import { createCoverDocument } from '../templates';
import { useTimelineStore } from '../../timeline/store/useTimelineStore';
import type { CoverJob } from '@/types/videoCover';
import type { CoverOperation } from '@/lib/video-editing-agent/types';
vi.mock('@/contexts/LocaleContext', () => ({ useLocale: () => ({ t: translations['zh-CN'] }) }));
vi.mock('@/lib/api/videoCoverV2', () => ({ videoCoverV2: {
  get: vi.fn(), save: vi.fn(), getJob: vi.fn(), generate: vi.fn(),
  cancelByRequest: vi.fn(async () => ({ status: 'cancelled' })),
} }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });
const snapshot = { document: createCoverDocument({ title: '初始', mode: 'html' }),
  version: 1, documentHash: 'h1', revisions: [], jobs: [], assets: [], legacyAvailable: false,
  appliedRevision: null };
const candidate = { assetId: 'asset', url: '/api/storage/files/projects/project/covers/assets/asset.png',
  width: 1920, height: 1080, sha256: 'a'.repeat(64) };
const queued: CoverJob = { jobId: 'job', baseVersion: 1, status: 'queued', assets: [] };
const succeeded: CoverJob = { ...queued, status: 'succeeded', assets: [candidate] };
const operation: CoverOperation = { type: 'cover_action', projectId: 'project',
  operationId: 'call', action: 'watch_job', jobId: 'job', draftVersion: 1,
  durationFrames: 30, applyWhenReady: true };
describe('封面订阅与草稿竞态', () => {
  it('轮询只读任务，不重复提交供应商生成', async () => {
    vi.useFakeTimers();
    vi.mocked(videoCoverV2.getJob).mockResolvedValue({ jobId: 'j', baseVersion: 1, status: 'succeeded', assets: [] });
    const hook = renderHook(() => useCoverJobs('project'));
    act(() => hook.result.current.putJob({ jobId: 'j', baseVersion: 1, status: 'queued', assets: [] }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(hook.result.current.jobs[0].status).toBe('succeeded');
    expect(videoCoverV2.generate).not.toHaveBeenCalled();
    hook.unmount(); await vi.advanceTimersByTimeAsync(10000);
    expect(videoCoverV2.getJob).toHaveBeenCalledTimes(1);
  });
  it('关闭前flush最后输入，进行中的PUT不会并发覆盖新文字', async () => {
    vi.mocked(videoCoverV2.get).mockResolvedValue(snapshot);
    let release!: (value: unknown) => void;
    vi.mocked(videoCoverV2.save).mockImplementationOnce(() => new Promise(resolve => { release = resolve as never; }));
    vi.mocked(videoCoverV2.save).mockImplementationOnce(async (_id, document) => ({ document, version: 3, documentHash: 'h3' }));
    const hook = renderHook(() => useCoverController({ projectId: 'project', projectName: '项目',
      aspectRatio: '16:9', renderer: { current: null }, registerMaterial: vi.fn(), onApplied: vi.fn() }));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const first = { ...snapshot.document, fields: { ...snapshot.document.fields, title: '第一个输入' } };
    act(() => hook.result.current.update(first));
    let pending!: Promise<unknown>;
    act(() => { pending = hook.result.current.flush(); });
    const last = { ...first, fields: { ...first.fields, title: '最后输入' } };
    act(() => hook.result.current.update(last));
    expect(videoCoverV2.save).toHaveBeenCalledTimes(1);
    await act(async () => { release({ document: first, version: 2, documentHash: 'h2' }); await pending; });
    expect(videoCoverV2.save).toHaveBeenLastCalledWith('project', last, 2);
    expect(hook.result.current.document!.fields.title).toBe('最后输入');
    expect(hook.result.current.saveState).toBe('saved');
  });
  it('只收到重放结果时不渲染不应用', async () => {
    vi.mocked(videoCoverV2.get).mockResolvedValue(snapshot);
    const renderer = { current: { render: vi.fn() } };
    const applied = vi.fn(); const status = vi.fn();
    const hook = renderHook(() => useCoverController({ projectId: 'project', projectName: '项目',
      aspectRatio: '16:9', renderer, registerMaterial: vi.fn(), onApplied: applied }));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    await act(async () => hook.result.current.bridge.handleCoverOperation({ type: 'cover_action',
      projectId: 'project', operationId: 'missing-call', action: 'prepare_draft',
      draftVersion: 1, durationFrames: 30, applyWhenReady: true }, status));
    expect(status).toHaveBeenCalledWith({ state: 'not_applied', projectId: 'project' });
    expect(renderer.current.render).not.toHaveBeenCalled(); expect(applied).not.toHaveBeenCalled();
  });

  it.each(['草稿', '时间轴'] as const)('job完成前修改%s只保留候选，不选图、不渲染、不应用', async changed => {
    vi.useFakeTimers();
    const originalTimeline = useTimelineStore.getState().exportToData();
    vi.mocked(videoCoverV2.get).mockResolvedValue(structuredClone(snapshot));
    vi.mocked(videoCoverV2.getJob).mockResolvedValueOnce(queued).mockResolvedValueOnce(succeeded);
    vi.mocked(videoCoverV2.save).mockImplementation(async (_id, document, version) =>
      ({ document, version: version + 1, documentHash: 'saved' }));
    const renderer = { current: { render: vi.fn() } };
    const applied = vi.fn(); const status = vi.fn(); const registerMaterial = vi.fn();
    const hook = renderHook(() => useCoverController({ projectId: 'project', projectName: '项目',
      aspectRatio: '16:9', renderer, registerMaterial, onApplied: applied }));
    try {
      await act(async () => {});
      expect(hook.result.current.loading).toBe(false);
      act(() => hook.result.current.bridge.beginOperation('call', 'create_video_cover', status));
      await act(async () => hook.result.current.bridge.handleCoverOperation(operation, status));
      expect(hook.result.current.jobs[0].status).toBe('queued');
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      act(() => {
        if (changed === '草稿') {
          hook.result.current.update({ ...snapshot.document,
            fields: { ...snapshot.document.fields, title: '用户刚输入的新标题' } });
        } else {
          useTimelineStore.getState().initTimeline({ tracks: [{ id: 'user-track', name: '用户新字幕',
            type: 'subtitle', height: 56, order: 0, isLocked: false, isVisible: true,
            isMuted: false, volume: 100, items: [{ id: 'caption', name: '字幕', type: 'subtitle',
              trackId: 'user-track', startTime: 2, duration: 1, color: '#ffffff', text: '用户新增内容' }] }] });
        }
      });
      const editedTimeline = useTimelineStore.getState().exportToData();
      // 结果在输入后100ms抵达，早于300ms自动保存，直接验证editSequence防护。
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect(hook.result.current.jobs[0].status).toBe('succeeded');
      expect(hook.result.current.assets).toContainEqual(candidate);
      expect(hook.result.current.document!.background.assetId).toBeNull();
      if (changed === '草稿') expect(hook.result.current.document!.fields.title).toBe('用户刚输入的新标题');
      expect(videoCoverV2.save).not.toHaveBeenCalled();
      expect(renderer.current.render).not.toHaveBeenCalled();
      expect(applied).not.toHaveBeenCalled(); expect(registerMaterial).not.toHaveBeenCalled();
      expect(videoCoverV2.generate).not.toHaveBeenCalled();
      expect(useTimelineStore.getState().exportToData()).toEqual(editedTimeline);
      expect(status).toHaveBeenLastCalledWith({ state: 'not_applied', jobId: 'job', projectId: 'project' });
      if (changed === '草稿') await act(async () => { await hook.result.current.flush(); });
    } finally {
      hook.unmount();
      useTimelineStore.getState().importFromData(originalTimeline);
    }
  });

  it('停止后迟到的tool_result不能重新渲染或应用，取消使用原请求键', async () => {
    vi.mocked(videoCoverV2.get).mockResolvedValue(structuredClone(snapshot));
    vi.mocked(videoCoverV2.cancelByRequest).mockResolvedValue({ ...queued, status: 'cancelled' });
    const renderer = { current: { render: vi.fn() } }; const applied = vi.fn(); const status = vi.fn();
    const hook = renderHook(() => useCoverController({ projectId: 'project', projectName: '项目',
      aspectRatio: '16:9', renderer, registerMaterial: vi.fn(), onApplied: applied }));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    act(() => hook.result.current.bridge.beginOperation('call', 'create_video_cover', status));
    await act(async () => hook.result.current.bridge.cancelOperations({ cancelJobs: true, operationIds: ['call'] }));
    await act(async () => hook.result.current.bridge.handleCoverOperation({ type: 'cover_action',
      projectId: 'project', operationId: 'call', action: 'prepare_draft',
      draftVersion: 1, durationFrames: 30, applyWhenReady: true }, status));
    expect(videoCoverV2.cancelByRequest).toHaveBeenCalledExactlyOnceWith('project', 'agent:call');
    expect(videoCoverV2.get).toHaveBeenCalledTimes(1);
    expect(videoCoverV2.getJob).not.toHaveBeenCalled(); expect(videoCoverV2.generate).not.toHaveBeenCalled();
    expect(renderer.current.render).not.toHaveBeenCalled(); expect(applied).not.toHaveBeenCalled();
    expect(status).toHaveBeenLastCalledWith({ state: 'not_applied', projectId: 'project' });
  });

  it('切项目后旧getJob即使忽略取消并返回成功也不能污染新项目', async () => {
    vi.mocked(videoCoverV2.get).mockImplementation(async projectId => ({ ...structuredClone(snapshot),
      document: createCoverDocument({ title: projectId === 'project' ? '旧项目' : '新项目', mode: 'html' }) }));
    let resolveJob!: (job: CoverJob) => void;
    vi.mocked(videoCoverV2.getJob).mockImplementationOnce(() => new Promise(resolve => { resolveJob = resolve; }));
    const renderer = { current: { render: vi.fn() } }; const applied = vi.fn(); const status = vi.fn();
    const hook = renderHook(({ projectId }) => useCoverController({ projectId, projectName: projectId,
      aspectRatio: '16:9', renderer, registerMaterial: vi.fn(), onApplied: applied }),
    { initialProps: { projectId: 'project' } });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    act(() => hook.result.current.bridge.beginOperation('call', 'create_video_cover', status));
    let pending!: Promise<void> | void;
    act(() => { pending = hook.result.current.bridge.handleCoverOperation(operation, status); });
    await waitFor(() => expect(videoCoverV2.getJob).toHaveBeenCalledWith('project', 'job'));
    hook.rerender({ projectId: 'new-project' });
    await waitFor(() => expect(hook.result.current.document?.fields.title).toBe('新项目'));
    await act(async () => { resolveJob(succeeded); await pending; });
    expect(hook.result.current.jobs).toEqual([]); expect(hook.result.current.assets).toEqual([]);
    expect(hook.result.current.document!.fields.title).toBe('新项目');
    expect(hook.result.current.document!.background.assetId).toBeNull();
    expect(renderer.current.render).not.toHaveBeenCalled(); expect(applied).not.toHaveBeenCalled();
    expect(videoCoverV2.generate).not.toHaveBeenCalled();
    expect(videoCoverV2.save).not.toHaveBeenCalled();
  });
});
