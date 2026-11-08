/**
 * Login screen behaviour (spec §2.8, §6.2): no double submit, locked
 * countdown, registration switch, maintenance and version gates.
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
import LoginScreen from '../LoginScreen';
import { toAuthFailure } from '@/lib/api/authBridge';

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
    minClientVersion: '',
    maintenanceMessage: '',
    maxActiveSessions: 10,
    ...patch,
  };
}

function signedOut(patch: Partial<AuthStatus> = {}): AuthStatus {
  return {
    ...BOOTING_STATUS,
    state: 'unauthenticated',
    reason: 'no-session',
    appVersion: '1.0.0',
    server: meta(),
    reachable: true,
    ...patch,
  };
}

interface Harness {
  bridge: AuthBridge;
}

function createBridge(initial: AuthStatus, login?: AuthBridge['login']): Harness {
  const resolve = () => Promise.resolve(initial);
  const bridge: AuthBridge = {
    status: vi.fn(async () => initial),
    login: login ?? vi.fn(resolve),
    loginLocal: vi.fn(resolve),
    logout: vi.fn(resolve),
    register: vi.fn(resolve),
    changePassword: vi.fn(resolve),
    requestPasswordReset: vi.fn(async () => ({ ok: true as const })),
    listSessions: vi.fn(async () => ({ ok: true as const, items: [], currentId: '' })),
    revokeSession: vi.fn(async () => ({ ok: true as const })),
    openExternal: vi.fn(async () => ({ ok: true as const })),
    onChanged: vi.fn(() => () => {}),
  };
  (window as unknown as { ecliptrixDesktop?: unknown }).ecliptrixDesktop = {
    auth: bridge,
    version: '1.0.0',
  };
  return { bridge };
}

function renderScreen(current: AuthStatus, login?: AuthBridge['login']) {
  const harness = createBridge(current, login);
  const view = render(
    <SessionProvider>
      <LoginScreen reason={current.reason} />
    </SessionProvider>,
  );
  return { ...harness, view };
}

function fillCredentials() {
  fireEvent.change(screen.getByLabelText(copy.identifier.label), {
    target: { value: 'ada@example.com' },
  });
  fireEvent.change(screen.getByLabelText(copy.password.label), {
    target: { value: 'correct horse battery' },
  });
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { ecliptrixDesktop?: unknown }).ecliptrixDesktop;
});

describe('LoginScreen', () => {
  it('does not submit an empty form', async () => {
    const { bridge } = renderScreen(signedOut());
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: copy.title })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: copy.submit }));
    expect(bridge.login).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getAllByText(copy.error.required).length).toBe(2));
  });

  it('submits at most once while a login is in flight', async () => {
    let release: (status: AuthStatus) => void = () => {};
    const login = vi.fn(
      () =>
        new Promise<AuthStatus>((resolve) => {
          release = resolve;
        }),
    ) as unknown as AuthBridge['login'];
    const { bridge, view } = renderScreen(signedOut(), login);
    fillCredentials();

    const form = view.container.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    fireEvent.submit(form!);

    expect(bridge.login).toHaveBeenCalledTimes(1);
    release(signedOut({ state: 'authenticated' }));
    await waitFor(() => expect(bridge.login).toHaveBeenCalledTimes(1));
  });

  it('shows the lock countdown and disables submit while it runs', async () => {
    const login = vi.fn(() =>
      Promise.reject(
        toAuthFailure({
          ok: false,
          code: 'account_locked',
          message: 'locked',
          details: { retryAfterSeconds: 45 },
          requestId: 'req-1',
        }),
      ),
    ) as unknown as AuthBridge['login'];
    renderScreen(signedOut(), login);
    fillCredentials();
    fireEvent.submit(screen.getByRole('button', { name: copy.submit }).closest('form')!);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(copy.error.locked);
    expect(screen.getByRole('alert')).toHaveTextContent('45');
    expect(screen.getByText('Error reference req-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.submit })).toBeDisabled();
  });

  it('hides account creation when the server disables registration', async () => {
    renderScreen(signedOut({ server: meta({ registrationEnabled: false }) }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: copy.title })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: copy.createAccount })).toBeNull();
    expect(screen.getByText('support@example.com')).toBeInTheDocument();
  });

  it('switches to the registration form and back, showing the invite field only when required', async () => {
    renderScreen(signedOut({ server: meta({ inviteRequired: true }) }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: copy.title })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: copy.createAccount }));
    await waitFor(() => expect(screen.getByLabelText(copy.confirmPassword.label)).toBeInTheDocument());
    // `meta.inviteRequired` is what decides the invite field (spec §2.8): a server
    // with no invites must not show a field whose value it would reject.
    expect(screen.getByLabelText(copy.invite.label)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: copy.backToLogin }));
    await waitFor(() => expect(screen.getByLabelText(copy.password.label)).toBeInTheDocument());
  });

  it('hides the invite field when the server does not require one', async () => {
    renderScreen(signedOut({ server: meta({ inviteRequired: false }) }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: copy.title })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: copy.createAccount }));
    await waitFor(() => expect(screen.getByLabelText(copy.confirmPassword.label)).toBeInTheDocument());
    expect(screen.queryByLabelText(copy.invite.label)).toBeNull();
  });

  it('renders under prefers-reduced-motion without throwing', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      renderScreen(signedOut());
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: copy.title })).toBeInTheDocument(),
      );
      expect(screen.getByLabelText(copy.identifier.label)).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });

  it('never reports "too old" when the client version itself is unknown', async () => {
    // Regression: `''` was compared as `0.0.0`, which replaced the whole form with
    // the download notice — a self-lock, because neither the main process nor the
    // server gates on an empty client version.
    renderScreen(signedOut({ appVersion: '', server: meta({ minClientVersion: '99.0.0' }) }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: copy.title })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('heading', { name: copy.outdated.title })).toBeNull();
    expect(screen.getByLabelText(copy.identifier.label)).toBeInTheDocument();
  });

  it('offers no reset link while the server metadata is unavailable', async () => {
    // The reset panel needs `meta.smtpEnabled`; without `/meta` the link used to
    // set the view and fall back into this same branch — a dead button.
    renderScreen(signedOut({ server: null, reachable: false }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: copy.title })).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(copy.identifier.label)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: copy.forgot })).toBeNull();
  });

  it('replaces the form with the maintenance notice', async () => {
    renderScreen(
      signedOut({ server: meta({ maintenanceMessage: 'Database upgrade until 22:00' }) }),
    );
    await waitFor(() =>
      expect(screen.getByText('Database upgrade until 22:00')).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(copy.identifier.label)).toBeNull();
    // The break-glass entry survives every state.
    expect(screen.getByRole('button', { name: new RegExp(copy.local.entry) })).toBeInTheDocument();
  });

  it('overrides the form with the update notice when the client is too old', async () => {
    renderScreen(signedOut({ server: meta({ minClientVersion: '99.0.0' }) }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: copy.outdated.title })).toBeInTheDocument(),
    );
    expect(screen.getByText(/Minimum version 99\.0\.0/)).toBeInTheDocument();
    expect(screen.queryByLabelText(copy.identifier.label)).toBeNull();
  });
});
