import { describe, expect, it } from 'vitest';
import { Agent } from '@mariozechner/pi-agent-core';
import { Type, createAssistantMessageEventStream } from '@mariozechner/pi-ai';
import { createRunHandle } from '../runLifecycle';
import { MAX_PENDING_STEERS, SteerError } from '@/lib/server/agentRunRegistry';
import { STEER_WRAPPER } from '@/lib/video-editing-agent/promptParts';
import type { SSEEvent } from '@/lib/video-editing-agent/types';

/**
 * These tests drive a REAL pi-agent-core Agent with a scripted model, because
 * the design rests on three pi behaviours (spec 评审结论 #2): reference
 * equality of the delivered message, `steeringMode: 'all'`, and skipping the
 * rest of a tool batch.
 */

const usage = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(content: unknown[], stopReason: 'toolUse' | 'stop') {
  return {
    role: 'assistant', content, api: 'openai-completions', provider: 'openai',
    model: 'fake', usage, stopReason, timestamp: Date.now(),
  };
}

function scriptedStream(message: ReturnType<typeof assistant>) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push({ type: 'start', partial: message } as never);
    stream.push({ type: 'done', reason: message.stopReason, message } as never);
    stream.end(message as never);
  });
  return stream;
}

interface Harness {
  agent: Agent;
  sent: SSEEvent[];
  seenByModel: string[];
  releaseTool: () => void;
  firstToolStarted: Promise<void>;
  toolsRun: string[];
}

function harness(toolCallsInFirstTurn: string[]): Harness {
  const sent: SSEEvent[] = [];
  const seenByModel: string[] = [];
  const toolsRun: string[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let markStarted: () => void = () => undefined;
  const firstToolStarted = new Promise<void>(resolve => { markStarted = resolve; });
  let call = 0;
  const tool = (name: string) => ({
    name, label: name, description: name, parameters: Type.Object({}),
    execute: async () => {
      toolsRun.push(name);
      if (name === 'slow_a') { markStarted(); await gate; }
      return { content: [{ type: 'text' as const, text: 'ok' }], details: {} };
    },
  });
  const agent = new Agent({
    streamFn: (_model, context) => {
      seenByModel.push(JSON.stringify(context.messages));
      call += 1;
      if (call === 1) {
        return scriptedStream(assistant(toolCallsInFirstTurn.map((name, index) =>
          ({ type: 'toolCall', id: `call-${index}`, name, arguments: {} })), 'toolUse')) as never;
      }
      return scriptedStream(assistant([{ type: 'text', text: 'done' }], 'stop')) as never;
    },
    initialState: {
      systemPrompt: 'test', thinkingLevel: 'off', messages: [],
      model: {
        id: 'fake', name: 'fake', api: 'openai-completions', provider: 'openai',
        baseUrl: '', reasoning: false, input: ['text'], contextWindow: 1000, maxTokens: 100,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      } as never,
      tools: toolCallsInFirstTurn.map(tool) as never,
    },
    getApiKey: () => 'k',
  });
  return { agent, sent, seenByModel, releaseTool: release, firstToolStarted, toolsRun };
}

function wire(h: Harness) {
  const handle = createRunHandle({ agent: h.agent, send: event => h.sent.push(event) });
  h.agent.subscribe(event => handle.onAgentEvent(event));
  return handle;
}

describe('createRunHandle with a real Agent', () => {
  it('delivers a steer after the running tool, emits steer_applied, and skips the rest of the batch', async () => {
    const h = harness(['slow_a', 'fast_b']);
    const handle = wire(h);
    const turn = h.agent.prompt('start');
    await h.firstToolStarted;
    handle.steer({ steerId: 'steer-0001', text: '改成竖版' });
    h.releaseTool();
    await turn;

    // pi still emits tool_execution_end for the SKIPPED call-1, so that is the
    // last tool event before delivery — and the id the converter will find.
    expect(h.sent.filter(event => event.type === 'steer_applied')).toEqual([
      { type: 'steer_applied', steerId: 'steer-0001', afterToolCallId: 'call-1' },
    ]);
    expect(h.toolsRun).toEqual(['slow_a']);
    const lastRequest = h.seenByModel[h.seenByModel.length - 1];
    expect(lastRequest).toContain(JSON.stringify(STEER_WRAPPER('改成竖版')).slice(1, -1));
  });

  it('delivers several steers of one batch together, each with its own steer_applied', async () => {
    const h = harness(['slow_a']);
    const handle = wire(h);
    const turn = h.agent.prompt('start');
    await h.firstToolStarted;
    handle.steer({ steerId: 'steer-0001', text: 'one' });
    handle.steer({ steerId: 'steer-0002', text: 'two' });
    h.releaseTool();
    await turn;

    const ids = h.sent.filter(event => event.type === 'steer_applied')
      .map(event => (event as { steerId: string }).steerId);
    expect(ids).toEqual(['steer-0001', 'steer-0002']);
    expect(h.agent.getSteeringMode()).toBe('all');
    expect(handle.pendingCount()).toBe(0);
  });

  it('reports afterToolCallId null for a steer delivered at the start of the turn', async () => {
    const h = harness(['fast_b']);
    const handle = wire(h);
    handle.steer({ steerId: 'steer-0001', text: 'a' });
    await h.agent.prompt('start');
    expect(h.sent.find(event => event.type === 'steer_applied')).toEqual(
      { type: 'steer_applied', steerId: 'steer-0001', afterToolCallId: null });
  });

  it('enforces duplicate, queue-size and closed rules', () => {
    const h = harness(['slow_a']);
    const handle = wire(h);
    handle.steer({ steerId: 'steer-0001', text: 'a' });
    expect(() => handle.steer({ steerId: 'steer-0001', text: 'a' }))
      .toThrowError(expect.objectContaining({ code: 'duplicate_steer' }));
    for (let index = 2; index <= MAX_PENDING_STEERS; index++) {
      handle.steer({ steerId: `steer-000${index}`, text: 'x' });
    }
    expect(() => handle.steer({ steerId: 'steer-9999', text: 'x' }))
      .toThrowError(expect.objectContaining({ code: 'steer_queue_full' }));
    handle.close();
    expect(() => handle.steer({ steerId: 'steer-8888', text: 'x' }))
      .toThrow(SteerError);
    expect(() => handle.steer({ steerId: 'steer-8888', text: 'x' }))
      .toThrowError(expect.objectContaining({ code: 'run_closed' }));
  });

  it('close() reports undelivered steers once and is idempotent', () => {
    const h = harness(['slow_a']);
    const handle = wire(h);
    handle.steer({ steerId: 'steer-0001', text: 'a' });
    handle.close();
    handle.close();
    expect(h.sent).toEqual([{ type: 'steer_dropped', steerIds: ['steer-0001'] }]);
  });

  it('timestamps are strictly increasing so the fallback match cannot hit another note', () => {
    const h = harness(['slow_a']);
    const handle = wire(h);
    const stamps: number[] = [];
    h.agent.steer = (message: unknown) => { stamps.push((message as { timestamp: number }).timestamp); };
    for (let index = 1; index <= 3; index++) {
      handle.steer({ steerId: `steer-000${index}`, text: 'x' });
    }
    expect(stamps[1]).toBeGreaterThan(stamps[0]);
    expect(stamps[2]).toBeGreaterThan(stamps[1]);
  });
});
