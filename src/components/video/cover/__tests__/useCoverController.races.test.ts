import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import { videoCoverV2 } from '@/lib/api/videoCoverV2';
import { ApiError } from '@/lib/api/http-client';
import type { CoverAspectRatio, CoverJob, CoverRevision,
  CoverSavedDraft, CoverSnapshot } from '@/types/videoCover';
import { applyCoverTimelineAction } from '../../timeline/store/actions/applyCover';
import { useCoverController } from '../useCoverController';
import { createCoverDocument } from '../templates';
import { coverSize } from '../layout';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations['zh-CN'] }),
}));
vi.mock('@/lib/api/videoCoverV2', () => ({ videoCoverV2: {
  get: vi.fn(), save: vi.fn(), generate: vi.fn(), importLegacy: vi.fn(),
  publish: vi.fn(), getJob: vi.fn(), uploadAsset: vi.fn(), copyAsset: vi.fn(),
  getRevision: vi.fn(), downloadUrl: vi.fn(), cancelByRequest: vi.fn(),
  cancelJob: vi.fn(),
} }));
vi.mock('../../timeline/store/actions/applyCover', () => ({
  applyCoverTimelineAction: vi.fn(),
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done; reject = fail;
  });
  return { promise, resolve, reject };
}
function snapshot(title = '初始', version = 1): CoverSnapshot {
  return { document: createCoverDocument({ title, mode: 'html' }),
    version, documentHash: `h${version}`, assets: [], revisions: [],
    jobs: [], appliedRevision: null, legacyAvailable: false,
    generationConfigured: true };
}
function setup(aspectRatio: CoverAspectRatio = '16:9') {
  const renderer = { current: { render: vi.fn(async () => new Blob()) } };
  const hook = renderHook(({ projectId }: { projectId?: string }) =>
    useCoverController({ projectId, projectName: '项目', aspectRatio,
      renderer, registerMaterial: vi.fn(), onApplied: vi.fn() }),
  { initialProps: { projectId: 'first' as string | undefined } });
  return { ...hook, renderer };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(videoCoverV2.get).mockImplementation(async id => snapshot(id));
  vi.mocked(videoCoverV2.save).mockImplementation(async (_id, document, v) =>
    ({ document, version: v + 1, documentHash: `h${v + 1}` }));
});
afterEach(() => {
  cleanup(); vi.resetAllMocks(); vi.restoreAllMocks(); vi.useRealTimers();
});

describe('封面控制器异步会话隔离', () => {
  it('检查身份在跨工程当次渲染改变，同会话编辑保持不变', async () => {
    const hook = setup(); await act(async () => {});
    const key = hook.result.current.readinessKey;
    act(() => hook.result.current.update({ ...hook.result.current.document!,
      fields: { title: '更改', subtitle: '', label: '' } }));
    expect(hook.result.current.readinessKey).toBe(key);
    hook.rerender({ projectId: 'second' });
    expect(hook.result.current.readinessKey).not.toBe(key);
    await act(async () => {});
    expect(hook.result.current.readinessKey).toMatch(/^second:/);
  });
  it.each(['apply', 'download'] as const)('缺失背景在%s渲染前拒绝且零发布', async action => {
    const hook = setup(); await act(async () => {});
    const doc = hook.result.current.document!;
    act(() => hook.result.current.update({ ...doc, mode: 'mixed',
      background: { ...doc.background, kind: 'asset', assetId: 'missing' } }));
    await act(async () => {
      await expect(hook.result.current.act(action)).rejects.toMatchObject({ code: 'COVER_ASSET_MISSING' });
    });
    expect(hook.renderer.current.render).not.toHaveBeenCalled();
    expect(videoCoverV2.publish).not.toHaveBeenCalled();
    expect(applyCoverTimelineAction).not.toHaveBeenCalled();
  });
  const candidate = { assetId: 'candidate', url: '/api/storage/files/candidate.png',
    width: 1920, height: 1080, sha256: 'a'.repeat(64) };
  const completed: CoverJob = { jobId: 'j', baseVersion: 1,
    status: 'succeeded', assets: [candidate] };
  it('迟到上传仅收录资源，不能覆盖后来选择的背景', async () => {
    const hook = setup(); await act(async () => {});
    const uploaded = deferred<typeof candidate>();
    vi.mocked(videoCoverV2.uploadAsset).mockReturnValueOnce(uploaded.promise);
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.upload(new Blob()); });
    await act(async () => { await hook.result.current.selectAsset(candidate); });
    await act(async () => {
      uploaded.resolve({ ...candidate, assetId: 'late' }); await pending;
    });
    expect(hook.result.current.document?.background.assetId).toBe('candidate');
    expect(hook.result.current.assets.map(asset => asset.assetId)).toContain('late');
  });

  it('过期上传失败保留独立提示，不覆盖后来选择及主要错误', async () => {
    const hook = setup(); await act(async () => {});
    const uploaded = deferred<typeof candidate>();
    vi.mocked(videoCoverV2.uploadAsset).mockReturnValueOnce(uploaded.promise);
    let pending!: Promise<unknown>;
    act(() => { pending = hook.result.current.upload(new Blob()).catch(error => error); });
    await act(async () => { await hook.result.current.selectAsset(candidate); });
    await act(async () => { uploaded.reject(new Error('旧导入失败')); await pending; });
    expect(hook.result.current.document?.background.assetId).toBe('candidate');
    expect(hook.result.current.issue).toBeUndefined();
    expect(hook.result.current.notice).toBe('image-import-failed');
  });

  it('两次上传B先A后完成，B保持选中且两图都可回收', async () => {
    const hook = setup(); await act(async () => {});
    const first = deferred<typeof candidate>();
    const second = deferred<typeof candidate>();
    vi.mocked(videoCoverV2.uploadAsset).mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    let uploadA!: Promise<void>; let uploadB!: Promise<void>;
    act(() => {
      uploadA = hook.result.current.upload(new Blob(['A']));
      uploadB = hook.result.current.upload(new Blob(['B']));
    });
    const assetA = { ...candidate, assetId: 'A' };
    const assetB = { ...candidate, assetId: 'B' };
    await act(async () => { second.resolve(assetB); await uploadB; });
    expect(hook.result.current.document?.background.assetId).toBe('B');
    await act(async () => { first.resolve(assetA); await uploadA; });
    expect(hook.result.current.document?.background.assetId).toBe('B');
    expect(hook.result.current.assets).toEqual([assetB, assetA]);
    expect(videoCoverV2.save).toHaveBeenCalledTimes(1);
    expect(hook.result.current.notice).toBe('image-imported');
  });

  it('上传期间只改标题仍采用图片，并保留最新标题', async () => {
    const hook = setup(); await act(async () => {});
    const uploaded = deferred<typeof candidate>();
    vi.mocked(videoCoverV2.uploadAsset).mockReturnValueOnce(uploaded.promise);
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.upload(new Blob()); });
    act(() => hook.result.current.update({ ...hook.result.current.document!,
      fields: { ...hook.result.current.document!.fields, title: '上传中改的标题' } }));
    await act(async () => { uploaded.resolve(candidate); await pending; });
    expect(hook.result.current.document).toMatchObject({
      fields: { title: '上传中改的标题' },
      background: { kind: 'asset', assetId: candidate.assetId },
    });
    expect(videoCoverV2.save).toHaveBeenLastCalledWith('first',
      expect.objectContaining({ fields: expect.objectContaining({
        title: '上传中改的标题' }), background: expect.objectContaining({
        assetId: candidate.assetId }) }), 1);
  });

  it('上传期间改变背景焦点使旧上传失效，只保留资源', async () => {
    const hook = setup(); await act(async () => {});
    const selected = { ...candidate, assetId: 'selected' };
    await act(async () => { await hook.result.current.selectAsset(selected); });
    const uploaded = deferred<typeof candidate>();
    vi.mocked(videoCoverV2.uploadAsset).mockReturnValueOnce(uploaded.promise);
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.upload(new Blob()); });
    act(() => hook.result.current.update({ ...hook.result.current.document!,
      background: { ...hook.result.current.document!.background, focusX: 0.8 } }));
    await act(async () => { uploaded.resolve(candidate); await pending; });
    expect(hook.result.current.document?.background).toMatchObject({
      assetId: 'selected', focusX: 0.8,
    });
    expect(hook.result.current.assets).toContainEqual(candidate);
    expect(hook.result.current.notice).toBe('image-imported');
  });

  it('发布渲染期间开始上传即阻止旧文档发布', async () => {
    const hook = setup(); await act(async () => {});
    const rendering = deferred<Blob>();
    hook.renderer.current.render.mockReturnValueOnce(rendering.promise);
    vi.mocked(videoCoverV2.uploadAsset).mockReturnValueOnce(new Promise(() => {}));
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = hook.result.current.act('apply').catch(error => error);
    });
    act(() => { void hook.result.current.upload(new Blob()); });
    await act(async () => { rendering.resolve(new Blob()); await pending; });
    expect(videoCoverV2.publish).not.toHaveBeenCalled();
    expect(applyCoverTimelineAction).not.toHaveBeenCalled();
  });

  it('未知生成重放冻结负载，不因新编辑分配新请求', async () => {
    const hook = setup(); await act(async () => {});
    vi.mocked(videoCoverV2.generate).mockRejectedValueOnce(new Error('断网'))
      .mockResolvedValueOnce({ ...completed, status: 'queued', assets: [] });
    await act(async () => { await hook.result.current.generate(); });
    const original = vi.mocked(videoCoverV2.generate).mock.calls[0];
    act(() => hook.result.current.update({ ...hook.result.current.document!,
      fields: { ...hook.result.current.document!.fields, title: '新文字' } }));
    await act(async () => { await hook.result.current.generate(); });
    expect(videoCoverV2.generate).toHaveBeenCalledTimes(1);
    await act(async () => { await hook.result.current.resumeSubmission(); });
    expect(vi.mocked(videoCoverV2.generate).mock.calls[1]).toEqual(original);
    expect(hook.result.current.document?.fields.title).toBe('新文字');
  });

  it('取消返回未确认的活动态不能解除未知提交闸门', async () => {
    const hook = setup(); await act(async () => {});
    vi.mocked(videoCoverV2.generate).mockRejectedValueOnce(new Error('断网'));
    await act(async () => { await hook.result.current.generate(); });
    vi.mocked(videoCoverV2.cancelByRequest).mockResolvedValueOnce({
      ...completed, status: 'running', assets: [] });
    await act(async () => { await hook.result.current.cancelSubmission(); });
    expect(hook.result.current.hasUnknownSubmission).toBe(true);
    await act(async () => { await hook.result.current.generate(); });
    expect(videoCoverV2.generate).toHaveBeenCalledTimes(1);
  });

  it('202响应PARSE_ERROR保留未知请求，编辑保存后仍原ID原负载重放', async () => {
    const hook = setup(); await act(async () => {});
    vi.mocked(videoCoverV2.generate).mockRejectedValueOnce(
      new ApiError(202, 'PARSE_ERROR', '响应无法解析')).mockResolvedValueOnce(completed);
    await act(async () => { await hook.result.current.generate(); });
    const original = structuredClone(vi.mocked(videoCoverV2.generate).mock.calls[0]);
    expect(hook.result.current.hasUnknownSubmission).toBe(true);
    expect(hook.result.current.submittingGeneration).toBe(false);
    expect(hook.result.current.issue?.actions).toContain('resume-submission');
    act(() => hook.result.current.update({ ...hook.result.current.document!,
      generation: { prompt: '新的背景提示', count: 4 } }));
    await act(async () => { await hook.result.current.flush(); });
    const saves = vi.mocked(videoCoverV2.save).mock.calls.length;
    await act(async () => {
      await hook.result.current.generate();
      expect(videoCoverV2.generate).toHaveBeenCalledTimes(1);
      await hook.result.current.resumeSubmission();
    });
    expect(vi.mocked(videoCoverV2.generate).mock.calls[1]).toEqual(original);
    expect(videoCoverV2.save).toHaveBeenCalledTimes(saves);
    expect(hook.result.current.hasUnknownSubmission).toBe(false);
    expect(hook.result.current.document?.generation.prompt).toBe('新的背景提示');
    expect(hook.result.current.document?.background.assetId).toBeNull();
    expect(hook.result.current.assets).toContainEqual(candidate);
  });

  it('旧生成未知响应不能把新上传错误动作改成恢复提交', async () => {
    const hook = setup(); await act(async () => {});
    const submitted = deferred<CoverJob>();
    vi.mocked(videoCoverV2.generate).mockReturnValueOnce(submitted.promise);
    let pending!: Promise<void>;
    await act(async () => { pending = hook.result.current.generate(); });
    vi.mocked(videoCoverV2.uploadAsset).mockRejectedValueOnce(new Error('新上传失败'));
    await act(async () => { await hook.result.current.upload(new Blob()).catch(() => {}); });
    const issue = hook.result.current.issue;
    await act(async () => { submitted.reject(new Error('旧提交断网')); await pending; });
    expect(hook.result.current.issue).toEqual(issue);
    expect(hook.result.current.hasUnknownSubmission).toBe(true);
  });

  it('资源刷新仅最新请求更新能力，保留本地文档', async () => {
    const hook = setup(); await act(async () => {});
    const old = deferred<CoverSnapshot>();
    vi.mocked(videoCoverV2.get).mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ ...snapshot('服务端'), generationConfigured: false });
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.refreshResources(); });
    await act(async () => { await hook.result.current.refreshResources(); });
    await act(async () => { old.resolve(snapshot('过期')); await pending; });
    expect(hook.result.current.canGenerate).toBe(false);
    expect(hook.result.current.document?.fields.title).toBe('first');
  });
  async function finishAgentJob(hook: ReturnType<typeof setup>) {
    vi.mocked(videoCoverV2.getJob).mockResolvedValueOnce(completed);
    const notify = vi.fn();
    act(() => hook.result.current.bridge.beginOperation('call', 'tool', notify));
    await act(async () => {
      await hook.result.current.bridge.handleCoverOperation({
        type: 'cover_action', projectId: 'first', operationId: 'call',
        action: 'watch_job', jobId: 'j', draftVersion: 1,
        durationFrames: 30, applyWhenReady: true,
      }, notify);
    });
    return notify;
  }

  it('Agent选图通过CAS推进版本后发布并应用同一份新草稿', async () => {
    const hook = setup(); await act(async () => {});
    vi.mocked(videoCoverV2.publish).mockImplementation(async (projectId, draft) => ({
      id: 'revision', projectId, document: draft.document,
      documentHash: draft.documentHash, assetId: candidate.assetId,
      url: candidate.url, sha256: candidate.sha256,
      width: 1920, height: 1080, createdAt: '2026-09-28',
    }));
    const notify = await finishAgentJob(hook);
    expect(videoCoverV2.save).toHaveBeenCalledWith('first',
      expect.objectContaining({ background: expect.objectContaining({
        assetId: candidate.assetId,
      }) }), 1);
    expect(videoCoverV2.publish).toHaveBeenCalledWith('first',
      expect.objectContaining({ version: 2, documentHash: 'h2' }),
      expect.any(Blob), expect.any(String));
    expect(applyCoverTimelineAction).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'applied', revisionId: 'revision',
    }));
  });

  it('自动选图的保存迟到失败不污染新项目错误状态', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hook = setup(); await act(async () => {});
    const save = deferred<CoverSavedDraft>();
    vi.mocked(videoCoverV2.save).mockReturnValueOnce(save.promise);
    await finishAgentJob(hook);
    expect(videoCoverV2.save).toHaveBeenCalledTimes(1);
    hook.rerender({ projectId: 'second' }); await act(async () => {});
    await act(async () => { save.reject(new Error('旧项目保存失败')); });
    expect(hook.result.current.error).toBeUndefined();
    expect(hook.result.current.document?.fields.title).toBe('second');
    expect(log).toHaveBeenCalledWith(
      '[CoverStudio] closing draft save failed', expect.any(Error));
  });

  it('重载等待已有保存结束，不能用旧快照回退刚保存的草稿', async () => {
    const hook = setup(); await act(async () => {});
    const save = deferred<CoverSavedDraft>();
    vi.mocked(videoCoverV2.save).mockReturnValueOnce(save.promise);
    const edited = { ...hook.result.current.document!, fields: {
      ...hook.result.current.document!.fields, title: '最后输入' } };
    act(() => hook.result.current.update(edited));
    let saving!: Promise<CoverSavedDraft>;
    let reloading!: Promise<void>;
    act(() => { saving = hook.result.current.flush(); });
    vi.mocked(videoCoverV2.get).mockResolvedValueOnce(snapshot('最后输入', 2));
    act(() => { reloading = hook.result.current.resolveConflict('server'); });
    expect(videoCoverV2.get).toHaveBeenCalledTimes(1);
    await act(async () => {
      save.resolve({ document: edited, version: 2, documentHash: 'h2' });
      await saving; await reloading;
    });
    expect(hook.result.current.document?.fields.title).toBe('最后输入');
  });

  it('恢复读取期间拒绝新PUT并在新增输入后拒绝旧快照', async () => {
    const hook = setup(); await act(async () => {});
    const read = deferred<CoverSnapshot>();
    vi.mocked(videoCoverV2.get).mockReturnValueOnce(read.promise);
    let reloading!: Promise<unknown>;
    act(() => { reloading = hook.result.current.resolveConflict('server').catch(error => error); });
    const edited = { ...hook.result.current.document!, fields: {
      ...hook.result.current.document!.fields, title: '新输入' } };
    await act(async () => {
      hook.result.current.update(edited);
      await expect(hook.result.current.flush()).rejects.toMatchObject({
        code: 'COVER_VERSION_CONFLICT',
      });
      expect(videoCoverV2.save).not.toHaveBeenCalled();
      read.resolve(snapshot('旧输入')); await reloading;
    });
    expect(hook.result.current.document?.fields.title).toBe('新输入');
    expect(await reloading).toMatchObject({ code: 'COVER_VERSION_CONFLICT' });
  });

  it('生成前保存失败仍提供保存重试，不能误报未知生成提交', async () => {
    const hook = setup(); await act(async () => {});
    act(() => hook.result.current.update({ ...hook.result.current.document!,
      durationFrames: 60 }));
    vi.mocked(videoCoverV2.save).mockRejectedValueOnce(new Error('保存断网'));
    await act(async () => { await hook.result.current.generate(); });
    expect(videoCoverV2.generate).not.toHaveBeenCalled();
    expect(hook.result.current.issue?.operation).toBe('save');
    expect(hook.result.current.issue?.actions).toContain('retry-save');
    expect(hook.result.current.hasUnknownSubmission).toBe(false);
  });

  it('已有本地文档时兼容reload不能静默替换草稿', async () => {
    const hook = setup(); await act(async () => {});
    vi.mocked(videoCoverV2.get).mockResolvedValueOnce(snapshot('会丢输入'));
    await act(async () => { await hook.result.current.reload().catch(() => {}); });
    expect(hook.result.current.document?.fields.title).toBe('first');
    expect(videoCoverV2.get).toHaveBeenCalledTimes(1);
  });

  it('CAS恢复连点只读一次，本地恢复只以最新服务端版本保存一次', async () => {
    const hook = setup(); await act(async () => {});
    const local = { ...hook.result.current.document!, fields: {
      ...hook.result.current.document!.fields, title: '本地' } };
    act(() => hook.result.current.update(local));
    vi.mocked(videoCoverV2.save).mockRejectedValueOnce(
      new ApiError(409, 'COVER_VERSION_CONFLICT', '冲突'));
    await act(async () => { await hook.result.current.flush().catch(() => {}); });
    expect(hook.result.current.issue?.kind).toBe('draft-conflict');
    const read = deferred<CoverSnapshot>();
    vi.mocked(videoCoverV2.get).mockReturnValueOnce(read.promise);
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.resolveConflict('local'); });
    await act(async () => { await hook.result.current.resolveConflict('server'); });
    expect(videoCoverV2.get).toHaveBeenCalledTimes(2);
    await act(async () => { read.resolve(snapshot('服务端', 8)); await pending; });
    expect(videoCoverV2.save).toHaveBeenLastCalledWith('first', local, 8);
    expect(hook.result.current.document?.fields.title).toBe('本地');
    expect(hook.result.current.issue).toBeUndefined();
  });

  it('服务端恢复不发PUT且推进权限，后续保存使用服务端版本', async () => {
    const hook = setup(); await act(async () => {});
    vi.mocked(videoCoverV2.get).mockResolvedValueOnce(snapshot('服务端', 7));
    await act(async () => { await hook.result.current.resolveConflict('server'); });
    expect(videoCoverV2.save).not.toHaveBeenCalled();
    expect(hook.result.current.document?.fields.title).toBe('服务端');
    act(() => hook.result.current.update({ ...hook.result.current.document!,
      durationFrames: 60 }));
    await act(async () => { await hook.result.current.flush(); });
    expect(videoCoverV2.save).toHaveBeenLastCalledWith('first',
      expect.objectContaining({ durationFrames: 60 }), 7);
  });

  it('服务端草稿为空时保留本地输入和本地恢复入口', async () => {
    const hook = setup(); await act(async () => {});
    vi.mocked(videoCoverV2.get).mockResolvedValueOnce({ ...snapshot(),
      document: null, documentHash: null, version: 0 });
    await act(async () => { await hook.result.current.resolveConflict('server')
      .catch(() => {}); });
    expect(hook.result.current.document?.fields.title).toBe('first');
    expect(hook.result.current.issue?.actions).toContain('use-local');
    expect(hook.result.current.issue?.actions).not.toContain('use-server');
    expect(videoCoverV2.save).not.toHaveBeenCalled();
  });

  it('恢复途中继续输入保留已确认CAS入口，关闭提示后保存仍能重新恢复', async () => {
    const hook = setup(); await act(async () => {});
    act(() => hook.result.current.update({ ...hook.result.current.document!,
      durationFrames: 60 }));
    vi.mocked(videoCoverV2.save).mockRejectedValueOnce(
      new ApiError(409, 'COVER_VERSION_CONFLICT', '冲突'));
    await act(async () => { await hook.result.current.flush().catch(() => {}); });
    const read = deferred<CoverSnapshot>();
    vi.mocked(videoCoverV2.get).mockReturnValueOnce(read.promise);
    let pending!: Promise<unknown>;
    act(() => { pending = hook.result.current.resolveConflict('server')
      .catch(error => error); });
    act(() => hook.result.current.update({ ...hook.result.current.document!,
      durationFrames: 90 }));
    await act(async () => { read.resolve(snapshot('服务器', 4)); await pending; });
    expect(hook.result.current.issue?.actions).toContain('use-local');
    act(() => hook.result.current.setError(undefined));
    await act(async () => { await hook.result.current.retrySave().catch(() => {}); });
    expect(hook.result.current.issue?.actions).toContain('use-local');
    expect(hook.result.current.document?.durationFrames).toBe(90);
    expect(videoCoverV2.save).toHaveBeenCalledTimes(1);
    vi.mocked(videoCoverV2.get).mockResolvedValueOnce(snapshot('服务器', 4));
    await act(async () => { await hook.result.current.resolveConflict('local'); });
  });

  it('非CAS的409不阻塞后续保存，也不提供草稿覆盖操作', async () => {
    const hook = setup(); await act(async () => {});
    act(() => hook.result.current.update({ ...hook.result.current.document!,
      durationFrames: 45 }));
    vi.mocked(videoCoverV2.save).mockRejectedValueOnce(
      new ApiError(409, 'COVER_REQUEST_CONFLICT', '请求冲突'));
    await act(async () => { await hook.result.current.flush().catch(() => {}); });
    expect(hook.result.current.issue?.actions).toEqual(['retry-save', 'dismiss']);
    await act(async () => { await hook.result.current.retrySave(); });
    expect(videoCoverV2.save).toHaveBeenCalledTimes(2);
    expect(hook.result.current.saveState).toBe('saved');
  });

  it('配置未知阻止新生成，资源失败也不得沿用旧true', async () => {
    const hook = setup(); await act(async () => {});
    vi.mocked(videoCoverV2.get).mockRejectedValueOnce(new Error('配置断网'));
    await act(async () => { await hook.result.current.refreshResources().catch(() => {}); });
    expect(hook.result.current.canGenerate).toBeUndefined();
    await act(async () => { await hook.result.current.generate(); });
    expect(videoCoverV2.generate).not.toHaveBeenCalled();
    expect(hook.result.current.document?.fields.title).toBe('first');
  });

  const revision = (): CoverRevision => ({ id: 'history', projectId: 'first',
    document: createCoverDocument({ title: '历史', mode: 'html' }),
    documentHash: 'history-hash', assetId: 'png', url: '/history.png',
    sha256: 'b'.repeat(64), width: 1920, height: 1080, createdAt: '2026-09-28' });

  it.each([
    ['9:16', '16:9'], ['16:9', '9:16'], ['4:3', '1:1'],
    ['21:9', '4:3'], ['9:16', '21:9'],
  ] as Array<[CoverAspectRatio, CoverAspectRatio]>)(
    '历史%s载入当前%s画布时重排并保留时长，发布使用新稿',
    async (sourceRatio, targetRatio) => {
      vi.mocked(videoCoverV2.get).mockImplementation(async id => ({
        ...snapshot(id), document: createCoverDocument({ title: id,
          aspectRatio: targetRatio, mode: 'html' }),
      }));
      const hook = setup(targetRatio); await act(async () => {});
      const historical = revision();
      historical.document = { ...historical.document,
        aspectRatio: sourceRatio, durationFrames: 75 };
      Object.assign(historical, coverSize(sourceRatio));
      vi.mocked(videoCoverV2.getRevision).mockResolvedValue(historical);
      vi.mocked(videoCoverV2.publish).mockImplementation(async (projectId, draft) => ({
        ...historical, id: 'reflowed', projectId, document: draft.document,
        documentHash: draft.documentHash, ...coverSize(draft.document.aspectRatio),
      }));
      await act(async () => { await hook.result.current.restoreRevision('history'); });
      expect(hook.result.current.document).toMatchObject({
        schemaVersion: 2, templateVersion: 1,
        aspectRatio: targetRatio, durationFrames: 75,
      });
      expect(historical.document.aspectRatio).toBe(sourceRatio);
      expect(hook.result.current.notice).toBe('restore-reflow');
      expect(hook.result.current.canUndoRestore).toBe(true);
      expect(videoCoverV2.save).toHaveBeenLastCalledWith('first',
        expect.objectContaining({ aspectRatio: targetRatio, durationFrames: 75 }), 1);
      expect(videoCoverV2.publish).not.toHaveBeenCalled();
      expect(applyCoverTimelineAction).not.toHaveBeenCalled();
      await act(async () => { await hook.result.current.act('apply'); });
      expect(hook.renderer.current.render).toHaveBeenCalledWith(
        expect.objectContaining({ aspectRatio: targetRatio, durationFrames: 75 }),
        undefined);
      expect(applyCoverTimelineAction).toHaveBeenCalledWith(
        expect.objectContaining({ durationFrames: 75, revision:
          expect.objectContaining({ id: 'reflowed', document:
            expect.objectContaining({ aspectRatio: targetRatio }) }) }));
      if (targetRatio === '21:9') {
        expect(applyCoverTimelineAction).toHaveBeenCalledWith(
          expect.objectContaining({ revision: expect.objectContaining({
            width: 2560, height: 1080,
          }) }));
      }
    });

  it('历史背景解码10秒超时保留原稿并释放锁，迟到解码不能采用', async () => {
    const decoded = deferred<void>();
    vi.stubGlobal('Image', class { decode = () => decoded.promise; src = ''; });
    try {
      vi.mocked(videoCoverV2.get).mockResolvedValue({
        ...snapshot('first'), assets: [candidate],
      });
      const hook = setup(); await act(async () => {});
      const historical = revision();
      historical.document.background = { ...historical.document.background,
        kind: 'asset', assetId: candidate.assetId };
      vi.mocked(videoCoverV2.getRevision).mockResolvedValueOnce(historical)
        .mockResolvedValueOnce({ ...revision(), id: 'fallback',
          documentHash: 'fallback-hash' });
      let pending!: Promise<unknown>;
      await act(async () => { pending = hook.result.current.restoreRevision('history')
        .catch(error => error); });
      expect(hook.result.current.activity).toBe('restoring');
      await act(async () => { await vi.advanceTimersByTimeAsync(9999); });
      expect(hook.result.current.busy).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1); await pending;
      });
      expect(await pending).toMatchObject({ code: 'COVER_RENDER_FAILED' });
      expect(hook.result.current.busy).toBe(false);
      expect(hook.result.current.document?.fields.title).toBe('first');
      expect(hook.result.current.canUndoRestore).toBe(false);
      expect(hook.result.current.revisionEntries[0].backgroundStatus).toBe('unknown');
      expect(videoCoverV2.save).not.toHaveBeenCalled();
      await act(async () => { decoded.resolve(); });
      expect(hook.result.current.document?.fields.title).toBe('first');
      await act(async () => { await hook.result.current.restoreRevision('fallback'); });
      expect(hook.result.current.document?.fields.title).toBe('历史');
      expect(hook.result.current.busy).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });

  it('载入为草稿与撤销走CAS且下载不发布当前输入', async () => {
    const hook = setup(); await act(async () => {});
    vi.mocked(videoCoverV2.getRevision).mockResolvedValue(revision());
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await act(async () => { await hook.result.current.restoreRevision('history'); });
    expect(hook.result.current.document?.fields.title).toBe('历史');
    expect(hook.result.current.canUndoRestore).toBe(true);
    await act(async () => { await hook.result.current.undoRestore(); });
    expect(hook.result.current.document?.fields.title).toBe('first');
    const saves = vi.mocked(videoCoverV2.save).mock.calls.length;
    await act(async () => { await hook.result.current.downloadRevision('history'); });
    expect(videoCoverV2.save).toHaveBeenCalledTimes(saves);
    expect(videoCoverV2.publish).not.toHaveBeenCalled();
    expect(videoCoverV2.downloadUrl).toHaveBeenCalledWith('first', 'history');
  });

  it('载入保存期间新编辑使整文档撤销立即失效', async () => {
    const hook = setup(); await act(async () => {});
    vi.mocked(videoCoverV2.getRevision).mockResolvedValue(revision());
    const save = deferred<CoverSavedDraft>();
    vi.mocked(videoCoverV2.save).mockReturnValueOnce(save.promise);
    let pending!: Promise<void>;
    await act(async () => { pending = hook.result.current.restoreRevision('history'); });
    expect(hook.result.current.canUndoRestore).toBe(true);
    const restored = hook.result.current.document!;
    act(() => hook.result.current.update({ ...restored,
      fields: { ...restored.fields, title: '新输入' } }));
    expect(hook.result.current.canUndoRestore).toBe(false);
    await act(async () => {
      save.resolve({ document: restored, version: 2, documentHash: 'h2' });
      await pending; await hook.result.current.undoRestore();
    });
    expect(hook.result.current.document?.fields.title).toBe('新输入');
  });

  it('载入后保存失败保留新草稿和有效撤销，错误仍属于保存', async () => {
    const hook = setup(); await act(async () => {});
    vi.mocked(videoCoverV2.getRevision).mockResolvedValue(revision());
    vi.mocked(videoCoverV2.save).mockRejectedValueOnce(new Error('保存失败'));
    await act(async () => { await hook.result.current.restoreRevision('history')
      .catch(() => {}); });
    expect(hook.result.current.document?.fields.title).toBe('历史');
    expect(hook.result.current.canUndoRestore).toBe(true);
    expect(hook.result.current.saveState).toBe('unsaved');
    expect(hook.result.current.issue?.operation).toBe('save');
    await act(async () => { await hook.result.current.undoRestore(); });
    expect(hook.result.current.document?.fields.title).toBe('first');
  });

  it('模板撤销在开始上传时失效，不等待上传完成', async () => {
    const hook = setup(); await act(async () => {});
    act(() => hook.result.current.changeTemplate({ ...hook.result.current.document!,
      templateId: 'bold' }));
    expect(hook.result.current.canUndoTemplate).toBe(true);
    vi.mocked(videoCoverV2.uploadAsset).mockReturnValueOnce(new Promise(() => {}));
    act(() => { void hook.result.current.upload(new Blob()); });
    expect(hook.result.current.canUndoTemplate).toBe(false);
    await act(async () => { await hook.result.current.undoTemplate(); });
    expect(hook.result.current.document?.templateId).toBe('bold');
  });

  it('载入GET期间开始上传使载入失效，即使上传仍未完成', async () => {
    const hook = setup(); await act(async () => {});
    const read = deferred<CoverRevision>();
    vi.mocked(videoCoverV2.getRevision).mockReturnValueOnce(read.promise);
    vi.mocked(videoCoverV2.uploadAsset).mockReturnValueOnce(new Promise(() => {}));
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = hook.result.current.restoreRevision('history').catch(error => error);
    });
    act(() => { void hook.result.current.upload(new Blob()); });
    await act(async () => { read.resolve(revision()); await pending; });
    expect(hook.result.current.document?.fields.title).toBe('first');
    expect(hook.result.current.issue?.kind).toBe('operation-stale');
    expect(hook.result.current.busy).toBe(false);
  });

  it('项目清空后不保留上一项目草稿', async () => {
    const hook = setup(); await act(async () => {});
    hook.rerender({ projectId: undefined });
    expect(hook.result.current.document).toBeNull();
    await expect(hook.result.current.flush()).rejects.toMatchObject({
      code: 'COVER_PROJECT_CHANGED',
    });
  });

  it('旧项目取消失败经兼容catch也不能污染新项目', async () => {
    const hook = setup(); await act(async () => {});
    const cancelled = deferred<CoverJob>();
    vi.mocked(videoCoverV2.cancelJob).mockReturnValueOnce(cancelled.promise);
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.cancel('j').catch(error => {
      hook.result.current.setError(error);
    }); });
    hook.rerender({ projectId: 'second' }); await act(async () => {});
    await act(async () => { cancelled.reject(new Error('旧取消失败')); await pending; });
    expect(hook.result.current.error).toBeUndefined();
    expect(hook.result.current.issue).toBeUndefined();
  });

  it('初次加载失败后空草稿重载可恢复为可编辑的新文档', async () => {
    vi.mocked(videoCoverV2.get).mockRejectedValueOnce(new Error('断网'));
    const hook = setup(); await act(async () => {});
    vi.mocked(videoCoverV2.get).mockResolvedValueOnce({
      ...snapshot(), document: null, version: 0, documentHash: null,
    });
    await act(async () => { await hook.result.current.reload(); });
    expect(hook.result.current.document?.fields.title).toBe('项目');
    expect(hook.result.current.error).toBeUndefined();
    expect(hook.result.current.saveState).toBe('saved');
  });

  it('初始加载连续失败仍提供加载重试而非保存空草稿', async () => {
    vi.mocked(videoCoverV2.get)
      .mockRejectedValueOnce(new Error('首次断网'))
      .mockRejectedValueOnce(new Error('仍然断网'));
    const hook = setup(); await act(async () => {});
    await act(async () => {
      await hook.result.current.reload().catch(() => undefined);
    });
    expect(hook.result.current.issue?.actions).toEqual(['reload-initial', 'dismiss']);
    expect(hook.result.current.document).toBeNull();
    expect(videoCoverV2.save).not.toHaveBeenCalled();
    await act(async () => { await hook.result.current.reload(); });
    expect(hook.result.current.document?.fields.title).toBe('first');
    expect(hook.result.current.issue).toBeUndefined();
  });

  it('初始加载重试成功后恢复已有任务订阅而不自动采用旧结果', async () => {
    vi.mocked(videoCoverV2.get).mockRejectedValueOnce(new Error('断网'));
    const hook = setup(); await act(async () => {});
    const running: CoverJob = { jobId: '恢复中的任务', status: 'running',
      baseVersion: 1, assets: [] };
    vi.mocked(videoCoverV2.get).mockResolvedValueOnce({
      ...snapshot(), jobs: [running],
    });
    vi.mocked(videoCoverV2.getJob).mockResolvedValueOnce({
      ...running, status: 'succeeded', assets: [candidate],
    });
    await act(async () => { await hook.result.current.reload(); });
    expect(hook.result.current.jobs).toEqual([running]);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(videoCoverV2.getJob).toHaveBeenCalledWith('first', running.jobId,
      expect.any(AbortSignal));
    expect(hook.result.current.assets).toContainEqual(candidate);
    expect(hook.result.current.document?.background.assetId).toBeNull();
    expect(videoCoverV2.generate).not.toHaveBeenCalled();
    expect(applyCoverTimelineAction).not.toHaveBeenCalled();
  });

  it('旧项目导入完成不能重载并覆盖新项目的未保存输入', async () => {
    const hook = setup(); await act(async () => {});
    const imported = deferred<CoverSavedDraft>();
    vi.mocked(videoCoverV2.importLegacy).mockReturnValueOnce(imported.promise);
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.importLegacy(); });
    hook.rerender({ projectId: 'second' }); await act(async () => {});
    act(() => hook.result.current.update({ ...hook.result.current.document!,
      fields: { ...hook.result.current.document!.fields, title: '新项目未保存输入' } }));
    await act(async () => {
      imported.resolve({ document: snapshot().document!, version: 2,
        documentHash: 'h2' }); await pending;
    });
    expect(hook.result.current.document?.fields.title).toBe('新项目未保存输入');
    expect(videoCoverV2.get).toHaveBeenCalledTimes(2);
  });

  it('导入期间新增的本地输入不能被导入完成后的重载覆盖', async () => {
    const hook = setup(); await act(async () => {});
    const imported = deferred<CoverSavedDraft>();
    vi.mocked(videoCoverV2.importLegacy).mockReturnValueOnce(imported.promise);
    let pending!: Promise<unknown>;
    act(() => {
      pending = hook.result.current.importLegacy().catch(error => error);
    });
    act(() => hook.result.current.update({ ...hook.result.current.document!,
      fields: { ...hook.result.current.document!.fields, title: '导入中继续输入' } }));
    await act(async () => {
      imported.resolve({ document: snapshot().document!, version: 2,
        documentHash: 'h2' }); await pending;
    });
    expect(hook.result.current.document?.fields.title).toBe('导入中继续输入');
    expect(await pending).toMatchObject({ code: 'COVER_VERSION_CONFLICT' });
  });

  it('Agent渲染期间切项目后旧失败不污染新项目错误状态', async () => {
    const hook = setup(); await act(async () => {});
    const rendering = deferred<Blob>();
    hook.renderer.current.render.mockReturnValueOnce(rendering.promise);
    const notify = vi.fn();
    act(() => hook.result.current.bridge.beginOperation('call', 'tool', notify));
    let pending!: Promise<void> | void;
    await act(async () => {
      pending = hook.result.current.bridge.handleCoverOperation({
        type: 'cover_action', projectId: 'first', operationId: 'call',
        action: 'prepare_draft', draftVersion: 1, durationFrames: 30,
        applyWhenReady: true,
      }, notify);
    });
    expect(hook.renderer.current.render).toHaveBeenCalledTimes(1);
    hook.rerender({ projectId: 'second' }); await act(async () => {});
    await act(async () => { rendering.resolve(new Blob()); await pending; });
    expect(hook.result.current.error).toBeUndefined();
  });

  it('旧项目生成请求挂起不阻止新项目生成', async () => {
    const hook = setup(); await act(async () => {});
    const first = deferred<CoverJob>();
    const job: CoverJob = { jobId: 'j', baseVersion: 1,
      status: 'queued', assets: [] };
    vi.mocked(videoCoverV2.generate).mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ ...job, jobId: 'second-job' });
    let pending!: Promise<void>;
    await act(async () => { pending = hook.result.current.generate(); });
    hook.rerender({ projectId: 'second' }); await act(async () => {});
    await act(async () => { await hook.result.current.generate(); });
    expect(videoCoverV2.generate).toHaveBeenCalledTimes(2);
    await act(async () => { first.resolve(job); await pending; });
    expect(hook.result.current.jobs.map(value => value.jobId)).toEqual(['second-job']);
  });

  it('渲染期间切项目后不继续发布旧封面或污染新项目错误状态', async () => {
    const hook = setup(); await act(async () => {});
    const rendering = deferred<Blob>();
    hook.renderer.current.render.mockReturnValueOnce(rendering.promise);
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = hook.result.current.act('download').catch(error => error);
    });
    expect(hook.renderer.current.render).toHaveBeenCalledTimes(1);
    hook.rerender({ projectId: 'second' }); await act(async () => {});
    await act(async () => { rendering.resolve(new Blob()); await pending; });
    expect(videoCoverV2.publish).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBeUndefined();
    expect(hook.result.current.busy).toBe(false);
  });
  it('取消未知提交响应丢失后保留原ID，仍禁止新生成', async () => {
    const hook = setup(); await act(async () => {});
    vi.mocked(videoCoverV2.generate).mockRejectedValueOnce(new TypeError('lost'))
      .mockResolvedValueOnce({ ...completed, status: 'queued', assets: [] });
    await act(async () => { await hook.result.current.generate(); });
    const original = vi.mocked(videoCoverV2.generate).mock.calls[0];
    vi.mocked(videoCoverV2.cancelByRequest).mockRejectedValueOnce(new TypeError('lost cancel'));
    await act(async () => { await hook.result.current.cancelSubmission(); });
    expect(hook.result.current.hasUnknownSubmission).toBe(true);
    await act(async () => { await hook.result.current.generate(); });
    expect(videoCoverV2.generate).toHaveBeenCalledTimes(1);
    await act(async () => { await hook.result.current.resumeSubmission(); });
    expect(vi.mocked(videoCoverV2.generate).mock.calls[1]).toEqual(original);
  });

  it('Agent采用GET等待时开始上传，服务器文档不能先覆盖本地', async () => {
    const hook = setup(); await act(async () => {});
    const remote = deferred<CoverSnapshot>();
    const uploaded = deferred<typeof candidate>();
    vi.mocked(videoCoverV2.get).mockReturnValueOnce(remote.promise);
    vi.mocked(videoCoverV2.uploadAsset).mockReturnValueOnce(uploaded.promise);
    const notify = vi.fn();
    act(() => hook.result.current.bridge.beginOperation('guard', 'create_video_cover', notify));
    let operation!: Promise<void> | void;
    act(() => { operation = hook.result.current.bridge.handleCoverOperation({
      type: 'cover_action', projectId: 'first', operationId: 'guard',
      action: 'prepare_draft', draftVersion: 2, durationFrames: 30,
      applyWhenReady: true,
    }, notify); });
    let upload!: Promise<void>;
    act(() => { upload = hook.result.current.upload(new Blob()); });
    await act(async () => { remote.resolve(snapshot('不能采用的新远端标题', 2)); await operation; });
    expect(hook.result.current.document?.fields.title).toBe('first');
    expect(hook.renderer.current.render).not.toHaveBeenCalled();
    expect(applyCoverTimelineAction).not.toHaveBeenCalled();
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'not_applied' }));
    await act(async () => { uploaded.resolve(candidate); await upload; });
  });

  it('人工载入持锁时Agent完成只保留候选，不能越锁应用', async () => {
    const hook = setup(); await act(async () => {});
    const historical = { id: 'old', projectId: 'first',
      document: snapshot('历史标题').document!, documentHash: 'old-hash',
      assetId: 'png-old', url: '/api/storage/files/old.png',
      width: 1920, height: 1080, sha256: 'b'.repeat(64),
      createdAt: '2026-09-28T10:00:00Z' };
    const reading = deferred<typeof historical>();
    vi.mocked(videoCoverV2.getRevision).mockReturnValueOnce(reading.promise);
    let restoring!: Promise<void>;
    await act(async () => { restoring = hook.result.current.restoreRevision('old'); });
    const notify = vi.fn();
    act(() => hook.result.current.bridge.beginOperation('busy', 'create_video_cover', notify));
    vi.mocked(videoCoverV2.getJob).mockResolvedValueOnce(completed);
    await act(async () => hook.result.current.bridge.handleCoverOperation({
      type: 'cover_action', projectId: 'first', operationId: 'busy',
      action: 'watch_job', jobId: 'j', draftVersion: 1,
      durationFrames: 30, applyWhenReady: true,
    }, notify));
    expect(hook.result.current.assets).toContainEqual(candidate);
    expect(hook.result.current.activity).toBe('restoring');
    expect(hook.renderer.current.render).not.toHaveBeenCalled();
    expect(applyCoverTimelineAction).not.toHaveBeenCalled();
    await act(async () => { reading.resolve(historical); await restoring; });
    expect(hook.result.current.document?.fields.title).toBe('历史标题');
  });

  it('实时轨道引用404保留占位，手动恢复详情不修改草稿', async () => {
    const { useTimelineStore } = await import('../../timeline/store/useTimelineStore');
    const { ApiError } = await import('@/lib/api/http-client');
    const store = useTimelineStore.getState(); const previous = store.exportToData();
    const historical = { id: 'missing', projectId: 'first',
      document: snapshot('历史标题').document!, documentHash: 'old-hash',
      assetId: 'png-old', url: '/api/storage/files/old.png',
      width: 1920, height: 1080, sha256: 'b'.repeat(64),
      createdAt: '2026-09-28T10:00:00Z' };
    vi.mocked(videoCoverV2.getRevision).mockRejectedValueOnce(new ApiError(404,
      'COVER_ASSET_MISSING', 'missing')).mockResolvedValue(historical);
    vi.stubGlobal('Image', class { decode = async () => {}; src = ''; });
    try {
      store.initTimeline({ tracks: [{ id: 'cover', name: '封面', type: 'video',
        height: 56, order: 0, isLocked: false, isVisible: true,
        isMuted: false, volume: 100, items: [{ id: 'cover-clip', name: '封面',
          type: 'video', trackId: 'cover', startTime: 0, duration: 1,
          color: '#000000', metadata: { role: 'video-cover', cover: {
            schemaVersion: 2, projectId: 'first', revisionId: 'missing',
            assetId: 'png-old', sha256: 'b'.repeat(64),
          } } }] }] });
      const hook = setup(); await act(async () => {});
      expect(hook.result.current.revisionEntries[0]).toMatchObject({
        id: 'missing', metadataStatus: 'unavailable',
      });
      expect(hook.result.current.revisionEntries[0].revision).toBeUndefined();
      expect(hook.result.current.draftChanged).toBeUndefined();
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(videoCoverV2.getRevision).toHaveBeenCalledTimes(1);
      await act(async () => { await hook.result.current.retryRevision('missing'); });
      expect(hook.result.current.revisionEntries[0].revision?.id).toBe('missing');
      expect(hook.result.current.document?.fields.title).toBe('first');
      expect(videoCoverV2.save).not.toHaveBeenCalled();
      expect(applyCoverTimelineAction).not.toHaveBeenCalled();
      hook.unmount();
    } finally { store.importFromData(previous); vi.unstubAllGlobals(); }
  });
  it('R24 当前草稿下载连点仅发布下载一次且不触碰时间轴', async () => {
    const hook = setup(); await act(async () => {});
    const rendering = deferred<Blob>();
    hook.renderer.current.render.mockReturnValueOnce(rendering.promise);
    vi.mocked(videoCoverV2.publish).mockImplementation(async (projectId, draft) => ({
      ...revision(), id: 'downloaded-current', projectId, document: draft.document,
      documentHash: draft.documentHash,
    }));
    vi.mocked(videoCoverV2.downloadUrl).mockReturnValue('/current-download');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    let pending!: Promise<void>;
    await act(async () => { pending = hook.result.current.act('download'); });
    expect(hook.result.current.activity).toBe('downloading');
    await act(async () => { await hook.result.current.act('download'); });
    expect(hook.renderer.current.render).toHaveBeenCalledTimes(1);
    expect(videoCoverV2.publish).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    await act(async () => { rendering.resolve(new Blob()); await pending; });
    expect(videoCoverV2.publish).toHaveBeenCalledTimes(1);
    expect(videoCoverV2.publish).toHaveBeenCalledWith('first',
      expect.objectContaining({ version: 1, documentHash: 'h1',
        document: expect.objectContaining({ fields: expect.objectContaining({
          title: 'first' }) }) }), expect.any(Blob), expect.any(String));
    expect(videoCoverV2.downloadUrl).toHaveBeenCalledWith('first', 'downloaded-current');
    expect(click).toHaveBeenCalledTimes(1);
    expect(applyCoverTimelineAction).not.toHaveBeenCalled();
    expect(hook.result.current.activity).toBe('idle');
  });

  it('R25 生成等待草稿保存时改背景使旧生成失效且不POST', async () => {
    const hook = setup(); await act(async () => {});
    const firstSave = deferred<CoverSavedDraft>();
    const edited = { ...hook.result.current.document!, fields: {
      ...hook.result.current.document!.fields, title: '待保存标题' } };
    act(() => hook.result.current.update(edited));
    vi.mocked(videoCoverV2.save).mockReturnValueOnce(firstSave.promise);
    let generating!: Promise<void>;
    act(() => { generating = hook.result.current.generate(); });
    expect(videoCoverV2.save).toHaveBeenCalledTimes(1);
    let choosing!: ReturnType<typeof hook.result.current.selectAsset>;
    act(() => { choosing = hook.result.current.selectAsset(candidate); });
    expect(hook.result.current.document?.background.assetId).toBe(candidate.assetId);
    await act(async () => {
      firstSave.resolve({ document: edited, version: 2, documentHash: 'h2' });
      await generating; await choosing;
    });
    expect(videoCoverV2.generate).not.toHaveBeenCalled();
    expect(videoCoverV2.save).toHaveBeenCalledTimes(2);
    expect(videoCoverV2.save).toHaveBeenLastCalledWith('first',
      expect.objectContaining({ background: expect.objectContaining({
        assetId: candidate.assetId }), fields: expect.objectContaining({
        title: '待保存标题' }) }), 2);
    expect(hook.result.current.document?.background.assetId).toBe(candidate.assetId);
    expect(hook.result.current.hasUnknownSubmission).toBe(false);
    expect(hook.result.current.submittingGeneration).toBe(false);
  });

  it('R26 恢复CAS再次409后停止自动重试并释放屏障供下一次显式恢复', async () => {
    const hook = setup(); await act(async () => {});
    const local = { ...hook.result.current.document!, fields: {
      ...hook.result.current.document!.fields, title: '保留本地' } };
    act(() => hook.result.current.update(local));
    vi.mocked(videoCoverV2.save)
      .mockRejectedValueOnce(new ApiError(409, 'COVER_VERSION_CONFLICT', '首次冲突'))
      .mockRejectedValueOnce(new ApiError(409, 'COVER_VERSION_CONFLICT', '恢复又冲突'));
    await act(async () => { await hook.result.current.flush().catch(() => {}); });
    vi.mocked(videoCoverV2.get).mockResolvedValueOnce(snapshot('服务器8', 8));
    await act(async () => {
      await expect(hook.result.current.resolveConflict('local'))
        .rejects.toMatchObject({ status: 409, code: 'COVER_VERSION_CONFLICT' });
    });
    expect(videoCoverV2.get).toHaveBeenCalledTimes(2);
    expect(videoCoverV2.save).toHaveBeenCalledTimes(2);
    expect(videoCoverV2.save).toHaveBeenLastCalledWith('first', local, 8);
    expect(hook.result.current.document).toEqual(local);
    expect(hook.result.current.issue?.kind).toBe('draft-conflict');
    expect(hook.result.current.issue?.actions).toContain('use-local');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(videoCoverV2.get).toHaveBeenCalledTimes(2);
    expect(videoCoverV2.save).toHaveBeenCalledTimes(2);
    vi.mocked(videoCoverV2.get).mockResolvedValueOnce(snapshot('服务器9', 9));
    await act(async () => { await hook.result.current.resolveConflict('server'); });
    expect(videoCoverV2.get).toHaveBeenCalledTimes(3);
    expect(videoCoverV2.save).toHaveBeenCalledTimes(2);
    expect(hook.result.current.document?.fields.title).toBe('服务器9');
    expect(hook.result.current.issue).toBeUndefined();
  });

  it('R32 旧资源刷新失败不能覆盖较新资源错误', async () => {
    const hook = setup(); await act(async () => {});
    const old = deferred<CoverSnapshot>();
    vi.mocked(videoCoverV2.get).mockReturnValueOnce(old.promise)
      .mockRejectedValueOnce(new Error('设置返回后的新错误'));
    let pending!: Promise<unknown>;
    act(() => { pending = hook.result.current.refreshResources().catch(error => error); });
    await act(async () => { await hook.result.current.refreshResources().catch(() => {}); });
    const latestIssue = hook.result.current.issue;
    expect(latestIssue?.operation).toBe('resources');
    expect(latestIssue?.actions).toContain('refresh-resources');
    await act(async () => { old.reject(new Error('较旧请求失败')); await pending; });
    expect(hook.result.current.issue).toEqual(latestIssue);
    expect(hook.result.current.document?.fields.title).toBe('first');
    expect(videoCoverV2.save).not.toHaveBeenCalled();
  });

  it('R32 旧资源刷新失败不能撤销较新成功能力快照', async () => {
    const hook = setup(); await act(async () => {});
    const old = deferred<CoverSnapshot>();
    vi.mocked(videoCoverV2.get).mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ ...snapshot('设置返回'), generationConfigured: false });
    let pending!: Promise<unknown>;
    act(() => { pending = hook.result.current.refreshResources().catch(error => error); });
    await act(async () => { await hook.result.current.refreshResources(); });
    await act(async () => { old.reject(new Error('较旧请求失败')); await pending; });
    expect(hook.result.current.canGenerate).toBe(false);
    expect(hook.result.current.issue).toBeUndefined();
    expect(hook.result.current.document?.fields.title).toBe('first');
  });
});
