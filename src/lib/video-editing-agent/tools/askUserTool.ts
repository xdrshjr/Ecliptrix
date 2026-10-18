import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { toolkitResult } from './toolkitAdapter';
import { stableHex } from './planTool';

/**
 * `ask_user`：关键分叉处停下来问一句（常驻工具，**不**引入中断-恢复协议）。
 *
 * 设计基线：docs/plans/agent-general-toolkit/spec.md §3.5.2。
 *
 * 三条硬约束：
 *   1. `options` 与 `allow_free_text` 至少给一个，否则用户无路可答（R-16）；
 *   2. 单轮只允许问一次，第二次返回 `already_asked`；
 *   3. `question_id` 必须**确定性**（同输入同 id），否则 SSE 重试会留下指向
 *      已消失问题的旧卡片（R-15 / 本仓库已知类缺陷 R1-AG-01）。
 */

const parameters = Type.Object({
  question: Type.String({ minLength: 1, maxLength: 300,
    description: 'The question, in the user\'s language. Keep it to one sentence.' }),
  options: Type.Optional(Type.Array(Type.Object({
    label: Type.String({ minLength: 1, maxLength: 60 }),
    description: Type.Optional(Type.String({ maxLength: 120 })),
  }), { minItems: 2, maxItems: 4,
    description: '2-4 choices. Pass this or allow_free_text=true (or both).' })),
  allow_free_text: Type.Optional(Type.Boolean({
    description: 'Allow a typed answer when none of the options fit.' })),
  reason: Type.Optional(Type.String({ maxLength: 120,
    description: 'Why the answer changes what you do next.' })),
});

type Params = Static<typeof parameters>;

export function questionIdFor(question: string, options: Array<{ label: string }>): string {
  return 'q-' + stableHex(
    question.trim() + '\u001f' + options.map(item => item.label).join('\u001f'));
}

export function createAskUserTool(
  context: ToolContext,
): AgentTool<typeof parameters> {
  return {
    name: 'ask_user',
    label: 'Ask User',
    description:
      'Ask the user one question when a missing decision would change the result. ' +
      'The tool returns immediately and the turn ends; the answer arrives as the next ' +
      'user message. Ask at most once per turn, and only when you cannot infer the answer.',
    parameters,
    execute: async (_toolCallId: string, params: Params) => {
      if (context.turnState.askedQuestionId) {
        return toolkitResult({
          success: false,
          error: 'already_asked',
          error_code: 'already_asked',
          next_step:
            'Wait for the user answer; do not ask twice in one turn.',
        });
      }
      const options = (params.options ?? []).map(option => ({
        label: option.label.trim(),
        ...(option.description ? { description: option.description.trim() } : {}),
      })).filter(option => option.label.length > 0);
      if (options.length === 0 && !params.allow_free_text) {
        return toolkitResult({
          success: false,
          error: 'invalid_argument',
          error_code: 'invalid_argument',
          next_step: 'Pass 2-4 options or allow_free_text=true.',
        });
      }
      const questionId = questionIdFor(params.question, options);
      context.turnState.askedQuestionId = questionId;
      return toolkitResult({
        success: true,
        status: 'awaiting_user',
        question_id: questionId,
        question: params.question.trim(),
        options,
        allow_free_text: params.allow_free_text === true,
        reason: params.reason ?? null,
        instruction:
          'Stop the turn now. The user answer arrives as the next user message.',
      });
    },
  };
}
