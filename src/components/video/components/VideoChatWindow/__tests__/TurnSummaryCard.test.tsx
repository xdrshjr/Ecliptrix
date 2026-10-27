import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import TurnSummaryCard from '../TurnSummaryCard';
import type { TurnSummary } from '../turnSummary';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

const copy = translations.en.agentCollab;

function summary(patch: Partial<TurnSummary> = {}): TurnSummary {
  return {
    clips: { added: 5, removed: 0, moved: 0, trimmed: 0, resized: 0 },
    materials: { imported: 3, generated: { tts: 0, image: 0, video: 0 }, webDownloaded: 0 },
    check: { blockers: 0, warnings: 0, unlicensed: 0 },
    failedTools: 0, hasUndoable: true, partial: false, completedSteps: 4, ...patch,
  };
}

afterEach(cleanup);

describe('TurnSummaryCard', () => {
  it('shows the metric chips inside a labelled group', () => {
    render(<TurnSummaryCard summary={summary()} />);
    const group = screen.getByRole('group', { name: copy.summaryLabel });
    expect(group.textContent).toContain('+5 clips');
    expect(group.textContent).toContain('3 materials imported');
    expect(group.textContent).toContain(copy.summaryCheckOk);
  });

  it('offers the fix action only when the check found problems, and prefills a FIXED sentence', () => {
    const onPrefill = vi.fn();
    const { rerender } = render(<TurnSummaryCard summary={summary()} onPrefill={onPrefill} />);
    expect(screen.queryByRole('button', { name: copy.summaryFix })).toBeNull();

    rerender(<TurnSummaryCard
      summary={summary({ check: { blockers: 1, warnings: 2, unlicensed: 0 } })} onPrefill={onPrefill} />);
    expect(screen.getByRole('group').textContent).toContain('Check: 1 blocking · 2 warnings');
    fireEvent.click(screen.getByRole('button', { name: copy.summaryFix }));
    expect(onPrefill).toHaveBeenCalledWith(copy.summaryFixPrompt);
  });

  it('offers the source list only when web media was downloaded', () => {
    const onPrefill = vi.fn();
    render(<TurnSummaryCard
      summary={summary({ materials: { imported: 1, generated: { tts: 0, image: 0, video: 0 }, webDownloaded: 2 } })}
      onPrefill={onPrefill} />);
    fireEvent.click(screen.getByRole('button', { name: copy.summaryCredits }));
    expect(onPrefill).toHaveBeenCalledWith(copy.summaryCreditsPrompt);
  });

  it('renders the compact variant for a stopped turn', () => {
    render(<TurnSummaryCard summary={summary({
      partial: true, completedSteps: 3, check: null,
      clips: { added: 0, removed: 0, moved: 0, trimmed: 0, resized: 0 },
      materials: { imported: 0, generated: { tts: 0, image: 0, video: 0 }, webDownloaded: 0 },
    })} />);
    expect(screen.getByRole('group').textContent).toContain('3 steps done before stopping');
  });

  it('renders nothing when there is nothing to report', () => {
    const { container } = render(<TurnSummaryCard summary={summary({
      clips: { added: 0, removed: 0, moved: 0, trimmed: 0, resized: 0 },
      materials: { imported: 0, generated: { tts: 0, image: 0, video: 0 }, webDownloaded: 0 },
      check: null,
    })} />);
    expect(container.firstChild).toBeNull();
  });
});
