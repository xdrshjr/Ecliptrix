import { describe, expect, it, vi } from 'vitest';
import type { Agent, AgentEvent } from '@mariozechner/pi-agent-core';
import { getTranslations } from '@/lib/i18n';
import { describeTtsFailure, makeTtsFailure } from '@/lib/ttsErrors';
import type { TtsFailure } from '@/lib/ttsErrors';
import { subscribeAgentEvents } from '../agent';
import { AgentEventRouter } from '../AgentEventRouter';
import { AgentStateManager } from '../AgentStateManager';
import type { OperationApplier } from '../OperationApplier';
import type { SSEEvent, ToolContext } from '../types';

const balance = makeTtsFailure('TTS_INSUFFICIENT_BALANCE', {
  source: 'provider', provider: 'volcengine', retryable: false, attempts: 1,
});

function runAgent() {
  let callback: (event: AgentEvent) => void = () => undefined;
  const abort = vi.fn();
  const agent = {
    subscribe: (listener: typeof callback) => {
      callback = listener;
      return () => undefined;
    }, abort,
  } as unknown as Agent;
  const events: SSEEvent[] = [];
  subscribeAgentEvents(agent, {
    operations: new Map(),
  } as ToolContext, event => events.push(event));
  const emit = (event: Record<string, unknown>) => callback(event as AgentEvent);
  const result = (details: unknown, toolName = 'generate_tts') => emit({
    type: 'tool_execution_end', toolCallId: `call-${events.length}`,
    toolName, result: { details }, isError: false,
  });
  return { emit, result, events, abort };
}

describe('TTS 最近原因与熔断终态', () => {
  it('第五次失败先发工具结果，再附最近原因且后续消息不覆盖终态', () => {
    const run = runAgent();
    for (let index = 0; index < 5; index++) {
      run.result({ success: false, ...balance });
    }
    const message = {
      role: 'assistant', content: [], stopReason: 'error',
      errorMessage: 'model aborted after tool failure',
    };
    run.emit({ type: 'message_end', message });
    run.emit({ type: 'agent_end', messages: [message] });
    expect(run.events.map(event => event.type)).toEqual([
      'tool_result', 'tool_result', 'tool_result', 'tool_result', 'tool_result',
      'error', 'message_end', 'agent_end',
    ]);
    expect(run.events[5]).toMatchObject({ code: 'tool_failures', cause: balance });
    expect(run.abort).toHaveBeenCalledTimes(1);
  });

  it('当前普通工具失败清空之前的欠费原因', () => {
    const run = runAgent();
    for (let index = 0; index < 4; index++) {
      run.result({ success: false, ...balance });
    }
    run.result({ success: false, ...balance }, 'search_video');
    const error = run.events.find(event => event.type === 'error');
    expect(error).not.toHaveProperty('cause');
  });

  it('新的可信失败替换之前的原因', () => {
    const run = runAgent();
    for (let index = 0; index < 4; index++) {
      run.result({ success: false, ...balance });
    }
    run.result({ success: false, ...makeTtsFailure('TTS_AUTH_FAILED', {
      source: 'provider', retryable: false,
    }) });
    expect(run.events.find(event => event.type === 'error')).toMatchObject({
      cause: { error_code: 'TTS_AUTH_FAILED' },
    });
  });

  it('有成果的部分成功重置失败计数和原因', () => {
    const run = runAgent();
    for (let index = 0; index < 4; index++) {
      run.result({ success: false, ...balance });
    }
    run.result({ success: true, partial: true, results: [{ material_id: 'audio' }] },
      'batch_generate_tts');
    for (let index = 0; index < 4; index++) run.result({ success: false });
    expect(run.events.some(event => event.type === 'error')).toBe(false);
    run.result({ success: false });
    expect(run.events.find(event => event.type === 'error'))
      .not.toHaveProperty('cause');
  });

  it('熔断后仍发已开始工具的结果，只触发一次终态错误', () => {
    const run = runAgent();
    for (let index = 0; index < 7; index++) {
      run.result({ success: false, ...balance });
    }
    expect(run.events.filter(event => event.type === 'tool_result')).toHaveLength(7);
    expect(run.events.filter(event => event.type === 'error')).toHaveLength(1);
    expect(run.abort).toHaveBeenCalledTimes(1);
  });
});

describe('错误路由的原因守卫与本地化', () => {
  it.each(['zh-CN', 'en'])('将安全原因交给 %s 本地化并复用通知文本', async locale => {
    const stateManager = new AgentStateManager('message');
    const onError = vi.fn();
    const describeError = vi.fn((error: { cause?: TtsFailure }) => {
      const t = getTranslations(locale);
      return t.agentStream.errors.toolFailuresWithCause.replace(
        '{detail}', describeTtsFailure(error.cause!, t).summary,
      );
    });
    const router = new AgentEventRouter({
      stateManager, onError, describeError,
      operationApplier: {} as OperationApplier,
    });
    await router.handleEvent({
      type: 'error', code: 'tool_failures', message: 'fallback', cause: {
        ...balance, error_details: {
          ...balance.error_details!,
          provider_message: 'Authorization: Bearer invalid-fixture',
        },
      },
    });
    expect(describeError.mock.calls[0][0].cause).toEqual(balance);
    expect(onError.mock.calls[0][0]).toBe(stateManager.getSnapshot().errorMessage);
    expect(onError.mock.calls[0][0]).toContain(locale === 'en' ? 'balance' : '余额不足');
  });
});
