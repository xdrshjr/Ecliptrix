import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import { videoCoverV2 } from '@/lib/api/videoCoverV2';
import type { CoverJob, CoverSavedDraft, CoverSnapshot } from '@/types/videoCover';
import { applyCoverTimelineAction } from '../../timeline/store/actions/applyCover';
import { useCoverController } from '../useCoverController';
import { createCoverDocument } from '../templates';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations['zh-CN'] }),
}));
vi.mock('@/lib/api/videoCoverV2', () => ({ videoCoverV2: {
  get: vi.fn(), save: vi.fn(), generate: vi.fn(), importLegacy: vi.fn(),
  publish: vi.fn(), getJob: vi.fn(),
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
    jobs: [], appliedRevision: null, legacyAvailable: false };
}
function setup() {
  const renderer = { current: { render: vi.fn(async () => new Blob()) } };
  const hook = renderHook(({ projectId }: { projectId?: string }) =>
    useCoverController({ projectId, projectName: '项目', aspectRatio: '16:9',
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
  const candidate = { assetId: 'candidate', url: '/candidate.png',
    width: 1920, height: 1080, sha256: 'a'.repeat(64) };
  const completed: CoverJob = { jobId: 'j', baseVersion: 1,
    status: 'succeeded', assets: [candidate] };
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
    act(() => { reloading = hook.result.current.reload(); });
    expect(videoCoverV2.get).toHaveBeenCalledTimes(1);
    await act(async () => {
      save.resolve({ document: edited, version: 2, documentHash: 'h2' });
      await saving; await reloading;
    });
    expect(hook.result.current.document?.fields.title).toBe('最后输入');
  });

  it('重载读取期间保存推进版本时拒绝迟到的旧快照', async () => {
    const hook = setup(); await act(async () => {});
    const read = deferred<CoverSnapshot>();
    vi.mocked(videoCoverV2.get).mockReturnValueOnce(read.promise);
    let reloading!: Promise<unknown>;
    act(() => { reloading = hook.result.current.reload().catch(error => error); });
    const edited = { ...hook.result.current.document!, fields: {
      ...hook.result.current.document!.fields, title: '新输入' } };
    await act(async () => {
      hook.result.current.update(edited); await hook.result.current.flush();
      read.resolve(snapshot('旧输入')); await reloading;
    });
    expect(hook.result.current.document?.fields.title).toBe('新输入');
    expect(await reloading).toMatchObject({ code: 'COVER_VERSION_CONFLICT' });
  });

  it('项目清空后不保留上一项目草稿', async () => {
    const hook = setup(); await act(async () => {});
    hook.rerender({ projectId: undefined });
    expect(hook.result.current.document).toBeNull();
    await expect(hook.result.current.flush()).rejects.toMatchObject({
      code: 'COVER_PROJECT_CHANGED',
    });
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
});
