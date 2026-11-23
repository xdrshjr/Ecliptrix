/**
 * The saved-key capsule (spec R2-05): the verdict survives a restart, and a
 * record older than a day says so instead of claiming a fresh check.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { SkillRouterStatus } from '@/lib/api/skillrouter';
import RouterConnectionCard, {
  deriveConnectionState,
  describeCheckedAt,
} from '../RouterConnectionCard';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

const copy = translations.en.skillrouter.panel;
const HOUR = 3_600_000;

function status(lastVerified: SkillRouterStatus['lastVerified']): SkillRouterStatus {
  return {
    mode: 'router',
    modeState: 'router',
    baseUrl: 'https://www.skillrouter.net',
    keyConfigured: true,
    keyHint: 'ar-…****abcd',
    enabled: true,
    manualCapabilities: [],
    slotModels: {},
    defaults: {},
    lastVerified,
    revision: 'r1',
  };
}

const handlers = { onReverify: vi.fn(), onReplaceKey: vi.fn(), onClearKey: vi.fn() };

describe('deriveConnectionState', () => {
  it('reads a persisted ok record as connected, no record as unverified', () => {
    expect(deriveConnectionState(status({ ok: true, at: 1, outcome: 'ok', stale: false }))).toBe('connected');
    expect(deriveConnectionState(status(null))).toBe('unverified');
  });

  it('keeps a stale ok record connected (the backend is re-checking it)', () => {
    expect(deriveConnectionState(status({ ok: true, at: 1, outcome: 'ok', stale: true }))).toBe('connected');
  });
});

describe('describeCheckedAt', () => {
  it('shows the clock time for a fresh record', () => {
    const at = new Date(2026, 0, 5, 14, 2).getTime();
    expect(describeCheckedAt(status({ ok: true, at, outcome: 'ok', stale: false }), copy)).toBe(
      'Verified 14:02',
    );
  });

  it('shows whole hours for a stale one, never less than one', () => {
    const now = 1_800_000_000_000;
    const old = status({ ok: true, at: now - 26 * HOUR - 5000, outcome: 'ok', stale: true });
    expect(describeCheckedAt(old, copy, now)).toBe('Last verified 26 h ago · checking again');
    const barely = status({ ok: true, at: now - 100, outcome: 'ok', stale: true });
    expect(describeCheckedAt(barely, copy, now)).toContain('1 h ago');
  });

  it('has nothing to say without a record', () => {
    expect(describeCheckedAt(status(null), copy)).toBeNull();
  });
});

describe('RouterConnectionCard', () => {
  it('renders the connected pill with the stale wording', () => {
    const at = Date.now() - 30 * HOUR;
    render(
      <RouterConnectionCard
        status={status({ ok: true, at, outcome: 'ok', stale: true })}
        verifying={false}
        verifyResult={null}
        {...handlers}
      />,
    );
    expect(screen.getByTestId('connection-pill')).toHaveTextContent(copy.state.connected);
    expect(screen.getByText(/Last verified 30 h ago/)).toBeInTheDocument();
  });

  it('renders "not verified" and no time line without a record', () => {
    render(<RouterConnectionCard status={status(null)} verifying={false} verifyResult={null} {...handlers} />);
    expect(screen.getByTestId('connection-pill')).toHaveTextContent(copy.state.unverified);
    expect(screen.queryByText(/Verified|Last verified/)).toBeNull();
  });
});
