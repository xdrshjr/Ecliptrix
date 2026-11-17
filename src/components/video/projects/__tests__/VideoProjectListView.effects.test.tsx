import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { readPending, writePending } from '@/lib/effects/pendingWrites';
import VideoProjectListView from '../VideoProjectListView';
const api = vi.hoisted(() => ({ remove: vi.fn(), list: vi.fn(),
  notices: { showError: vi.fn(), showSuccess: vi.fn() } }));
vi.mock('@/lib/api/videoProjects', () => ({ deleteVideoProject: api.remove,
  listVideoProjectCategories: async () => [], listVideoProjects: api.list }));
vi.mock('@/contexts/NotificationContext', () => ({
  useNotification: () => api.notices }));
vi.mock('../ProjectSidebar', () => ({ default: () => null }));
vi.mock('../ProjectCard', () => ({ default: (props: { onDelete: () => void }) =>
  <button onClick={props.onDelete}>delete fixture</button> }));
vi.mock('@/components/ui/ConfirmationDialog', () => ({
  default: (props: { isOpen: boolean; onConfirm: () => void }) =>
    props.isOpen ? <button onClick={props.onConfirm}>confirm fixture</button> : null,
}));
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  api.list.mockResolvedValue({ items: [{ id: 'p', name: 'project' }], total: 1 });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: async (_name: string, _options: unknown,
      callback: () => unknown) => callback(),
  } });
});
afterEach(cleanup);
it.each([true, false])('项目删除成功=%s 时只清理成功删除项目的恢复记录', async success => {
  const record = { schemaVersion: 1 as const, requestId: crypto.randomUUID(),
    draftId: crypto.randomUUID(), expectedVersion: 1,
    profile: 'mp4-1080p' as const, state: 'uncertain' as const,
    createdAt: new Date().toISOString() };
  await writePending('p', 'submission', { ...record, projectId: 'p' }, { kind: 'absent' });
  await writePending('q', 'submission', { ...record, projectId: 'q' }, { kind: 'absent' });
  let finish!: () => void;
  api.remove.mockImplementation(() => new Promise<void>((resolve, reject) => {
    finish = () => success ? resolve() : reject(new Error('HTTP 503'));
  }));
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<LocaleProvider><VideoProjectListView onOpenProject={vi.fn()} /></LocaleProvider>);
  fireEvent.click(await screen.findByText('delete fixture'));
  fireEvent.click(screen.getByText('confirm fixture'));
  expect((await readPending('p', 'submission')).record).toBeTruthy();
  await act(async () => { finish(); });
  expect(Boolean((await readPending('p', 'submission')).record)).toBe(!success);
  expect((await readPending('q', 'submission')).record).toBeTruthy();
  if (!success) expect(api.notices.showError).toHaveBeenCalledOnce();
  logged.mockRestore();
});
