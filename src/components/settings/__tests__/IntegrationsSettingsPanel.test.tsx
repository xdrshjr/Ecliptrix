/**
 * Settings → Services & libraries: the same cards as the wizard, so what the
 * wizard saved shows up here field for field (spec §3.10, AC2-4).
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import { cleanInstall, listBody, wireIntegration } from '@/components/integrations/__tests__/fixtures';
import IntegrationsSettingsPanel from '../IntegrationsSettingsPanel';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api/http-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/http-client')>()),
  http: api,
}));
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

const text = translations.en.integrations;
const OPTOUT_KEY = 'ecliptrix-setup-optouts';

/** ASR saved through the wizard: id + token stored, resource switched to 2.0. */
const savedAsr = () =>
  wireIntegration('volcano_asr', {
    usable: true,
    source: 'database',
    fields: {
      appid: { configured: true, source: 'database', value: '1234567890' },
      access_token: { configured: true, source: 'database' },
      resource_id: { configured: true, source: 'database', value: 'volc.seedasr.sauc.duration' },
    },
  });

function installList(items = cleanInstall()) {
  api.get.mockResolvedValue(listBody(items));
}

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  window.localStorage.clear();
  installList();
});

describe('IntegrationsSettingsPanel', () => {
  it('lists all seven integrations under their three groups', async () => {
    render(<IntegrationsSettingsPanel />);
    for (const name of [
      text.volcano_tts.name, text.volcano_asr.name, text.volcano_voice_clone.name,
      text.ark.name, text.pexels.name, text.unsplash.name, text.freesound.name,
    ]) {
      expect(await screen.findByRole('heading', { name })).toBeInTheDocument();
    }
    for (const group of ['voice', 'generation', 'media'] as const) {
      expect(screen.getByRole('region', { name: translations.en.setupWizard.group[group].title }))
        .toBeInTheDocument();
    }
  });

  it('shows what the wizard saved: text and choice echoed, secret only as "saved"', async () => {
    installList(cleanInstall().map((item) => (item.id === 'volcano_asr' ? savedAsr() : item)));
    render(<IntegrationsSettingsPanel />);
    await screen.findByRole('heading', { name: text.volcano_asr.name });

    expect((screen.getByLabelText(text.field.appId) as HTMLInputElement).value).toBe('1234567890');
    // Several cards share the "Resource ID" label, so address the ASR one by id.
    const resource = document.getElementById('integration-volcano_asr-resource_id');
    expect((resource as HTMLSelectElement).value).toBe('volc.seedasr.sauc.duration');
    const token = screen.getByLabelText(text.field.accessToken) as HTMLInputElement;
    expect(token.value).toBe('');
    expect(screen.getByText(text.hint.keepSecret)).toBeInTheDocument();
    expect(screen.getByText(text.source.database)).toBeInTheDocument();
  });

  it('clears the in-app value and re-reads the list so the badge falls back', async () => {
    installList(cleanInstall().map((item) => (item.id === 'volcano_asr' ? savedAsr() : item)));
    api.del.mockResolvedValue({ success: true, data: wireIntegration('volcano_asr') });
    render(<IntegrationsSettingsPanel />);
    await screen.findByRole('heading', { name: text.volcano_asr.name });

    api.get.mockClear();
    fireEvent.click(screen.getByRole('button', { name: text.action.clear }));
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(api.del).toHaveBeenCalledWith(
      '/api/integrations/volcano_asr',
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }),
    );
  });

  it('tells the owner a service was declined and lets them turn reminders back on', async () => {
    window.localStorage.setItem(OPTOUT_KEY, '["ai_image","ai_video"]');
    render(<IntegrationsSettingsPanel />);
    await screen.findByRole('heading', { name: text.ark.name });

    fireEvent.click(screen.getByRole('button', { name: text.action.reenable }));
    await waitFor(() => expect(window.localStorage.getItem(OPTOUT_KEY)).toBe('[]'));
    expect(screen.queryByRole('button', { name: text.action.reenable })).toBeNull();
  });

  it('points to the Web search panel for Tavily instead of duplicating it', async () => {
    const onOpenWebResearch = vi.fn();
    render(<IntegrationsSettingsPanel onOpenWebResearch={onOpenWebResearch} />);
    await screen.findByRole('heading', { name: text.ark.name });
    fireEvent.click(screen.getByRole('button', { name: text.panel.openWebSearch }));
    expect(onOpenWebResearch).toHaveBeenCalledTimes(1);
  });

  it('offers a retry when the list cannot be loaded', async () => {
    api.get.mockRejectedValueOnce(new Error('down'));
    render(<IntegrationsSettingsPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent(text.panel.loadFailed);
    installList();
    fireEvent.click(screen.getByRole('button', { name: text.panel.retry }));
    expect(await screen.findByRole('heading', { name: text.ark.name })).toBeInTheDocument();
  });
});
