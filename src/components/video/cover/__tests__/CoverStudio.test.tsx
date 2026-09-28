import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import { CoverStudio } from '../CoverStudio';
import { createCoverDocument } from '../templates';
import type { CoverController } from '../useCoverController';
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
HTMLDialogElement.prototype.close = vi.fn();
HTMLDialogElement.prototype.showModal = vi.fn();
vi.mock('@/contexts/LocaleContext', () => ({ useLocale: () => ({ t: translations['zh-CN'], locale: 'zh-CN' }) }));
vi.mock('@/components/settings/SettingsPage', () => ({ default: () => null }));
afterEach(cleanup);
function fixture(): CoverController {
  return { document: createCoverDocument({ mode: 'html', title: '离线封面' }),
    update: vi.fn(), loading: false, saveState: 'saved', error: undefined,
    setError: vi.fn(), busy: false, assets: [], revisions: [], legacyAvailable: false,
    canGenerate: false, jobs: [], flush: vi.fn(async () => undefined),
    reload: vi.fn(), upload: vi.fn(), copyAsset: vi.fn(), selectAsset: vi.fn(),
    generate: vi.fn(async () => undefined), act: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined), importLegacy: vi.fn(async () => undefined),
    bridge: {} } as unknown as CoverController;
}
describe('封面工作室交互', () => {
  it('无凭据仍支持纯HTML并提供五模板及三模式', () => {
    render(<CoverStudio controller={fixture()} onClose={vi.fn()} materials={[]} />);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(screen.getByRole('button', { name: '应用到视频' })).not.toBeDisabled();
    expect(screen.queryByRole('button', { name: '生成图片' })).toBeNull();
  });
  it('键盘切模式保留文字，模板按钮调用同一文档更新', () => {
    const state = fixture(); render(<CoverStudio controller={state} onClose={vi.fn()} materials={[]} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'HTML 排版' }), { key: 'ArrowRight' });
    expect(state.update).toHaveBeenCalledWith(expect.objectContaining({ mode: 'ai', fields: state.document!.fields }));
    fireEvent.click(screen.getByRole('radio', { name: '大字观点' }));
    expect(state.update).toHaveBeenLastCalledWith(expect.objectContaining({ templateId: 'bold', fields: state.document!.fields }));
  });
  it('AI缺配置明确提示，不能创建无背景成品', () => {
    const state = fixture(); state.document!.mode = 'ai';
    render(<CoverStudio controller={state} onClose={vi.fn()} materials={[]} />);
    expect(screen.getByRole('button', { name: '生成图片' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '应用到视频' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '模型设置' })).toBeVisible();
  });
  it('排队任务可以取消且不会显示为已应用', () => {
    const state = fixture(); state.jobs = [{ jobId: 'job', baseVersion: 1, status: 'queued', assets: [] }];
    render(<CoverStudio controller={state} onClose={vi.fn()} materials={[]} />);
    expect(screen.getByText('排队中')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '取消生成' }));
    expect(state.cancel).toHaveBeenCalledWith('job');
    expect(screen.queryByText('已应用到时间轴')).toBeNull();
  });
});
