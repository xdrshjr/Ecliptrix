/**
 * The embedded account centre (spec §7.2 / AC-23).
 *
 * Four properties, and each one is a bug the design review found in an earlier
 * draft:
 *  1. four tabs, and the profile tab shows the live `/me` data;
 *  2. saving the display name goes through `auth:update-profile`;
 *  3. an unverified address shows the banner plus the resend affordance;
 *  4. **degradation is per METHOD**: a main process that ships the bridge without
 *     the four new methods still opens the dialog, and the missing controls are
 *     simply not rendered (P1-7);
 *  5. the "open in browser" link prefers the RUNTIME origin (P1-8).
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type {
  ActivityResult,
  AuthBridge,
  AuthStatus,
  MeView,
  ServerMeta,
} from '@/lib/api/authBridge';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

const bridgeRef: { current: AuthBridge | null } = { current: null };

/**
 * One stable session object per bridge.
 *
 * The real `SessionProvider` memoises every action, so the dialog may depend on
 * those identities. A mock that rebuilt them per render made the `me()` effect
 * re-run on every state change (which is exactly the bug React's exhaustive-deps
 * rule exists to prevent).
 */
function sessionFor(bridge: AuthBridge | null) {
  const missing = (name: keyof AuthBridge) => typeof bridge?.[name] !== 'function';
  const guard = <T,>(name: keyof AuthBridge) => async (...args: unknown[]): Promise<T> => {
    if (missing(name)) throw new Error('bridge unavailable');
    return (bridge![name] as unknown as (...a: unknown[]) => Promise<T>)(...args);
  };
  return {
      status: STATUS,
      bridgeAvailable: true,
      pending: false,
      urlReason: null,
      retry: () => {},
      login: async () => STATUS,
      loginLocal: async () => STATUS,
      register: async () => STATUS,
      logout: async () => STATUS,
      changePassword: async () => STATUS,
      requestPasswordReset: async () => ({ ok: true as const }),
      listSessions: guard('listSessions'),
      revokeSession: guard('revokeSession'),
      openExternal: guard('openExternal'),
      capabilities: {
        me: !missing('me'),
        updateProfile: !missing('updateProfile'),
        activity: !missing('activity'),
        resendVerification: !missing('resendVerification'),
      },
      me: guard<MeView>('me'),
      updateProfile: guard<MeView>('updateProfile'),
      activity: guard<ActivityResult>('activity'),
      resendVerification: guard<{ sentAt: string; expiresAt: string }>('resendVerification'),
  };
}

const sessionCache = new WeakMap<AuthBridge, Record<string, unknown>>();

vi.mock('@/contexts/SessionContext', () => ({
  useSession: () => {
    const bridge = bridgeRef.current;
    if (!bridge) return sessionFor(null);
    const cached = sessionCache.get(bridge);
    if (cached) return cached;
    const built = sessionFor(bridge);
    sessionCache.set(bridge, built);
    return built;
  },
}));

import AccountCentreDialog from '../AccountCentreDialog';

const copy = translations.en.auth.account;

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
  emailVerificationRequired: false,
  // A self-hosted deployment: the dialog MUST use this, not the vendor default.
  baseUrl: 'https://accounts.internal.example',
};

const STATUS = {
  state: 'authenticated',
  source: 'server',
  reason: null,
  user: {
    id: 'u1',
    email: 'ada@example.com',
    username: 'ada',
    displayName: 'Ada',
    avatarUrl: null,
    status: 'active',
    planTag: 'free',
    mustChangePassword: false,
    emailVerified: false,
    role: { key: 'member', name: 'Member' },
    permissions: [],
  },
  sessionId: 's1',
  expiresAt: null,
  lastVerifiedAt: null,
  graceUntil: null,
  mustChangePassword: false,
  appVersion: '1.0.1',
  server: META,
  reachable: true,
  lockedUntil: null,
  attemptsLeft: null,
  securityWarning: null,
} as unknown as AuthStatus;

function meView(patch: Partial<MeView> = {}): MeView {
  return {
    id: 'u1',
    email: 'ada@example.com',
    emailVerified: false,
    displayName: 'Ada',
    username: 'ada',
    locale: 'en-US',
    timezone: 'Asia/Shanghai',
    role: { key: 'member', name: 'Member' },
    planTag: 'free',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLoginAt: null,
    pendingEmail: null,
    deletion: null,
    ...patch,
  };
}

/** Every method the dialog may call, so a test can drop exactly one. */
function fullBridge(overrides: Partial<AuthBridge> = {}): AuthBridge {
  return {
    status: vi.fn(async () => STATUS),
    login: vi.fn(async () => STATUS),
    loginLocal: vi.fn(async () => STATUS),
    logout: vi.fn(async () => STATUS),
    register: vi.fn(async () => STATUS),
    changePassword: vi.fn(async () => STATUS),
    requestPasswordReset: vi.fn(async () => ({ ok: true as const })),
    listSessions: vi.fn(async () => ({
      ok: true as const,
      items: [
        {
          id: 's1',
          client: 'desktop' as const,
          deviceName: 'ThinkPad',
          platform: 'win32',
          appVersion: '1.0.1',
          deviceKey: 'k',
          ip: '1.2.x.x',
          userAgent: 'x',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastSeenAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2026-01-02T00:00:00.000Z',
          current: true,
        },
      ],
      currentId: 's1',
    })),
    revokeSession: vi.fn(async () => ({ ok: true as const })),
    openExternal: vi.fn(async () => ({ ok: true as const })),
    me: vi.fn(async () => meView()),
    updateProfile: vi.fn(async (payload) => meView({ displayName: payload.displayName ?? 'Ada' })),
    activity: vi.fn(async () => ({
      items: [
        {
          id: 'a1',
          action: 'auth.login',
          targetType: 'session',
          targetId: 's1',
          ipMasked: '1.2.x.x',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      truncated: false,
    })),
    resendVerification: vi.fn(async () => ({
      sentAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-03T00:00:00.000Z',
    })),
    onChanged: () => () => {},
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  bridgeRef.current = null;
});

describe('AccountCentreDialog', () => {
  it('renders the four tabs and the live profile', async () => {
    bridgeRef.current = fullBridge();
    render(<AccountCentreDialog open onClose={() => {}} onOpenBrowser={() => {}} />);
    for (const label of [copy.tabs.profile, copy.tabs.devices, copy.tabs.security, copy.tabs.activity]) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy();
    }
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeTruthy());
    expect(screen.getByText(copy.unverified)).toBeTruthy();
  });

  it('saves the display name through updateProfile', async () => {
    const updateProfile = vi.fn(async (payload: { displayName?: string }) =>
      meView({ displayName: payload.displayName ?? 'Ada', emailVerified: true }),
    );
    bridgeRef.current = fullBridge({ updateProfile });
    render(<AccountCentreDialog open onClose={() => {}} onOpenBrowser={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('Ada')).toBeTruthy());
    fireEvent.change(screen.getByDisplayValue('Ada'), { target: { value: 'Ada L' } });
    fireEvent.click(screen.getByRole('button', { name: copy.profile.saved }));
    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ displayName: 'Ada L' }));
  });

  it('shows the unverified banner with a working resend', async () => {
    const resendVerification = vi.fn(async () => ({
      sentAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-03T00:00:00.000Z',
    }));
    bridgeRef.current = fullBridge({ resendVerification });
    render(<AccountCentreDialog open onClose={() => {}} onOpenBrowser={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Verify ada@example\.com/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: copy.resend }));
    await waitFor(() => expect(resendVerification).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(copy.resent)).toBeTruthy());
  });

  it('degrades per method: without the four methods it still opens', async () => {
    // The bridge exists but exposes none of the account-centre methods.
    const legacy: AuthBridge = fullBridge();
    delete legacy.me;
    delete legacy.updateProfile;
    delete legacy.activity;
    delete legacy.resendVerification;
    bridgeRef.current = legacy;

    render(<AccountCentreDialog open onClose={() => {}} onOpenBrowser={() => {}} />);
    // Only the tabs that need no new method remain.
    expect(screen.queryByRole('tab', { name: copy.tabs.activity })).toBeNull();
    expect(screen.getByRole('tab', { name: copy.tabs.devices })).toBeTruthy();
    expect(screen.getAllByText(copy.degraded).length).toBeGreaterThan(0);
    // The resend control is not rendered at all (rather than failing on click).
    expect(screen.queryByRole('button', { name: copy.resend })).toBeNull();
  });

  it('prefers the runtime account-server origin for the browser link', async () => {
    bridgeRef.current = fullBridge();
    const onOpenBrowser = vi.fn();
    render(<AccountCentreDialog open onClose={() => {}} onOpenBrowser={onOpenBrowser} />);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    const link = await screen.findByRole('button', { name: copy.openInBrowser });
    fireEvent.click(link);
    expect(onOpenBrowser).toHaveBeenCalledWith('https://accounts.internal.example/account');
  });

  it('closes on Escape and on the close button', async () => {
    bridgeRef.current = fullBridge();
    const onClose = vi.fn();
    render(<AccountCentreDialog open onClose={onClose} onOpenBrowser={() => {}} />);
    // Let the profile fetch settle first: otherwise this test interleaves with a
    // state update from the effect and React reports an act() warning.
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeTruthy());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    // Two controls carry the same accessible name by design (the header icon and
    // the footer button); either one must close the dialog.
    const closers = screen.getAllByRole('button', { name: copy.close });
    expect(closers.length).toBe(2);
    fireEvent.click(closers[closers.length - 1]);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('returns focus to the trigger when it closes (aria-modal is a promise)', async () => {
    bridgeRef.current = fullBridge();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const { unmount } = render(
      <AccountCentreDialog open onClose={() => {}} onOpenBrowser={() => {}} />,
    );
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('renders nothing when closed', () => {
    bridgeRef.current = fullBridge();
    const { container } = render(
      <AccountCentreDialog open={false} onClose={() => {}} onOpenBrowser={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the activity timeline with masked addresses only', async () => {
    bridgeRef.current = fullBridge();
    render(<AccountCentreDialog open onClose={() => {}} onOpenBrowser={() => {}} />);
    await waitFor(() => expect(screen.getByRole('tab', { name: copy.tabs.activity })).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: copy.tabs.activity }));
    await waitFor(() => expect(screen.getByText(/1\.2\.x\.x/)).toBeTruthy());
    expect(screen.queryByText(/203\.0\.113/)).toBeNull();
  });
});
