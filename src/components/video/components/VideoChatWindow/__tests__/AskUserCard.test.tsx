import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { AskUserQuestion } from '@/types/agentToolkit';
import AskUserCard, { ASK_ANSWER_EVENT } from '../AskUserCard';

let locale = 'en';
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations[locale], locale }),
}));

interface AnswerDetail { questionId: string; answer: string }

const stopListening: Array<() => void> = [];

/** 收集 `ecliptrix:agent-ask-answer` 的载荷（不依赖实现内部的 dispatch 路径）。 */
function listen(): AnswerDetail[] {
  const details: AnswerDetail[] = [];
  const handler = (event: Event) => {
    details.push((event as CustomEvent<AnswerDetail>).detail);
  };
  window.addEventListener(ASK_ANSWER_EVENT, handler);
  stopListening.push(() => window.removeEventListener(ASK_ANSWER_EVENT, handler));
  return details;
}

afterEach(() => {
  while (stopListening.length) stopListening.pop()?.();
  locale = 'en';
});

const copy = translations.en.agentToolkit;

const question: AskUserQuestion = {
  questionId: 'q-1a2b3c4d',
  question: 'Which voice should I use?',
  options: [{ label: 'Narrator' }, { label: 'Host', description: 'Warmer tone' }],
  allowFreeText: true,
  status: 'awaiting',
};

describe('AskUserCard', () => {
  it('点击选项恰好派发一次携带问题与答案的事件', () => {
    const details = listen();
    render(<AskUserCard question={question} />);
    const option = screen.getByRole('button', { name: 'Narrator' });
    expect(option).not.toBeDisabled();
    fireEvent.click(option);
    // 同一次激活不得重复派发（双击/回车提交两条路径共用同一个守卫）。
    fireEvent.click(option);
    expect(details).toEqual([{ questionId: 'q-1a2b3c4d', answer: 'Narrator' }]);
  });

  it('answered 态禁用选项与输入并显示已回答标签', () => {
    const details = listen();
    render(<AskUserCard question={question} answered />);
    expect(screen.getByRole('button', { name: 'Narrator' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Host' })).toBeDisabled();
    expect(screen.getByLabelText(copy.askFreeText)).toBeDisabled();
    expect(screen.getByText(copy.askAnswered)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Host' }));
    expect(details).toEqual([]);
  });

  it('unresolved 态给出未回答提示并禁用按钮', () => {
    render(<AskUserCard question={question} unresolved />);
    expect(screen.getByRole('status')).toHaveTextContent(copy.askUnanswered);
    expect(screen.getByRole('button', { name: 'Narrator' })).toBeDisabled();
    expect(screen.queryByText(copy.askAnswered)).toBeNull();
  });

  it('自由输入按 Enter 恰好派发一次', () => {
    const details = listen();
    render(<AskUserCard question={question} />);
    const input = screen.getByLabelText(copy.askFreeText);
    fireEvent.change(input, { target: { value: '  Use the host voice  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // 隐式表单提交在同一按键上是第二条路径，守卫必须吞掉它。
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(details).toEqual([
      { questionId: 'q-1a2b3c4d', answer: 'Use the host voice' },
    ]);
  });

  it('空白自由输入不派发事件', () => {
    const details = listen();
    render(<AskUserCard question={question} />);
    const input = screen.getByLabelText(copy.askFreeText);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(details).toEqual([]);
  });

  it('allowFreeText 为 false 时不渲染输入框', () => {
    render(<AskUserCard question={{ ...question, allowFreeText: false }} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Narrator' })).not.toBeDisabled();
  });
});
