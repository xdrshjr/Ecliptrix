import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { CoverRevisionEntry } from '@/types/videoCover';
import { createCoverDocument } from '../templates';
import { CoverRevisionHistory } from '../CoverRevisionHistory';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations['zh-CN'], locale: 'zh-CN' }),
}));
afterEach(cleanup);
const entry: CoverRevisionEntry = { id: 'one', metadataStatus: 'readable',
  pngStatus: 'readable', backgroundStatus: 'readable', revision: {
    id: 'one', projectId: 'p', assetId: 'a', url: '/cover.png', sha256: 'sha',
    width: 1920, height: 1080, createdAt: '2026-09-28T12:00:00',
    documentHash: 'hash', document: createCoverDocument({ mode: 'html' }),
  } };
function mount(entries = [entry]) {
  const callbacks = { onPreview: vi.fn(), onRestore: vi.fn(),
    onDownload: vi.fn(), onRetry: vi.fn(), onPngUnavailable: vi.fn() };
  render(<CoverRevisionHistory entries={entries} appliedRevisionId="one"
    {...callbacks} />);
  return callbacks;
}
it('预览、载入和下载是独立动作，版本不是单选组', () => {
  const callbacks = mount();
  fireEvent.click(screen.getByRole('button', { name: /放大预览|预览/ }));
  expect(callbacks.onPreview).toHaveBeenCalledWith(entry.revision);
  expect(callbacks.onRestore).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '载入为草稿' }));
  expect(callbacks.onRestore).toHaveBeenCalledWith('one');
  fireEvent.click(screen.getByRole('button', { name: '下载 PNG' }));
  expect(callbacks.onDownload).toHaveBeenCalledWith('one');
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.getByText('视频正在使用')).toBeVisible();
});
it('缺背景保留PNG下载但禁止载入，缺详情引用不伪造成品', () => {
  mount([{ ...entry, backgroundStatus: 'unavailable' }, {
    id: 'missing', metadataStatus: 'unavailable',
    pngStatus: 'unavailable', backgroundStatus: 'unknown',
  }]);
  expect(screen.getByRole('button', { name: '载入为草稿' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '下载 PNG' })).not.toBeDisabled();
  expect(screen.getByText('原背景已丢失，可下载成品后重新上传')).toBeVisible();
  expect(screen.getByText('missing')).toBeVisible();
  expect(screen.getAllByRole('button', { name: '重试读取' })).toHaveLength(2);
});
it('PNG不可读但背景可读允许载入重建；GET不可读禁用载入', () => {
  mount([{ ...entry, pngStatus: 'unavailable' }]);
  expect(screen.getByRole('button', { name: '载入为草稿' })).not.toBeDisabled();
  expect(screen.getByRole('button', { name: '下载 PNG' })).toBeDisabled();
});
