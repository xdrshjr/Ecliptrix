import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { QueuedFollowUp, SteerNote } from '@/types/agentSteering';
import SteerQueue from '../SteerQueue';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

const copy = translations.en.agentCollab;

const note = (patch: Partial<SteerNote>): SteerNote => ({
  id: 'n1', text: 'make it vertical', status: 'sent', createdAt: 1, ...patch,
});
const queued = (patch: Partial<QueuedFollowUp> = {}): QueuedFollowUp => ({
  id: 'q1', text: 'then an English version', createdAt: 2, ...patch,
});

afterEach(cleanup);

describe('SteerQueue', () => {
  it('renders nothing when nothing is waiting (applied notes live in the timeline)', () => {
    const { container } = render(
      <SteerQueue notes={[note({ status: 'applied' })]} queued={[]} onCancel={vi.fn()}
        onStopAndResend={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('says honestly which tool the steer waits for, in words rather than colour only', () => {
    render(<SteerQueue notes={[note({})]} queued={[]} currentToolName="web_download_media"
      onCancel={vi.fn()} onStopAndResend={vi.fn()} />);
    expect(screen.getByText('Delivered after “web_download_media” finishes')).toBeTruthy();
    expect(screen.getByRole('list', { name: copy.steerQueueLabel })).toBeTruthy();
  });

  it('falls back to a generic wait text without a current tool', () => {
    render(<SteerQueue notes={[note({})]} queued={[]} onCancel={vi.fn()} onStopAndResend={vi.fn()} />);
    expect(screen.getByText(copy.steerChipWaitingStep)).toBeTruthy();
  });

  it('only a local or queued note can be removed; a sent one cannot be recalled', () => {
    const onCancel = vi.fn();
    render(<SteerQueue
      notes={[note({ id: 'sent', status: 'sent' }), note({ id: 'local', status: 'local', text: 'typed early' })]}
      queued={[queued()]} onCancel={onCancel} onStopAndResend={vi.fn()} />);
    const sentRemove = screen.getByRole('button', { name: copy.steerChipSentTooltip }) as HTMLButtonElement;
    expect(sentRemove.disabled).toBe(true);
    const removable = screen.getAllByRole('button', { name: copy.steerChipCancel });
    expect(removable).toHaveLength(2);
    fireEvent.click(removable[0]);
    expect(onCancel).toHaveBeenCalledWith('local');
    fireEvent.click(removable[1]);
    expect(onCancel).toHaveBeenCalledWith('q1');
  });

  it('offers stop-and-resend for waiting notes but not for queued ones', () => {
    const onStop = vi.fn();
    render(<SteerQueue notes={[note({})]} queued={[queued()]} onCancel={vi.fn()} onStopAndResend={onStop} />);
    const stop = screen.getAllByRole('button', { name: copy.steerStopAndResend });
    expect(stop).toHaveLength(1);
    fireEvent.click(stop[0]);
    expect(onStop).toHaveBeenCalledWith('n1');
    expect(screen.getByText(copy.steerChipQueued)).toBeTruthy();
  });

  it('marks waiting chips with a pulse that respects reduced motion', () => {
    render(<SteerQueue notes={[note({})]} queued={[queued()]} onCancel={vi.fn()} onStopAndResend={vi.fn()} />);
    const chips = screen.getAllByTestId('steer-chip');
    expect(chips[0].querySelector('.motion-safe\\:animate-pulse')).not.toBeNull();
    expect(chips[1].querySelector('.motion-safe\\:animate-pulse')).toBeNull();
  });
});
