/**
 * Agent 运行中插话集成用例。
 *
 * 运行方式（**必须**显式指定集成配置，否则 0 用例、退出码 0）：
 *   npx vitest run --config vitest.integration.config.ts tests/integration/agent-steering.test.ts
 *
 * 设计基线：docs/plans/agent-steering-and-skills/spec.md §3.2 / AC-A2、AC-A11。
 *
 * 跨模块接线：真实的 `POST /steer` 路由 → 进程内登记表 → 运行句柄 → 真实的
 * pi-agent-core `Agent`（脚本化模型）。验证「回合中途插话 → 收到 steer_applied →
 * 后续模型请求带上插话」，以及停止后到达的插话得到 409 而不是 202。
 */
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Agent } from '@mariozechner/pi-agent-core';
import { Type, createAssistantMessageEventStream } from '@mariozechner/pi-ai';
import defaultConfig from '../../vitest.config';
import { POST as steerRoute } from '@/app/api/video-editing-agent/steer/route';
import { createRunHandle } from '@/app/api/video-editing-agent/chat/runLifecycle';
import {
  getRun, registerRun, resetRunRegistryForTests, unregisterRun,
} from '@/lib/server/agentRunRegistry';
import { STEER_WRAPPER } from '@/lib/video-editing-agent/promptParts';
import type { SSEEvent } from '@/lib/video-editing-agent/types';

// The steer route imports the BFF helpers, which refuse to load without a backend URL.
vi.hoisted(() => { process.env.BACKEND_URL ??= 'http://127.0.0.1:8000'; });

const usage = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function scripted(content: unknown[], stopReason: 'toolUse' | 'stop') {
  const message = {
    role: 'assistant', content, api: 'openai-completions', provider: 'openai',
    model: 'fake', usage, stopReason, timestamp: Date.now(),
  };
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push({ type: 'start', partial: message } as never);
    stream.push({ type: 'done', reason: stopReason, message } as never);
    stream.end(message as never);
  });
  return stream as never;
}

function steerRequest(runId: string, text: string, steerId: string) {
  return new NextRequest('http://localhost:3000/api/video-editing-agent/steer', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify({ runId, steerId, text }),
  });
}

describe('steering integration', () => {
  it('is excluded from the default unit config', () => {
    const include = (defaultConfig as { test?: { include?: string[] } }).test?.include ?? [];
    expect(include.every(pattern => !pattern.includes('tests/integration'))).toBe(true);
  });

  it('delivers a mid-turn POST /steer to the model after the running tool', async () => {
    resetRunRegistryForTests();
    const sent: SSEEvent[] = [];
    const requests: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let started: () => void = () => undefined;
    const toolStarted = new Promise<void>(resolve => { started = resolve; });
    let call = 0;
    const agent = new Agent({
      streamFn: (_model, context) => {
        requests.push(JSON.stringify(context.messages));
        call += 1;
        return call === 1
          ? scripted([{ type: 'toolCall', id: 'call-1', name: 'slow', arguments: {} }], 'toolUse')
          : scripted([{ type: 'text', text: 'ok' }], 'stop');
      },
      initialState: {
        systemPrompt: 's', thinkingLevel: 'off', messages: [],
        model: {
          id: 'fake', name: 'fake', api: 'openai-completions', provider: 'openai', baseUrl: '',
          reasoning: false, input: ['text'], contextWindow: 1000, maxTokens: 100,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        } as never,
        tools: [{
          name: 'slow', label: 'slow', description: 'slow', parameters: Type.Object({}),
          execute: async () => { started(); await gate; return { content: [{ type: 'text', text: 'done' }], details: {} }; },
        }] as never,
      },
      getApiKey: () => 'k',
    });
    const handle = createRunHandle({ agent, send: event => sent.push(event) });
    agent.subscribe(event => handle.onAgentEvent(event));
    registerRun(handle);

    const turn = agent.prompt('go');
    await toolStarted;
    const response = await steerRoute(steerRequest(handle.runId, '配图改成竖版', 'steer-int-0001'));
    expect(response.status).toBe(202);
    release();
    await turn;
    unregisterRun(handle.runId);

    expect(sent.find(event => event.type === 'steer_applied')).toEqual(
      { type: 'steer_applied', steerId: 'steer-int-0001', afterToolCallId: 'call-1' });
    expect(requests[requests.length - 1]).toContain(
      JSON.stringify(STEER_WRAPPER('配图改成竖版')).slice(1, -1));
  });

  it('answers 409 run_closed for a steer that arrives after the run was closed', async () => {
    resetRunRegistryForTests();
    const agent = new Agent({
      streamFn: () => scripted([{ type: 'text', text: 'ok' }], 'stop'),
      initialState: {
        systemPrompt: 's', thinkingLevel: 'off', messages: [], tools: [],
        model: { id: 'fake', name: 'fake', api: 'openai-completions', provider: 'openai',
          baseUrl: '', reasoning: false, input: ['text'], contextWindow: 1000, maxTokens: 100,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as never,
      },
      getApiKey: () => 'k',
    });
    const handle = createRunHandle({ agent, send: () => undefined });
    registerRun(handle);
    handle.close();
    const response = await steerRoute(steerRequest(handle.runId, 'late', 'steer-int-0002'));
    expect(response.status).toBe(409);
    expect((await response.json()).error_code).toBe('run_closed');
    expect(getRun(handle.runId)).toBeDefined();
    unregisterRun(handle.runId);
  });
});
