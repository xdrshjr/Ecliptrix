import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import CompactionDivider from '../CompactionDivider';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));
vi.mock('@/components/chat/MarkdownRenderer', () => ({
  default: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));

const copy = translations.en.agentContext;
const props = {
  messageId: 'c1', summaryText: '## Goal\nvertical video', coveredCount: 24,
  tokensBefore: 1000, tokensAfter: 370,
};

afterEach(cleanup);

describe('CompactionDivider', () => {
  it('states how many messages were folded and how much context was saved', () => {
    render(<CompactionDivider {...props} />);

    expect(screen.getByText('Folded 24 earlier messages, saving about 63% of context')).toBeTruthy();
  });

  it('keeps the digest hidden until expanded, then renders it read-only as markdown', () => {
    render(<CompactionDivider {...props} />);
    expect(screen.queryByTestId('markdown')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: copy.expand }));

    expect(screen.getByRole('region', { name: copy.summaryLabel })).toBeTruthy();
    expect(screen.getByTestId('markdown').textContent).toBe('## Goal\nvertical video');
    expect(screen.getByRole('button', { name: copy.collapse }).getAttribute('aria-expanded')).toBe('true');
  });

  it('undo hands the compaction id to the caller', () => {
    const onUndo = vi.fn();
    render(<CompactionDivider {...props} onUndo={onUndo} />);

    fireEvent.click(screen.getByRole('button', { name: copy.undo }));

    expect(onUndo).toHaveBeenCalledWith('c1');
  });

  it('undo is disabled while a turn runs', () => {
    const onUndo = vi.fn();
    render(<CompactionDivider {...props} onUndo={onUndo} undoDisabled />);

    const button = screen.getByRole('button', { name: copy.undo }) as HTMLButtonElement;
    fireEvent.click(button);

    expect(button.disabled).toBe(true);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('shows a status skeleton in its place while the digest is being made, with no actions', () => {
    render(<CompactionDivider pending />);

    expect(screen.getByRole('status').textContent).toBe(copy.compacting);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('does not divide by zero on a digest without token figures', () => {
    render(<CompactionDivider messageId="c1" summaryText="x" coveredCount={3} />);

    expect(screen.getByText('Folded 3 earlier messages, saving about 0% of context')).toBeTruthy();
  });
});
