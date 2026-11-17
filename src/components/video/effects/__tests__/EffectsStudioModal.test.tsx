import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/http-client';
import { createEffectDocument } from '@/lib/effects/catalog';
import type { EffectDocument, EffectDraft } from '@/types/effects';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { useEffectsDraft } from '../useEffectsDraft';
import { useEffectsController } from '../useEffectsController';
import { EffectsStudioModal } from '../EffectsStudioModal';
import { effectsFixture } from './effectsFixture';
import { planEffectsTimelineChange } from '../effectsTimeline';
import { useTimelineStore } from '../../timeline/store/useTimelineStore';

const api = vi.hoisted(() => ({ saveEffectDraft: vi.fn(),
  getEffectCapabilities: vi.fn(), listEffectJobs: vi.fn(),
  listEffectDrafts: vi.fn(), getEffectDraft: vi.fn(),
  getEffectAsset: vi.fn(), getEffectJob: vi.fn(), cancelEffectJob: vi.fn(),
  attachEffectInput: vi.fn(), submitEffectJob: vi.fn() }));
vi.mock('@/lib/api/effects', () => api);
vi.mock('next/dynamic', () => ({ default: () => () =>
  React.createElement('div', { 'data-testid': 'preview' }) }));

function saved(document: EffectDocument, version = 1): EffectDraft {
  return { id: 'd', projectId: 'p', name: 'Draft', version, document,
    documentHash: 'hash', createdAt: '', updatedAt: '', readOnly: false,
    renderability: { ready: Boolean(document.content.title), errors: [] } };
}
beforeEach(() => {
  vi.clearAllMocks();
  api.saveEffectDraft.mockImplementation(options => Promise.resolve(
    saved(options.document, (options.expectedVersion ?? 0) + 1)));
  api.getEffectCapabilities.mockResolvedValue({ ready: true });
  api.listEffectDrafts.mockResolvedValue([]);
  api.listEffectJobs.mockResolvedValue({ items: [] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('工作台草稿的串行保存与关闭', () => {
  it('重新选择已应用的同一成品，再次替换为无副作用操作', async () => {
    const fixture = effectsFixture();
    const applied = planEffectsTimelineChange(fixture);
    const store = useTimelineStore.getState();
    store.setExternalEditLock(null);
    store.initTimeline(applied.timeline); store.clearHistory();
    store.selectItem('clip');
    api.attachEffectInput.mockResolvedValue({ ...fixture.asset,
      id: 'output-snapshot', kind: 'input-video' });
    const registerMaterial = vi.fn();
    const hook = renderHook(() => useEffectsController({ projectId: 'p',
      materials: [], registerMaterial }), { wrapper: LocaleProvider });
    await act(async () => { await hook.result.current.reselect(); });
    const before = store.exportToData();
    await act(async () => {
      await hook.result.current.apply(fixture.asset, 'replace');
    });
    expect(hook.result.current.error).toBeUndefined();
    expect(useTimelineStore.getState().exportToData()).toEqual(before);
    expect(registerMaterial).not.toHaveBeenCalled();
    expect(useTimelineStore.getState().canUndo).toBe(false);
  });

  it('提交返回前关闭再打开，仍跟踪当前项目的任务', async () => {
    const hook = renderHook(() => useEffectsController({ projectId: 'p',
      materials: [], registerMaterial: vi.fn() }), { wrapper: LocaleProvider });
    await act(async () => { await hook.result.current.open({ newDraft: true }); });
    act(() => hook.result.current.draft.edit({ name: 'Draft', document: {
      ...hook.result.current.draft.document,
      content: { title: '标题', subtitle: '' } } }));
    let resolveJob!: (job: unknown) => void;
    api.submitEffectJob.mockImplementationOnce(() => new Promise(done => {
      resolveJob = done;
    }));
    let submission!: Promise<void>;
    await act(async () => {
      submission = hook.result.current.render(); await Promise.resolve();
    });
    act(() => hook.result.current.close());
    await act(async () => {
      await hook.result.current.open({ newDraft: true });
      resolveJob({ id: 'late-job', projectId: 'p', status: 'queued' });
      await submission;
    });
    expect(hook.result.current.jobs.jobs).toEqual([
      expect.objectContaining({ id: 'late-job' }),
    ]);
  });

  it('切换项目后不领取旧项目迟到的提交结果', async () => {
    const hook = renderHook(({ projectId }) => useEffectsController({ projectId,
      materials: [], registerMaterial: vi.fn() }), {
      initialProps: { projectId: 'p' }, wrapper: LocaleProvider,
    });
    await act(async () => { await hook.result.current.open({ newDraft: true }); });
    act(() => hook.result.current.draft.edit({ name: 'Draft', document: {
      ...hook.result.current.draft.document,
      content: { title: '标题', subtitle: '' } } }));
    let resolveJob!: (job: unknown) => void;
    api.submitEffectJob.mockImplementationOnce(() => new Promise(done => {
      resolveJob = done;
    }));
    let submission!: Promise<void>;
    await act(async () => {
      submission = hook.result.current.render(); await Promise.resolve();
    });
    hook.rerender({ projectId: 'other-project' });
    await act(async () => {
      resolveJob({ id: 'old-job', projectId: 'p', status: 'queued' });
      await submission;
    });
    expect(hook.result.current.jobs.jobs).toEqual([]);
  });

  it('关闭重开和切换入口后应用模式按当前目标重置', async () => {
    const hook = renderHook(() => useEffectsController({ projectId: 'p',
      materials: [], registerMaterial: vi.fn() }), { wrapper: LocaleProvider });
    await act(async () => { await hook.result.current.open({ newDraft: true }); });
    const target = { projectId: 'p', trackId: 'track', clipId: 'clip',
      sourceMaterialId: 'source', targetFingerprint: 'fingerprint',
      durationSeconds: 5 };
    const modal = (isOpen: boolean, hasTarget: boolean) =>
      React.createElement(LocaleProvider, null,
        React.createElement(EffectsStudioModal, {
          controller: { ...hook.result.current, isOpen,
            target: hasTarget ? target : undefined }, materials: [],
        }));
    const view = render(modal(true, true));
    const mode = () => screen.getByRole('combobox', {
      name: 'Insert on a new video track',
    }) as HTMLSelectElement;
    expect(mode().value).toBe('replace');
    fireEvent.change(mode(), { target: { value: 'insert' } });
    view.rerender(modal(false, true));
    view.rerender(modal(true, true));
    expect(mode().value).toBe('replace');
    fireEvent.change(mode(), { target: { value: 'replace' } });
    view.rerender(modal(true, false));
    expect(mode().value).toBe('insert');
  });

  it('提交尚未返回时重复生成只创建一个 requestId', async () => {
    const hook = renderHook(() => useEffectsController({ projectId: 'p',
      materials: [], registerMaterial: vi.fn() }), { wrapper: LocaleProvider });
    await act(async () => { await hook.result.current.open({ newDraft: true }); });
    act(() => hook.result.current.draft.edit({ name: 'Draft', document: {
      ...hook.result.current.draft.document, content: { title: '标题', subtitle: '' } } }));
    let resolveJob!: (job: unknown) => void;
    api.submitEffectJob.mockImplementationOnce(() => new Promise(done => { resolveJob = done; }));
    let first!: Promise<void>;
    await act(async () => { first = hook.result.current.render(); await Promise.resolve(); });
    await act(async () => { await hook.result.current.render(); });
    expect(api.submitEffectJob).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveJob({ id: 'j', projectId: 'p', status: 'queued' }); await first;
    });
  });

  it('500ms保存未完成草稿，未到时间不发请求', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useEffectsDraft('p', true));
    act(() => result.current.load({ document: createEffectDocument(), name: 'Draft' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(499); });
    expect(api.saveEffectDraft).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(api.saveEffectDraft).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('saved');
  });

  it('保存期间继续编辑，flush等待最新文案且使用确认后的版本', async () => {
    const initial = createEffectDocument();
    initial.content.title = 'initial';
    let complete!: (draft: EffectDraft) => void;
    api.saveEffectDraft.mockImplementationOnce(() => new Promise(done => { complete = done; }));
    const { result } = renderHook(() => useEffectsDraft('p', false));
    act(() => result.current.load({ document: initial, name: 'Draft' }));
    let first!: Promise<EffectDraft | undefined>;
    await act(async () => { first = result.current.save(); await Promise.resolve(); });
    const latest = { ...initial, content: { ...initial.content, title: 'latest' } };
    act(() => result.current.edit({ document: latest, name: 'Draft' }));
    await act(async () => {
      const flush = result.current.flush(); complete(saved(initial));
      await first; await flush;
    });
    expect(api.saveEffectDraft).toHaveBeenCalledTimes(2);
    expect(api.saveEffectDraft.mock.calls[1][0]).toMatchObject({ expectedVersion: 1,
      document: { content: { title: 'latest' } } });
    expect(result.current.draft?.version).toBe(2);
    expect(result.current.dirty).toBe(false);
  });

  it('409后继续输入也不覆盖服务器，另存才重新允许保存', async () => {
    api.saveEffectDraft.mockRejectedValueOnce(new ApiError(409,
      'EFFECT_VERSION_CONFLICT', 'conflict'));
    const { result } = renderHook(() => useEffectsDraft('p', false));
    act(() => result.current.load({ document: createEffectDocument(), name: 'Draft' }));
    await act(async () => { await expect(result.current.flush()).rejects.toThrow(); });
    act(() => result.current.edit({ name: 'changed', document: createEffectDocument() }));
    await expect(result.current.save()).rejects.toThrow('EFFECT_VERSION_CONFLICT');
    expect(api.saveEffectDraft).toHaveBeenCalledTimes(1);
    act(() => result.current.load(result.current.getCurrent()));
    await act(async () => { await result.current.flush(); });
    expect(api.saveEffectDraft.mock.calls[1][0].draftId).toBeUndefined();
  });

  it('保存冲突后重新加载会读取服务器版本并恢复编辑', async () => {
    const original = createEffectDocument(); original.content.title = '原稿';
    api.listEffectDrafts.mockResolvedValue([{ id: 'd', name: 'Draft', version: 1 }]);
    api.getEffectDraft.mockResolvedValue(saved(original));
    const hook = renderHook(() => useEffectsController({ projectId: 'p',
      materials: [], registerMaterial: vi.fn() }), { wrapper: LocaleProvider });
    await act(async () => { await hook.result.current.open({ draftId: 'd' }); });
    act(() => hook.result.current.draft.edit({ name: 'Draft', document: {
      ...original, content: { title: '本地修改', subtitle: '' } } }));
    api.saveEffectDraft.mockRejectedValueOnce(new ApiError(409,
      'EFFECT_VERSION_CONFLICT', 'conflict'));
    await act(async () => {
      await expect(hook.result.current.draft.flush()).rejects.toThrow();
    });
    const updated = { ...original, content: { title: '服务器版本', subtitle: '' } };
    api.getEffectDraft.mockResolvedValue(saved(updated, 2));
    render(React.createElement(LocaleProvider, null,
      React.createElement(EffectsStudioModal, { controller: hook.result.current,
        materials: [] })));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Load server version' }));
    });
    expect(api.getEffectDraft).toHaveBeenCalledTimes(2);
    expect(hook.result.current.draft.document.content.title).toBe('服务器版本');
    expect(hook.result.current.draft.status).toBe('saved');
  });

  it('有未保存内容时关闭先显示保存选择，保存成功才关闭', async () => {
    const hook = renderHook(() => useEffectsController({ projectId: 'p',
      materials: [], registerMaterial: vi.fn() }), { wrapper: LocaleProvider });
    await act(async () => { await hook.result.current.open({ newDraft: true }); });
    render(React.createElement(LocaleProvider, null,
      React.createElement(EffectsStudioModal, { controller: hook.result.current,
        materials: [] })));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save and close' }));
    });
    expect(hook.result.current.isOpen).toBe(false);
  });
});
