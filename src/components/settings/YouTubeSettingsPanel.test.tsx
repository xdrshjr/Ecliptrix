import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import YouTubeSettingsPanel from './YouTubeSettingsPanel';

vi.mock('@/contexts/LocaleContext', () => ({ useLocale: () => ({ t: translations['zh-CN'] }) }));
vi.mock('@/contexts/NotificationContext', () => ({ useNotification: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }));
vi.mock('./components/useSettingsPanel', () => ({ useSettingsPanel: () => ({
  settings: {}, loading: false, saving: false, isDirty: false, updateSetting: vi.fn(),
  saveSettings: vi.fn(), resetToDefaults: vi.fn(),
}) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('读取实际 worker 版本和更新记录，手工检查提交后台任务', async () => {
  const status = { active_version: '2026.10.26', available_version: '2026.11.20', status: 'ready',
    last_checked_at: null, last_updated_at: null, last_result: null, error: null,
    history: [{ old_version: '2026.8.19', new_version: '2026.10.26', result: 'activated', checked_at: null }] };
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => status }));
  vi.stubGlobal('fetch', fetchMock);
  render(<YouTubeSettingsPanel />);
  await screen.findByText('2026.10.26', { selector: 'dd' });
  expect(screen.getByText(/2026.8.19 → 2026.10.26/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/youtube/runtime/check', { method: 'POST' }));
});
