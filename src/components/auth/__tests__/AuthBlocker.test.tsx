/**
 * Blocked-screen behaviour: the download button, its disabled state, and — the
 * regression this file exists for — the fact that the "origin unknown" hint is
 * scoped to the one reason that actually renders a download button.
 *
 * `AuthBlocker` is what a locked-out desktop user sees. A hint about downloading
 * shown under a bridge-unavailable / local-admin screen reads as "downloading is
 * broken" while the real problem is something else entirely.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { AuthBridge, AuthStatus, ServerMeta } from '@/lib/api/authBridge';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

import { BOOTING_STATUS, SessionProvider } from '@/contexts/SessionContext';
import AuthBlocker from '../AuthBlocker';

const copy = translations.en.auth;

function meta(patch: Partial<ServerMeta> = {}): ServerMeta {
  return {
    registrationEnabled: true,
    inviteRequired: false,
    smtpEnabled: true,
    passwordPolicy: { minLength: 10, maxBytes: 200 },
    appName: 'Ecliptrix',
    supportEmail: 'support@example.com',
    version: '1.0.0',
    minClientVersion: '99.0.0',
    maintenanceMessage: '',
    maxActiveSessions: 10,
    emailVerificationRequired: false,
    baseUrl: 'https://id.ecliptrix.app',
    ...patch,
  };
}

function blocked(patch: Partial<AuthStatus> = {}): AuthStatus {
  return {
    ...BOOTING_STATUS,
    state: 'blocked',
    reason: 'client-outdated',
    appVersion: '1.0.0',
    server: meta(),
    reachable: true,
    ...patch,
  };
}

function renderBlocker(
  current: AuthStatus,
  openExternal?: AuthBridge['openExternal'],
): { bridge: AuthBridge } {
  const resolve = () => Promise.resolve(current);
  const bridge: AuthBridge = {
    status: vi.fn(async () => current),
    login: vi.fn(resolve),
    loginLocal: vi.fn(resolve),
    logout: vi.fn(resolve),
    register: vi.fn(resolve),
    changePassword: vi.fn(resolve),
    requestPasswordReset: vi.fn(async () => ({ ok: true as const })),
    listSessions: vi.fn(async () => ({ ok: true as const, items: [], currentId: '' })),
    revokeSession: vi.fn(async () => ({ ok: true as const })),
    openExternal: openExternal ?? vi.fn(async () => ({ ok: true as const })),
    onChanged: vi.fn(() => () => {}),
  };
  (window as unknown as { ecliptrixDesktop?: unknown }).ecliptrixDesktop = {
    auth: bridge,
    version: '1.0.0',
  };
  render(
    <SessionProvider>
      <AuthBlocker />
    </SessionProvider>,
  );
  return { bridge };
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { ecliptrixDesktop?: unknown }).ecliptrixDesktop;
});

describe('AuthBlocker', () => {
  it('opens the runtime download page when the client is outdated', async () => {
    const { bridge } = renderBlocker(blocked());
    const button = await screen.findByRole('button', { name: copy.maintenance.download });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() =>
      expect(bridge.openExternal).toHaveBeenCalledWith('https://id.ecliptrix.app/download'),
    );
  });

  it('disables the button and explains itself when the origin is unknown', async () => {
    const { bridge } = renderBlocker(blocked({ server: meta({ baseUrl: '' }) }));
    const button = await screen.findByRole('button', { name: copy.maintenance.download });
    expect(button).toBeDisabled();
    expect(await screen.findByText(copy.outdated.noUrl)).toBeInTheDocument();
    expect(bridge.openExternal).not.toHaveBeenCalled();
  });

  it('never mentions the download page in a state that has no download button', async () => {
    // The regression: `noUrl` used to render whenever `server` was absent, which is
    // exactly the bridge-unavailable and server-not-configured cases below.
    renderBlocker(
      blocked({ reason: 'bridge-unavailable', server: null, reachable: false }),
    );
    await screen.findByRole('heading', { name: copy.error.bridgeUnavailable });
    expect(screen.queryByRole('button', { name: copy.maintenance.download })).toBeNull();
    expect(screen.queryByText(copy.outdated.noUrl)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('reports a refused address instead of swallowing it', async () => {
    const openExternal = vi.fn(() =>
      Promise.reject({ ok: false, code: 'url_not_allowed', message: 'blocked' }),
    ) as unknown as AuthBridge['openExternal'];
    renderBlocker(blocked(), openExternal);
    fireEvent.click(await screen.findByRole('button', { name: copy.maintenance.download }));
    expect(await screen.findByText(copy.outdated.openBlocked)).toBeInTheDocument();
    expect(screen.getByText('https://id.ecliptrix.app/download')).toBeInTheDocument();
  });
});
