import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import SourceModeChooser from '../SourceModeChooser';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations['zh-CN'], locale: 'zh-CN' }),
}));

const copy = translations['zh-CN'].skillrouter.chooser;

function radios() {
  return screen.getAllByRole('radio');
}

describe('SourceModeChooser', () => {
  it('is a labelled radio group with the relay card marked as recommended', () => {
    render(<SourceModeChooser value="router" onChange={() => undefined} />);
    expect(screen.getByRole('radiogroup', { name: copy.label })).toBeTruthy();
    expect(radios()).toHaveLength(2);
    expect(radios()[0].getAttribute('aria-checked')).toBe('true');
    expect(radios()[1].getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(copy.recommended)).toBeTruthy();
  });

  it('keeps one tab stop: the checked card', () => {
    render(<SourceModeChooser value="manual" onChange={() => undefined} />);
    expect(radios().map((radio) => radio.tabIndex)).toEqual([-1, 0]);
  });

  it('checks nothing on a fresh install, with the first card as the tab stop', () => {
    render(<SourceModeChooser value={null} onChange={() => undefined} />);
    expect(radios().every((radio) => radio.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(radios().map((radio) => radio.tabIndex)).toEqual([0, -1]);
  });

  it('selects on click', () => {
    const onChange = vi.fn();
    render(<SourceModeChooser value="router" onChange={onChange} />);
    fireEvent.click(radios()[1]);
    expect(onChange).toHaveBeenCalledWith('manual');
  });

  it.each([
    ['ArrowRight', 'router', 'manual'],
    ['ArrowDown', 'router', 'manual'],
    ['ArrowLeft', 'manual', 'router'],
    ['ArrowUp', 'manual', 'router'],
    ['ArrowRight', 'manual', 'router'],
    ['End', 'router', 'manual'],
    ['Home', 'manual', 'router'],
  ] as const)('%s moves focus and selection from %s to %s', (key, from, to) => {
    const onChange = vi.fn();
    render(<SourceModeChooser value={from} onChange={onChange} />);
    const index = from === 'router' ? 0 : 1;
    radios()[index].focus();
    fireEvent.keyDown(radios()[index], { key });
    expect(onChange).toHaveBeenCalledWith(to);
    expect(document.activeElement).toBe(radios()[to === 'router' ? 0 : 1]);
  });

  it('ignores other keys', () => {
    const onChange = vi.fn();
    render(<SourceModeChooser value="router" onChange={onChange} />);
    fireEvent.keyDown(radios()[0], { key: 'a' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not change anything while disabled', () => {
    const onChange = vi.fn();
    render(<SourceModeChooser value="router" onChange={onChange} disabled />);
    fireEvent.click(radios()[1]);
    expect(onChange).not.toHaveBeenCalled();
    expect(radios().every((radio) => (radio as HTMLButtonElement).disabled)).toBe(true);
  });

  it('drops the bullet points in compact mode', () => {
    const { rerender } = render(<SourceModeChooser value="router" onChange={() => undefined} />);
    expect(screen.getByText(copy.router.points[0])).toBeTruthy();
    rerender(<SourceModeChooser value="router" onChange={() => undefined} compact />);
    expect(screen.queryByText(copy.router.points[0])).toBeNull();
  });
});
