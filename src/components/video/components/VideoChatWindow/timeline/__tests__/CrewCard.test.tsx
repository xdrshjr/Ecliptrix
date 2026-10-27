import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { AgentToolCallRecord } from '@/types';
import { EMPTY_LIVE_PROGRESS, type LiveCrew, type LiveProgressState } from '@/components/video/hooks/agentLiveProgress';
import { LiveProgressContext } from '@/components/video/hooks/useCrewProgress';
import CrewCard from '../CrewCard';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

const copy = translations.en.agentCrew;

const params = { tasks: [{ id: 'shot-1', goal: 'night city' }, { id: 'shot-2', goal: 'latte art' }] };
const RESULT = {
  success: true, model_tier: 'fast',
  tasks: [
    {
      id: 'shot-1', status: 'done', summary: 'three good ones',
      candidates: [{ url: 'https://videos.example.com/a.mp4', kind: 'video', title: 'Night city', why: 'vertical',
        license_hint: 'CC0', source_page_url: 'https://videos.example.com/a' },
      { url: 'javascript:alert(1)', kind: 'video', title: 'Evil link', why: 'x', source_page_url: 'javascript:alert(2)' }],
      sources: [], gaps: ['no drone'], dropped_unverified: 1, usage: { model_calls: 2, tool_calls: 5, elapsed_ms: 31_000 },
    },
    { id: 'shot-2', status: 'failed', summary: '', candidates: [], sources: [], gaps: [], dropped_unverified: 0,
      usage: { model_calls: 1, tool_calls: 2, elapsed_ms: 4_000 } },
  ],
};

const call = (patch: Partial<AgentToolCallRecord> = {}): AgentToolCallRecord => ({
  id: 'tc-1', name: 'delegate_research', params, status: 'completed', result: RESULT, ...patch,
});

function liveCrew(patch: Partial<LiveCrew> = {}): LiveCrew {
  return {
    toolCallId: 'tc-1', crewId: 'crew-1', modelTier: 'fast', ended: false,
    members: [
      { id: 'shot-1', goal: 'night city', state: 'running', activity: 'search:city night aerial', toolCalls: 2, modelCalls: 1, elapsedMs: 12_000 },
      { id: 'shot-2', goal: 'latte art', state: 'queued', toolCalls: 0, modelCalls: 0, elapsedMs: 0 },
    ],
    ...patch,
  };
}
const withLive = (crew: LiveCrew | undefined, children: React.ReactNode) => {
  const value: LiveProgressState = crew ? { ...EMPTY_LIVE_PROGRESS, crews: { 'tc-1': crew } } : EMPTY_LIVE_PROGRESS;
  return <LiveProgressContext.Provider value={value}>{children}</LiveProgressContext.Provider>;
};

afterEach(cleanup);

describe('CrewCard — running', () => {
  const running = () => call({ status: 'executing', result: undefined });

  it('shows one row per member with its localised activity', () => {
    render(withLive(liveCrew(), <CrewCard toolCall={running()} />));

    expect(screen.getByText('Research crew · 2 in parallel')).toBeTruthy();
    expect(screen.getByText('Searching: city night aerial')).toBeTruthy();
    expect(screen.getByText(/shot-2 latte art/)).toBeTruthy();
    expect(screen.getByText(/Fast-tier model · 2 tool calls/)).toBeTruthy();
  });

  it('gives every state a glyph and an accessible name, not just a colour', () => {
    render(withLive(liveCrew(), <CrewCard toolCall={running()} />));

    expect(screen.getByRole('img', { name: copy.member.running })).toBeTruthy();
    expect(screen.getByRole('img', { name: copy.member.queued })).toBeTruthy();
  });

  it('shows an activity it cannot parse verbatim', () => {
    const crew = liveCrew();
    crew.members[0].activity = 'planning next step';

    render(withLive(crew, <CrewCard toolCall={running()} />));

    expect(screen.getByText('planning next step')).toBeTruthy();
  });

  it('keeps the changing activity out of assistive technology', () => {
    render(withLive(liveCrew(), <CrewCard toolCall={running()} />));

    expect(screen.getByText('Searching: city night aerial').getAttribute('aria-hidden')).toBe('true');
  });

  it('falls back to queued rows built from the call params before the first event', () => {
    render(withLive(undefined, <CrewCard toolCall={running()} />));

    expect(screen.getAllByRole('img', { name: copy.member.queued })).toHaveLength(2);
  });

  it('announces a member reaching a terminal state, and only that', () => {
    const view = render(withLive(liveCrew(), <CrewCard toolCall={running()} />));
    const status = () => screen.getByRole('status').textContent;
    expect(status()).toBe('');

    const next = liveCrew();
    next.members[0] = { ...next.members[0], state: 'running', activity: 'read:pexels.com', toolCalls: 3 };
    act(() => { view.rerender(withLive(next, <CrewCard toolCall={running()} />)); });
    expect(status()).toBe('');

    const done = liveCrew();
    done.members[0] = { ...done.members[0], state: 'done' };
    act(() => { view.rerender(withLive(done, <CrewCard toolCall={running()} />)); });
    expect(status()).toBe('shot-1: Done');
  });
});

describe('CrewCard — stopped before the crew reported back', () => {
  it('shows sealed members as cancelled with a note, no spinner', () => {
    const sealed = liveCrew({ ended: true });
    sealed.members = sealed.members.map(m => ({ ...m, state: 'cancelled' as const }));

    render(withLive(sealed, <CrewCard toolCall={call({ status: 'cancelled', result: undefined })} />));

    expect(screen.getAllByRole('img', { name: copy.member.cancelled })).toHaveLength(2);
    expect(screen.getByText(copy.cancelledNote)).toBeTruthy();
    expect(screen.queryByRole('img', { name: copy.member.running })).toBeNull();
  });

  it('after a reload (no live data) rebuilds cancelled rows from the params', () => {
    render(withLive(undefined, <CrewCard toolCall={call({ status: 'cancelled', result: undefined })} />));

    expect(screen.getAllByRole('img', { name: copy.member.cancelled })).toHaveLength(2);
  });
});

describe('CrewCard — finished', () => {
  it('collapses to a one-line summary built from the persisted result', () => {
    render(withLive(undefined, <CrewCard toolCall={call()} />));

    expect(screen.getByText('Research crew · 1 finished · 2 candidates · 1 gaps')).toBeTruthy();
    expect(screen.queryByText('three good ones')).toBeNull();
  });

  it('expands to summaries, candidates, gaps and the dropped-unverified count', () => {
    render(withLive(undefined, <CrewCard toolCall={call()} />));

    fireEvent.click(screen.getByRole('button', { name: copy.expand }));

    expect(screen.getByText('three good ones')).toBeTruthy();
    expect(screen.getByText('Night city')).toBeTruthy();
    expect(screen.getByText('CC0')).toBeTruthy();
    expect(screen.getByText(/Not found: no drone/)).toBeTruthy();
    expect(screen.getByText('1 unverified dropped')).toBeTruthy();
    expect(screen.getByText(copy.untrusted)).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.collapse }).getAttribute('aria-expanded')).toBe('true');
  });

  it('links the source page with a safe external link and refuses a javascript: url', () => {
    render(withLive(undefined, <CrewCard toolCall={call()} />));
    fireEvent.click(screen.getByRole('button', { name: copy.expand }));

    const links = screen.getAllByRole('link');

    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://videos.example.com/a');
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText('Evil link')).toBeTruthy();
  });

  it('marks each task with its state glyph, in the summary rows and the details', () => {
    render(withLive(undefined, <CrewCard toolCall={call()} />));
    fireEvent.click(screen.getByRole('button', { name: copy.expand }));

    expect(screen.getAllByRole('img', { name: copy.member.done }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('img', { name: copy.member.failed }).length).toBeGreaterThan(0);
  });

  it('says why a task has no candidates instead of showing an empty list', () => {
    render(withLive(undefined, <CrewCard toolCall={call()} />));
    fireEvent.click(screen.getByRole('button', { name: copy.expand }));

    expect(screen.getByText(copy.noCandidates)).toBeTruthy();
  });

  it('shows the error code when the whole tool failed', () => {
    render(withLive(undefined, <CrewCard toolCall={call({
      status: 'error', result: { success: false, error_code: 'crew_disabled', next_step: 'Search sequentially' },
    })} />));

    expect(screen.getByText(/crew_disabled/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.expand })).toBeNull();
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });
});
