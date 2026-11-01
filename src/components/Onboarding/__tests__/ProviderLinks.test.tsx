/**
 * Every preset model provider shows its "get a key" link in the wizard's
 * provider step; the custom provider shows a plain sentence (spec §3.7).
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import schema from '@/lib/api/__fixtures__/integrations-schema.json';
import type { CapabilityStatus } from '@/lib/api/setupStatus';
import { PROVIDER_LINKS } from '@/lib/credentialLinks';
import { translations } from '@/lib/i18n';
import SetupWizard from '../SetupWizard';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api/http-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/http-client')>()),
  http: api,
}));
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

const copy = translations.en.setupWizard;
const linkCopy = translations.en.integrations.link;

const providers = schema.providerPresetIds.map((id) => ({
  id,
  name: `Provider ${id}`,
  default_api_url: `https://api.${id}.example/v1`,
  region: 'domestic',
  api_format: 'openai',
  default_models: [],
}));

const modelGaps: CapabilityStatus[] = (['chat', 'fast', 'video_cut', 'vision'] as const).map((id) => ({
  id, tier: 'core', state: 'missing', source: 'none',
}));

const START = new RegExp(`^(${copy.start}|${copy.resume})$`);

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  api.get.mockImplementation(async (url: string) =>
    url.endsWith('/saved') ? { providers: [] } : { providers });
  window.localStorage.clear();
});

function renderWizard(capabilities: CapabilityStatus[]) {
  render(
    <SetupWizard
      mode="auto"
      capabilities={capabilities}
      optOuts={[]}
      onClose={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: START }));
}

describe('provider step credential links', () => {
  it('has a console link for every preset the backend ships', async () => {
    renderWizard(modelGaps);
    await screen.findByRole('button', { name: providers[0].name });
    for (const provider of providers) {
      fireEvent.click(screen.getByRole('button', { name: provider.name }));
      const link = screen.getByRole('link', { name: new RegExp(linkCopy.getKey) });
      expect(link, provider.id).toHaveAttribute('href', PROVIDER_LINKS[provider.id].consoleUrl);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('shows a plain sentence, not a link, for a custom provider', async () => {
    renderWizard(modelGaps);
    await screen.findByRole('button', { name: providers[0].name });
    fireEvent.click(screen.getByRole('button', { name: copy.customProvider }));
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(linkCopy.noLink)).toBeInTheDocument();
  });

  it('keeps the Tavily link on the search step', async () => {
    renderWizard([{ id: 'web_search', tier: 'extended', state: 'missing', source: 'none' }]);
    const link = await screen.findByRole('link', { name: new RegExp(copy.getKey) });
    expect(link).toHaveAttribute('href', 'https://app.tavily.com/home');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
