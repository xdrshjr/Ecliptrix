import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import { CoverCandidates } from '../CoverCandidates';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations['zh-CN'] }),
}));
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('生成部分成功时保留警告且不诱发自动重新生成', () => {
  const onRegenerate = vi.fn();
  render(<CoverCandidates jobs={[{ jobId: 'partial', status: 'succeeded',
    baseVersion: 1, assets: [], warnings: ['COVER_GENERATION_FAILED'] }]}
    value={null} onSelect={vi.fn()} onCancel={vi.fn()}
    onRegenerate={onRegenerate} />);
  expect(screen.getByText(translations['zh-CN'].coverStudio.partialGeneration))
    .toBeVisible();
  expect(onRegenerate).not.toHaveBeenCalled();
});

it('下载阶段显示保存图片和持续递增的实际等待时间', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-28T12:00:10Z'));
  render(<CoverCandidates jobs={[{
    jobId: 'job', status: 'running', phase: 'downloading',
    baseVersion: 1, assets: [], createdAt: '2026-09-28T12:00:00',
  }]} value={null} onSelect={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.getByText('正在保存图片')).toBeVisible();
  expect(screen.getByText('已等待 10 秒')).toBeVisible();
  act(() => { vi.advanceTimersByTime(2000); });
  expect(screen.getByText('已等待 12 秒')).toBeVisible();
});

it('只有选中图片可Tab进入，四方向键按assetId在重排后保持焦点', () => {
  const assets = ['a', 'b', 'c'].map(assetId => ({ assetId,
    url: `/${assetId}.png`, width: 100, height: 100, sha256: assetId }));
  const onSelect = vi.fn();
  const { rerender } = render(<CoverCandidates jobs={[]} assets={assets}
    value="a" onSelect={onSelect} onCancel={vi.fn()} />);
  expect(screen.getAllByRole('radio').map(r => r.tabIndex)).toEqual([0, -1, -1]);
  screen.getAllByRole('radio')[0].focus();
  fireEvent.keyDown(screen.getAllByRole('radio')[0], { key: 'ArrowDown' });
  expect(onSelect).toHaveBeenLastCalledWith(assets[1]);
  rerender(<CoverCandidates jobs={[]} assets={[assets[1], assets[0], assets[2]]}
    value="b" onSelect={onSelect} onCancel={vi.fn()} />);
  expect(screen.getAllByRole('radio')[0]).toHaveFocus();
  expect(screen.getAllByRole('radio')[0]).toHaveAttribute('aria-checked', 'true');
});

it('等待秒数不在任务阶段live区域内', () => {
  render(<CoverCandidates jobs={[{ jobId: 'j', status: 'running',
    baseVersion: 1, assets: [], createdAt: new Date().toISOString() }]}
    value={null} onSelect={vi.fn()} onCancel={vi.fn()} />);
  const elapsed = screen.getByText(/已等待/);
  expect(elapsed.closest('[aria-live="polite"]')).toBeNull();
});

it('404停止自动观察时只提示不可读取，不宣称自动重试', () => {
  render(<CoverCandidates jobs={[]} assets={[]} value={null}
    onSelect={vi.fn()} onCancel={vi.fn()} onRefresh={vi.fn()}
    connection={{ status: 'retrying', failedJobIds: [],
      unavailableJobIds: ['missing'] }} />);
  expect(screen.getByText('部分生成任务暂时无法读取')).toBeVisible();
  expect(screen.queryByText('暂时无法获取生成进度，正在重试')).toBeNull();
});
