/**
 * Runtime exit (spec §3.9): a feature that fails for missing credentials
 * offers "go configure", which re-opens the wizard on that integration.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/http-client';
import { notConfiguredIntegration } from '@/lib/api/integrations';
import { reportCredentialMissing } from '@/lib/credentialMissing';
import { OPEN_SETUP_WIZARD_EVENT } from '@/lib/setupEvents';
import { translations } from '@/lib/i18n';
import ConfigureCta from '../ConfigureCta';
import CredentialMissingListener from '../CredentialMissingListener';

const showConfirm = vi.hoisted(() => vi.fn());
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));
vi.mock('@/contexts/NotificationContext', () => ({
  useNotification: () => ({ showConfirm }),
}));

const copy = translations.en.integrations;
const missing = (id: string) =>
  new ApiError(409, 'credential_not_configured', 'missing', { integration_id: id });

let opened: Array<{ focus?: string }> = [];
const onOpen = (event: Event) => opened.push((event as CustomEvent).detail);

beforeEach(() => {
  opened = [];
  showConfirm.mockReset();
  window.addEventListener(OPEN_SETUP_WIZARD_EVENT, onOpen);
});
afterEach(() => window.removeEventListener(OPEN_SETUP_WIZARD_EVENT, onOpen));

describe('ConfigureCta', () => {
  it('asks the page to open the wizard on the right integration', () => {
    render(<ConfigureCta integrationId="pexels" />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(copy.pexels.name) }));
    expect(opened).toEqual([{ focus: 'pexels' }]);
  });
});

describe('notConfiguredIntegration', () => {
  it('reads the 409 envelope', () => {
    expect(notConfiguredIntegration(missing('ark'))).toBe('ark');
  });

  it('treats the legacy TTS and ASR codes as their integrations', () => {
    expect(notConfiguredIntegration(new ApiError(503, 'TTS_CONFIG_MISSING', 'x'))).toBe('volcano_tts');
    expect(notConfiguredIntegration(new ApiError(400, 'ASR_NOT_CONFIGURED', 'x'))).toBe('volcano_asr');
  });

  it.each([
    new ApiError(409, 'credential_not_configured', 'x', { integration_id: 'evil' }),
    new ApiError(409, 'credential_not_configured', 'x'),
    new ApiError(500, 'HTTP_500', 'x'),
    new Error('plain'),
    null,
  ])('ignores everything else (%#)', (error) => {
    expect(notConfiguredIntegration(error)).toBeNull();
  });
});

describe('reportCredentialMissing + listener', () => {
  it('reports only credential errors, so callers keep their generic path otherwise', () => {
    expect(reportCredentialMissing(new Error('x'))).toBe(false);
    expect(reportCredentialMissing(missing('freesound'))).toBe(true);
  });

  it('prompts with the integration name and opens the wizard on confirm', () => {
    render(<CredentialMissingListener />);
    act(() => void reportCredentialMissing(missing('pexels')));
    expect(showConfirm).toHaveBeenCalledTimes(1);
    const [message, onConfirm, options] = showConfirm.mock.calls[0];
    expect(message).toBe(copy.cta.missing.replace('{name}', copy.pexels.name));
    expect(options).toEqual({ confirmLabel: copy.cta.configure });
    onConfirm();
    expect(opened).toEqual([{ focus: 'pexels' }]);
  });

  it('does not stack the same prompt on a retry loop, but still prompts for another service', () => {
    render(<CredentialMissingListener />);
    act(() => {
      reportCredentialMissing(missing('ark'));
      reportCredentialMissing(missing('ark'));
      reportCredentialMissing(missing('unsplash'));
    });
    expect(showConfirm).toHaveBeenCalledTimes(2);
  });
});
