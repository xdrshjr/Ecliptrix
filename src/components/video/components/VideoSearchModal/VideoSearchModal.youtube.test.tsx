import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import VideoSearchModal from './VideoSearchModal';
import type { UseVideoSearchReturn } from '../../types';

vi.mock('@/contexts/LocaleContext', () => ({ useLocale: () => ({ t: translations['zh-CN'] }) }));
vi.mock('../../utils/logger', () => ({ VideoEditingLogger: class { info() {} error() {} userAction() {} } }));
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const video = (id: string) => ({ id, title: id, videoUrl: 'https://youtube.com/watch?v=' + id, width: 320, height: 180 });
function props(id = 'abcdefghijk') {
  return {
    isModalOpen: true, searchQuery: 'test', searchOrientation: 'mixed', isSearching: false,
    searchResults: [], selectedResults: new Set(), previewVideo: null, validationError: '',
    activeLibrary: 'youtube', youtubeSearchResults: [], youtubeSelectedResults: new Set(),
    youtubePreviewVideo: video(id), isYoutubeSearching: false, youtubeDurationRange: {},
    youtubeDurationPreset: 'all', currentPage: 1, totalPages: 1, pageSize: 20,
  } as unknown as UseVideoSearchReturn;
}
const response = (value: object) => Promise.resolve({ ok: true, json: async () => value });

it('显示网络前提，失败后可在同一视频重建播放器', async () => {
  fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') return response({});
    return response({ session: 's1', status: 'error', code: 'SIGN_IN_REQUIRED' });
  });
  const view = render(<VideoSearchModal {...props()} />);
  expect(screen.getByRole('note').textContent).toContain('能够正常连接 YouTube');
  await screen.findByText(translations['zh-CN'].videoSearchModal.previewErrors.SIGN_IN_REQUIRED);
  fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') return response({});
    return response({ session: 's2', status: 'ready', stream_url: '/api/youtube/preview-stream?session=s2' });
  });
  fireEvent.click(screen.getByRole('button', { name: '重试预览' }));
  await waitFor(() => expect(view.container.querySelector('video')?.getAttribute('src')).toContain('session=s2'));
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('retry=true'))).toBe(true);
});

it('快速切换不接受旧视频的迟到结果，并释放旧会话', async () => {
  let finish!: (value: unknown) => void;
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fetchMock.mockImplementation((_url: string, init?: RequestInit) => response(init?.method === 'DELETE' ? {}
    : { session: 'new', status: 'ready', stream_url: '/api/youtube/preview-stream?session=new' }));
  const view = render(<VideoSearchModal {...props()} />);
  view.rerender(<VideoSearchModal {...props('12345678901')} />);
  await waitFor(() => expect(view.container.querySelector('video')?.getAttribute('src')).toContain('session=new'));
  await act(async () => { finish(await response({ session: 'old', status: 'error', code: 'SIGN_IN_REQUIRED' })); });
  expect(view.container.querySelector('video')?.getAttribute('src')).toContain('session=new');
  expect(fetchMock).toHaveBeenCalledWith('/api/youtube/preview-prepare?session=old', expect.objectContaining({ method: 'DELETE' }));
});
