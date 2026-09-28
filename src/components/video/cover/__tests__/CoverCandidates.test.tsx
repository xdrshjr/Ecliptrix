import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import { CoverCandidates } from '../CoverCandidates';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations['zh-CN'] }),
}));
afterEach(() => { cleanup(); vi.useRealTimers(); });

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
