import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import ContextRing, { type ContextRingProps } from '../ContextRing';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

const copy = translations.en.agentContext;

function ring(patch: Partial<ContextRingProps> = {}) {
  const props: ContextRingProps = {
    percent: 72, level: 'notice',
    reading: { usedTokens: 87_000, windowTokens: 128_000, maxOutputTokens: 4096, dropped: false },
    isCompacting: false, canCompact: true, autoCompact: true,
    onCompact: vi.fn(), onToggleAutoCompact: vi.fn(), ...patch,
  };
  return { props, ...render(<ContextRing {...props} />) };
}
const trigger = (percent = 72) =>
  screen.getByRole('button', { name: copy.ring.label.replace('{pct}', String(percent)) });

afterEach(cleanup);

describe('ContextRing', () => {
  it('names itself with the percentage for assistive technology', () => {
    ring();

    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a card with the level in words, the token counts and the actions', () => {
    ring();

    fireEvent.click(trigger());

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(copy.level.notice)).toBeTruthy();
    expect(screen.getByText('87,000 / 128,000 tokens')).toBeTruthy();
    expect(screen.getByRole('switch', { name: copy.autoCompact })).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.compactNow })).toBeTruthy();
  });

  it('opens on keyboard focus-free hover too, and closes on Escape', () => {
    ring();

    fireEvent.mouseEnter(trigger().parentElement as HTMLElement);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('compact now calls back once', () => {
    const { props } = ring({ level: 'warn', percent: 85 });
    fireEvent.click(trigger(85));

    fireEvent.click(screen.getByRole('button', { name: copy.compactNow }));

    expect(props.onCompact).toHaveBeenCalledTimes(1);
  });

  it('disables compacting while a turn runs and says it is working while compacting', () => {
    ring({ canCompact: false, isCompacting: true });
    fireEvent.click(trigger());

    const button = screen.getByRole('button', { name: copy.compacting }) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
  });

  it('the auto-compact switch reports the new value', () => {
    const { props } = ring({ autoCompact: true });
    fireEvent.click(trigger());

    fireEvent.click(screen.getByRole('switch', { name: copy.autoCompact }));

    expect(props.onToggleAutoCompact).toHaveBeenCalledWith(false);
  });

  it('reads out the dropped state in words', () => {
    ring({ level: 'dropped', percent: 100 });
    fireEvent.click(trigger(100));

    expect(screen.getByText(copy.level.dropped)).toBeTruthy();
  });
});
