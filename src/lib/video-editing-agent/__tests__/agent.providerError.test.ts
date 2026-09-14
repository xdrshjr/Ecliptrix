/**
 * AG3-03: a model provider failure (401, 429, context overflow) is reported
 * with its cause. pi-agent-core ends such a turn with an assistant message
 * whose stopReason is 'error'; it used to read as "the model returned an
 * empty response", sending users after the wrong fix.
 */
import { describe, it, expect } from 'vitest';
import type { Agent, AgentEvent } from '@mariozechner/pi-agent-core';
import { formatProviderError, subscribeAgentEvents } from '../agent';
import type { SSEEvent, ToolContext } from '../types';

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

function assistantMessage(extra: Record<string, unknown>) {
  return { role: 'assistant', content: [{ type: 'text', text: '' }], ...extra };
}

describe('agent provider errors', () => {
  it('a provider error is reported with its cause, not as an empty response', () => {
    const run = subscribeToFakeAgent();
    const message = assistantMessage({ stopReason: 'error', errorMessage: '429 Too Many Requests: rate limit reached' });

    run.emit({ type: 'message_start', message });
    run.emit({ type: 'message_end', message });
    run.emit({ type: 'agent_end', messages: [message] });

    expect(run.errors()).toEqual([
      { type: 'error', code: 'provider_rate_limit', message: '429 Too Many Requests: rate limit reached' },
    ]);
  });

  it('an aborted assistant message emits no empty-response error', () => {
    const run = subscribeToFakeAgent();
    const message = assistantMessage({ stopReason: 'aborted' });

    run.emit({ type: 'message_start', message });
    run.emit({ type: 'message_end', message });

    expect(run.errors()).toEqual([]);
  });

  it('an empty assistant message still reports empty_response', () => {
    const run = subscribeToFakeAgent();
    const message = assistantMessage({ stopReason: 'stop' });

    run.emit({ type: 'message_start', message });
    run.emit({ type: 'message_end', message });

    expect(run.errors()).toEqual([expect.objectContaining({ code: 'empty_response' })]);
  });

  it('a request that fails before streaming reports its cause at agent_end', () => {
    const run = subscribeToFakeAgent();

    run.emit({
      type: 'agent_end',
      messages: [assistantMessage({ stopReason: 'error', errorMessage: '401 Unauthorized' })],
    });

    expect(run.errors()).toEqual([{ type: 'error', code: 'provider_auth', message: '401 Unauthorized' }]);
  });

  it('provider error details never contain an API key', () => {
    const formatted = formatProviderError(
      '401 Incorrect API key provided: sk-proj-abcdef1234567890. Header was Authorization: Bearer abc.def.ghi, api_key=zz9988776655',
    );

    expect({
      code: formatted.code,
      leaks: /abcdef1234567890|abc\.def\.ghi|zz9988776655/.test(formatted.message),
    }).toEqual({ code: 'provider_auth', leaks: false });
  });

  it('a context-length message that mentions 401 tokens is context_overflow', () => {
    const formatted = formatProviderError(
      "400 This model's maximum context length is 128000 tokens. However, you requested 401 more tokens.",
    );

    expect(formatted.code).toBe('context_overflow');
  });

  it('context overflow wording of other providers is context_overflow', () => {
    const messages = [
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 215000 tokens > 200000 maximum"}}',
      'Your input exceeds the context window of this model. Please adjust your input and try again.',
      'The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).',
      'Invalid request: Your request exceeded model token limit: 262144',
      '<400> InternalError.Algo.InvalidParameter: Range of input length should be [1, 98752]',
      'Prompt exceeds max length',
    ];

    expect(messages.map(text => formatProviderError(text).code))
      .toEqual(messages.map(() => 'context_overflow'));
  });

  it('a tokens-per-minute rate limit stays provider_rate_limit', () => {
    const formatted = formatProviderError(
      '429 Rate limit reached for gpt-4o on tokens per min (TPM): Limit 30000, Used 25000, Requested 9000.',
    );

    expect(formatted.code).toBe('provider_rate_limit');
  });

  it('query-string keys, access tokens and raw authorization headers are redacted', () => {
    const formatted = formatProviderError(
      'request to https://example.test/v1/models:generate?alt=sse&key=AIzaSyA1234567890abcdef failed; ' +
      'access_token=ya29.a0AfH6SMBxyz123456; {"authorization":"0123456789abcdef.XyZ987"}; ' +
      'Authorization: Basic dXNlcjpwYXNzd29yZA==',
    );

    expect(formatted.message).not.toMatch(
      /AIzaSyA1234567890abcdef|ya29\.a0AfH6SMBxyz123456|0123456789abcdef\.XyZ987|dXNlcjpwYXNzd29yZA==/,
    );
  });

  it('the circuit breaker error carries a code the UI can localise', () => {
    const run = subscribeToFakeAgent();

    for (let attempt = 0; attempt < 5; attempt++) {
      run.emit({
        type: 'tool_execution_end',
        toolCallId: `tc-${attempt}`,
        toolName: 'search_video',
        result: { details: { success: false } },
        isError: false,
      });
    }

    expect(run.errors()).toEqual([expect.objectContaining({ type: 'error', code: 'tool_failures' })]);
  });
});
