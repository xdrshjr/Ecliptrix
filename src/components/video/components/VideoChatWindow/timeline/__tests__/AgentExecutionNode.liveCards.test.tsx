import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { AgentToolCallRecord } from '@/types';
import AgentExecutionNode from '../AgentExecutionNode';
import type { AgentExecutionNodeData } from '../types';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

function renderNode(toolCalls: AgentToolCallRecord[], isActive: boolean) {
  const node: AgentExecutionNodeData = {
    kind: 'execution', id: 'n', timestamp: new Date(0), toolCalls, isActive, messageId: 'm',
  };
  const view = render(<AgentExecutionNode node={node} />);
  const header = view.container.querySelector('button[aria-expanded]');
  if (header?.getAttribute('aria-expanded') === 'false') fireEvent.click(header);
  return view;
}

describe('AgentExecutionNode — crew and acquire cards', () => {
  it('shows delegate_research as a crew card, also while it is still running', () => {
    renderNode([{
      id: 'tc-1', name: 'delegate_research', status: 'executing',
      params: { tasks: [{ id: 'shot-1', goal: 'night city' }] },
    }], true);

    expect(screen.getByText('Research crew · 1 in parallel')).toBeTruthy();
    expect(screen.getByRole('img', { name: translations.en.agentCrew.member.queued })).toBeTruthy();
  });

  it('shows acquire_web_materials as slots, also while it is still running', () => {
    renderNode([{
      id: 'tc-2', name: 'acquire_web_materials', status: 'executing', params: { items: [{}, {}] },
    }], true);

    expect(screen.getByText('Acquiring materials · 0/2')).toBeTruthy();
  });

  it('shows the finished results from the persisted tool result', () => {
    renderNode([
      {
        id: 'tc-1', name: 'delegate_research', status: 'completed', params: {},
        result: { success: true, tasks: [{ id: 'shot-1', status: 'done', candidates: [], gaps: [] }] },
      },
      {
        id: 'tc-2', name: 'acquire_web_materials', status: 'completed', params: {},
        result: { success: true, requested: 1, ready: 1, failed: 0, published: true,
          items: [{ index: 0, status: 'ready', name: 'a.mp4' }] },
      },
    ], false);

    expect(screen.getByText(/Research crew · 1 finished/)).toBeTruthy();
    expect(screen.getByText('1 added to library · 0 failed')).toBeTruthy();
  });
});
