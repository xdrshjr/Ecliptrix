import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { SteerNote } from '@/types/agentSteering';
import SteerQueue from '../SteerQueue';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

const note: SteerNote = { id: 'n1', text: 'make it vertical', status: 'sent', createdAt: 1 };
const noop = vi.fn();

afterEach(cleanup);

describe('SteerQueue while a research crew runs', () => {
  it('says the note is delivered when the crew finishes, instead of naming a tool', () => {
    render(<SteerQueue notes={[note]} queued={[]} currentToolName="delegate_research" crewRunning
      onCancel={noop} onStopAndResend={noop} />);

    expect(screen.getByText(translations.en.agentCrew.steerHint)).toBeTruthy();
    expect(screen.queryByText(/delegate_research/)).toBeNull();
  });

  it('keeps the usual tool wording when no crew runs', () => {
    render(<SteerQueue notes={[note]} queued={[]} currentToolName="web_search"
      onCancel={noop} onStopAndResend={noop} />);

    expect(screen.getByText('Delivered after “web_search” finishes')).toBeTruthy();
  });

  it('does not change what a queued follow-up says', () => {
    render(<SteerQueue notes={[]} queued={[{ id: 'q', text: 'then English', createdAt: 2 }]} crewRunning
      onCancel={noop} onStopAndResend={noop} />);

    expect(screen.getByText(translations.en.agentCollab.steerChipQueued)).toBeTruthy();
  });
});
