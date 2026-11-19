import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '@/lib/api/skillrouter';
import type { SkillRouterCatalog, SkillRouterStatus } from '@/lib/api/skillrouter';
import { SETUP_CONFIG_UPDATED_EVENT } from '@/lib/setupEvents';
import { translations } from '@/lib/i18n';
import RoutedNotice from '../RoutedNotice';
import RouterModelSlots from '../RouterModelSlots';
import RouterQuotaMeter from '../RouterQuotaMeter';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations['zh-CN'], locale: 'zh-CN' }),
}));

const t = translations['zh-CN'];

function makeStatus(overrides: Partial<SkillRouterStatus> = {}): SkillRouterStatus {
  return {
    mode: 'router',
    modeState: 'router',
    baseUrl: 'https://www.skillrouter.net',
    keyConfigured: true,
    keyHint: 'ar-…****abcd',
    enabled: true,
    manualCapabilities: [],
    slotModels: {},
    defaults: {},
    lastVerified: null,
    revision: 'r1',
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('RoutedNotice', () => {
  it('renders nothing in manual mode', async () => {
    const read = vi
      .spyOn(client, 'getSkillRouter')
      .mockResolvedValue(makeStatus({ mode: 'manual', modeState: 'manual' }));
    const { container } = render(<RoutedNotice capability="tts" />);
    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('renders nothing for a capability the relay does not offer or that is overridden', async () => {
    vi.spyOn(client, 'getSkillRouter').mockResolvedValue(makeStatus({ manualCapabilities: ['tts'] }));
    const first = render(<RoutedNotice capability="tts" />);
    const second = render(<RoutedNotice capability="web_search" />);
    await act(async () => undefined);
    expect(first.container.textContent).toBe('');
    expect(second.container.textContent).toBe('');
  });

  it('shows the grey banner for a routed capability', async () => {
    vi.spyOn(client, 'getSkillRouter').mockResolvedValue(makeStatus());
    render(<RoutedNotice capability="tts" />);
    expect(await screen.findByText(new RegExp(t.skillrouter.notice.routed))).toBeTruthy();
    expect(screen.getByRole('button', { name: t.skillrouter.notice.useOwn })).toBeTruthy();
  });

  it('treats the legacy coding slot as chat', async () => {
    vi.spyOn(client, 'getSkillRouter').mockResolvedValue(makeStatus());
    render(<RoutedNotice capability="coding" />);
    expect(await screen.findByRole('note')).toBeTruthy();
  });

  it('adds only that capability to the own-configuration list, then disappears', async () => {
    vi.spyOn(client, 'getSkillRouter').mockResolvedValue(makeStatus({ manualCapabilities: ['ai_image'] }));
    const update = vi
      .spyOn(client, 'updateSkillRouter')
      .mockResolvedValue(makeStatus({ manualCapabilities: ['tts', 'ai_image'] }));
    render(<RoutedNotice capability="tts" />);
    fireEvent.click(await screen.findByRole('button', { name: t.skillrouter.notice.useOwn }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ manualCapabilities: ['tts', 'ai_image'] }));
    await waitFor(() => expect(screen.queryByRole('note')).toBeNull());
  });

  it('stays visible and explains the failure when the switch is rejected', async () => {
    vi.spyOn(client, 'getSkillRouter').mockResolvedValue(makeStatus());
    vi.spyOn(client, 'updateSkillRouter').mockRejectedValue(new Error('offline'));
    render(<RoutedNotice capability="tts" />);
    fireEvent.click(await screen.findByRole('button', { name: t.skillrouter.notice.useOwn }));
    expect((await screen.findByRole('alert')).textContent).toContain(t.routerErrors.unknown.title);
    expect(screen.getByRole('note')).toBeTruthy();
  });

  it('re-reads the status when another panel changes the configuration', async () => {
    const read = vi.spyOn(client, 'getSkillRouter').mockResolvedValue(makeStatus());
    render(<RoutedNotice capability="tts" />);
    await screen.findByRole('note');
    read.mockResolvedValue(makeStatus({ manualCapabilities: ['tts'] }));
    act(() => {
      window.dispatchEvent(new Event(SETUP_CONFIG_UPDATED_EVENT));
    });
    await waitFor(() => expect(screen.queryByRole('note')).toBeNull());
  });
});

const catalog: SkillRouterCatalog = {
  models: [
    { id: 'ecliptrix-chat', label: 'Ecliptrix Chat', protocol: 'route', isRoute: true },
    { id: 'claude-sonnet', label: 'Claude Sonnet', protocol: 'anthropic', isRoute: false },
    { id: 'gpt-mini', label: 'GPT Mini', protocol: 'openai', isRoute: false },
  ],
  capabilities: [],
  defaults: { chat: 'ecliptrix-chat', fast: 'gpt-mini' },
  stale: false,
  fetchedAt: null,
  error: null,
};

interface SlotsProps {
  status?: SkillRouterStatus;
  catalogValue?: SkillRouterCatalog | null;
  catalogState?: 'loading' | 'ready' | 'error';
  onSave?: (patch: client.SkillRouterPatch) => Promise<{ ok: true; status: SkillRouterStatus }>;
  onRefreshCatalog?: (force: boolean) => Promise<void>;
}

function renderSlots({
  status = makeStatus({ defaults: catalog.defaults }),
  catalogValue = catalog,
  catalogState = 'ready',
  onSave = vi.fn().mockResolvedValue({ ok: true, status }),
  onRefreshCatalog = vi.fn().mockResolvedValue(undefined),
}: SlotsProps = {}) {
  render(
    <RouterModelSlots
      status={status}
      catalog={catalogValue}
      catalogState={catalogState}
      onSave={onSave}
      onRefreshCatalog={onRefreshCatalog}
    />,
  );
  return { onSave, onRefreshCatalog };
}

const select = (slot: keyof typeof t.setupWizard.cap) =>
  screen.getByLabelText(t.setupWizard.cap[slot].name) as HTMLSelectElement;

describe('RouterModelSlots', () => {
  it('pre-fills the recommendation and marks it', () => {
    renderSlots();
    expect(select('chat').value).toBe('ecliptrix-chat');
    expect(select('fast').value).toBe('gpt-mini');
    expect(screen.getAllByText(t.skillrouter.slots.recommended).length).toBeGreaterThanOrEqual(2);
  });

  it('prefers the saved model over the recommendation', () => {
    renderSlots({ status: makeStatus({ defaults: catalog.defaults, slotModels: { chat: 'claude-sonnet' } }) });
    expect(select('chat').value).toBe('claude-sonnet');
  });

  it('saves the pick together with its protocol', async () => {
    const { onSave } = renderSlots();
    fireEvent.change(select('chat'), { target: { value: 'claude-sonnet' } });
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        slotModels: { chat: 'claude-sonnet' },
        slotProtocols: { chat: 'anthropic' },
      }),
    );
  });

  it('sends no protocol for an operator route (it works over both)', async () => {
    const { onSave } = renderSlots({
      status: makeStatus({ defaults: catalog.defaults, slotModels: { chat: 'gpt-mini' } }),
    });
    fireEvent.change(select('chat'), { target: { value: 'ecliptrix-chat' } });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ slotModels: { chat: 'ecliptrix-chat' } }));
  });

  it('tests one slot and reports success in the live region', async () => {
    renderSlots();
    vi.spyOn(client, 'testSkillRouterSlot').mockResolvedValue({
      ok: true,
      message: 'ok',
      latencyMs: 321,
      model: 'ecliptrix-chat',
    });
    const row = select('chat').closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: t.skillrouter.slots.test }));
    await waitFor(() => expect(within(row).getByRole('status').textContent).toContain('321 ms'));
    expect(client.testSkillRouterSlot).toHaveBeenCalledWith('chat');
  });

  it('reports a failed test with the reason', async () => {
    renderSlots();
    vi.spyOn(client, 'testSkillRouterSlot').mockResolvedValue({
      ok: false,
      message: 'HTTP 401',
      latencyMs: null,
      model: null,
    });
    const row = select('fast').closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: t.skillrouter.slots.test }));
    await waitFor(() => expect(within(row).getByRole('status').textContent).toContain('HTTP 401'));
  });

  it('forces a refresh from the button', () => {
    const { onRefreshCatalog } = renderSlots();
    fireEvent.click(screen.getByRole('button', { name: t.skillrouter.slots.refresh }));
    expect(onRefreshCatalog).toHaveBeenCalledWith(true);
  });

  it('explains an empty model list and lets the user retry', () => {
    const { onRefreshCatalog } = renderSlots({ catalogValue: { ...catalog, models: [] } });
    expect(screen.getByText(t.skillrouter.slots.emptyTitle)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t.skillrouter.slots.retry }));
    expect(onRefreshCatalog).toHaveBeenCalledWith(true);
  });

  it('shows skeletons while loading and an error state when loading fails', () => {
    const { container } = render(
      <RouterModelSlots
        status={makeStatus()}
        catalog={null}
        catalogState="loading"
        onSave={vi.fn()}
        onRefreshCatalog={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('.sr-skeleton').length).toBe(5);
    render(
      <RouterModelSlots
        status={makeStatus()}
        catalog={null}
        catalogState="error"
        onSave={vi.fn()}
        onRefreshCatalog={vi.fn()}
      />,
    );
    expect(screen.getByText(t.skillrouter.slots.loadFailed)).toBeTruthy();
  });
});

describe('RouterQuotaMeter', () => {
  const quota = (remaining: number) => ({
    unit: 'calls',
    dailyLimit: 100,
    used: 100 - remaining,
    remaining,
    resetsAt: new Date(2026, 0, 1, 9, 30).getTime(),
  });

  it('renders nothing without a limit', () => {
    const { container } = render(<RouterQuotaMeter quota={null} />);
    expect(container.textContent).toBe('');
  });

  it('exposes the remaining allowance and the local reset time', () => {
    render(<RouterQuotaMeter quota={quota(60)} />);
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('60');
    expect(meter.getAttribute('aria-valuemax')).toBe('100');
    expect(screen.getByText(/09:30/)).toBeTruthy();
  });

  it.each([
    [5, t.skillrouter.quota.low],
    [0, t.skillrouter.quota.exhausted],
  ])('warns in words when %i is left', (remaining, message) => {
    render(<RouterQuotaMeter quota={quota(remaining)} />);
    expect(screen.getByText(new RegExp(message))).toBeTruthy();
  });
});
