import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { AgentExecutionState } from '@/components/video/hooks/useAgentExecutionState';
import AgentBusyBar, { formatElapsed } from '../AgentBusyBar';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

function state(patch: Partial<AgentExecutionState> = {}): AgentExecutionState {
  return {
    status: 'executing', startTime: Date.now(), elapsedTime: 0, retryCount: 0,
    completedTools: [], currentTool: null, pendingMessage: '', error: null,
    isThinking: false, ...patch,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('formatElapsed', () => {
  it.each([[0, '0:00'], [9, '0:09'], [72, '1:12'], [3_725, '1:02:05'], [-4, '0:00']])(
    '%i s → %s', (seconds, text) => expect(formatElapsed(seconds)).toBe(text));
});

describe('AgentBusyBar', () => {
  it('shows "Step i/n · title" when the turn has a plan', () => {
    render(<AgentBusyBar executionState={state()} onCancel={vi.fn()}
      planStep={{ index: 2, total: 5, title: 'Search footage' }} />);
    expect(screen.getByRole('status').textContent).toBe('Step 2/5 · Search footage');
  });

  it('falls back to the running tool, then to the generic label, without a plan', () => {
    const { rerender } = render(<AgentBusyBar onCancel={vi.fn()}
      executionState={state({ currentTool: { id: 'c', name: 'search_video' } as never })} />);
    expect(screen.getByRole('status').textContent).toContain('search_video');
    rerender(<AgentBusyBar onCancel={vi.fn()} executionState={state()} />);
    expect(screen.getByRole('status').textContent).toBe(translations.en.videoChatWindow.agentBusyWorking);
  });

  it('ticks the clock every second but keeps it out of the live region (aria-hidden)', () => {
    render(<AgentBusyBar executionState={state({ startTime: Date.now() })} onCancel={vi.fn()} />);
    const clock = screen.getByTestId('agent-busy-elapsed');
    expect(clock.getAttribute('aria-hidden')).toBe('true');
    expect(clock.textContent).toContain('0:00');
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(screen.getByTestId('agent-busy-elapsed').textContent).toContain('0:03');
    expect(screen.getByRole('status').textContent).not.toContain('0:0');
  });

  it('shows the steer hint only when asked to', () => {
    const { rerender } = render(<AgentBusyBar executionState={state()} onCancel={vi.fn()} />);
    expect(screen.queryByText(/Enter to steer/)).toBeNull();
    rerender(<AgentBusyBar executionState={state()} onCancel={vi.fn()} showSteerHint />);
    expect(screen.getByText(/Enter to steer/)).toBeTruthy();
  });

  it('stops the run from its ghost button and drops the ping animation under reduced motion', () => {
    const onCancel = vi.fn();
    const { container } = render(<AgentBusyBar executionState={state()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[class*="animate-ping"]')?.className).toContain('motion-safe:animate-ping');
  });
});
