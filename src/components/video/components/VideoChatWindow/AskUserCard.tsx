'use client';

/**
 * AskUserCard — `ask_user` 的提问卡片（2–4 个选项 + 可选自由输入）。
 *
 * 设计基线：docs/plans/agent-general-toolkit/spec.md §3.5.2 / §6.2。
 *
 * 三态（**全部只读派生**，不往 `ChatMessage` 写任何新字段）：
 *   - `awaiting`（默认）：选项可点，`window` 事件把答案交给 `VideoChatWindow`；
 *   - `answered`：该问题之后已存在 `[[ask:<id>]]` 用户消息 → 勾选 + 禁用；
 *   - `unresolved`：本轮已结束且历史里没有回答 → 灰态提示"直接输入答案即可"，
 *     不再假装还有一个不存在的挂起态。
 *
 * 一次激活只 dispatch 一次：`fired` ref 兜住「Enter 提交 + 表单 submit」这类
 * 同一次按键走两条路径的情况（AC-10 要求恰好一次）。
 */

import React, { useId, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { AskUserQuestion } from '@/types/agentToolkit';

export const ASK_ANSWER_EVENT = 'ecliptrix:agent-ask-answer';

export interface AskAnswerDetail {
  questionId: string;
  answer: string;
}

export interface AskUserCardProps {
  question: AskUserQuestion;
  /** 该问题之后已存在带同 `questionId` 的用户消息（宿主从历史派生）。 */
  answered?: boolean;
  /** 本轮已结束且历史里没有回答。 */
  unresolved?: boolean;
}

const BASE_BUTTON = 'rounded px-2 py-1 text-xs transition-colors ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ' +
  'disabled:cursor-not-allowed disabled:opacity-50';
const OPTION_BUTTON = `${BASE_BUTTON} border border-border hover:bg-accent`;
const PRIMARY_BUTTON = `${BASE_BUTTON} bg-primary text-primary-foreground hover:bg-primary/90`;

export default function AskUserCard({
  question, answered = false, unresolved = false,
}: AskUserCardProps) {
  const { t } = useLocale();
  const [freeText, setFreeText] = useState('');
  const fired = useRef(false);
  const inputId = useId();
  const locked = answered || unresolved;

  const answer = (value: string) => {
    const text = value.trim();
    if (!text || locked || fired.current) return;
    fired.current = true;
    window.dispatchEvent(new CustomEvent<AskAnswerDetail>(ASK_ANSWER_EVENT, {
      detail: { questionId: question.questionId, answer: text },
    }));
    setFreeText('');
  };

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-md border border-border
      bg-muted/40 p-3 text-xs text-foreground">
      <p className="font-medium break-words">{question.question}</p>
      {question.options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {question.options.map((option, index) => (
            <div key={`${index}-${option.label}`} className="min-w-0">
              <button type="button" disabled={locked}
                className={index === 0 ? PRIMARY_BUTTON : OPTION_BUTTON}
                onClick={() => answer(option.label)}>
                {option.label}
              </button>
              {option.description && (
                <p className="mt-1 break-words text-[11px] text-muted-foreground">
                  {option.description}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {question.allowFreeText && (
        <form className="mt-2 space-y-1"
          onSubmit={event => { event.preventDefault(); answer(freeText); }}>
          <label htmlFor={inputId}
            className="block text-[11px] text-muted-foreground">
            {t.agentToolkit.askFreeText}
          </label>
          <input id={inputId} type="text" value={freeText} disabled={locked}
            placeholder={t.agentToolkit.askPlaceholder}
            onChange={event => setFreeText(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              answer(freeText);
            }}
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs
              text-foreground focus-visible:outline focus-visible:outline-2
              focus-visible:outline-primary disabled:opacity-50" />
        </form>
      )}
      {answered && (
        <p className="mt-2 flex items-center gap-1 text-muted-foreground">
          <span aria-hidden="true" className="font-mono text-green-600 dark:text-green-400">✓</span>
          {t.agentToolkit.askAnswered}
        </p>
      )}
      {!answered && unresolved && (
        <p role="status" className="mt-2 text-muted-foreground">
          {t.agentToolkit.askUnanswered}
        </p>
      )}
    </section>
  );
}
