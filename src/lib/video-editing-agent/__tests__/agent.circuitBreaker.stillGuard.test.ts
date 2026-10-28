/**
 * A still-image refusal is a one-step self-correction, not a failing tool:
 * the breaker must neither count it nor reset on it (spec D-2, AC-5/AC-19).
 */
import { describe, expect, it, vi } from 'vitest';
import type { Agent, AgentEvent } from '@mariozechner/pi-agent-core';
import { subscribeAgentEvents } from '../agent';
import type { SSEEvent, ToolContext } from '../types';

const REFUSAL = { success: false, error_code: 'still_needs_conversion', error: 'convert first' };
const FAILURE = { success: false, error: 'boom' };

function runAgent() {
  let callback: (event: AgentEvent) => void = () => undefined;
  const abort = vi.fn();
  const agent = {
    subscribe: (listener: typeof callback) => {
      callback = listener;
      return () => undefined;
    },
    abort,
  } as unknown as Agent;
  const events: SSEEvent[] = [];
  subscribeAgentEvents(agent, { operations: new Map() } as ToolContext, event => events.push(event));
  const result = (details: unknown, toolName = 'add_to_track') =>
    callback({
      type: 'tool_execution_end', toolCallId: `call-${events.length}`,
      toolName, result: { details }, isError: false,
    } as unknown as AgentEvent);
  const tripped = () => events.some(event => event.type === 'error');
  return { result, tripped, abort };
}

describe('circuit breaker and the still-image guard', () => {
  it('does not trip on six consecutive refusals', () => {
    const run = runAgent();
    for (let index = 0; index < 6; index++) run.result(REFUSAL);
    expect(run.tripped()).toBe(false);
    expect(run.abort).not.toHaveBeenCalled();
  });

  it('still trips on five real failures after the refusals', () => {
    const run = runAgent();
    for (let index = 0; index < 6; index++) run.result(REFUSAL);
    for (let index = 0; index < 5; index++) run.result(FAILURE);
    expect(run.tripped()).toBe(true);
  });

  it('does not reset the failure count (refusals between failures do not rescue)', () => {
    const run = runAgent();
    for (let index = 0; index < 4; index++) {
      run.result(FAILURE);
      run.result(REFUSAL);
    }
    expect(run.tripped()).toBe(false);
    run.result(FAILURE);
    expect(run.tripped()).toBe(true);
  });

  it('exempts compose_storyboard when all of its scenes were refused', () => {
    const run = runAgent();
    for (let index = 0; index < 6; index++) run.result(REFUSAL, 'compose_storyboard');
    expect(run.tripped()).toBe(false);
  });

  it('does not exempt a plain failure that merely mentions the code in text', () => {
    const run = runAgent();
    for (let index = 0; index < 5; index++) {
      run.result({ success: false, error: 'still_needs_conversion' });
    }
    expect(run.tripped()).toBe(true);
  });
});
