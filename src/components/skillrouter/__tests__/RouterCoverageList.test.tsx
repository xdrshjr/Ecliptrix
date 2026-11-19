import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/http-client';
import * as client from '@/lib/api/skillrouter';
import type { SkillRouterCatalog, SkillRouterStatus } from '@/lib/api/skillrouter';
import { translations } from '@/lib/i18n';
import RouterCoverageList from '../RouterCoverageList';
import { useSkillRouter } from '../useSkillRouter';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations['zh-CN'], locale: 'zh-CN' }),
}));

const t = translations['zh-CN'];
const sourceCopy = t.skillrouter.coverage.source;

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

const catalog: SkillRouterCatalog = {
  models: [],
  capabilities: [
    {
      id: 'tts',
      available: true,
      unavailableReason: null,
      quota: { unit: 'calls', dailyLimit: 100, used: 95, remaining: 5, resetsAt: null },
    },
    { id: 'ai_video', available: false, unavailableReason: 'tier_denied', quota: null },
  ],
  defaults: {},
  stale: false,
  fetchedAt: null,
  error: null,
};

const Harness: React.FC = () => {
  const router = useSkillRouter({ withCatalog: true });
  if (!router.status) return <p>loading</p>;
  return (
    <RouterCoverageList
      status={router.status}
      capabilities={router.catalog?.capabilities ?? []}
      onSave={router.save}
    />
  );
};

const group = (name: string) => screen.getByRole('radiogroup', { name: new RegExp(`^${name} ·`) });
const choice = (name: string, label: string) =>
  within(group(name)).getByRole('radio', { name: label });

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.spyOn(client, 'getSkillRouterCatalog').mockResolvedValue(catalog);
});
afterEach(() => vi.restoreAllMocks());

describe('RouterCoverageList', () => {
  it('lists every capability with its source, and disables the three manual-only rows', async () => {
    vi.spyOn(client, 'getSkillRouter').mockResolvedValue(makeStatus());
    render(<Harness />);
    await screen.findByRole('radiogroup', { name: new RegExp(`^${t.setupWizard.cap.chat.name} ·`) });
    expect(screen.getAllByRole('radiogroup')).toHaveLength(14);
    for (const id of ['web_search', 'asr', 'voice_clone'] as const) {
      const name = t.setupWizard.cap[id].name;
      expect(choice(name, sourceCopy.manual).getAttribute('aria-checked')).toBe('true');
      expect((choice(name, sourceCopy.router) as HTMLButtonElement).disabled).toBe(true);
      expect((choice(name, sourceCopy.manual) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getAllByText(t.skillrouter.coverage.manualOnlyNote)).toHaveLength(3);
  });

  it('shows availability and quota in words, not colour alone', async () => {
    vi.spyOn(client, 'getSkillRouter').mockResolvedValue(makeStatus());
    render(<Harness />);
    await screen.findAllByRole('meter');
    expect(screen.getByText(new RegExp(t.skillrouter.coverage.unavailable))).toBeTruthy();
    expect(screen.getByText(new RegExp(t.skillrouter.quota.low))).toBeTruthy();
  });

  it('writes the choice immediately and keeps it after the server confirms', async () => {
    vi.spyOn(client, 'getSkillRouter').mockResolvedValue(makeStatus());
    const write = deferred<SkillRouterStatus>();
    const update = vi.spyOn(client, 'updateSkillRouter').mockReturnValue(write.promise);
    render(<Harness />);
    await screen.findAllByRole('meter');
    const name = t.setupWizard.cap.tts.name;

    fireEvent.click(choice(name, sourceCopy.manual));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ manualCapabilities: ['tts'] }));
    // optimistic: already switched while the request is in flight
    await waitFor(() => expect(choice(name, sourceCopy.manual).getAttribute('aria-checked')).toBe('true'));
    expect(group(name).getAttribute('aria-busy')).toBe('true');

    await act(async () => write.resolve(makeStatus({ manualCapabilities: ['tts'] })));
    await waitFor(() => expect(group(name).getAttribute('aria-busy')).toBeNull());
    expect(choice(name, sourceCopy.manual).getAttribute('aria-checked')).toBe('true');
  });

  it('rolls the row back and says why when the save fails', async () => {
    const getStatus = vi.spyOn(client, 'getSkillRouter').mockResolvedValue(makeStatus());
    vi.spyOn(client, 'updateSkillRouter').mockRejectedValue(
      new ApiError(409, 'router_key_invalid', 'revoked'),
    );
    render(<Harness />);
    await screen.findAllByRole('meter');
    const name = t.setupWizard.cap.tts.name;

    fireEvent.click(choice(name, sourceCopy.manual));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t.routerErrors.router_key_invalid.title);
    expect(choice(name, sourceCopy.router).getAttribute('aria-checked')).toBe('true');
    expect(choice(name, sourceCopy.manual).getAttribute('aria-checked')).toBe('false');
    // the server is asked again so the screen cannot drift from the stored truth
    await waitFor(() => expect(getStatus.mock.calls.length).toBeGreaterThan(1));
  });

  it('keeps the stored order when several capabilities use their own configuration', async () => {
    vi.spyOn(client, 'getSkillRouter').mockResolvedValue(makeStatus({ manualCapabilities: ['ai_image'] }));
    const update = vi
      .spyOn(client, 'updateSkillRouter')
      .mockResolvedValue(makeStatus({ manualCapabilities: ['chat', 'ai_image'] }));
    render(<Harness />);
    await screen.findAllByRole('meter');
    fireEvent.click(choice(t.setupWizard.cap.chat.name, sourceCopy.manual));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith({ manualCapabilities: ['chat', 'ai_image'] });
  });

  it('moves between the two choices with the arrow keys', async () => {
    vi.spyOn(client, 'getSkillRouter').mockResolvedValue(makeStatus());
    const update = vi.spyOn(client, 'updateSkillRouter').mockResolvedValue(makeStatus());
    render(<Harness />);
    await screen.findAllByRole('meter');
    const name = t.setupWizard.cap.fast.name;
    fireEvent.keyDown(choice(name, sourceCopy.router), { key: 'ArrowRight' });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ manualCapabilities: ['fast'] }));
  });
});
