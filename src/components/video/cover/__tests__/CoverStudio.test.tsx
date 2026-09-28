import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import { CoverStudio } from '../CoverStudio';
import { CoverResources } from '../CoverResources';
import { createCoverDocument } from '../templates';
import type { CoverController } from '../useCoverController';
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
  this.removeAttribute('open');
});
HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
});
vi.mock('@/contexts/LocaleContext', () => ({ useLocale: () => ({ t: translations['zh-CN'], locale: 'zh-CN' }) }));
vi.mock('@/components/settings/SettingsPage', () => ({
  default: ({ onClose }: { onClose: () => void }) =>
    <button onClick={onClose}>返回设置</button>,
}));
afterEach(() => { cleanup(); window.innerWidth = 1024; });
function fixture(): CoverController {
  return { document: createCoverDocument({ mode: 'html', title: '离线封面' }),
    update: vi.fn(), loading: false, saveState: 'saved', error: undefined,
    setError: vi.fn(), busy: false, assets: [], revisions: [], legacyAvailable: false,
    canGenerate: false, jobs: [], flush: vi.fn(async () => undefined),
    reload: vi.fn(), upload: vi.fn(), copyAsset: vi.fn(), selectAsset: vi.fn(),
    generate: vi.fn(async () => undefined), act: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined), importLegacy: vi.fn(async () => undefined),
    bridge: {}, activity: 'idle', revisionEntries: [],
    refreshResources: vi.fn(async () => undefined), refreshJobs: vi.fn(),
    changeTemplate: vi.fn(), undoTemplate: vi.fn(),
    canUndoTemplate: false, canUndoRestore: false,
    restoreRevision: vi.fn(), downloadRevision: vi.fn(), retryRevision: vi.fn(),
    markRevisionPngUnavailable: vi.fn(),
    submittingGeneration: false, hasUnknownSubmission: false,
    resolveConflict: vi.fn(async () => undefined),
  } as unknown as CoverController;
}
describe('封面工作室交互', () => {
  it('高度受限时资源只保留入口，主动打开后在原生dialog完整显示', () => {
    function Fixture() {
      const [tab, setTab] = React.useState<'images' | 'revisions'>('images');
      return <CoverResources compact assets={[]} jobs={[]} revisionEntries={[]}
        selectedAssetId={null} tab={tab} onTabChange={setTab}
        onSelect={vi.fn()} onCancel={vi.fn()} onRefresh={vi.fn()}
        onPreview={vi.fn()} onRestore={vi.fn()} onDownload={vi.fn()}
        onRetry={vi.fn()} onPngUnavailable={vi.fn()} />;
    }
    render(<Fixture />);
    expect(screen.getByText('上传背景，或生成第一张图片')).not.toBeVisible();
    const trigger = screen.getByRole('tab', { name: '最近成品' });
    trigger.focus(); fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: '最近成品' })).toBeVisible();
    expect(screen.getByText('应用或下载封面后，成品会保存在这里')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });
  it('无凭据仍支持纯HTML并提供五模板及三模式', () => {
    render(<CoverStudio controller={fixture()} onClose={vi.fn()} materials={[]} />);
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(screen.getByRole('button', { name: '应用到视频' })).not.toBeDisabled();
    expect(screen.queryByRole('button', { name: '生成图片' })).toBeNull();
  });
  it('键盘切模式保留文字，模板按钮调用同一文档更新', () => {
    const state = fixture(); render(<CoverStudio controller={state} onClose={vi.fn()} materials={[]} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'HTML 排版' }), { key: 'ArrowRight' });
    expect(state.update).toHaveBeenCalledWith(expect.objectContaining({ mode: 'ai', fields: state.document!.fields }));
    fireEvent.click(screen.getByRole('radio', { name: '大字观点' }));
    expect(state.changeTemplate).toHaveBeenCalledWith(expect.objectContaining({ templateId: 'bold', fields: state.document!.fields }));
  });
  it('AI缺配置明确提示，不能创建无背景成品', () => {
    const state = fixture(); state.document!.mode = 'ai';
    render(<CoverStudio controller={state} onClose={vi.fn()} materials={[]} />);
    expect(screen.getByRole('button', { name: '生成图片' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '应用到视频' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '模型设置' })).toBeVisible();
  });
  it('能力未知禁止生成但仍提供资源刷新，不误称未配置', () => {
    const state = fixture(); state.document!.mode = 'ai';
    state.document!.generation.prompt = '山川'; state.canGenerate = undefined;
    render(<CoverStudio controller={state} onClose={vi.fn()} materials={[]} />);
    expect(screen.getByRole('button', { name: '生成图片' })).toBeDisabled();
    expect(screen.getByText('暂时无法确认模型配置')).toBeVisible();
    expect(screen.getByRole('button', { name: '刷新资源' })).toBeVisible();
  });
  it('模式有明确tabpanel关联且进入时聚焦标题', () => {
    render(<CoverStudio controller={fixture()} onClose={vi.fn()} materials={[]} />);
    const tab = screen.getByRole('tab', { name: 'HTML 排版' });
    expect(screen.getByRole('tabpanel', { name: 'HTML 排版' }).id)
      .toBe(tab.getAttribute('aria-controls'));
    expect(screen.getByRole('heading', { name: '封面工作室' })).toHaveFocus();
  });
  it('排队任务可以取消且不会显示为已应用', () => {
    const state = fixture(); state.jobs = [{ jobId: 'job', baseVersion: 1, status: 'queued', assets: [] }];
    render(<CoverStudio controller={state} onClose={vi.fn()} materials={[]} />);
    expect(screen.getByText('排队中')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '取消生成' }));
    expect(state.cancel).toHaveBeenCalledWith('job');
    expect(screen.queryByText('已应用到时间轴')).toBeNull();
  });
  it('从模型设置返回只刷新资源并保留草稿', async () => {
    const state = fixture(); state.document!.mode = 'ai';
    const original = state.document;
    render(<CoverStudio controller={state} onClose={vi.fn()} materials={[]} />);
    fireEvent.click(screen.getByRole('button', { name: '模型设置' }));
    fireEvent.click(screen.getByRole('button', { name: '返回设置' }));
    await waitFor(() => expect(state.refreshResources).toHaveBeenCalledOnce());
    expect(state.reload).not.toHaveBeenCalled();
    expect(state.document).toBe(original);
    expect(screen.getByRole('button', { name: '模型设置' })).toHaveFocus();
  });
  it('保存网络错误仅重试保存，不显示冲突覆盖操作', () => {
    const state = fixture(); state.issue = { id: 'e', projectId: 'p',
      operation: 'save', kind: 'other', code: 'NETWORK',
      actions: ['retry-save', 'dismiss'] };
    state.retrySave = vi.fn(async () => undefined);
    render(<CoverStudio controller={state} onClose={vi.fn()} materials={[]} />);
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
    expect(state.retrySave).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: '使用已保存草稿' })).toBeNull();
    expect(screen.queryByRole('button', { name: '保留我的草稿' })).toBeNull();
  });
  it('较早图片导入失败单独提示并保留当前草稿错误', () => {
    const state = fixture(); state.notice = 'image-import-failed';
    state.issue = { id: 'save-error', projectId: 'p', operation: 'save',
      kind: 'other', code: 'NETWORK', actions: ['retry-save', 'dismiss'] };
    render(<CoverStudio controller={state} onClose={vi.fn()} materials={[]} />);
    expect(screen.getByText('较早的图片导入失败，当前背景仍保留，可重新选择图片'))
      .toBeVisible();
    expect(screen.getByText('草稿尚未保存，输入仍保留')).toBeVisible();
    expect(screen.getByRole('button', { name: '重试保存' })).toBeVisible();
    expect(screen.queryByText('已按当前画布重新排版，应用时将生成新成品')).toBeNull();
  });
  it('服务器草稿为空说明保留输入并只提供本地恢复', () => {
    const state = fixture(); state.issue = { id: 'missing', projectId: 'p',
      operation: 'save', kind: 'other', code: 'COVER_SERVER_DRAFT_MISSING',
      actions: ['use-local', 'dismiss'] };
    render(<CoverStudio controller={state} onClose={vi.fn()} materials={[]} />);
    expect(screen.getByText('服务端没有可载入的草稿，本地输入已保留'))
      .toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '保留我的草稿' }));
    expect(state.resolveConflict).toHaveBeenCalledWith('local');
    expect(screen.queryByRole('button', { name: '使用已保存草稿' })).toBeNull();
  });
  it('成品页选择不会被后台任务更新重置', () => {
    const state = fixture();
    const { rerender } = render(<CoverStudio controller={state}
      onClose={vi.fn()} materials={[]} />);
    fireEvent.click(screen.getByRole('tab', { name: '最近成品' }));
    expect(state.refreshResources).toHaveBeenCalledOnce();
    expect(state.reload).not.toHaveBeenCalled();
    state.jobs = [{ jobId: 'new', status: 'succeeded', baseVersion: 1, assets: [] }];
    rerender(<CoverStudio controller={state} onClose={vi.fn()} materials={[]} />);
    expect(screen.getByRole('tab', { name: '最近成品' }))
      .toHaveAttribute('aria-selected', 'true');
  });
  it('从宽屏属性字段变为窄屏时焦点回到可见属性按钮', () => {
    window.innerWidth = 1280;
    render(<CoverStudio controller={fixture()} onClose={vi.fn()} materials={[]} />);
    screen.getByRole('textbox', { name: '标题' }).focus();
    window.innerWidth = 900; fireEvent(window, new Event('resize'));
    expect(screen.getByRole('button', { name: '属性' })).toHaveFocus();
  });
  it('窄屏抽屉内发生提交未知时恢复操作仍处于可交互模态内', () => {
    window.innerWidth = 900;
    const state = fixture(); state.document!.mode = 'ai';
    const { rerender } = render(<CoverStudio controller={state}
      onClose={vi.fn()} materials={[]} />);
    fireEvent.click(screen.getByRole('button', { name: '属性' }));
    state.hasUnknownSubmission = true;
    rerender(<CoverStudio controller={state} onClose={vi.fn()} materials={[]} />);
    expect(screen.getByRole('button', { name: '恢复此次提交' }).closest('dialog'))
      .toBe(screen.getByRole('dialog', { name: '属性' }));
  });
});
