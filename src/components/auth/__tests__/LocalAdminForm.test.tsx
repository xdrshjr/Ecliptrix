/**
 * Break-glass form (spec §2.8 / §2.9 / §6.2): default-password warning, the
 * remaining-attempts counter and the lock countdown that disables the form.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { AuthBridge, AuthStatus } from '@/lib/api/authBridge';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

import { BOOTING_STATUS, SessionProvider } from '@/contexts/SessionContext';
import LocalAdminForm from '../LocalAdminForm';

const copy = translations.en.auth;

function signedOut(patch: Partial<AuthStatus> = {}): AuthStatus {
  return {
    ...BOOTING_STATUS,
    state: 'unauthenticated',
    reason: 'no-session',
    appVersion: '1.0.0',
    reachable: true,
    ...patch,
  };
}

interface Harness {
  emit: (next: AuthStatus) => void;
  loginLocal: AuthBridge['loginLocal'];
}

function renderForm(initial: AuthStatus): Harness {
  const listeners = new Set<(s: AuthStatus) => void>();
  const loginLocal = vi.fn(async () => initial) as unknown as AuthBridge['loginLocal'];
  const bridge: AuthBridge = {
    status: vi.fn(async () => initial),
    login: vi.fn(async () => initial),
    loginLocal,
    logout: vi.fn(async () => initial),
    register: vi.fn(async () => initial),
    changePassword: vi.fn(async () => initial),
    requestPasswordReset: vi.fn(async () => ({ ok: true as const })),
    listSessions: vi.fn(async () => ({ ok: true as const, items: [], currentId: '' })),
    revokeSession: vi.fn(async () => ({ ok: true as const })),
    openExternal: vi.fn(async () => ({ ok: true as const })),
    onChanged: vi.fn((cb: (s: AuthStatus) => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    }),
  };
  (window as unknown as { ecliptrixDesktop?: unknown }).ecliptrixDesktop = { auth: bridge };

  render(
    <SessionProvider>
      <LocalAdminForm />
    </SessionProvider>,
  );

  return {
    loginLocal,
    emit: (next) => act(() => listeners.forEach((cb) => cb(next))),
  };
}

async function expand() {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(copy.local.entry) }));
  await screen.findByText(copy.local.hint);
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { ecliptrixDesktop?: unknown }).ecliptrixDesktop;
});

describe('LocalAdminForm', () => {
  it('starts collapsed behind a plain text entry', async () => {
    renderForm(signedOut());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: new RegExp(copy.local.entry) })).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(copy.password.label)).toBeNull();
  });

  it('warns in red when the typed password is the shipped default', async () => {
    renderForm(signedOut());
    await expand();
    expect(screen.queryByText(copy.local.defaultPasswordWarning)).toBeNull();

    fireEvent.change(screen.getByLabelText(copy.password.label), {
      target: { value: 'adminjr' },
    });
    expect(screen.getByText(copy.local.defaultPasswordWarning)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(copy.password.label), {
      target: { value: 'a-very-long-rescue-password' },
    });
    expect(screen.queryByText(copy.local.defaultPasswordWarning)).toBeNull();
  });

  it('warns when the main process reports the default password', async () => {
    const harness = renderForm(signedOut());
    await expand();
    harness.emit(signedOut({ securityWarning: 'local-default-password' }));
    await waitFor(() =>
      expect(screen.getByText(copy.local.defaultPasswordWarning)).toBeInTheDocument(),
    );
  });

  it('shows the remaining attempts and follows pushes', async () => {
    const harness = renderForm(signedOut({ attemptsLeft: 3 }));
    await expand();
    expect(screen.getByText(copy.local.attemptsLeft.replace('{count}', '3'))).toBeInTheDocument();

    harness.emit(signedOut({ attemptsLeft: 2 }));
    await waitFor(() =>
      expect(screen.getByText(copy.local.attemptsLeft.replace('{count}', '2'))).toBeInTheDocument(),
    );
  });

  it('disables both inputs and the submit button while locked', async () => {
    const lockedUntil = new Date(Date.now() + 90_000).toISOString();
    renderForm(signedOut({ lockedUntil }));
    await expand();

    expect(screen.getByLabelText(copy.username.label)).toBeDisabled();
    expect(screen.getByLabelText(copy.password.label)).toBeDisabled();
    expect(screen.getByRole('button', { name: copy.local.submit })).toBeDisabled();
    expect(screen.getByText(/Locked\. Try again in \d+s/)).toBeInTheDocument();
  });
});
