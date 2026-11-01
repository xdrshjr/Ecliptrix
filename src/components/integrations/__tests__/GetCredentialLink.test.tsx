import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import { INTEGRATION_LINKS, PROVIDER_LINKS } from '@/lib/credentialLinks';
import GetCredentialLink from '../GetCredentialLink';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

const copy = translations.en.integrations.link;

describe('GetCredentialLink', () => {
  it('opens in a new window safely and says so in its accessible name', () => {
    render(<GetCredentialLink id="pexels" />);
    const link = screen.getByRole('link', { name: `${copy.getKey} ${copy.external}` });
    expect(link).toHaveAttribute('href', INTEGRATION_LINKS.pexels.consoleUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('adds the docs link, and the activation link only where one exists', () => {
    const { unmount } = render(<GetCredentialLink id="ark" />);
    expect(screen.getByRole('link', { name: new RegExp(copy.docs) })).toHaveAttribute(
      'href', INTEGRATION_LINKS.ark.docsUrl);
    expect(screen.getByRole('link', { name: new RegExp(copy.activate) })).toHaveAttribute(
      'href', INTEGRATION_LINKS.ark.activationUrl);
    unmount();
    render(<GetCredentialLink id="freesound" />);
    expect(screen.queryByRole('link', { name: new RegExp(copy.activate) })).toBeNull();
  });

  it('resolves model providers by their preset id', () => {
    render(<GetCredentialLink id="deepseek" showDocs={false} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', PROVIDER_LINKS.deepseek.consoleUrl);
  });

  it('honours a custom label', () => {
    render(<GetCredentialLink id="tavily" label="Get a Tavily key" />);
    expect(screen.getByRole('link', { name: /Get a Tavily key/ })).toBeInTheDocument();
  });

  it.each(['custom', 'not-a-provider', '__proto__', 'constructor'])(
    'renders a plain sentence, never an anchor, for the unknown id %s',
    (id) => {
      render(<GetCredentialLink id={id} />);
      expect(screen.queryByRole('link')).toBeNull();
      expect(screen.getByText(copy.noLink)).toBeInTheDocument();
    },
  );

  it('copies the console link as a fallback for a blocked browser', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<GetCredentialLink id="unsplash" />);
    fireEvent.click(screen.getByRole('button', { name: copy.copy }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(INTEGRATION_LINKS.unsplash.consoleUrl));
    expect(await screen.findByRole('button', { name: copy.copied })).toBeInTheDocument();
  });

  it('offers copying again once the "copied" feedback has timed out', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<GetCredentialLink id="unsplash" />);
    fireEvent.click(screen.getByRole('button', { name: copy.copy }));
    expect(await screen.findByRole('button', { name: copy.copied })).toBeInTheDocument();
    // Real timers: the feedback window is 2 s, so allow a little more.
    expect(
      await screen.findByRole('button', { name: copy.copy }, { timeout: 3500 }),
    ).toBeInTheDocument();
  });
});
