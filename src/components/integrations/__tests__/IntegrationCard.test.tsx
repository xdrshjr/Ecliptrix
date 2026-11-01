/**
 * IntegrationCard: schema-driven fields, the save → test flow and its request
 * payloads, local validation, secret hygiene, and honest result wording.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/http-client';
import { classifyIntegrationError, type IntegrationStatus } from '@/lib/api/integrations';
import { translations } from '@/lib/i18n';
import IntegrationCard from '../IntegrationCard';
import { wireIntegration } from './fixtures';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api/http-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/http-client')>()),
  http: api,
}));
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

const copy = translations.en.integrations;
const SECRET = 'tok-canary-9f8e7d6c5b4a';

function status(id: string, options?: Parameters<typeof wireIntegration>[1]): IntegrationStatus {
  const wire = wireIntegration(id, options);
  const { verify_level: verifyLevel, fields, ...rest } = wire;
  return {
    ...rest,
    verifyLevel,
    fields: fields.map(({ max_items: maxItems, ...field }) => ({ ...field, maxItems })),
  } as unknown as IntegrationStatus;
}

function renderCard(
  integration: IntegrationStatus,
  props: Partial<React.ComponentProps<typeof IntegrationCard>> = {},
) {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  render(<IntegrationCard integration={integration} onChanged={onChanged} {...props} />);
  return { onChanged };
}

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('field rendering', () => {
  it('draws each field from the schema: text, secret and a choice select', () => {
    renderCard(status('volcano_asr'));
    expect(screen.getByLabelText(copy.field.appId)).not.toHaveAttribute('type', 'password');
    expect(screen.getByLabelText(copy.field.accessToken)).toHaveAttribute('type', 'password');
    const select = screen.getByLabelText(copy.field.resourceId) as HTMLSelectElement;
    expect(select.value).toBe('volc.bigasr.sauc.duration');
    expect(select.options).toHaveLength(4);
  });

  it('carries the purpose-specific pitfall and a get-key link', () => {
    renderCard(status('volcano_asr'));
    expect(screen.getByText(copy.volcano_asr.pitfall)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: new RegExp(copy.link.getKey) });
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('echoes saved text fields but never a saved secret', () => {
    renderCard(
      status('volcano_asr', {
        usable: true,
        source: 'database',
        fields: {
          appid: { configured: true, source: 'database', value: '1234567890' },
          access_token: { configured: true, source: 'database' },
        },
      }),
    );
    expect((screen.getByLabelText(copy.field.appId) as HTMLInputElement).value).toBe('1234567890');
    expect((screen.getByLabelText(copy.field.accessToken) as HTMLInputElement).value).toBe('');
    expect(screen.getByText(copy.hint.keepSecret)).toBeInTheDocument();
  });
});

describe('save and test', () => {
  it('PUTs only the typed fields, then tests, then forgets the plaintext', async () => {
    api.put.mockResolvedValue({ success: true, data: wireIntegration('freesound', { usable: true }) });
    api.post.mockResolvedValue({
      success: true,
      data: { outcome: 'ok', verify_level: 'free', elapsed_ms: 12 },
    });
    const updated = vi.fn();
    window.addEventListener('ecliptrix-llm-config-updated', updated);
    const { onChanged } = renderCard(status('freesound'));

    type(copy.field.apiKey, SECRET);
    submit(copy.action.saveTest);

    expect(await screen.findByRole('status')).toHaveTextContent(copy.test.ok);
    expect(api.put).toHaveBeenCalledWith(
      '/api/integrations/freesound',
      { fields: { api_key: SECRET } },
      expect.any(Object),
    );
    expect(api.post.mock.calls[0][0]).toBe('/api/integrations/freesound/test');
    expect((screen.getByLabelText(copy.field.apiKey) as HTMLInputElement).value).toBe('');
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(updated).toHaveBeenCalled();
    const dump = JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage });
    expect(dump).not.toContain(SECRET);
    window.removeEventListener('ecliptrix-llm-config-updated', updated);
  });

  it('un-mutes the reminders of what it just configured', async () => {
    window.localStorage.setItem('ecliptrix-setup-optouts', '["ai_image","ai_video","tts"]');
    api.put.mockResolvedValue({ success: true, data: wireIntegration('ark', { usable: true }) });
    api.post.mockResolvedValue({ success: true, data: { outcome: 'ok', verify_level: 'free' } });
    renderCard(status('ark'));
    type(copy.field.apiKey, SECRET);
    submit(copy.action.saveTest);
    await screen.findByRole('status');
    expect(window.localStorage.getItem('ecliptrix-setup-optouts')).toBe('["tts"]');
  });

  it('does not test a service that cannot be verified for free', async () => {
    api.put.mockResolvedValue({ success: true, data: wireIntegration('volcano_voice_clone') });
    renderCard(status('volcano_voice_clone'));
    type(copy.field.appKey, '1234567890');
    type(copy.field.accessKey, SECRET);
    submit(copy.action.save);

    expect(await screen.findByRole('status')).toHaveTextContent(copy.test.unverifiable);
    expect(api.post).not.toHaveBeenCalled();
    expect(api.put.mock.calls[0][1]).toEqual({
      fields: { app_key: '1234567890', access_key: SECRET },
    });
  });

  it('sends a changed choice, and only when it changed', async () => {
    api.put.mockResolvedValue({ success: true, data: wireIntegration('volcano_tts') });
    api.post.mockResolvedValue({ success: true, data: { outcome: 'ok', verify_level: 'billed_minimal' } });
    renderCard(status('volcano_tts'));
    type(copy.field.apiKey, SECRET);
    fireEvent.change(screen.getByLabelText(copy.field.resourceId), { target: { value: 'seed-tts-1.0' } });
    submit(copy.action.saveTest);
    await screen.findByRole('status');
    expect(api.put.mock.calls[0][1]).toEqual({
      fields: { api_key: SECRET, resource_id: 'seed-tts-1.0' },
    });
  });

  it('warns the TTS test synthesises one character', () => {
    renderCard(status('volcano_tts'));
    expect(screen.getByText(copy.hint.billedTest)).toBeInTheDocument();
  });
});

describe('local validation', () => {
  it('rejects a template placeholder before any request', async () => {
    renderCard(status('ark'));
    type(copy.field.apiKey, 'your_ark_api_key_here');
    submit(copy.action.saveTest);
    expect(await screen.findAllByText(copy.err.placeholder)).not.toHaveLength(0);
    expect(api.put).not.toHaveBeenCalled();
  });

  it('asks for the missing required fields on a fresh integration', async () => {
    renderCard(status('volcano_asr'));
    type(copy.field.appId, '1234567890');
    submit(copy.action.saveTest);
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.err.required);
    expect(api.put).not.toHaveBeenCalled();
  });

  it('lets a half-configured integration be completed with just the missing field', async () => {
    api.put.mockResolvedValue({ success: true, data: wireIntegration('volcano_asr', { usable: true }) });
    api.post.mockResolvedValue({ success: true, data: { outcome: 'ok', verify_level: 'handshake' } });
    renderCard(
      status('volcano_asr', {
        fields: { appid: { configured: true, source: 'database', value: '1234567890' } },
      }),
    );
    type(copy.field.accessToken, SECRET);
    submit(copy.action.saveTest);
    await screen.findByRole('status');
    expect(api.put.mock.calls[0][1]).toEqual({ fields: { access_token: SECRET } });
  });

  it('shows the server verdict for a rejected value without echoing it', async () => {
    api.put.mockRejectedValue(
      new ApiError(422, 'credential_malformed', 'bad', { field: 'api_key' }),
    );
    renderCard(status('freesound'));
    type(copy.field.apiKey, SECRET);
    submit(copy.action.saveTest);
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.err.malformed);
    expect(screen.queryByText(SECRET)).toBeNull();
  });

  it('explains an origin rejection instead of a generic failure', async () => {
    api.put.mockRejectedValue(new ApiError(403, 'origin_forbidden', 'nope'));
    renderCard(status('freesound'));
    type(copy.field.apiKey, SECRET);
    submit(copy.action.saveTest);
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.err.originForbidden);
  });
});

describe('test outcomes', () => {
  async function failTest(outcome: string, id = 'freesound') {
    api.put.mockResolvedValue({ success: true, data: wireIntegration(id, { usable: true }) });
    api.post.mockResolvedValue({ success: true, data: { outcome, verify_level: 'free' } });
    const onContinueAnyway = vi.fn();
    renderCard(status(id), { onContinueAnyway });
    type(id === 'ark' ? copy.field.apiKey : copy.field.apiKey, SECRET);
    submit(copy.action.saveTest);
    return onContinueAnyway;
  }

  it('keeps the key saved when the test fails and offers to continue anyway', async () => {
    const onContinueAnyway = await failTest('invalid_credentials');
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.test.invalid_credentials);
    fireEvent.click(screen.getByRole('button', { name: copy.action.saveAnyway }));
    expect(onContinueAnyway).toHaveBeenCalledTimes(1);
  });

  it('lets the user re-enter after a failed test', async () => {
    await failTest('unreachable');
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: copy.action.retype }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says "Key is valid" for Ark, never "connected", and keeps the activation link', async () => {
    await failTest('ok', 'ark');
    expect(await screen.findByRole('status')).toHaveTextContent(copy.test.okArk);
    expect(screen.getByRole('link', { name: new RegExp(copy.link.activate) })).toHaveAttribute(
      'href',
      expect.stringContaining('openManagement'),
    );
  });

  it('degrades to "saved, check later" when the probe itself errors', async () => {
    api.put.mockResolvedValue({ success: true, data: wireIntegration('freesound', { usable: true }) });
    api.post.mockRejectedValue(new ApiError(500, 'HTTP_500', 'boom'));
    renderCard(status('freesound'));
    type(copy.field.apiKey, SECRET);
    submit(copy.action.saveTest);
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.test.upstream_error);
  });

  it('treats a 409 from the test endpoint as "fill the form in first"', async () => {
    api.put.mockResolvedValue({ success: true, data: wireIntegration('freesound', { usable: true }) });
    api.post.mockRejectedValue(
      new ApiError(409, 'credential_not_configured', 'no', { integration_id: 'freesound' }),
    );
    renderCard(status('freesound'));
    type(copy.field.apiKey, SECRET);
    submit(copy.action.saveTest);
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.err.required);
  });
});

describe('list fields (Pexels / Unsplash)', () => {
  const configured = () =>
    status('pexels', {
      usable: true,
      source: 'database',
      fields: { api_keys: { configured: true, source: 'database', count: 2 } },
    });

  it('shows the count, keeps keys when left blank and tests the saved ones', async () => {
    api.post.mockResolvedValue({ success: true, data: { outcome: 'ok', verify_level: 'free' } });
    renderCard(configured());
    expect(screen.getByText(/2 configured/)).toBeInTheDocument();
    expect(screen.getByText(copy.hint.replaceList)).toBeInTheDocument();
    submit(copy.action.saveTest);
    await screen.findByRole('status');
    expect(api.put).not.toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('replaces the whole list with the keys typed, split on lines and commas', async () => {
    api.put.mockResolvedValue({ success: true, data: wireIntegration('pexels', { usable: true }) });
    api.post.mockResolvedValue({ success: true, data: { outcome: 'ok', verify_level: 'free' } });
    renderCard(configured());
    type(copy.field.apiKeys, 'pexels-key-aaaa1111\npexels-key-bbbb2222, pexels-key-aaaa1111');
    submit(copy.action.saveTest);
    await screen.findByRole('status');
    expect(api.put.mock.calls[0][1]).toEqual({
      fields: { api_keys: ['pexels-key-aaaa1111', 'pexels-key-bbbb2222'] },
    });
  });

  it('refuses more keys than the limit before sending', async () => {
    renderCard(status('pexels'));
    type(copy.field.apiKeys, Array.from({ length: 6 }, (_, i) => `pexels-key-${i}0000000`).join('\n'));
    submit(copy.action.saveTest);
    expect(await screen.findByRole('alert')).toHaveTextContent('up to 5');
    expect(api.put).not.toHaveBeenCalled();
  });
});

describe('clearing (settings)', () => {
  it('DELETEs with a JSON content type so the origin check accepts it', async () => {
    api.del.mockResolvedValue({ success: true, data: wireIntegration('ark') });
    const { onChanged } = renderCard(
      status('ark', {
        usable: true,
        source: 'database',
        fields: { api_key: { configured: true, source: 'database' } },
      }),
      { allowClear: true },
    );
    submit(copy.action.clear);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.del).toHaveBeenCalledWith(
      '/api/integrations/ark',
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }),
    );
  });

  it('offers no clear button when nothing is stored in the app', () => {
    renderCard(status('ark'), { allowClear: true });
    expect(screen.queryByRole('button', { name: copy.action.clear })).toBeNull();
  });
});

describe('error classification', () => {
  it.each([
    ['credential_placeholder', 'placeholder'],
    ['credential_malformed', 'malformed'],
    ['too_many_values', 'tooMany'],
    ['invalid_choice', 'invalidChoice'],
    ['unknown_field', 'unknownField'],
    ['origin_forbidden', 'originForbidden'],
    ['integration_save_failed', 'saveFailed'],
  ])('maps %s → %s and keeps the field name', (code, kind) => {
    const error = new ApiError(422, code, 'x', { field: 'api_key' });
    expect(classifyIntegrationError(error)).toEqual({ kind, field: 'api_key' });
  });

  it('treats a non-API failure as a plain save failure', () => {
    expect(classifyIntegrationError(new Error('x'))).toEqual({ kind: 'saveFailed' });
  });
});
