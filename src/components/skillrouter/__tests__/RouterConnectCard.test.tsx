import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/http-client';
import * as client from '@/lib/api/skillrouter';
import type { SkillRouterStatus, SkillRouterVerifyResult } from '@/lib/api/skillrouter';
import { translations } from '@/lib/i18n';
import RouterConnectCard from '../RouterConnectCard';
import { AUTO_VERIFY_DELAY_MS } from '../useRouterConnect';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations['zh-CN'], locale: 'zh-CN' }),
}));

const t = translations['zh-CN'];
const copy = t.skillrouter.connect;
const KEY = 'ar-abcdef1234567890';

function makeStatus(overrides: Partial<SkillRouterStatus> = {}): SkillRouterStatus {
  return {
    mode: 'manual',
    modeState: 'unset',
    baseUrl: 'https://www.skillrouter.net',
    keyConfigured: false,
    keyHint: null,
    enabled: true,
    manualCapabilities: [],
    slotModels: {},
    defaults: {},
    lastVerified: null,
    revision: 'r',
    ...overrides,
  };
}

function verifyResult(overrides: Partial<SkillRouterVerifyResult> = {}): SkillRouterVerifyResult {
  return {
    outcome: 'ok',
    latencyMs: 12,
    capabilities: [
      {
        id: 'tts',
        available: true,
        unavailableReason: null,
        quota: { unit: 'calls', dailyLimit: 100, used: 10, remaining: 90, resetsAt: null },
      },
      { id: 'ai_video', available: false, unavailableReason: 'off', quota: null },
    ],
    coverage: {
      routed: ['chat', 'tts', 'ai_video'],
      manualOnly: ['web_search', 'asr', 'voice_clone'],
    },
    ...overrides,
  };
}

const keyInput = () => screen.getByLabelText(copy.keyLabel) as HTMLInputElement;

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('RouterConnectCard', () => {
  it('masks the key until the user asks to see it', () => {
    render(<RouterConnectCard status={makeStatus()} onSaved={() => undefined} />);
    expect(keyInput().type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: t.setupWizard.showKey }));
    expect(keyInput().type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: t.setupWizard.hideKey }));
    expect(keyInput().type).toBe('password');
  });

  it('strips whitespace and newlines from a pasted key', () => {
    render(<RouterConnectCard status={makeStatus()} onSaved={() => undefined} />);
    fireEvent.change(keyInput(), { target: { value: `  ${KEY}\n ` } });
    expect(keyInput().value).toBe(KEY);
  });

  it('only hints, never blocks, a key without the ar- prefix', () => {
    render(<RouterConnectCard status={makeStatus()} onSaved={() => undefined} />);
    fireEvent.change(keyInput(), { target: { value: 'sk-something-else' } });
    expect(screen.getByText(copy.prefixHint)).toBeTruthy();
    expect((screen.getByRole('button', { name: copy.verify }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('verifies on its own 600 ms after a paste, and not before', async () => {
    const verify = vi.spyOn(client, 'verifySkillRouter').mockResolvedValue(verifyResult());
    render(<RouterConnectCard status={makeStatus()} onSaved={() => undefined} />);
    fireEvent.paste(keyInput());
    fireEvent.change(keyInput(), { target: { value: KEY } });
    await act(async () => {
      vi.advanceTimersByTime(AUTO_VERIFY_DELAY_MS - 50);
    });
    expect(verify).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith({ apiKey: KEY, baseUrl: 'https://www.skillrouter.net' });
  });

  it('does not auto-verify while typing, only after a paste', async () => {
    const verify = vi.spyOn(client, 'verifySkillRouter').mockResolvedValue(verifyResult());
    render(<RouterConnectCard status={makeStatus()} onSaved={() => undefined} />);
    fireEvent.change(keyInput(), { target: { value: KEY } });
    await act(async () => {
      vi.advanceTimersByTime(AUTO_VERIFY_DELAY_MS * 2);
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it('respects autoVerify={false}', async () => {
    const verify = vi.spyOn(client, 'verifySkillRouter').mockResolvedValue(verifyResult());
    render(<RouterConnectCard status={makeStatus()} onSaved={() => undefined} autoVerify={false} />);
    fireEvent.paste(keyInput());
    fireEvent.change(keyInput(), { target: { value: KEY } });
    await act(async () => {
      vi.advanceTimersByTime(AUTO_VERIFY_DELAY_MS * 2);
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it('shows coverage, quota and what stays manual after a good check', async () => {
    vi.spyOn(client, 'verifySkillRouter').mockResolvedValue(verifyResult());
    const onVerified = vi.fn();
    render(<RouterConnectCard status={makeStatus()} onSaved={() => undefined} onVerified={onVerified} />);
    fireEvent.change(keyInput(), { target: { value: KEY } });
    fireEvent.click(screen.getByRole('button', { name: copy.verify }));
    const verdict = await screen.findByTestId('verify-verdict');
    expect(verdict.textContent).toContain('12 ms');
    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('list', { name: copy.coverageTitle }).textContent).toContain(
      t.setupWizard.cap.tts.name,
    );
    // an unavailable routed capability is flagged in words, not only colour
    expect(screen.getByText(t.skillrouter.coverage.unavailable)).toBeTruthy();
    expect(screen.getByRole('meter')).toBeTruthy();
    for (const id of ['web_search', 'asr', 'voice_clone'] as const) {
      expect(screen.getByText(new RegExp(t.setupWizard.cap[id].name))).toBeTruthy();
    }
  });

  it.each([
    ['invalid_credentials', copy.result.invalid_credentials.title],
    ['unreachable', copy.result.unreachable.title],
    ['upstream_error', copy.result.upstream_error.title],
    ['unverifiable', copy.result.unverifiable.title],
  ] as const)('explains a %s outcome and offers a next step', async (outcome, title) => {
    vi.spyOn(client, 'verifySkillRouter').mockResolvedValue(
      verifyResult({ outcome, capabilities: [], coverage: { routed: [], manualOnly: [] } }),
    );
    render(<RouterConnectCard status={makeStatus()} onSaved={() => undefined} />);
    fireEvent.change(keyInput(), { target: { value: KEY } });
    fireEvent.click(screen.getByRole('button', { name: copy.verify }));
    expect((await screen.findByTestId('verify-verdict')).textContent).toContain(title);
    expect(screen.queryByText(copy.result.stillManual)).toBeNull();
    const canSaveLater = outcome !== 'invalid_credentials';
    expect(!!screen.queryByRole('button', { name: copy.saveLater })).toBe(canSaveLater);
    expect(!!screen.queryByRole('button', { name: copy.saveAndUse })).toBe(false);
  });

  it('saves with mode router only after a good check, then forgets the key', async () => {
    vi.spyOn(client, 'verifySkillRouter').mockResolvedValue(verifyResult());
    const saved = makeStatus({ mode: 'router', modeState: 'router', keyConfigured: true });
    const update = vi.spyOn(client, 'updateSkillRouter').mockResolvedValue(saved);
    const onSaved = vi.fn();
    render(<RouterConnectCard status={makeStatus()} onSaved={onSaved} />);
    fireEvent.change(keyInput(), { target: { value: KEY } });
    fireEvent.click(screen.getByRole('button', { name: copy.verify }));
    fireEvent.click(await screen.findByRole('button', { name: copy.saveAndUse }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(update).toHaveBeenCalledWith({ mode: 'router', apiKey: KEY });
    expect(keyInput().value).toBe('');
  });

  it('sends a custom relay address only when it was changed', async () => {
    vi.spyOn(client, 'verifySkillRouter').mockResolvedValue(verifyResult());
    const update = vi.spyOn(client, 'updateSkillRouter').mockResolvedValue(makeStatus());
    render(<RouterConnectCard status={makeStatus()} onSaved={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(copy.advanced) }));
    fireEvent.change(screen.getByLabelText(copy.baseUrlLabel), {
      target: { value: 'http://localhost:3000/' },
    });
    fireEvent.change(keyInput(), { target: { value: KEY } });
    fireEvent.click(screen.getByRole('button', { name: copy.verify }));
    fireEvent.click(await screen.findByRole('button', { name: copy.saveAndUse }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith({
      mode: 'router',
      apiKey: KEY,
      baseUrl: 'http://localhost:3000',
    });
  });

  it('shows a described, actionable error when saving is rejected', async () => {
    vi.spyOn(client, 'verifySkillRouter').mockResolvedValue(verifyResult());
    vi.spyOn(client, 'updateSkillRouter').mockRejectedValue(
      new ApiError(422, 'invalid_base_url', 'rejected', { field: 'base_url' }),
    );
    const onSaved = vi.fn();
    render(<RouterConnectCard status={makeStatus()} onSaved={onSaved} />);
    fireEvent.change(keyInput(), { target: { value: KEY } });
    fireEvent.click(screen.getByRole('button', { name: copy.verify }));
    fireEvent.click(await screen.findByRole('button', { name: copy.saveAndUse }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t.routerErrors.invalid_base_url.title);
    expect(keyInput().getAttribute('aria-invalid')).toBe('true');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('can verify a key that is already saved without retyping it', async () => {
    const verify = vi.spyOn(client, 'verifySkillRouter').mockResolvedValue(verifyResult());
    const status = makeStatus({ keyConfigured: true, keyHint: 'ar-…****beef' });
    render(<RouterConnectCard status={status} onSaved={() => undefined} />);
    expect(screen.getByText(/ar-…\*\*\*\*beef/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: copy.verifySaved }));
    await screen.findByTestId('verify-verdict');
    expect(verify).toHaveBeenCalledWith({ baseUrl: 'https://www.skillrouter.net' });
  });

  it('disables verifying while there is nothing to verify', () => {
    render(<RouterConnectCard status={makeStatus()} onSaved={() => undefined} />);
    expect((screen.getByRole('button', { name: copy.verifySaved }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('discards a stale verdict once the key is edited', async () => {
    vi.spyOn(client, 'verifySkillRouter').mockResolvedValue(verifyResult());
    render(<RouterConnectCard status={makeStatus()} onSaved={() => undefined} />);
    fireEvent.change(keyInput(), { target: { value: KEY } });
    fireEvent.click(screen.getByRole('button', { name: copy.verify }));
    await screen.findByTestId('verify-verdict');
    fireEvent.change(keyInput(), { target: { value: `${KEY}x` } });
    expect(screen.queryByTestId('verify-verdict')).toBeNull();
  });

  it('reports whether an unsaved key is typed', () => {
    const onDraftChange = vi.fn();
    render(<RouterConnectCard status={makeStatus()} onSaved={() => undefined} onDraftChange={onDraftChange} />);
    expect(onDraftChange).toHaveBeenLastCalledWith(false);
    fireEvent.change(keyInput(), { target: { value: KEY } });
    expect(onDraftChange).toHaveBeenLastCalledWith(true);
    fireEvent.change(keyInput(), { target: { value: '' } });
    expect(onDraftChange).toHaveBeenLastCalledWith(false);
  });

  it('links to the sign-up page and states the privacy disclosure', () => {
    render(<RouterConnectCard status={makeStatus()} onSaved={() => undefined} />);
    const link = screen.getByRole('link', { name: new RegExp(copy.register) }) as HTMLAnchorElement;
    expect(link.href).toBe('https://www.skillrouter.net/login');
    expect(link.target).toBe('_blank');
    expect(screen.getByText(copy.privacy)).toBeTruthy();
  });
});
