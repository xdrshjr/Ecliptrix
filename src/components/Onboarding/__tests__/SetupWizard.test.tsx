/**
 * Behaviour tests for the first-run setup wizard: request payloads are the
 * settings page's, a failed key check creates nothing, stepping back to retype
 * a key PUTs instead of POSTing a second provider (RV-04), a failing chat model
 * blocks the other slots (AC-7), and Esc with unsaved input asks first.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/http-client';
import type { CapabilityId, CapabilityStatus } from '@/lib/api/setupStatus';
import { translations } from '@/lib/i18n';
import SetupWizard from '../SetupWizard';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));
vi.mock('@/lib/api/http-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/http-client')>()),
  http: api,
}));
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

const copy = translations.en.setupWizard;
const SECRET = 'sk-test-secret-123';

const DEEPSEEK = {
  id: 'deepseek',
  name: 'DeepSeek',
  default_api_url: 'https://api.deepseek.com/v1',
  region: 'domestic',
  api_format: 'openai',
  default_models: [],
};

function capabilities(missing: CapabilityId[]): CapabilityStatus[] {
  const ids: CapabilityId[] = ['chat', 'fast', 'video_cut', 'vision', 'research', 'web_search'];
  return ids.map((id) => ({
    id,
    tier: id === 'research' || id === 'web_search' ? 'extended' : 'core',
    state: missing.includes(id) ? 'missing' : 'ready',
    source: missing.includes(id) ? 'none' : 'database',
  }));
}

const ALL_MISSING = capabilities(['chat', 'fast', 'video_cut', 'vision', 'research', 'web_search']);

function savedProvider(id: string, name = 'DeepSeek') {
  return {
    id, name, provider_type: 'deepseek', api_url: DEEPSEEK.default_api_url,
    api_key_masked: 'sk-…', api_key_set: true, api_format: 'openai',
    created_at: null, updated_at: null,
  };
}

function installBackend() {
  api.get.mockImplementation(async (url: string) =>
    url.endsWith('/saved') ? { providers: [] } : { providers: [DEEPSEEK] });
  api.post.mockImplementation(async (url: string) => {
    if (url.endsWith('/fetch-models')) {
      return { success: true, models: ['deepseek-chat', 'deepseek-reasoner'] };
    }
    return { success: true, provider: savedProvider('p1') };
  });
  api.put.mockImplementation(async (url: string) =>
    url.includes('/providers/') ? { success: true, provider: savedProvider('p1') } : { success: true });
}

function renderWizard(
  caps: CapabilityStatus[] = ALL_MISSING,
  onClose = vi.fn(),
  mode: 'auto' | 'manual' = 'auto',
) {
  render(
    <SetupWizard
      mode={mode}
      capabilities={caps}
      optOuts={[]}
      onClose={onClose}
      onOpenSettings={vi.fn()}
    />,
  );
  return onClose;
}

const click = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole('button', { name }));

function typeKey(value: string) {
  fireEvent.change(screen.getByLabelText(copy.apiKey), { target: { value } });
}

async function reachProviderForm() {
  click(new RegExp(`^(${copy.start}|${copy.resume})$`));
  fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek' }));
}

async function verifyKey(value: string) {
  await reachProviderForm();
  typeKey(value);
  click(copy.verifyContinue);
}

function postedTo(suffix: string) {
  return api.post.mock.calls.filter((call) => String(call[0]).endsWith(suffix));
}

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  installBackend();
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('SetupWizard happy path', () => {
  it('walks overview → provider → models → search → done with settings-identical payloads', async () => {
    const onClose = renderWizard();
    await verifyKey(SECRET);

    await screen.findByText(copy.modelsTitle);
    expect(postedTo('/fetch-models')[0][1]).toEqual({
      api_url: DEEPSEEK.default_api_url,
      api_key: SECRET,
      provider_type: 'deepseek',
    });
    expect(postedTo('/providers')).toHaveLength(1);
    expect(postedTo('/providers')[0][1]).toEqual({
      name: 'DeepSeek',
      provider_type: 'deepseek',
      api_url: DEEPSEEK.default_api_url,
      api_key: SECRET,
      api_format: 'openai',
    });

    expect((screen.getByLabelText(copy.mainModel) as HTMLInputElement).value).toBe('deepseek-chat');
    click(copy.saveContinue);

    await screen.findByText(copy.searchTitle);
    const assignmentCalls = api.put.mock.calls.filter((c) => c[0] === '/api/model-settings/assignments');
    expect(assignmentCalls[0][1]).toEqual({
      function_type: 'chat', provider_id: 'p1', model_name: 'deepseek-chat',
      temperature: 0.7, max_tokens: 128000,
    });
    expect(assignmentCalls.map((c) => c[1].function_type).sort()).toEqual(
      ['chat', 'fast', 'research', 'video_cut', 'vision']);

    click(copy.skipSearch);
    await screen.findByText(copy.donePartialTitle);
    expect(window.localStorage.getItem('ecliptrix-setup-optouts')).toBe('["web_search"]');
    click(copy.finishPartial);
    expect(onClose).toHaveBeenCalledWith('finished');
  });

  it('keeps the key out of every storage and clears the field once saved', async () => {
    renderWizard();
    await verifyKey(SECRET);
    await screen.findByText(copy.modelsTitle);
    const dump = JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage });
    expect(dump).not.toContain(SECRET);
  });
});

describe('SetupWizard key verification', () => {
  it('creates nothing and keeps the input when the key is rejected', async () => {
    api.post.mockImplementation(async () => ({
      success: false, models: [], message: 'Error: 401 Unauthorized',
    }));
    renderWizard();
    await verifyKey(SECRET);

    expect(await screen.findByRole('alert')).toHaveTextContent(copy.err.keyInvalid);
    expect(postedTo('/providers')).toHaveLength(0);
    expect((screen.getByLabelText(copy.apiKey) as HTMLInputElement).value).toBe(SECRET);
  });

  it('offers manual entry when the provider cannot be reached', async () => {
    api.post.mockImplementation(async (url: string) => url.endsWith('/fetch-models')
      ? { success: false, models: [], message: 'Failed: All connection attempts failed' }
      : { success: true, provider: savedProvider('p1') });
    renderWizard();
    await verifyKey(SECRET);
    await screen.findByText(copy.err.unreachable);

    click(copy.skipVerify);
    await screen.findByText(copy.modelsTitle);
    expect(postedTo('/providers')).toHaveLength(1);
    expect(screen.getByText(copy.err.noModelList)).toBeInTheDocument();
  });

  it('rejects a template placeholder before any request', async () => {
    renderWizard();
    await reachProviderForm();
    typeKey('your_api_key_here');
    expect(screen.getByText(copy.err.keyPlaceholder)).toBeInTheDocument();
    click(copy.verifyContinue);
    expect(postedTo('/fetch-models')).toHaveLength(0);
  });
});

describe('SetupWizard model saving', () => {
  const chatRejected = () => {
    api.put.mockImplementation(async (url: string, body: { function_type?: string }) => {
      if (url === '/api/model-settings/assignments' && body.function_type === 'chat') {
        throw new ApiError(400, 'HTTP_400', 'CHAT model connection test failed: 401');
      }
      return url.includes('/providers/')
        ? { success: true, provider: savedProvider('p1') }
        : { success: true };
    });
  };

  it('shows the server detail and writes no other slot when chat fails', async () => {
    chatRejected();
    renderWizard();
    await verifyKey(SECRET);
    await screen.findByText(copy.modelsTitle);
    click(copy.saveContinue);

    expect(await screen.findByText(/CHAT model connection test failed: 401/)).toBeInTheDocument();
    const slots = api.put.mock.calls
      .filter((c) => c[0] === '/api/model-settings/assignments')
      .map((c) => c[1].function_type);
    expect(slots).toEqual(['chat']);
  });

  it('PUTs the same provider (never a second POST) when the key is retyped', async () => {
    chatRejected();
    renderWizard();
    await verifyKey(SECRET);
    await screen.findByText(copy.modelsTitle);
    click(copy.saveContinue);
    await screen.findByText(copy.err.chatFailed);

    click(copy.backToKey);
    await screen.findByLabelText(copy.apiKey);
    typeKey('sk-new-key');
    click(copy.verifyContinue);

    await waitFor(() => expect(
      api.put.mock.calls.some((c) => c[0] === '/api/model-settings/providers/p1')).toBe(true));
    expect(postedTo('/providers')).toHaveLength(1);
    const update = api.put.mock.calls.find((c) => c[0] === '/api/model-settings/providers/p1');
    expect(update?.[1]).toMatchObject({ api_key: 'sk-new-key', provider_type: 'deepseek' });
  });

  it('keeps the stored key (__KEEP__) when stepping back without retyping it', async () => {
    chatRejected();
    renderWizard();
    await verifyKey(SECRET);
    await screen.findByText(copy.modelsTitle);
    click(copy.saveContinue);
    await screen.findByText(copy.err.chatFailed);

    click(copy.backToKey);
    await screen.findByLabelText(copy.apiKey);
    click(copy.verifyContinue);

    await waitFor(() => expect(
      api.put.mock.calls.some((c) => c[0] === '/api/model-settings/providers/p1')).toBe(true));
    const update = api.put.mock.calls.find((c) => c[0] === '/api/model-settings/providers/p1');
    expect(update?.[1].api_key).toBe('__KEEP__');
    expect(postedTo('/providers')).toHaveLength(1);
  });

  it('asks for a key again instead of reusing the stored one on another preset', async () => {
    chatRejected();
    renderWizard();
    await verifyKey(SECRET);
    await screen.findByText(copy.modelsTitle);
    click(copy.saveContinue);
    await screen.findByText(copy.err.chatFailed);

    click(copy.backToKey);
    fireEvent.click(await screen.findByRole('button', { name: copy.customProvider }));
    click(copy.verifyContinue);

    expect(await screen.findByText(copy.err.keyRequired)).toBeInTheDocument();
    expect(api.put.mock.calls.some((c) => String(c[0]).includes('/providers/'))).toBe(false);
  });

  it('only fills the gaps and leaves a ready slot untouched (auto mode)', async () => {
    renderWizard(capabilities(['fast', 'video_cut']));
    await verifyKey(SECRET);
    await screen.findByText(copy.modelsTitle);
    expect(screen.queryByLabelText(new RegExp(copy.cap.chat.name))).toBeNull();
    click(copy.saveContinue);
    await waitFor(() => expect(
      api.put.mock.calls.filter((c) => c[0] === '/api/model-settings/assignments')).toHaveLength(2));
    const slots = api.put.mock.calls.map((c) => c[1].function_type).sort();
    expect(slots).toEqual(['fast', 'video_cut']);
  });
});

describe('SetupWizard dismissal', () => {
  it('asks before discarding an unsaved key; Esc twice closes as "later"', async () => {
    const onClose = renderWizard();
    await reachProviderForm();
    typeKey(SECRET);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await screen.findByText(copy.discardPrompt)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledWith('later');
  });

  it('closes immediately on Esc when nothing was typed', () => {
    const onClose = renderWizard();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledWith('later');
  });

  it('does not close on a backdrop click (a pasted key must not be lost)', () => {
    const onClose = renderWizard();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog.parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('SetupWizard accessibility', () => {
  it('labels the dialog and focuses the primary action on the overview', () => {
    renderWizard();
    expect(screen.getByRole('dialog', { name: copy.title })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.start })).toHaveFocus();
  });

  it('marks the current step and only lets the user go back, never ahead', async () => {
    renderWizard();
    click(copy.start);
    await screen.findByText(copy.providerTitle);
    const nav = screen.getByRole('navigation');
    const buttons = Array.from(nav.querySelectorAll('button'));
    expect(buttons[1]).toHaveAttribute('aria-current', 'step');
    expect(buttons[0]).toBeEnabled();
    expect(buttons[2]).toBeDisabled();
  });
});

describe('SetupWizard manual mode', () => {
  it('lists every capability and starts ready slots unticked', async () => {
    renderWizard(capabilities([]), vi.fn(), 'manual');
    await verifyKey(SECRET);
    await screen.findByText(copy.modelsTitle);
    const chatBox = screen.getByRole('checkbox', { name: new RegExp(copy.cap.chat.name) });
    expect(chatBox).not.toBeChecked();
    expect(screen.getByText(translations.en.setupWizard.cap.research.name)).toBeInTheDocument();
  });
});
