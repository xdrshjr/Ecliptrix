/**
 * Settings → 浏览器 (spec §4.7): loads the category, saves through the shared
 * settings endpoint, and keeps consent OUT of system settings (R1-4, AC-C10).
 */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/contexts/LocaleContext';
import BrowserWorkspaceSettingsPanel, {
  BROWSER_LIMITS, BROWSER_SETTING_DEFAULTS, parseHostLines,
} from '../BrowserWorkspaceSettingsPanel';
import SettingsSidebar from '../SettingsSidebar';
import { installBridge, makeState, removeBridge } from '@/components/browser/__tests__/testUtils';

const http = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api/http-client', () => ({
  http, ApiError: class extends Error {}, RateLimitError: class extends Error {},
  TimeoutError: class extends Error {},
}));

function items(overrides: Record<string, unknown> = {}) {
  return Object.entries({ ...BROWSER_SETTING_DEFAULTS, ...overrides }).map(([key, value]) => ({
    key, value, default_value: (BROWSER_SETTING_DEFAULTS as Record<string, unknown>)[key],
    value_type: typeof value, description: '', updated_at: null, updated_by: null,
  }));
}

beforeEach(() => {
  http.get.mockReset();
  http.put.mockReset().mockResolvedValue({ success: true, message: 'ok' });
  http.post.mockReset();
  http.get.mockImplementation((url: string) => (
    url.startsWith('/api/browser-workspace/state')
      ? Promise.resolve({ reachable: true, version: '1.2.3', profiles: 2, tabs: 3 })
      : Promise.resolve({ success: true, settings: items() })));
});
afterEach(() => { cleanup(); removeBridge(); });

const mount = () => render(<LocaleProvider><BrowserWorkspaceSettingsPanel /></LocaleProvider>);

describe('parseHostLines', () => {
  it('trims_lowercases_dedupes_and_caps', () => {
    expect(parseHostLines(' Example.COM \n\nexample.com\r\nfoo.org')).toEqual(['example.com', 'foo.org']);
    const many = Array.from({ length: 150 }, (_, i) => `h${i}.com`).join('\n');
    expect(parseHostLines(many)).toHaveLength(100);
  });
});

describe('BrowserWorkspaceSettingsPanel', () => {
  it('limits_mirror_the_spec_table', () => {
    expect(BROWSER_LIMITS).toEqual({
      session_cookie_ttl_days: [0, 90], max_tabs: [2, 12], agent_max_tabs: [1, 5],
      max_elements: [20, 120], max_actions_per_run: [10, 500], idle_release_seconds: [15, 300],
    });
  });

  it('loads_the_browser_workspace_category_and_shows_the_sections', async () => {
    removeBridge();
    mount();
    expect(await screen.findByText('Master switches')).toBeTruthy();
    expect(http.get).toHaveBeenCalledWith('/api/system-settings/browser_workspace');
    expect(screen.getByText('Safety preferences')).toBeTruthy();
    expect(screen.getByText(/not adversarial boundaries/)).toBeTruthy();
    // No bridge → the desktop-only block degrades to a note, not an error.
    expect(screen.getByRole('note').textContent).toContain('desktop-only');
  });

  it('save_is_disabled_until_dirty_then_puts_the_whole_category', async () => {
    removeBridge();
    mount();
    const save = await screen.findByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Enable the browser workspace' }));
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(http.put).toHaveBeenCalledTimes(1));
    const [url, body] = http.put.mock.calls[0];
    expect(url).toBe('/api/system-settings/browser_workspace');
    expect(body.settings.enabled).toBe(false);
    expect(Object.keys(body.settings)).not.toContain('consent_granted_at');
    expect((await screen.findByText('Saved'))).toBeTruthy();
  });

  it('reports_a_failed_save_as_an_alert', async () => {
    removeBridge();
    http.put.mockRejectedValueOnce(new Error('boom'));
    mount();
    await screen.findByText('Master switches');
    fireEvent.click(screen.getByRole('switch', { name: 'Follow the Agent when it navigates' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Save failed');
  });

  it('shows_a_retry_when_the_category_cannot_be_loaded', async () => {
    removeBridge();
    http.get.mockRejectedValueOnce(new Error('down'));
    mount();
    expect((await screen.findByRole('alert')).textContent).toBe('Could not load settings');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('desktop_consent_is_read_from_the_bridge_and_revoked_over_ipc_not_settings', async () => {
    const bridge = installBridge(makeState({
      profiles: [{ id: 'default', name: 'Default', color: '#fff', loginSiteCount: 0, agentConsent: true }],
    }));
    mount();
    expect(await screen.findByText('Authorised')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(bridge.revokeConsent).toHaveBeenCalledWith('default');
    expect(http.put).not.toHaveBeenCalled();
    expect(await screen.findByText('Reachable')).toBeTruthy();
    expect(screen.getByText('1.2.3')).toBeTruthy();
  });

  it('hides_the_revoke_control_when_the_bridge_method_is_missing', async () => {
    const bridge = installBridge(makeState({
      profiles: [{ id: 'default', name: 'Default', color: '#fff', loginSiteCount: 0, agentConsent: true }],
    }));
    delete (bridge as Record<string, unknown>).revokeConsent;
    mount();
    await screen.findByText('Authorised');
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
  });

  it('clear_all_asks_first_then_clears_every_profile', async () => {
    const bridge = installBridge(makeState());
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Clear all browsing data' }));
    expect(bridge.profiles.clearData).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(bridge.profiles.clearData).toHaveBeenCalledWith('default'));
  });
});

describe('SettingsSidebar', () => {
  it('lists_the_browser_entry_in_the_ai_group', () => {
    const onSelect = vi.fn();
    render(<LocaleProvider><SettingsSidebar activeItem="general" onSelectItem={onSelect} /></LocaleProvider>);
    fireEvent.click(screen.getByText('Let the Agent use a real browser with your sign-ins. Sign-ins stay on this device.'));
    expect(onSelect).toHaveBeenCalledWith('browser');
  });
});
