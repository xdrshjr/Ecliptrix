import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '@/lib/api/skillrouter';
import type { SkillRouterCatalog, SkillRouterStatus } from '@/lib/api/skillrouter';
import { translations } from '@/lib/i18n';
import SkillRouterSettingsPanel from '@/components/settings/SkillRouterSettingsPanel';

const notify = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations['zh-CN'], locale: 'zh-CN' }),
}));
vi.mock('@/contexts/NotificationContext', () => ({
  useNotification: () => notify,
}));

const t = translations['zh-CN'];
const copy = t.skillrouter.panel;

function makeStatus(overrides: Partial<SkillRouterStatus> = {}): SkillRouterStatus {
  return {
    mode: 'manual',
    modeState: 'manual',
    baseUrl: 'https://www.skillrouter.net',
    keyConfigured: false,
    keyHint: null,
    enabled: true,
    manualCapabilities: [],
    slotModels: {},
    defaults: {},
    lastVerified: null,
    revision: 'r1',
    ...overrides,
  };
}

const catalog: SkillRouterCatalog = {
  models: [{ id: 'ecliptrix-chat', label: 'Chat', protocol: 'route', isRoute: true }],
  capabilities: [],
  defaults: { chat: 'ecliptrix-chat' },
  stale: false,
  fetchedAt: null,
  error: null,
};

const ROUTER_CARD = new RegExp(t.skillrouter.chooser.router.title);
const MANUAL_CARD = new RegExp(t.skillrouter.chooser.manual.title);

beforeEach(() => {
  notify.showSuccess.mockReset();
  notify.showError.mockReset();
  vi.spyOn(client, 'getSkillRouterCatalog').mockResolvedValue(catalog);
});
afterEach(() => vi.restoreAllMocks());

describe('SkillRouterSettingsPanel', () => {
  it('shows a skeleton, not a spinner, while loading', () => {
    vi.spyOn(client, 'getSkillRouter').mockReturnValue(new Promise(() => undefined));
    const { container } = render(<SkillRouterSettingsPanel />);
    expect(container.querySelectorAll('.sr-skeleton').length).toBeGreaterThan(0);
    expect(container.querySelector('.animate-spin')).toBeNull();
  });

  it('offers a retry when the status cannot be read', async () => {
    const read = vi.spyOn(client, 'getSkillRouter').mockRejectedValueOnce(new Error('down'));
    read.mockResolvedValue(makeStatus());
    render(<SkillRouterSettingsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: copy.retry }));
    await screen.findByRole('radiogroup', { name: t.skillrouter.chooser.label });
  });

  it('does not switch to the relay without a key: it expands the connection card instead', async () => {
    vi.spyOn(client, 'getSkillRouter').mockResolvedValue(makeStatus());
    const update = vi.spyOn(client, 'updateSkillRouter');
    render(<SkillRouterSettingsPanel />);
    fireEvent.click(await screen.findByRole('radio', { name: ROUTER_CARD }));
    expect(await screen.findByLabelText(t.skillrouter.connect.keyLabel)).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
    expect(notify.showSuccess).not.toHaveBeenCalled();
  });

  it('switches to the relay with a saved key and says the manual setup is kept', async () => {
    vi.spyOn(client, 'getSkillRouter').mockResolvedValue(
      makeStatus({ keyConfigured: true, keyHint: 'ar-…****abcd' }),
    );
    const update = vi
      .spyOn(client, 'updateSkillRouter')
      .mockResolvedValue(makeStatus({ mode: 'router', modeState: 'router', keyConfigured: true }));
    render(<SkillRouterSettingsPanel />);
    fireEvent.click(await screen.findByRole('radio', { name: ROUTER_CARD }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ mode: 'router' }));
    await waitFor(() => expect(notify.showSuccess).toHaveBeenCalledWith(copy.switchedToRouter));
    expect(copy.switchedToRouter).toBe('已切换到中转站，手动配置已保留');
  });

  it('keeps the previous choice and reports the error when the switch is rejected', async () => {
    vi.spyOn(client, 'getSkillRouter').mockResolvedValue(
      makeStatus({ keyConfigured: true, keyHint: 'ar-…****abcd' }),
    );
    vi.spyOn(client, 'updateSkillRouter').mockRejectedValue(new Error('offline'));
    render(<SkillRouterSettingsPanel />);
    fireEvent.click(await screen.findByRole('radio', { name: ROUTER_CARD }));
    await waitFor(() => expect(notify.showError).toHaveBeenCalled());
    expect(screen.getByRole('radio', { name: MANUAL_CARD }).getAttribute('aria-checked')).toBe('true');
    expect(notify.showSuccess).not.toHaveBeenCalled();
  });

  it('only shows coverage, models and the privacy note in router mode', async () => {
    const manual = makeStatus({ keyConfigured: true, keyHint: 'ar-…****abcd' });
    const read = vi.spyOn(client, 'getSkillRouter').mockResolvedValue(manual);
    const { unmount } = render(<SkillRouterSettingsPanel />);
    await screen.findByRole('radiogroup', { name: t.skillrouter.chooser.label });
    expect(screen.queryByText(copy.coverageTitle)).toBeNull();
    expect(screen.queryByText(copy.slotsTitle)).toBeNull();
    expect(screen.queryByText(t.skillrouter.connect.privacy)).toBeNull();
    unmount();

    read.mockResolvedValue({ ...manual, mode: 'router', modeState: 'router' });
    render(<SkillRouterSettingsPanel />);
    expect(await screen.findByText(copy.coverageTitle)).toBeTruthy();
    expect(screen.getByText(copy.slotsTitle)).toBeTruthy();
    expect(screen.getByText(t.skillrouter.connect.privacy)).toBeTruthy();
  });

  it('summarises the saved key and never shows more than its hint', async () => {
    vi.spyOn(client, 'getSkillRouter').mockResolvedValue(
      makeStatus({
        keyConfigured: true,
        keyHint: 'ar-…****abcd',
        lastVerified: { ok: true, at: Date.now(), outcome: 'ok' },
      }),
    );
    render(<SkillRouterSettingsPanel />);
    expect((await screen.findByTestId('connection-pill')).textContent).toContain(copy.state.connected);
    expect(screen.getByText(/ar-…\*\*\*\*abcd/)).toBeTruthy();
    expect(screen.getByRole('link', { name: new RegExp(copy.openConsole) })).toBeTruthy();
  });

  it.each([
    [null, copy.state.unverified],
    [{ ok: false, at: 1, outcome: 'invalid_credentials' }, copy.state.invalid],
    [{ ok: false, at: 1, outcome: 'unreachable' }, copy.state.unreachable],
  ] as const)('derives the pill from the last verification (%o)', async (lastVerified, label) => {
    vi.spyOn(client, 'getSkillRouter').mockResolvedValue(
      makeStatus({ keyConfigured: true, keyHint: 'ar-…****abcd', lastVerified }),
    );
    render(<SkillRouterSettingsPanel />);
    expect((await screen.findByTestId('connection-pill')).textContent).toContain(label);
  });

  it('asks before clearing the key and explains it returns to manual mode', async () => {
    vi.spyOn(client, 'getSkillRouter').mockResolvedValue(
      makeStatus({ mode: 'router', modeState: 'router', keyConfigured: true, keyHint: 'ar-…****abcd' }),
    );
    const clear = vi
      .spyOn(client, 'clearSkillRouterKey')
      .mockResolvedValue(makeStatus({ keyConfigured: false }));
    render(<SkillRouterSettingsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: copy.clearKey }));
    expect(screen.getByText(copy.clearConfirmBody)).toBeTruthy();
    expect(clear).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: copy.clearConfirmAction }));
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(notify.showSuccess).toHaveBeenCalledWith(copy.keyCleared));
  });

  it('re-verifies the saved key and shows the verdict inline', async () => {
    vi.spyOn(client, 'getSkillRouter').mockResolvedValue(
      makeStatus({ keyConfigured: true, keyHint: 'ar-…****abcd' }),
    );
    const verify = vi.spyOn(client, 'verifySkillRouter').mockResolvedValue({
      outcome: 'invalid_credentials',
      latencyMs: 3,
      capabilities: [],
      coverage: { routed: [], manualOnly: [] },
    });
    render(<SkillRouterSettingsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: copy.reverify }));
    expect((await screen.findByTestId('verify-verdict')).textContent).toContain(
      t.skillrouter.connect.result.invalid_credentials.title,
    );
    expect(verify).toHaveBeenCalledWith({});
  });

  it('shows the connection card to replace the key without leaving router mode', async () => {
    vi.spyOn(client, 'getSkillRouter').mockResolvedValue(
      makeStatus({ mode: 'router', modeState: 'router', keyConfigured: true, keyHint: 'ar-…****abcd' }),
    );
    render(<SkillRouterSettingsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: copy.replaceKey }));
    expect(await screen.findByLabelText(t.skillrouter.connect.keyLabel)).toBeTruthy();
    expect(screen.getByRole('radio', { name: ROUTER_CARD }).getAttribute('aria-checked')).toBe('true');
  });
});
