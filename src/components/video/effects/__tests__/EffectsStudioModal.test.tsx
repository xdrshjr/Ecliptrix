import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/http-client';
import { createEffectDocument } from '@/lib/effects/catalog';
import type { EffectAsset, EffectDocument, EffectDraft } from '@/types/effects';
import type { MaterialItem } from '@/types';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { useEffectsDraft } from '../useEffectsDraft';
import { useEffectsController } from '../useEffectsController';
import { EffectsStudioModal } from '../EffectsStudioModal';
import { EffectsInspector } from '../EffectsInspector';
import { effectsFixture } from './effectsFixture';
import { planEffectsTimelineChange } from '../effectsTimeline';
import { useTimelineStore } from '../../timeline/store/useTimelineStore';
import { acquireEffectEditor, readPending, writePending } from '@/lib/effects/pendingWrites';

const api = vi.hoisted(() => ({ saveEffectDraft: vi.fn(),
  getEffectCapabilities: vi.fn(), listEffectJobs: vi.fn(),
  listEffectDrafts: vi.fn(), listEffectDraftPage: vi.fn(), getEffectDraft: vi.fn(),
  getEffectAsset: vi.fn(), getEffectJob: vi.fn(), cancelEffectJob: vi.fn(),
  attachEffectInput: vi.fn(), submitEffectJob: vi.fn(), getEffectJobByRequest: vi.fn() }));
vi.mock('@/lib/api/effects', () => api);
vi.mock('next/dynamic', () => ({ default: () => () =>
  React.createElement('div', { 'data-testid': 'preview' }) }));

function saved(document: EffectDocument, version = 1): EffectDraft {
  return { id: '0e931a68-f0a1-4abd-b530-23a377620ce7', projectId: 'p', name: 'Draft', version, document,
    documentHash: 'hash', createdAt: '', updatedAt: '', readOnly: false,
    renderability: { ready: Boolean(document.content.title), errors: [] } };
}
beforeEach(() => {
  vi.clearAllMocks();
  const held = new Set<string>();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: async (name: string, options: { ifAvailable?: boolean },
      callback: (lock: object | null) => unknown) => {
      if (options.ifAvailable && held.has(name)) return callback(null);
      held.add(name);
      try { return await callback({}); } finally { held.delete(name); }
    },
  } });
  api.saveEffectDraft.mockImplementation(({ write }) => Promise.resolve({
    ...saved(write.document,
      write.kind === 'update' ? write.expectedVersion + 1 : 1),
    id: write.draftId, name: write.name }));
  api.getEffectCapabilities.mockResolvedValue({ ready: true });
  api.listEffectDrafts.mockResolvedValue([]);
  api.listEffectDraftPage.mockImplementation(async () => ({ items: await api.listEffectDrafts() }));
  api.listEffectJobs.mockResolvedValue({ items: [] });
  api.getEffectJobByRequest.mockRejectedValue(new ApiError(404,
    'EFFECT_NOT_FOUND', 'missing'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('逐键编辑只提交一次，保存新时长失败时不生成旧版本', async () => {
  const record = saved(createEffectDocument('countdown-ring'));
  api.getEffectDraft.mockResolvedValue(record);
  const hook = renderHook(() => useEffectsController({ projectId: 'p',
    materials: [], registerMaterial: vi.fn() }), { wrapper: LocaleProvider });
  await act(async () => { await hook.result.current.open({ draftId: record.id }); });
  const modal = () => <LocaleProvider><EffectsStudioModal controller={hook.result.current}
    materials={[]} /></LocaleProvider>;
  const view = render(modal());
  const duration = screen.getByRole('spinbutton', { name: 'Duration (seconds)' });
  fireEvent.change(duration, { target: { value: '0' } });
  expect(hook.result.current.draft.dirty).toBe(false);
  view.rerender(modal());
  expect(duration).toHaveValue(0);
  fireEvent.change(duration, { target: { value: '0.8' } });
  fireEvent.keyDown(duration, { key: 'Enter' });
  view.rerender(modal());
  fireEvent.blur(duration);
  expect(hook.result.current.draft.document.durationFrames).toBe(24);
  api.saveEffectDraft.mockRejectedValueOnce(new ApiError(422, 'EFFECT_INVALID_ARGUMENT', '保存失败'));
  await act(async () => { await hook.result.current.render(); });
  expect(api.submitEffectJob).not.toHaveBeenCalled();
  expect(hook.result.current.draft.status).toBe('error');
  act(() => hook.result.current.draft.undo());
  expect(hook.result.current.draft.document.durationFrames).toBe(150);
  expect(hook.result.current.draft.canUndo).toBe(false);
});

it('编辑时长时按 Esc 仍可在关闭前保存最后输入的值', async () => {
  const record = saved(createEffectDocument('countdown-ring'));
  api.getEffectDraft.mockResolvedValue(record);
  const hook = renderHook(() => useEffectsController({ projectId: 'p',
    materials: [], registerMaterial: vi.fn() }), { wrapper: LocaleProvider });
  await act(async () => { await hook.result.current.open({ draftId: record.id }); });
  render(<LocaleProvider><EffectsStudioModal controller={hook.result.current}
    materials={[]} /></LocaleProvider>);
  const duration = screen.getByRole('spinbutton', { name: 'Duration (seconds)' });
  duration.focus();
  fireEvent.change(duration, { target: { value: '0.8' } });
  await act(async () => { fireEvent.keyDown(duration, { key: 'Escape' }); });
  expect(screen.queryByRole('alertdialog')).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save and close' }));
  });
  expect(api.saveEffectDraft).toHaveBeenCalledTimes(1);
  expect(api.saveEffectDraft.mock.calls[0][0].write.document.durationFrames).toBe(24);
  expect(hook.result.current.isOpen).toBe(false);
});

it('同值草稿、模板与时长锁切换时清除未提交输入，数组项按失焦提交', async () => {
  const record = saved(createEffectDocument('countdown-ring'));
  api.getEffectDraft.mockResolvedValue(record);
  const hook = renderHook(() => useEffectsController({ projectId: 'p',
    materials: [], registerMaterial: vi.fn() }), { wrapper: LocaleProvider });
  await act(async () => { await hook.result.current.open({ draftId: record.id }); });
  const inspector = (lockSource = false) => <LocaleProvider><EffectsInspector
    controller={hook.result.current} materials={[]} lockSource={lockSource} /></LocaleProvider>;
  const view = render(inspector());
  const duration = () => screen.getByRole('spinbutton', { name: 'Duration (seconds)' });
  const typeZero = () => fireEvent.change(duration(), { target: { value: '0' } });
  typeZero();
  const next = { ...record, id: crypto.randomUUID() };
  act(() => hook.result.current.draft.load(next, next));
  view.rerender(inspector());
  expect(duration()).toHaveValue(5);
  typeZero();
  act(() => hook.result.current.selectTemplate('counter-bars'));
  view.rerender(inspector());
  expect(duration()).toHaveValue(5);
  const bar = screen.getByRole('spinbutton', { name: 'Bar values 1' });
  fireEvent.change(bar, { target: { value: '19.5' } });
  fireEvent.blur(bar);
  expect(hook.result.current.draft.document.params.bars).toEqual([19.5, 60, 90]);
  typeZero();
  view.rerender(inspector(true));
  expect(duration()).toBeDisabled();
  expect(duration()).toHaveValue(5);
  view.rerender(inspector());
  typeZero();
  act(() => hook.result.current.draft.load(next, { ...next, readOnly: true }));
  view.rerender(inspector());
  expect(duration()).toBeDisabled();
  expect(duration()).toHaveValue(5);
});

it('柱形草稿只展示三列数值，编辑和撤销模板切换后保留旧参数', async () => {
  const document = createEffectDocument('counter-bars');
  document.params = { value: 777, suffix: 'kg', bars: [30, 60, 90] };
  const record = saved(document);
  api.getEffectDraft.mockResolvedValue(record);
  const hook = renderHook(() => useEffectsController({ projectId: record.projectId,
    materials: [], registerMaterial: vi.fn() }), { wrapper: LocaleProvider });
  await act(async () => { await hook.result.current.open({ draftId: record.id }); });
  const inspector = () => <LocaleProvider><EffectsInspector controller={hook.result.current}
    materials={[]} lockSource={false} /></LocaleProvider>;
  const view = render(inspector());
  const finalValue = () => screen.queryByRole('spinbutton', { name: 'Final value' });
  const suffix = () => screen.queryByRole('textbox', { name: 'Suffix' });
  const bars = () => screen.queryAllByRole('spinbutton', { name: /Bar values/ });
  expect(finalValue()).toBeNull();
  expect(suffix()).toBeNull();
  expect(bars()).toHaveLength(3);
  fireEvent.change(bars()[0], { target: { value: '75' } });
  fireEvent.blur(bars()[0]);
  await act(async () => { await hook.result.current.draft.flush(); });
  const edited = { ...document.params, bars: [75, 60, 90] };
  expect(api.saveEffectDraft.mock.lastCall?.[0].write.document.params).toEqual(edited);
  act(() => hook.result.current.selectTemplate('counter-up'));
  view.rerender(inspector());
  expect(bars()).toHaveLength(0);
  expect(finalValue()).toHaveValue(100);
  expect(suffix()).toHaveValue('');
  act(() => hook.result.current.draft.undo());
  view.rerender(inspector());
  expect(finalValue()).toBeNull();
  expect(suffix()).toBeNull();
  expect(bars()[0]).toHaveValue(75);
  expect(hook.result.current.draft.document.params).toEqual(edited);
});

it.each([
  ['counter-bars', 'value', -1, 'Final value', 100],
  ['counter-bars', 'suffix', '123456789', 'Suffix', ''],
  ['counter-up', 'bars', [10, 20], 'Bar values', [30, 60, 90]],
] as const)('旧草稿 %s 的隐藏参数 %s 允许显式修正和撤销', async (id, key, invalid, label, expected) => {
  const document = createEffectDocument(id);
  document.params = { value: 777, suffix: 'kg', bars: [75, 60, 90] };
  const record = saved(document);
  const working = structuredClone(document);
  working.params[key] = typeof invalid === 'object' ? [...invalid] : invalid;
  await writePending(record.projectId, 'save', { schemaVersion: 1, projectId: record.projectId,
    draftId: record.id, recordRevision: 1, baseVersion: record.version,
    working: { name: record.name, document: working }, createdAt: new Date().toISOString(),
  }, { kind: 'absent' });
  api.getEffectDraft.mockResolvedValueOnce(record);
  const hook = renderHook(() => useEffectsController({ projectId: record.projectId,
    materials: [], registerMaterial: vi.fn() }), { wrapper: LocaleProvider });
  await act(async () => { await hook.result.current.open(); });
  const inspector = (editable: boolean) => <LocaleProvider><EffectsInspector
    controller={{ ...hook.result.current, isEditor: editable }} materials={[]} lockSource={false} /></LocaleProvider>;
  const view = render(inspector(false));
  const recovery = () => screen.queryByRole('button', { name: `Restore the default for “${label}”` });
  expect(screen.getByRole('status')).toHaveTextContent(label);
  expect(recovery()).toBeDisabled();
  expect(hook.result.current.draft.document.params).toEqual(working.params);
  view.rerender(inspector(true));
  fireEvent.click(recovery()!);
  view.rerender(inspector(true));
  expect(recovery()).toBeNull();
  const repaired = { ...working.params, [key]: expected };
  expect(hook.result.current.draft.document.params).toEqual(repaired);
  act(() => hook.result.current.draft.undo());
  view.rerender(inspector(true));
  expect(recovery()).toBeEnabled();
  expect(hook.result.current.draft.document.params[key]).toEqual(invalid);
  fireEvent.click(recovery()!);
  await act(async () => { await hook.result.current.draft.flush(); });
  expect(api.saveEffectDraft.mock.lastCall?.[0].write).toMatchObject({
    draftId: record.id, expectedVersion: record.version, document: { params: repaired },
  });
});

it('does_not_wait_for_directory_to_open_explicit_draft', async () => {
  api.listEffectDraftPage.mockReturnValue(new Promise(() => {}));
  const document = createEffectDocument(); document.content.title = 'Explicit';
  api.getEffectDraft.mockResolvedValue(saved(document));
  const hook = renderHook(() => useEffectsController({ projectId: 'p-explicit',
    materials: [], registerMaterial: vi.fn() }), { wrapper: LocaleProvider });
  await act(async () => { await hook.result.current.open({ draftId: saved(document).id }); });
  expect(hook.result.current.busy).toBe(false);
  expect(hook.result.current.draft.document.content.title).toBe('Explicit');
  expect(hook.result.current.draftList.loading).toBe(true);
});

it('keeps_selected_draft_outside_first_page', async () => {
  const id = crypto.randomUUID();
  const document = createEffectDocument(); document.content.title = 'Oldest';
  const record = { ...saved(document), id, projectId: 'p-selected' };
  api.listEffectDraftPage.mockResolvedValue({ items: [{ id: 'newest', name: 'New', version: 1 }] });
  api.getEffectDraft.mockResolvedValue(record);
  const hook = renderHook(() => useEffectsController({ projectId: 'p-selected',
    materials: [], registerMaterial: vi.fn() }), { wrapper: LocaleProvider });
  await act(async () => { await hook.result.current.open({ draftId: id }); });
  const view = render(<LocaleProvider><EffectsStudioModal controller={hook.result.current} materials={[]} /></LocaleProvider>);
  const select = screen.getByRole('combobox', { name: /Saved drafts|已保存草稿/ });
  expect(select).toHaveValue(id);
  await act(async () => { await hook.result.current.draftList.refresh(); });
  view.rerender(<LocaleProvider><EffectsStudioModal controller={hook.result.current} materials={[]} /></LocaleProvider>);
  expect(select).toHaveValue(id);
  await act(async () => { await hook.result.current.close(); await hook.result.current.open(); });
  expect(hook.result.current.draft.draft?.id).toBe(id);
  expect(api.saveEffectDraft).not.toHaveBeenCalled();
});

it('第13草稿可选择，加载末页后焦点返回select，隐藏副标题保留原值', async () => {
  const ids = Array.from({ length: 13 }, () => crypto.randomUUID());
  api.listEffectDraftPage.mockResolvedValueOnce({ items: ids.slice(0, 12).map((id, index) => ({ id, name: `Draft ${index}`, version: 1 })), nextCursor: 'second' })
    .mockResolvedValue({ items: [{ id: ids[12], name: 'Oldest', version: 1 }] });
  const document = createEffectDocument('type-lines'); document.content.title = 'Oldest'; document.content.subtitle = 'Hidden';
  api.getEffectDraft.mockImplementation(async (_project, id) => ({ ...saved(document), id, projectId: 'p-thirteen' }));
  const hook = renderHook(() => useEffectsController({ projectId: 'p-thirteen', materials: [], registerMaterial: vi.fn() }), { wrapper: LocaleProvider });
  await act(async () => { await hook.result.current.open({ draftId: ids[0] }); });
  const view = render(<LocaleProvider><EffectsStudioModal controller={hook.result.current} materials={[]} /></LocaleProvider>);
  const more = screen.getByRole('button', { name: /Load more drafts|加载更多草稿/ });
  more.focus(); await act(async () => { fireEvent.click(more); });
  view.rerender(<LocaleProvider><EffectsStudioModal controller={hook.result.current} materials={[]} /></LocaleProvider>);
  const select = screen.getByRole('combobox', { name: /Saved drafts|已保存草稿/ });
  expect(select).toHaveFocus();
  await act(async () => { fireEvent.change(select, { target: { value: ids[12] } }); });
  expect(hook.result.current.draft.draft?.id).toBe(ids[12]);
  expect(hook.result.current.draft.document.content.subtitle).toBe('Hidden');
  expect(screen.getAllByRole('textbox').filter(node => node.tagName === 'TEXTAREA')).toHaveLength(1);
});

describe('工作台草稿的串行保存与关闭', () => {
  it('首次创建丢回包后保留冻结体与新文案，重挂载仅确认旧体再PUT最新文案', async () => {
    const document = createEffectDocument(); document.content.title = '首次';
    const first = renderHook(() => useEffectsDraft('p', false));
    act(() => first.result.current.load({ name: 'Draft', document }));
    api.saveEffectDraft.mockRejectedValueOnce(new Error('lost response'));
    await act(async () => { await expect(first.result.current.flush()).rejects.toThrow(); });
    const original = api.saveEffectDraft.mock.calls[0][0].write;
    act(() => first.result.current.edit({ name: 'Draft', document: {
      ...document, content: { title: '稍后的输入', subtitle: '' } } }));
    await act(async () => { await first.result.current.persistWorking(); });
    expect((await readPending('p', 'save')).record?.pendingWrite)
      .toEqual(original);
    first.unmount();
    api.getEffectDraft.mockResolvedValue({ ...saved(document), id: original.draftId });
    const second = renderHook(() => useEffectsDraft('p', false));
    await act(async () => { await second.result.current.restore(); });
    expect(second.result.current.document.content.title).toBe('稍后的输入');
    await act(async () => { await second.result.current.flush(); });
    expect(api.saveEffectDraft.mock.calls[1][0].write).toMatchObject({
      kind: 'update', expectedVersion: 1, draftId: original.draftId,
      document: { content: { title: '稍后的输入' } } });
    expect((await readPending('p', 'save')).record).toBeUndefined();
  });
  it('不保存关闭只保留已发送的写入，不恢复明确丢弃的后续输入', async () => {
    const document = createEffectDocument(); document.content.title = '已发送';
    const first = renderHook(() => useEffectsDraft('p', false));
    act(() => first.result.current.load({ name: 'Draft', document }));
    api.saveEffectDraft.mockRejectedValueOnce(new Error('lost response'));
    await act(async () => { await expect(first.result.current.flush()).rejects.toThrow(); });
    const original = api.saveEffectDraft.mock.calls[0][0].write;
    act(() => first.result.current.edit({ name: 'Draft', document: {
      ...document, content: { title: '丢弃的文字', subtitle: '' } } }));
    await act(async () => {
      await first.result.current.discard();
      await first.result.current.persistWorking();
    });
    expect((await readPending('p', 'save')).record?.working).toBeUndefined();
    first.unmount();
    api.getEffectDraft.mockResolvedValue({ ...saved(document), id: original.draftId });
    const second = renderHook(() => useEffectsDraft('p', false));
    await act(async () => { await second.result.current.restore(); });
    expect(second.result.current.document.content.title).toBe('已发送');
    expect(second.result.current.dirty).toBe(false);
    expect(api.saveEffectDraft).toHaveBeenCalledTimes(1);
  });
  it('working-only恢复保留超长文案及缺失素材绑定，不恢复旧时间线目标授权', async () => {
    const document = createEffectDocument();
    document.content.title = '字'.repeat(200);
    document.inputs = [{ slot: 'base', assetId: crypto.randomUUID(),
      kind: 'image', fit: 'cover', focalX: 0.5, focalY: 0.5 }];
    const draftId = crypto.randomUUID();
    await writePending('p', 'save', { schemaVersion: 1, projectId: 'p', draftId,
      recordRevision: 1, baseVersion: null, working: { name: 'Draft', document },
      createdAt: new Date().toISOString() }, { kind: 'absent' });
    api.getEffectDraft.mockRejectedValue(new ApiError(404, 'EFFECT_NOT_FOUND', 'missing'));
    api.getEffectAsset.mockRejectedValue(new ApiError(404, 'EFFECT_NOT_FOUND', 'missing'));
    const hook = renderHook(() => useEffectsController({ projectId: 'p',
      materials: [], registerMaterial: vi.fn() }), { wrapper: LocaleProvider });
    await act(async () => { await hook.result.current.open(); });
    expect(hook.result.current.draft.document).toEqual(document);
    expect(hook.result.current.draft.getId()).toBe(draftId);
    expect(hook.result.current.assets).toEqual([]);
    expect(hook.result.current.target).toBeUndefined();
    expect(api.getEffectAsset).toHaveBeenCalledWith('p', document.inputs[0].assetId);
    expect(api.saveEffectDraft).not.toHaveBeenCalled();
  });
  it('丢失编辑租约后的保存回包不交付或续写', async () => {
    let epoch = 1;
    const document = createEffectDocument(); document.content.title = '初稿';
    let release!: (draft: EffectDraft) => void;
    api.saveEffectDraft.mockImplementationOnce(() => new Promise(done => { release = done; }));
    const hook = renderHook(() => useEffectsDraft('p', false, () => true, () => epoch));
    act(() => hook.result.current.load({ name: 'Draft', document }));
    let pending!: Promise<unknown>;
    await act(async () => { pending = hook.result.current.flush().catch(() => undefined); });
    epoch++;
    await act(async () => {
      release({ ...saved(document), id: api.saveEffectDraft.mock.calls[0][0].write.draftId });
      await pending;
    });
    expect(hook.result.current.draft).toBeUndefined();
    expect((await readPending('p', 'save')).record?.pendingWrite).toBeTruthy();
  });
  it('working-only恢复的GET暂时失败时不得将未知基准当作新稿POST', async () => {
    const document = createEffectDocument(); document.content.title = '保留原稿';
    await writePending('p', 'save', { schemaVersion: 1, projectId: 'p',
      draftId: crypto.randomUUID(), recordRevision: 1, baseVersion: null,
      working: { name: 'Draft', document }, createdAt: new Date().toISOString(),
    }, { kind: 'absent' });
    api.getEffectDraft.mockRejectedValue(new ApiError(503, 'unavailable', 'retry'));
    const hook = renderHook(() => useEffectsDraft('p', false));
    await act(async () => { await hook.result.current.restore(); });
    await expect(hook.result.current.flush()).rejects.toThrow('EFFECT_SUBMISSION_UNKNOWN');
    expect(api.saveEffectDraft).not.toHaveBeenCalled();
    expect(hook.result.current.document.content.title).toBe('保留原稿');
  });
  it('项目切换前不足500ms的输入也写入原项目，默认入口不用旧项目draftId', async () => {
    const document = createEffectDocument(); document.content.title = '原稿';
    api.getEffectDraft.mockResolvedValue(saved(document));
    const hook = renderHook(({ projectId }) => useEffectsController({ projectId,
      materials: [], registerMaterial: vi.fn() }), {
      initialProps: { projectId: 'p' }, wrapper: LocaleProvider,
    });
    await act(async () => { await hook.result.current.open({ draftId:
      '0e931a68-f0a1-4abd-b530-23a377620ce7' }); });
    act(() => hook.result.current.draft.edit({ name: 'Draft', document: {
      ...document, content: { title: '最后一次输入', subtitle: '' } } }));
    hook.rerender({ projectId: 'q' });
    await act(async () => { await Promise.resolve(); });
    expect((await readPending('p', 'save')).record?.working?.document.content.title)
      .toBe('最后一次输入');
    api.getEffectDraft.mockClear();
    await act(async () => { await hook.result.current.open(); });
    expect(api.getEffectDraft).not.toHaveBeenCalled();
    expect(hook.result.current.draft.draft).toBeUndefined();
  });
  it('退出快照配额失败后保留内存，返回项目优先恢复最新输入并可重试存储', async () => {
    const document = createEffectDocument(); document.content.title = '服务器原稿';
    api.getEffectDraft.mockResolvedValue(saved(document));
    const hook = renderHook(({ projectId }) => useEffectsController({ projectId,
      materials: [], registerMaterial: vi.fn() }), {
      initialProps: { projectId: 'p' }, wrapper: LocaleProvider,
    });
    await act(async () => { await hook.result.current.open({ draftId:
      '0e931a68-f0a1-4abd-b530-23a377620ce7' }); });
    act(() => hook.result.current.draft.edit({ name: 'Draft', document: {
      ...document, content: { title: '旧有效本地稿', subtitle: '' } } }));
    await act(async () => { await hook.result.current.draft.persistWorking(); });
    act(() => hook.result.current.draft.edit({ name: 'Draft', document: {
      ...document, content: { title: '退出前最后输入', subtitle: '' } } }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota');
    });
    hook.rerender({ projectId: 'q' });
    await act(async () => { await Promise.resolve(); });
    await waitFor(() => expect(log).toHaveBeenCalled());
    failed.mockRestore();
    await act(async () => { await hook.result.current.open({ newDraft: true }); });
    hook.rerender({ projectId: 'p' });
    await act(async () => { await hook.result.current.open(); });
    expect(hook.result.current.draft.document.content.title).toBe('退出前最后输入');
    expect(hook.result.current.error?.message).toBe('EFFECT_LOCAL_STATE_UNAVAILABLE');
    await act(async () => { await hook.result.current.draft.flush(); });
    expect(api.saveEffectDraft.mock.calls.slice(-1)[0]?.[0].write).toMatchObject({
      kind: 'update', expectedVersion: 1,
      document: { content: { title: '退出前最后输入' } } });
    log.mockRestore();
  });
  it('连续两次退出失败且中间GET未确认时仍保留原已确认版本', async () => {
    const document = createEffectDocument(); document.content.title = 'v1原稿';
    api.getEffectDraft.mockResolvedValue(saved(document));
    const hook = renderHook(({ projectId }) => useEffectsController({ projectId,
      materials: [], registerMaterial: vi.fn() }), {
      initialProps: { projectId: 'p' }, wrapper: LocaleProvider,
    });
    await act(async () => { await hook.result.current.open({ draftId:
      '0e931a68-f0a1-4abd-b530-23a377620ce7' }); });
    act(() => hook.result.current.draft.edit({ name: 'Draft', document: {
      ...document, content: { title: '两次退出保留', subtitle: '' } } }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const storage = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    hook.rerender({ projectId: 'q' });
    await waitFor(() => expect(log).toHaveBeenCalledTimes(1));
    api.getEffectDraft.mockRejectedValue(new ApiError(503, 'unavailable', 'offline'));
    hook.rerender({ projectId: 'p' });
    await act(async () => { await hook.result.current.open(); });
    expect(hook.result.current.draft.draft).toBeUndefined();
    hook.rerender({ projectId: 'q' });
    await waitFor(() => expect(log).toHaveBeenCalledTimes(2));
    storage.mockRestore(); api.getEffectDraft.mockResolvedValue(saved(document));
    hook.rerender({ projectId: 'p' });
    await act(async () => { await hook.result.current.open(); });
    expect(hook.result.current.draft.getBaseVersion()).toBe(1);
    expect(hook.result.current.draft.status).toBe('editing');
    await act(async () => { await hook.result.current.draft.flush(); });
    expect(api.saveEffectDraft.mock.calls.slice(-1)[0]?.[0].write).toMatchObject({
      kind: 'update', expectedVersion: 1,
      document: { content: { title: '两次退出保留' } } });
    log.mockRestore();
  });
  it('另一编辑器接管后推进的working不能被退出失败的旧内存稿覆盖', async () => {
    const document = createEffectDocument(); document.content.title = '服务器原稿';
    api.getEffectDraft.mockResolvedValue(saved(document));
    const hook = renderHook(({ projectId }) => useEffectsController({ projectId,
      materials: [], registerMaterial: vi.fn() }), {
      initialProps: { projectId: 'p' }, wrapper: LocaleProvider,
    });
    await act(async () => { await hook.result.current.open({ draftId:
      '0e931a68-f0a1-4abd-b530-23a377620ce7' }); });
    act(() => hook.result.current.draft.edit({ name: 'Draft', document }));
    await act(async () => { await hook.result.current.draft.persistWorking(); });
    act(() => hook.result.current.draft.edit({ name: 'Draft', document: {
      ...document, content: { title: '旧窗口内存', subtitle: '' } } }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const storage = vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota');
    });
    hook.rerender({ projectId: 'q' });
    await waitFor(() => expect(log).toHaveBeenCalled()); storage.mockRestore();
    const lease = await acquireEffectEditor('p'); expect(lease?.isActive()).toBe(true);
    const previous = await readPending('p', 'save');
    await writePending('p', 'save', { ...previous.record!,
      recordRevision: previous.record!.recordRevision + 1,
      working: { name: 'Draft', document: { ...document,
        content: { title: '另一个窗口更新', subtitle: '' } } },
    }, previous.identity); lease?.release();
    hook.rerender({ projectId: 'p' });
    await act(async () => { await hook.result.current.open(); });
    expect(hook.result.current.draft.document.content.title).toBe('旧窗口内存');
    expect(hook.result.current.draft.status).toBe('conflict');
    expect((await readPending('p', 'save')).record?.working?.document.content.title)
      .toBe('另一个窗口更新');
    await expect(hook.result.current.draft.flush()).rejects.toThrow('EFFECT_VERSION_CONFLICT');
    await expect(hook.result.current.draft.discardConflict())
      .rejects.toThrow('EFFECT_VERSION_CONFLICT');
    expect(hook.result.current.draft.document.content.title).toBe('旧窗口内存');
    expect((await readPending('p', 'save')).record?.working?.document.content.title)
      .toBe('另一个窗口更新');
    expect(api.saveEffectDraft).not.toHaveBeenCalled();
    await act(async () => { await hook.result.current.close(true); });
    expect((await readPending('p', 'save')).record?.working?.document.content.title)
      .toBe('另一个窗口更新'); log.mockRestore();
  });
  it('失败退出的旧恢复GET迟到后不向新项目续写本地working', async () => {
    const document = createEffectDocument(); document.content.title = '服务器';
    api.getEffectDraft.mockResolvedValue(saved(document));
    const hook = renderHook(({ projectId }) => useEffectsController({ projectId,
      materials: [], registerMaterial: vi.fn() }), {
      initialProps: { projectId: 'p' }, wrapper: LocaleProvider,
    });
    await act(async () => { await hook.result.current.open({ draftId:
      '0e931a68-f0a1-4abd-b530-23a377620ce7' }); });
    act(() => hook.result.current.draft.edit({ name: 'Draft', document }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const quota = vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota');
    });
    hook.rerender({ projectId: 'q' });
    await waitFor(() => expect(log).toHaveBeenCalled()); quota.mockRestore();
    let release!: (draft: EffectDraft) => void;
    api.getEffectDraft.mockImplementationOnce(() => new Promise(done => { release = done; }));
    hook.rerender({ projectId: 'p' });
    let opening!: Promise<void>;
    await act(async () => { opening = hook.result.current.open(); });
    await waitFor(() => expect(hook.result.current.draft.restored).toBe(true));
    hook.rerender({ projectId: 'q' });
    await act(async () => { await hook.result.current.open({ newDraft: true }); });
    vi.useFakeTimers();
    act(() => hook.result.current.draft.edit({ name: 'Q', document: {
      ...document, content: { title: '新项目输入', subtitle: '' } } }));
    const writes = vi.spyOn(localStorage, 'setItem');
    await act(async () => { release(saved(document)); await opening; });
    expect(writes.mock.calls.filter(([key]) => key === 'ecliptrix:effects:save:v1:q'))
      .toEqual([]);
    writes.mockRestore(); log.mockRestore();
  });
  it('列表失败及草稿GET未返回时先回显working，恢复素材使用冻结体与working的并集', async () => {
    const document = createEffectDocument(); document.content.title = '冻结内容';
    const assetId = crypto.randomUUID(), draftId = crypto.randomUUID();
    document.inputs = [{ slot: 'base', assetId, kind: 'image',
      fit: 'cover', focalX: 0.5, focalY: 0.5 }];
    const working = { name: '最新工作稿', document: { ...document, inputs: [],
      content: { title: '待恢复的最新输入', subtitle: '' } } };
    await writePending('p', 'save', { schemaVersion: 1, projectId: 'p', draftId,
      recordRevision: 1, baseVersion: null, working,
      pendingWrite: { kind: 'create', draftId, name: '已发送', document },
      createdAt: new Date().toISOString() }, { kind: 'absent' });
    api.listEffectDrafts.mockRejectedValue(new ApiError(503, 'unavailable', 'list failed'));
    let fail!: (failure: Error) => void;
    api.getEffectDraft.mockImplementation(() => new Promise((_done, reject) => { fail = reject; }));
    api.getEffectAsset.mockRejectedValue(new ApiError(404, 'EFFECT_NOT_FOUND', 'missing'));
    const hook = renderHook(() => useEffectsController({ projectId: 'p',
      materials: [], registerMaterial: vi.fn() }), { wrapper: LocaleProvider });
    let opening!: Promise<void>;
    await act(async () => { opening = hook.result.current.open(); });
    await waitFor(() => expect(hook.result.current.draft.document.content.title)
      .toBe('待恢复的最新输入'));
    expect(hook.result.current.busy).toBe(false);
    expect(api.saveEffectDraft).not.toHaveBeenCalled();
    await act(async () => {
      fail(new ApiError(503, 'unavailable', 'draft failed')); await opening;
    });
    expect(api.getEffectAsset).toHaveBeenCalledWith('p', assetId);
    expect(hook.result.current.draft.document.inputs).toEqual([]);
  });
  it('HTTP方法由kind决定，稳定ID的首次create仍POST且PUT不含draft_id', async () => {
    const actual = await vi.importActual<typeof import('@/lib/api/effects')>(
      '@/lib/api/effects');
    const document = createEffectDocument();
    const draftId = crypto.randomUUID();
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ success: true, data: { draft_id: draftId, project_id: 'p',
        name: 'Draft', version: 1, document: actual.toWireEffectDocument(document) } }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }));
    await actual.saveEffectDraft({ projectId: 'p', write: {
      kind: 'create', draftId, name: 'Draft', document } });
    expect(fetcher.mock.calls[0][1]?.method).toBe('POST');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ draft_id: draftId });
    fetcher.mockResolvedValue(new Response(JSON.stringify({ success: true,
      data: { draft_id: draftId, project_id: 'p', name: 'Draft', version: 2,
        document: actual.toWireEffectDocument(document) } }), { status: 200 }));
    await actual.saveEffectDraft({ projectId: 'p', write: {
      kind: 'update', draftId, name: 'Draft', document, expectedVersion: 1 } });
    expect(fetcher.mock.calls[1][1]?.method).toBe('PUT');
    const body = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(body.expected_version).toBe(1); expect(body).not.toHaveProperty('draft_id');
    fetcher.mockRestore();
  });
  it.each([
    ['9:16', 1080, 1920], ['1:1', 1080, 1080], ['4:3', 1440, 1080],
    ['21:9', 1920, 822], ['invalid', 1920, 1080],
  ])('空白草稿继承项目 %s 比例且遵守渲染尺寸限制', async (ratio, width, height) => {
    const hook = renderHook(() => useEffectsController({ projectId: 'p',
      aspectRatioId: String(ratio), materials: [], registerMaterial: vi.fn(),
    }), { wrapper: LocaleProvider });
    await act(async () => { await hook.result.current.open({ newDraft: true }); });
    expect(hook.result.current.draft.document.canvas).toEqual({ width, height, fps: 30 });
  });

  it.each(['base', 'images'])('按选择顺序串行绑定 %s 槽位', async slot => {
    const hook = renderHook(() => useEffectsController({ projectId: 'p',
      materials: [], registerMaterial: vi.fn() }), { wrapper: LocaleProvider });
    await act(async () => { await hook.result.current.open({ newDraft: true }); });
    if (slot === 'images') act(() => hook.result.current.selectTemplate('slides-stack'));
    const a = { id: '11111111-1111-4111-8111-111111111111', type: 'image', url: '/api/storage/files/a.png' } as MaterialItem;
    const b = { id: '22222222-2222-4222-8222-222222222222', type: 'image', url: '/api/storage/files/b.png' } as MaterialItem;
    let release!: (asset: EffectAsset) => void;
    api.attachEffectInput.mockImplementation((_project, source) =>
      source === a.url ? new Promise(done => { release = done; })
        : Promise.resolve({ id: '22222222-2222-4222-8222-222222222222', kind: 'input-image' }));
    let first!: Promise<void>, second!: Promise<void>;
    await act(async () => {
      first = hook.result.current.attach(slot, a);
      second = hook.result.current.attach(slot, b);
      await Promise.resolve();
    });
    expect(api.attachEffectInput).toHaveBeenCalledTimes(1);
    await act(async () => {
      release({ id: '11111111-1111-4111-8111-111111111111', kind: 'input-image' } as EffectAsset);
      await Promise.all([first, second]);
    });
    expect(hook.result.current.draft.document.inputs.map(input => input.assetId))
      .toEqual(slot === 'images' ? ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'] : ['22222222-2222-4222-8222-222222222222']);
  });

  it('重选当前模板保留已保存的参数、版本和撤销历史', async () => {
    const document = createEffectDocument('countdown-ring');
    document.params.from = 12;
    const record = saved(document, 6);
    api.getEffectDraft.mockResolvedValueOnce(record);
    const hook = renderHook(() => useEffectsController({ projectId: 'p',
      materials: [], registerMaterial: vi.fn() }), { wrapper: LocaleProvider });
    await act(async () => { await hook.result.current.open({ draftId: record.id }); });
    act(() => hook.result.current.selectTemplate('countdown-ring'));
    expect(hook.result.current.draft.document.params.from).toBe(12);
    expect(hook.result.current.draft.canUndo).toBe(false);
    await act(async () => { await hook.result.current.draft.flush(); });
    expect(api.saveEffectDraft).not.toHaveBeenCalled();
    expect(hook.result.current.draft.getBaseVersion()).toBe(6);
  });

  it.each([
    { switchAway: false, fails: false },
    { switchAway: false, fails: true },
    { switchAway: true, fails: false },
    { switchAway: true, fails: true },
  ])('素材回包只在原模板仍有效时生效：切走再切回=$switchAway，绑定失败=$fails', async ({ switchAway, fails }) => {
    const hook = renderHook(() => useEffectsController({ projectId: 'p',
      materials: [], registerMaterial: vi.fn() }), { wrapper: LocaleProvider });
    await act(async () => { await hook.result.current.open({ newDraft: true }); });
    const assetId = '11111111-1111-4111-8111-111111111111';
    const failure = new Error('素材绑定失败');
    let finish!: () => void;
    api.attachEffectInput.mockImplementationOnce(() => new Promise((resolve, reject) => {
      finish = () => {
        if (fails) reject(failure);
        else resolve({ id: assetId, kind: 'input-image' });
      };
    }));
    let attaching!: Promise<void>;
    await act(async () => {
      attaching = hook.result.current.attach('base', { id: assetId, type: 'image',
        url: '/api/storage/files/a.png' } as MaterialItem);
      await Promise.resolve();
    });
    act(() => {
      if (switchAway) hook.result.current.selectTemplate('image-zoom');
      hook.result.current.selectTemplate('title-rise');
    });
    await act(async () => {
      finish(); await attaching;
    });
    expect(hook.result.current.draft.document.inputs.map(input => input.assetId))
      .toEqual(switchAway || fails ? [] : [assetId]);
    expect(hook.result.current.error).toBe(!switchAway && fails ? failure : undefined);
  });

  it('一次绑定失败不会阻断后续选择', async () => {
    const hook = renderHook(() => useEffectsController({ projectId: 'p',
      materials: [], registerMaterial: vi.fn() }), { wrapper: LocaleProvider });
    await act(async () => { await hook.result.current.open({ newDraft: true }); });
    api.attachEffectInput.mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce({ id: '22222222-2222-4222-8222-222222222222', kind: 'input-image' });
    await act(async () => {
      await Promise.all(['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'].map(id => hook.result.current.attach('base', {
        id, type: 'image', url: `/api/storage/files/${id}.png`,
      } as MaterialItem)));
    });
    expect(hook.result.current.draft.document.inputs[0].assetId).toBe('22222222-2222-4222-8222-222222222222');
    expect(hook.result.current.error).toBeUndefined();
  });

  it('新工作台的绑定不等待旧工作台请求，且旧回包不污染新稿', async () => {
    const hook = renderHook(() => useEffectsController({ projectId: 'p',
      materials: [], registerMaterial: vi.fn() }), { wrapper: LocaleProvider });
    await act(async () => { await hook.result.current.open({ newDraft: true }); });
    let release!: (asset: EffectAsset) => void;
    api.attachEffectInput.mockImplementationOnce(() => new Promise(done => { release = done; }))
      .mockResolvedValueOnce({ id: '22222222-2222-4222-8222-222222222222', kind: 'input-image' });
    let old!: Promise<void>;
    await act(async () => {
      old = hook.result.current.attach('base', { id: '11111111-1111-4111-8111-111111111111', type: 'image',
        url: '/api/storage/files/a.png' } as MaterialItem);
      await Promise.resolve();
    });
    await act(async () => { await hook.result.current.close(); });
    await act(async () => { await hook.result.current.open({ newDraft: true }); });
    await act(async () => {
      await hook.result.current.attach('base', { id: '22222222-2222-4222-8222-222222222222', type: 'image',
        url: '/api/storage/files/b.png' } as MaterialItem);
    });
    expect(hook.result.current.draft.document.inputs[0].assetId).toBe('22222222-2222-4222-8222-222222222222');
    await act(async () => {
      release({ id: '11111111-1111-4111-8111-111111111111', kind: 'input-image' } as EffectAsset); await old;
    });
    expect(hook.result.current.draft.document.inputs[0].assetId).toBe('22222222-2222-4222-8222-222222222222');
    expect(hook.result.current.assets.map(asset => asset.id)).toEqual(['22222222-2222-4222-8222-222222222222']);
  });

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
    await act(async () => { await hook.result.current.close(); });
    await act(async () => {
      await hook.result.current.open({ newDraft: true });
      resolveJob({ ...api.submitEffectJob.mock.calls[0][0], id: 'late-job', draftVersion: 1, status: 'queued' });
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
      resolveJob({ ...api.submitEffectJob.mock.calls[0][0], id: 'j', draftVersion: 1, status: 'queued' }); await first;
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
      const flush = result.current.flush(); complete({ ...saved(initial), id: api.saveEffectDraft.mock.calls[0][0].write.draftId });
      await first; await flush;
    });
    expect(api.saveEffectDraft).toHaveBeenCalledTimes(2);
    expect(api.saveEffectDraft.mock.calls[1][0]).toMatchObject({ write: { kind: 'update', expectedVersion: 1,
      document: { content: { title: 'latest' } } } });
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
    await act(async () => { await result.current.discard(); result.current.load(result.current.getCurrent()); });
    await act(async () => { await result.current.flush(); });
    expect(api.saveEffectDraft.mock.calls[1][0].write).toMatchObject({ kind: 'create', draftId: expect.any(String) });
  });

  it('保存冲突后重新加载会读取服务器版本并恢复编辑', async () => {
    const original = createEffectDocument(); original.content.title = '原稿';
    api.listEffectDrafts.mockResolvedValue([{ id: '0e931a68-f0a1-4abd-b530-23a377620ce7', name: 'Draft', version: 1 }]);
    api.getEffectDraft.mockResolvedValue(saved(original));
    const hook = renderHook(() => useEffectsController({ projectId: 'p',
      materials: [], registerMaterial: vi.fn() }), { wrapper: LocaleProvider });
    await act(async () => { await hook.result.current.open({ draftId: '0e931a68-f0a1-4abd-b530-23a377620ce7' }); });
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
