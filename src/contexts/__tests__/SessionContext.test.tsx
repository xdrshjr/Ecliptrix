/**
 * The identity gate's degradation rules (spec §2.7 / §2.13 / AC-18 / AC-29).
 *
 * The two things under test are exactly the two sources of truth: what the
 * main process reports, and whether a preload bridge exists at all.
 */
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { AuthBridge, AuthStatus, ServerMeta } from '@/lib/api/authBridge';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) =>
    React.createElement('img', { alt: String(props.alt ?? ''), width: 18, height: 18 }),
}));

import { BOOTING_STATUS, SessionProvider } from '../SessionContext';
import SessionGate from '@/components/auth/SessionGate';

const copy = translations.en.auth;

const META: ServerMeta = {
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
};

function status(patch: Partial<AuthStatus>): AuthStatus {
  return { ...BOOTING_STATUS, appVersion: '1.0.0', server: META, reachable: true, ...patch };
}

const SIGNED_IN = status({
  state: 'authenticated',
  source: 'server',
  user: {
    id: 'u1',
    email: 'a@example.com',
    username: 'ada',
    displayName: 'Ada',
    avatarUrl: null,
    status: 'active',
    planTag: 'pro',
    mustChangePassword: false,
    role: { key: 'user', name: 'User' },
    permissions: [],
  },
  sessionId: 's1',
});

const SIGNED_OUT = status({ state: 'unauthenticated', reason: 'no-session' });

interface Harness {
  bridge: AuthBridge;
  emit: (next: AuthStatus) => void;
  listenerCount: () => number;
}

function createBridge(initial: AuthStatus): Harness {
  const listeners = new Set<(s: AuthStatus) => void>();
  let current = initial;
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
    openExternal: vi.fn(async () => ({ ok: true as const })),
    onChanged: vi.fn((cb: (s: AuthStatus) => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    }),
  };
  return {
    bridge,
    emit: (next) => {
      current = next;
      act(() => listeners.forEach((cb) => cb(next)));
    },
    listenerCount: () => listeners.size,
  };
}

function installBridge(bridge: AuthBridge | null): void {
  const host = window as unknown as { ecliptrixDesktop?: { auth?: AuthBridge; version: string } };
  if (bridge) host.ecliptrixDesktop = { auth: bridge, version: '1.0.0' };
  else delete host.ecliptrixDesktop;
}

function renderGate(harness: Harness | null) {
  installBridge(harness ? harness.bridge : null);
  return render(
    <SessionProvider>
      <SessionGate>
        <div>WORKSPACE</div>
      </SessionGate>
    </SessionProvider>,
  );
}

afterEach(() => {
  cleanup();
  installBridge(null);
  vi.unstubAllEnvs();
});

describe('SessionProvider + SessionGate', () => {
  it('renders the workspace once the main process reports authenticated', async () => {
    const harness = createBridge(SIGNED_IN);
    renderGate(harness);
    await waitFor(() => expect(screen.getByText('WORKSPACE')).toBeInTheDocument());
    expect(harness.listenerCount()).toBe(1);
  });

  it('shows the login screen for unauthenticated and follows auth:changed pushes', async () => {
    const harness = createBridge(SIGNED_OUT);
    renderGate(harness);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: copy.title })).toBeInTheDocument(),
    );
    expect(screen.queryByText('WORKSPACE')).toBeNull();

    harness.emit(SIGNED_IN);
    await waitFor(() => expect(screen.getByText('WORKSPACE')).toBeInTheDocument());
  });

  it('unsubscribes from auth:changed on unmount', async () => {
    const harness = createBridge(SIGNED_IN);
    const view = renderGate(harness);
    await waitFor(() => expect(harness.listenerCount()).toBe(1));
    view.unmount();
    expect(harness.listenerCount()).toBe(0);
  });

  it('fails closed when a production build has no preload bridge', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    renderGate(null);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: copy.error.bridgeUnavailable })).toBeInTheDocument(),
    );
    expect(screen.queryByText('WORKSPACE')).toBeNull();
  });

  it('lets a browser dev session through with a visible amber notice', async () => {
    renderGate(null);
    await waitFor(() => expect(screen.getByText('WORKSPACE')).toBeInTheDocument());
    expect(screen.getByText(copy.dev.badge)).toBeInTheDocument();
  });

  it('lets a main-process gate-disabled session through (dev shell path)', async () => {
    const harness = createBridge(
      status({ state: 'authenticated', source: 'gate-disabled', reason: 'gate-disabled' }),
    );
    renderGate(harness);
    await waitFor(() => expect(screen.getByText('WORKSPACE')).toBeInTheDocument());
    expect(screen.getByText(copy.dev.badge)).toBeInTheDocument();
    expect(screen.queryByText(copy.gateDisabled.badge)).toBeNull();
  });

  it('shows the red "gate is off" strip only for the explicit main-process warning', async () => {
    const harness = createBridge(
      status({
        state: 'authenticated',
        source: 'gate-disabled',
        securityWarning: 'gate-disabled',
      }),
    );
    renderGate(harness);
    await waitFor(() => expect(screen.getByText(copy.gateDisabled.badge)).toBeInTheDocument());
  });

  it('forces the change-password dialog while mustChangePassword is true', async () => {
    const harness = createBridge(status({ ...SIGNED_IN, mustChangePassword: true }));
    renderGate(harness);
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: copy.changePassword.title })).toBeInTheDocument(),
    );
    expect(screen.getByText('WORKSPACE')).toBeInTheDocument();
  });
});
