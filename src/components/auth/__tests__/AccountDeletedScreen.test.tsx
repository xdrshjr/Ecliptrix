/**
 * The deleted-account screen (AC-22, renderer half).
 *
 * Two properties matter, and they are the reason this is a screen rather than a
 * banner on the login form:
 *  1. it renders the dedicated copy, and
 *  2. its single control re-runs the gate so the user can sign in as somebody else.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';

const retry = vi.fn();

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

vi.mock('@/contexts/SessionContext', () => ({
  useSession: () => ({ retry }),
}));

import AccountDeletedScreen from '../AccountDeletedScreen';

const copy = translations.en.auth;

afterEach(() => {
  cleanup();
  retry.mockReset();
});

describe('AccountDeletedScreen', () => {
  it('renders the dedicated deleted copy', () => {
    render(<AccountDeletedScreen />);
    expect(screen.getByRole('heading', { name: copy.deleted.title })).toBeInTheDocument();
    expect(screen.getByText(copy.deleted.body)).toBeInTheDocument();
  });

  it('re-runs the gate so another account can sign in', () => {
    render(<AccountDeletedScreen />);
    fireEvent.click(screen.getByRole('button', { name: copy.deleted.signInOther }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
