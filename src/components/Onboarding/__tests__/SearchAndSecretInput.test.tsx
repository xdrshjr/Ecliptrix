/**
 * The web-search step (save → test → continue / continue anyway / skip) and
 * the SecretInput field.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityStatus } from '@/lib/api/setupStatus';
import { translations } from '@/lib/i18n';
import SetupWizard from '../SetupWizard';
import SecretInput from '../wizard/SecretInput';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api/http-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/http-client')>()),
  http: api,
}));
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

const copy = translations.en.setupWizard;

const ONLY_SEARCH_MISSING: CapabilityStatus[] = [
  { id: 'chat', tier: 'core', state: 'ready', source: 'database' },
  { id: 'web_search', tier: 'extended', state: 'missing', source: 'none' },
];

function renderSearchOnly(onClose = vi.fn()) {
  render(
    <SetupWizard
      mode="auto"
      capabilities={ONLY_SEARCH_MISSING}
      optOuts={[]}
      onClose={onClose}
      onOpenSettings={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: copy.resume }));
  return onClose;
}

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  window.localStorage.clear();
  api.put.mockResolvedValue({ success: true, data: { configured: true, key_count: 1 } });
});

describe('search step', () => {
  it('goes overview → search → done and saves the pasted keys', async () => {
    api.post.mockResolvedValue({ success: true, data: { configured: true, reachable: true } });
    renderSearchOnly();

    fireEvent.change(await screen.findByLabelText(copy.searchKeys), {
      target: { value: 'tvly-a\ntvly-b' },
    });
    fireEvent.click(screen.getByRole('button', { name: copy.saveTest }));

    await screen.findByText(copy.donePartialTitle);
    expect(api.put).toHaveBeenCalledWith(
      '/api/web-research/credentials',
      { tavily_api_keys: ['tvly-a', 'tvly-b'] },
      expect.anything(),
    );
  });

  it('keeps the saved keys and offers "continue anyway" when the test fails', async () => {
    api.post.mockResolvedValue({
      success: true,
      data: { configured: true, reachable: false, error_code: 'provider_rejected' },
    });
    renderSearchOnly();

    fireEvent.change(await screen.findByLabelText(copy.searchKeys), { target: { value: 'tvly-a' } });
    fireEvent.click(screen.getByRole('button', { name: copy.saveTest }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      translations.en.webResearch.credentialsRejected);
    fireEvent.click(screen.getByRole('button', { name: copy.saveAnyway }));
    await screen.findByText(copy.donePartialTitle);
  });

  it('refuses more than three keys without sending anything', async () => {
    renderSearchOnly();
    fireEvent.change(await screen.findByLabelText(copy.searchKeys), {
      target: { value: 'a\nb\nc\nd' },
    });
    fireEvent.click(screen.getByRole('button', { name: copy.saveTest }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Up to 3 keys');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('remembers "skip web search" across launches and moves on', async () => {
    renderSearchOnly();
    fireEvent.click(await screen.findByRole('button', { name: copy.skipSearch }));
    await screen.findByText(copy.donePartialTitle);
    expect(window.localStorage.getItem('ecliptrix-setup-optouts')).toBe('["web_search"]');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('shows a generic error when saving throws, without leaking the key', async () => {
    api.put.mockRejectedValue(new Error('boom tvly-secret'));
    renderSearchOnly();
    fireEvent.change(await screen.findByLabelText(copy.searchKeys), { target: { value: 'tvly-secret' } });
    fireEvent.click(screen.getByRole('button', { name: copy.saveTest }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(copy.err.generic);
    expect(alert).not.toHaveTextContent('tvly-secret');
  });
});

describe('SecretInput', () => {
  function Harness({ initial = '' }: { initial?: string }) {
    const [value, setValue] = React.useState(initial);
    return <SecretInput id="k" label="Key" value={value} onChange={setValue} />;
  }

  it('is masked by default and toggles visibility', () => {
    render(<Harness initial="sk-1" />);
    const input = screen.getByLabelText('Key') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: copy.showKey }));
    expect(input.type).toBe('text');
    expect(screen.getByRole('button', { name: copy.hideKey })).toHaveAttribute('aria-pressed', 'true');
  });

  it('trims what is pasted or typed (stray newline from a copied key)', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Key') as HTMLInputElement;
    fireEvent.paste(input, { clipboardData: { getData: () => '  sk-abc\n' } });
    expect(input.value).toBe('sk-abc');
    fireEvent.change(input, { target: { value: 'sk-abc ' } });
    expect(input.value).toBe('sk-abc');
  });

  it('flags a template placeholder', () => {
    render(<Harness initial="your_llm_api_key_here" />);
    expect(screen.getByRole('alert')).toHaveTextContent(copy.err.keyPlaceholder);
    expect(screen.getByLabelText('Key')).toHaveAttribute('aria-invalid', 'true');
  });

  it('disables autofill and spellcheck for secrets', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Key');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');
  });
});
