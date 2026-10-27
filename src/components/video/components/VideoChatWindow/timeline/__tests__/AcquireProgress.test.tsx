import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { AgentToolCallRecord } from '@/types';
import { EMPTY_LIVE_PROGRESS, type LiveAcquire } from '@/components/video/hooks/agentLiveProgress';
import { LiveProgressContext } from '@/components/video/hooks/useCrewProgress';
import { PREFILL_MESSAGE_EVENT } from '@/lib/video-editing-agent/prefilledMessage';
import AcquireProgress from '../AcquireProgress';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

const copy = translations.en.agentAcquire;

const RESULT = {
  success: true, requested: 3, ready: 1, failed: 2, skipped: 0, published: true,
  items: [
    { index: 0, status: 'ready', kind: 'media', name: 'night.mp4', license_status: 'unknown' },
    { index: 1, status: 'failed', kind: 'media', error_code: 'network_error', retryable: true },
    { index: 2, status: 'failed', kind: 'image', error_code: 'blocked_repeat', retryable: false },
  ],
};
const call = (patch: Partial<AgentToolCallRecord> = {}): AgentToolCallRecord => ({
  id: 'tc-7', name: 'acquire_web_materials', params: { items: [{}, {}, {}] }, status: 'completed',
  result: RESULT, ...patch,
});
const withLive = (acquire: LiveAcquire | undefined, node: React.ReactNode) => (
  <LiveProgressContext.Provider value={{
    ...EMPTY_LIVE_PROGRESS, acquire: acquire ? { 'tc-7': acquire } : {},
  }}>{node}</LiveProgressContext.Provider>
);

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(cleanup);

describe('AcquireProgress — running', () => {
  const running = () => call({ status: 'executing', result: undefined });

  it('shows one slot per requested item and fills them as progress events arrive', () => {
    render(withLive({ done: 2, total: 3, slots: { 0: 'ready', 1: 'failed' } }, <AcquireProgress toolCall={running()} />));

    expect(screen.getByText('Acquiring materials · 2/3')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('listitem', { name: '#0 Added' })).toBeTruthy();
    expect(screen.getByRole('listitem', { name: '#1 Failed' })).toBeTruthy();
    expect(screen.getByRole('listitem', { name: '#2 Waiting' })).toBeTruthy();
  });

  it('shows empty slots from the call params before the first event', () => {
    render(withLive(undefined, <AcquireProgress toolCall={running()} />));

    expect(screen.getByText('Acquiring materials · 0/3')).toBeTruthy();
    expect(screen.getAllByRole('listitem', { name: /Waiting/ })).toHaveLength(3);
  });
});

describe('AcquireProgress — finished', () => {
  it('summarises the batch and shows per-item names, errors and the unknown-licence tag', () => {
    render(withLive(undefined, <AcquireProgress toolCall={call()} />));

    expect(screen.getByText('1 added to library · 2 failed')).toBeTruthy();
    expect(screen.getByText('night.mp4')).toBeTruthy();
    expect(screen.getByText(copy.licenseUnknown)).toBeTruthy();
    expect(screen.getByText(copy.error.network_error)).toBeTruthy();
    expect(screen.getByText(copy.error.blocked_repeat)).toBeTruthy();
  });

  it('offers a retry only for failures the tool marked retryable', () => {
    render(withLive(undefined, <AcquireProgress toolCall={call()} />));

    const buttons = screen.getAllByRole('button');

    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain('#1');
  });

  it('retry only fills the message box; it never sends anything', () => {
    const input = document.createElement('textarea');
    input.setAttribute('data-agent-input', '');
    document.body.appendChild(input);
    const prefill = vi.fn();
    window.addEventListener(PREFILL_MESSAGE_EVENT, prefill);
    const sent = vi.fn();
    window.addEventListener('ecliptrix:agent-ask-answer', sent);
    render(withLive(undefined, <AcquireProgress toolCall={call()} />));

    fireEvent.click(screen.getByRole('button', { name: `${copy.retry} #1` }));

    expect(prefill).toHaveBeenCalledTimes(1);
    expect((prefill.mock.calls[0][0] as CustomEvent).detail).toEqual({ text: 'Please retry material #1' });
    expect(input.value).toBe('Please retry material #1');
    expect(sent).not.toHaveBeenCalled();
    window.removeEventListener(PREFILL_MESSAGE_EVENT, prefill);
  });

  it('says so when a stopped turn left ready items unpublished', () => {
    render(withLive(undefined, <AcquireProgress toolCall={call({
      result: { ...RESULT, published: false, failed: 0, items: [RESULT.items[0]] },
    })} />));

    expect(screen.getByText(copy.unpublished)).toBeTruthy();
  });

  it('maps an unknown error code to a generic failure text', () => {
    render(withLive(undefined, <AcquireProgress toolCall={call({
      result: { ...RESULT, items: [{ index: 0, status: 'failed', error_code: 'brand_new_code', retryable: false }] },
    })} />));

    expect(screen.getByText(copy.error.unknown)).toBeTruthy();
  });

  it('shows the failure of the whole batch instead of slots', () => {
    render(withLive(undefined, <AcquireProgress toolCall={call({
      status: 'error', result: { success: false, error_code: 'research_budget_exhausted' },
    })} />));

    expect(screen.getByText(new RegExp(copy.error.research_budget_exhausted))).toBeTruthy();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});
