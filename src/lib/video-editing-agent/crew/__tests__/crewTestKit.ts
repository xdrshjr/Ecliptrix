import { vi } from 'vitest';
import type { StreamFn } from '@mariozechner/pi-agent-core';
import type { AssistantMessage } from '@mariozechner/pi-ai';
import { createAssistantMessageEventStream } from '@mariozechner/pi-ai';
import { DEFAULT_CREW_SETTINGS, type CrewSettings, type ToolContext, type ToolSideEvent } from '../../types';

export const MAIN_MODEL = { apiUrl: 'https://main.example/v1', apiKey: 'main-key', model: 'main-model',
  apiType: 'openai' as const };
export const SEEN_ID = '11111111-1111-4111-8111-111111111111';
export const SEEN_URL = 'https://stock.example/video/night-city';

/** Stand-in for ResearchRunClient: records call ids and cancellations. */
export function fakeRun() {
  let lost: string | null = null;
  return {
    get lostReason() { return lost; },
    markLost: (code = 'run_closed') => { lost = code; },
    headerCalls: [] as string[],
    async headers(callId: string) { this.headerCalls.push(callId); return { 'X-Test-Run': 'run-1', 'X-Test-Call': callId }; },
    cancelCall: vi.fn(),
    controller: new AbortController(),
  };
}
export type FakeRun = ReturnType<typeof fakeRun>;

export interface TestContext {
  context: ToolContext;
  events: ToolSideEvent[];
  run: FakeRun;
  stop: AbortController;
}

export function makeContext(options: {
  settings?: Partial<CrewSettings>; globalConcurrency?: number; withRun?: boolean; withMain?: boolean;
} = {}): TestContext {
  const run = fakeRun();
  const events: ToolSideEvent[] = [];
  const stop = new AbortController();
  const context = {
    apiBaseUrl: 'http://localhost:3000', materials: [], operations: new Map(),
    updateTimeline: vi.fn(), recordOperation: vi.fn(),
    turnState: {}, callBudget: { used: 0 }, abortSignal: stop.signal,
    emit: (event: ToolSideEvent) => events.push(event),
    researchRun: options.withRun === false ? undefined : run,
    crewRuntime: { settings: { ...DEFAULT_CREW_SETTINGS, ...options.settings },
      mainModel: MAIN_MODEL, globalConcurrency: options.globalConcurrency ?? 3 },
  } as unknown as ToolContext;
  if (options.withMain === false) (context as { crewRuntime?: unknown }).crewRuntime = undefined;
  return { context, events, run, stop };
}

export type ModelStep =
  | { calls?: Array<{ name: string; args: Record<string, unknown> }>; text?: string }
  | { error: string }
  | 'hang';

const usage = { input: 0, output: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0,
  cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } };

function stepMessage(step: ModelStep, model: { api: string; provider: string; id: string }, tick: number) {
  const base = { role: 'assistant' as const, api: model.api, provider: model.provider, model: model.id,
    timestamp: Date.now(), usage };
  if (step !== 'hang' && 'error' in step) {
    return { ...base, content: [], stopReason: 'error' as const, errorMessage: step.error };
  }
  const detail = step === 'hang' ? {} : step;
  const calls = 'calls' in detail ? detail.calls ?? [] : [];
  const content: AssistantMessage['content'] = [
    ...('text' in detail && detail.text ? [{ type: 'text' as const, text: detail.text }] : []),
    ...calls.map((call, index) => ({ type: 'toolCall' as const, id: `tc-${tick}-${index}`,
      name: call.name, arguments: call.args })),
  ];
  return { ...base, content: content.length ? content : [{ type: 'text' as const, text: 'done' }],
    stopReason: calls.length ? 'toolUse' as const : 'stop' as const };
}

export interface ScriptedModel {
  streamModel: StreamFn;
  /** Provider calls per task id (key `*` when the script is shared). */
  calls: Record<string, number>;
  total: () => number;
}

/** A scripted provider: steps are consumed per task id, or from one shared list. */
export function scriptedModel(script: Record<string, ModelStep[]> | ModelStep[]): ScriptedModel {
  const calls: Record<string, number> = {};
  const streamModel: StreamFn = (model, context) => {
    const first = JSON.stringify(context.messages[0] ?? '');
    const taskId = Array.isArray(script) ? '*' : /Task ([a-z0-9-]+)/.exec(first)?.[1] ?? '?';
    const steps = Array.isArray(script) ? script : script[taskId] ?? [];
    const tick = calls[taskId] = (calls[taskId] ?? 0) + 1;
    const stream = createAssistantMessageEventStream();
    const step = steps[Math.min(tick, steps.length) - 1] ?? { text: 'done' };
    // Past the end of the script the model just keeps repeating its last step.
    if (step === 'hang') return stream;
    const message = stepMessage(step, model, tick);
    if (message.stopReason === 'error') {
      stream.push({ type: 'error', reason: 'error', error: message });
    } else {
      stream.push({ type: 'done', reason: message.stopReason, message });
    }
    stream.end(message);
    return stream;
  };
  return { streamModel, calls, total: () => Object.values(calls).reduce((sum, count) => sum + count, 0) };
}

export const searchCall = (query = 'night city') => ({ name: 'web_search', args: { query } });
export const submitCall = (report: Record<string, unknown>) => ({ name: 'submit_report', args: report });

/** The report most members send: one candidate the search result showed. */
export const goodReport = (extra: Record<string, unknown> = {}) => ({
  summary: 'Found a night city clip.',
  candidates: [{ candidate_id: SEEN_ID, url: SEEN_URL, kind: 'video', title: 'Night city',
    why: 'vertical, 15s' }],
  sources: [{ url: SEEN_URL, title: 'Stock site' }], gaps: [], ...extra,
});

export const searchPayload = (extra: Record<string, unknown> = {}) => ({ success: true, data: {
  results: [{ title: 'Night city', url: SEEN_URL, candidate_id: SEEN_ID }], ...extra } });

/** Routes global fetch by path; unknown paths fail loudly. */
export function stubFetch(handler: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    return handler(path, init);
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

export const jsonResponse = (body: unknown, status = 200) => Response.json(body, { status });

/** A fetch body that never answers until the request is aborted. */
export function hangUntilAborted(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort',
      () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  });
}
