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

// ---------------------------------------------------------------------------
// 布局行语法契约（analysis.md §九 三·E0/E2/E3/E5）：三栏栏头等高、内边距一致、
// 底部固定条高度恒定且分页不再位于滚动容器内。
// ---------------------------------------------------------------------------
const layoutProps = (overrides: Record<string, unknown> = {}) => ({
  ...props(), youtubePreviewVideo: null, ...overrides,
} as unknown as UseVideoSearchReturn);
const pane = (container: HTMLElement, name: string) => {
  const element = container.querySelector(`[data-pane="${name}"]`);
  expect(element).toBeTruthy();
  return element as HTMLElement;
};
const roleOf = (container: HTMLElement, name: string, role: string) => {
  const element = pane(container, name).querySelector(`[data-pane-${role}]`);
  expect(element).toBeTruthy();
  return element as HTMLElement;
};

it('三栏共用一套行语法：栏头 h-11 px-6 等高等距，底条 h-[52px] 恒定', () => {
  const view = render(<VideoSearchModal {...layoutProps()} />);
  for (const name of ['preview', 'results', 'selected']) {
    const head = roleOf(view.container, name, 'head');
    expect(head.className).toContain('h-11');
    expect(head.className).toContain('px-6');
    expect(head.className).toContain('shrink-0');
    const foot = roleOf(view.container, name, 'foot');
    expect(foot.className).toContain('h-[52px]');
    expect(foot.className).toContain('shrink-0');
  }
});

it('分页位于中栏底条内、不在滚动容器内，且单页时底条照常渲染', () => {
  const results = Array.from({ length: 25 }, (_, index) => video(`vid${index}`));
  const view = render(<VideoSearchModal {...layoutProps({ youtubeSearchResults: results, totalPages: 2 })} />);
  const foot = roleOf(view.container, 'results', 'foot');
  const next = screen.getByRole('button', { name: translations['zh-CN'].videoSearchModal.nextPage });
  expect(foot.contains(next)).toBe(true);
  expect(next.closest('[data-pane-scroll]')).toBeNull();

  cleanup();
  const single = render(<VideoSearchModal {...layoutProps({ youtubeSearchResults: [video('only')], totalPages: 1 })} />);
  const singleFoot = roleOf(single.container, 'results', 'foot');
  expect(singleFoot.className).toContain('h-[52px]');
  expect(singleFoot.textContent).toContain('第 1 / 1 页');
});

it('预览撑满本栏：媒体盒保留软下限、不再有 max-h 上限，<video> 无 inline maxHeight', async () => {
  fetchMock.mockImplementation((_url: string, init?: RequestInit) => response(init?.method === 'DELETE' ? {}
    : { session: 's3', status: 'ready', stream_url: '/api/youtube/preview-stream?session=s3' }));
  const view = render(<VideoSearchModal {...layoutProps({ youtubePreviewVideo: video('abcdefghijk') })} />);
  const stage = roleOf(view.container, 'preview', 'scroll');
  const mediaBox = stage.firstElementChild as HTMLElement;
  expect(mediaBox.className).toContain('min-h-[140px]');
  expect(mediaBox.className).not.toContain('max-h');
  await waitFor(() => expect(view.container.querySelector('video')).toBeTruthy());
  const player = view.container.querySelector('video') as HTMLVideoElement;
  expect(player.getAttribute('style') || '').not.toContain('max-height');
  expect(player.className).not.toContain('max-h');
});

// ---------------------------------------------------------------------------
// 评审补测（F-7/F-8）：统计 chip 与右栏徽章必须报同一个已选数；校验错误浮层
// 必须限宽在本栏内，不能横跨到中栏底条压住「上一页 / 下一页」。
// ---------------------------------------------------------------------------
it('中栏统计与右栏徽章报同一个已选数，忽略不在当前结果里的历史选中项', () => {
  const view = render(<VideoSearchModal {...layoutProps({
    youtubeSearchResults: [video('keep'), video('other')],
    youtubeSelectedResults: new Set(['keep', 'stale-not-in-results'])
  })} />);
  const chip = roleOf(view.container, 'results', 'head').querySelector('span') as HTMLElement;
  const badge = roleOf(view.container, 'selected', 'head').querySelector('span') as HTMLElement;
  expect(chip.textContent).toContain('已选择 1 个');
  expect(chip.textContent).not.toContain('已选择 2 个');
  expect(badge.textContent).toBe(`1 ${translations['zh-CN'].videoSearchModal.itemsUnit}`);
});

it('校验错误浮层限宽在本栏内，不横跨中栏底条', () => {
  const results = Array.from({ length: 25 }, (_, index) => video(`vid${index}`));
  const view = render(<VideoSearchModal {...layoutProps({
    youtubeSearchResults: results, totalPages: 2, validationError: '所选视频时长不足'
  })} />);
  const alert = screen.getByRole('alert');
  expect(alert.className).toContain('absolute bottom-full right-6');
  expect(alert.className).toContain('w-[min(24rem');
  expect(alert.className).not.toContain('36rem');
  expect(roleOf(view.container, 'results', 'foot').contains(alert)).toBe(false);
});
