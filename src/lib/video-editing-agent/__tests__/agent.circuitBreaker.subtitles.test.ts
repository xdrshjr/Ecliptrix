import { describe, expect, it } from 'vitest';
import type { Agent, AgentEvent } from '@mariozechner/pi-agent-core';
import { subscribeAgentEvents } from '../agent';
import type { SSEEvent, ToolContext } from '../types';

/**
 * 熔断豁免（agent-subtitles spec §D-8 / P1-4 / AC-8）。
 *
 * 字幕校验失败是**一步自纠**：用户连续两句字幕写错不该让整轮中断。用例走真实的
 * `tool_execution_end` 路径（构造 details，而不是 mock 判据函数），并额外钉住
 * P1-4 的第二条约束——**抛异常**的失败仍然计数（异常让 `details` 不再是对象，
 * 豁免判据必须判不出来，否则真故障会被当成可自纠的输入错误）。
 */

function subscribeToFakeAgent() {
  let listener: ((event: AgentEvent) => void) | null = null;
  const agent = {
    subscribe: (fn: (event: AgentEvent) => void) => {
      listener = fn;
      return () => undefined;
    },
    abort: () => undefined,
  } as unknown as Agent;
  const sent: SSEEvent[] = [];
  const toolContext = { operations: new Map() } as unknown as ToolContext;
  subscribeAgentEvents(agent, toolContext, event => sent.push(event));
  return {
    emit: (event: Record<string, unknown>) => listener?.(event as unknown as AgentEvent),
    errors: () => sent.filter(event => event.type === 'error'),
  };
}

/** 一次「校验失败、正常返回」的 tool_execution_end（D-8 要求的形态）。 */
function subtitleRefusal(toolCallId: string) {
  return {
    type: 'tool_execution_end',
    toolCallId,
    toolName: 'add_subtitles',
    isError: false,
    result: {
      content: [{ type: 'text', text: '{}' }],
      details: {
        success: false,
        error_code: 'subtitle_cues_overlap',
        error_details: { failure_class: 'validation' },
        next_step: 'Shorten or delay the cue.',
      },
    },
  };
}

function subtitleSuccess(toolCallId: string) {
  return {
    type: 'tool_execution_end',
    toolCallId,
    toolName: 'add_subtitles',
    isError: false,
    result: { content: [{ type: 'text', text: '{}' }], details: { success: true, addedCount: 2 } },
  };
}

describe('circuit breaker × subtitles', () => {
  it('does not trip after five validation refusals', () => {
    const run = subscribeToFakeAgent();
    for (let index = 0; index < 5; index += 1) {
      run.emit(subtitleRefusal(`sub-${index}`));
    }
    expect(run.errors()).toEqual([]);

    // 第 6 次成功调用照常进行，不会被中断。
    run.emit(subtitleSuccess('sub-ok'));
    expect(run.errors()).toEqual([]);
  });

  it('never resets a real failure streak either (exempt = neither counts nor resets)', () => {
    const run = subscribeToFakeAgent();
    for (let index = 0; index < 4; index += 1) {
      run.emit({
        type: 'tool_execution_end',
        toolCallId: `fail-${index}`,
        toolName: 'search_video',
        isError: false,
        result: { content: [], details: { success: false, error: 'boom' } },
      });
    }
    run.emit(subtitleRefusal('sub-mid'));
    // 第 5 次真失败仍然触发熔断：豁免不会把计数清零。
    run.emit({
      type: 'tool_execution_end',
      toolCallId: 'fail-4',
      toolName: 'search_video',
      isError: false,
      result: { content: [], details: { success: false, error: 'boom' } },
    });
    expect(run.errors()).toEqual([
      expect.objectContaining({ code: 'tool_failures' }),
    ]);
  });

  it('still counts a thrown (isError) failure, which carries no details to match', () => {
    const run = subscribeToFakeAgent();
    for (let index = 0; index < 5; index += 1) {
      run.emit({
        type: 'tool_execution_end',
        toolCallId: `thrown-${index}`,
        toolName: 'add_subtitles',
        isError: true,
        result: { content: [{ type: 'text', text: 'SubtitleParseError' }] },
      });
    }
    expect(run.errors()).toEqual([
      expect.objectContaining({ code: 'tool_failures' }),
    ]);
  });

  it('counts subtitle_apply_refused as a real failure (P0-2 divergence must surface)', () => {
    const run = subscribeToFakeAgent();
    for (let index = 0; index < 5; index += 1) {
      run.emit({
        type: 'tool_execution_end',
        toolCallId: `refused-${index}`,
        toolName: 'add_subtitles',
        isError: false,
        result: {
          content: [{ type: 'text', text: '{}' }],
          details: {
            success: false,
            error_code: 'subtitle_apply_refused',
            error_details: { failure_class: 'validation' },
          },
        },
      });
    }
    expect(run.errors()).toEqual([
      expect.objectContaining({ code: 'tool_failures' }),
    ]);
  });
});
