import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { AgentToolCallRecord, ChatMessage } from '@/types';
import { hasSummaryContent, summarizeTurn } from '../turnSummary';
import TurnSummaryCard from '../TurnSummaryCard';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

const crewCall: AgentToolCallRecord = {
  id: 'tc-1', name: 'delegate_research', params: {}, status: 'completed',
  result: { success: true, tasks: [
    { id: 'a', status: 'done', candidates: [{ url: 'https://x.example/1' }, { url: 'https://x.example/2' }] },
    { id: 'b', status: 'partial', candidates: [{ url: 'https://x.example/3' }] },
    { id: 'c', status: 'failed', candidates: [] },
  ] },
};
const acquireCall: AgentToolCallRecord = {
  id: 'tc-2', name: 'acquire_web_materials', params: {}, status: 'completed',
  result: { success: true, requested: 6, ready: 4, failed: 1, published: true, items: [
    { index: 0, status: 'ready' }, { index: 1, status: 'ready' }, { index: 2, status: 'already_in_library' },
    { index: 3, status: 'ready' }, { index: 4, status: 'failed' }, { index: 5, status: 'skipped' },
  ] },
};
const turn = (calls: AgentToolCallRecord[]): ChatMessage => ({
  id: 'm', role: 'assistant', content: 'done', timestamp: new Date(0), isAgentMessage: true,
  agentToolCalls: calls,
});

afterEach(cleanup);

describe('turn summary — web activity', () => {
  it('counts crew tasks, their candidates and acquired items out of the requested ones', () => {
    expect(summarizeTurn(turn([crewCall, acquireCall]))?.web)
      .toEqual({ crewTasks: 3, candidates: 3, acquired: 4, requested: 6 });
  });

  it('is null when neither tool ran', () => {
    const quiet: AgentToolCallRecord = { id: 'x', name: 'get_timeline', params: {}, status: 'completed', result: {} };

    expect(summarizeTurn(turn([quiet]))?.web).toBeNull();
  });

  it('ignores a failed tool call and a whole-batch failure', () => {
    const failed: AgentToolCallRecord = {
      ...acquireCall, result: { success: false, error_code: 'invalid_arguments' } };
    const errored: AgentToolCallRecord = { ...crewCall, status: 'error' };

    expect(summarizeTurn(turn([failed, errored]))?.web).toBeNull();
  });

  it('is enough content for the card to appear on its own', () => {
    const summary = summarizeTurn(turn([crewCall]))!;

    expect(hasSummaryContent(summary)).toBe(true);
  });

  it('renders the line on the card', () => {
    render(<TurnSummaryCard summary={summarizeTurn(turn([crewCall, acquireCall]))!} />);

    expect(screen.getByText('Web: crew 3 paths · 3 candidates')).toBeTruthy();
    expect(screen.getByText('Acquired 4/6')).toBeTruthy();
  });

  it('renders nothing extra for a summary built before this field existed', () => {
    const summary = summarizeTurn(turn([crewCall]))!;
    delete summary.web;

    render(<TurnSummaryCard summary={{ ...summary, failedTools: 1 }} />);

    expect(screen.queryByText(/Web: crew/)).toBeNull();
  });
});
