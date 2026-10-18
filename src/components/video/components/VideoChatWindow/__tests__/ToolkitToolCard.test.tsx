import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { AgentToolCallRecord } from '@/types';
import { ToolkitToolCard, isToolkitTool } from '../ToolkitToolCard';
import { ASK_ANSWER_EVENT } from '../AskUserCard';

let locale = 'en';
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations[locale], locale }),
}));
afterEach(() => { locale = 'en'; });

const copy = translations.en.agentToolkit;

function record(name: string, result?: unknown): AgentToolCallRecord {
  return { id: `call-${name}`, name, params: {}, status: 'completed', result };
}

const planEnvelope = {
  success: true, plan_id: 'plan-0123abcd', total: 2, done_count: 1,
  active_step: 1, note: null,
  steps: [
    { index: 0, title: 'Read the brief', status: 'completed' },
    { index: 1, title: 'Cut the clips', status: 'in_progress' },
  ],
};

const askEnvelope = {
  success: true, status: 'awaiting_user', question_id: 'q-1a2b3c4d',
  question: 'Which voice should I use?', allow_free_text: false,
  options: [{ label: 'Narrator' }, { label: 'Host' }],
};

describe('ToolkitToolCard', () => {
  it('谓词只认 toolkit 工具', () => {
    expect(isToolkitTool('update_plan')).toBe(true);
    expect(isToolkitTool('ask_user')).toBe(true);
    expect(isToolkitTool('run_analysis')).toBe(true);
    expect(isToolkitTool('memory_search')).toBe(true);
    expect(isToolkitTool('web_research')).toBe(false);
    expect(isToolkitTool('trim_clip')).toBe(false);
  });

  it('非 toolkit 工具返回 null（宿主继续走原路径）', () => {
    const { container } = render(<ToolkitToolCard toolCall={record('trim_clip', {})} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('update_plan 成功后渲染 PlanCard', () => {
    render(<ToolkitToolCard toolCall={record('update_plan', planEnvelope)} />);
    expect(screen.getByText(`${copy.planTitle} (1/2)`)).toBeInTheDocument();
    expect(screen.getByText('Read the brief')).toHaveClass('line-through');
  });

  it('update_plan 未生效时给中性空态而不是伪造步骤', () => {
    render(<ToolkitToolCard toolCall={record('update_plan', {
      success: false, error_code: 'invalid_argument',
    })} />);
    expect(screen.getByText(copy.planEmpty)).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('ask_user 只在 awaiting_user 时渲染提问卡片', () => {
    const { container } = render(
      <ToolkitToolCard toolCall={record('ask_user', askEnvelope)} />);
    expect(screen.getByText('Which voice should I use?')).toBeInTheDocument();
    expect(container.querySelectorAll('button')).toHaveLength(2);
    const settled = render(<ToolkitToolCard toolCall={record('ask_user', {
      success: true, status: 'answered', question_id: 'q-1a2b3c4d',
    })} />);
    expect(settled.container).toBeEmptyDOMElement();
  });

  it('answeredQuestionIds 命中后提问卡片被禁用', () => {
    render(<ToolkitToolCard toolCall={record('ask_user', askEnvelope)}
      answeredQuestionIds={new Set(['q-1a2b3c4d'])} />);
    expect(screen.getByRole('button', { name: 'Narrator' })).toBeDisabled();
    expect(screen.getByText(copy.askAnswered)).toBeInTheDocument();
  });

  it('未命中 answeredQuestionIds 时点击仍只派发一次答案事件', () => {
    const seen: unknown[] = [];
    const handler = (event: Event) =>
      seen.push((event as CustomEvent<{ questionId: string; answer: string }>).detail);
    window.addEventListener(ASK_ANSWER_EVENT, handler);
    try {
      render(<ToolkitToolCard toolCall={record('ask_user', askEnvelope)} />);
      const option = screen.getByRole('button', { name: 'Host' });
      fireEvent.click(option);
      fireEvent.click(option);
    } finally {
      window.removeEventListener(ASK_ANSWER_EVENT, handler);
    }
    expect(seen).toEqual([{ questionId: 'q-1a2b3c4d', answer: 'Host' }]);
  });

  it('工作区与分析类工具走 WorkspaceFileCard', () => {
    render(<ToolkitToolCard toolCall={record('run_analysis', {
      success: true, status: 'ok', stdout: 'done', duration_ms: 42, files: [],
    })} />);
    expect(screen.getByText(copy.tools.run_analysis)).toBeInTheDocument();
    expect(screen.getByText(copy.analysisOutput)).toBeInTheDocument();
  });
});
