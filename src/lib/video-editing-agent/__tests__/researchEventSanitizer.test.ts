import { expect, it, vi } from 'vitest';
import type { Agent, AgentEvent } from '@mariozechner/pi-agent-core';
import { subscribeAgentEvents } from '../agent';
import type { ToolContext } from '../types';
import { sanitizeResearchValue } from '../researchEventSanitizer';

it('removes signed credentials recursively without stripping public query', () => {
  const result = sanitizeResearchValue({ params: { url:
    'https://example.com/a?q=cat&X-Amz-Signature=FAKE_SECRET&token=OTHER_SECRET' },
    operation: { provenance: { url: 'https://example.com/?key=THIRD_SECRET' } },
    run_token: 'RUN_SECRET' });
  expect(JSON.stringify(result)).not.toMatch(/FAKE_SECRET|OTHER_SECRET|THIRD_SECRET|RUN_SECRET/);
  expect(JSON.stringify(result)).toContain('q=cat');
});

it('preserves material dates through operation serialization', () => {
  const operation = { materials: [{ createdAt: new Date('2026-10-06T00:00:00Z') }] };
  expect(JSON.stringify(sanitizeResearchValue(operation))).toContain('2026-10-06T00:00:00.000Z');
});

it('suppresses a prepared research operation if its network run closes before the event', () => {
  let onEvent: (event: AgentEvent) => void = () => undefined;
  const agent = { subscribe: (listener: typeof onEvent) => { onEvent = listener; } } as unknown as Agent;
  const controller = new AbortController();
  const context = { operations: new Map([['download', { type: 'add_materials', materials: [] }]]),
    researchRun: { controller } } as unknown as ToolContext;
  const send = vi.fn();
  subscribeAgentEvents(agent, context, send);
  controller.abort();
  onEvent({ type: 'tool_execution_end', toolCallId: 'download', toolName: 'fetch_web_image',
    result: { content: [], details: { success: true } }, isError: false });
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool_result', operation: null }));
});
