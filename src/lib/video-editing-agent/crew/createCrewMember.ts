import { Agent } from '@mariozechner/pi-agent-core';
import type { AgentEvent, AgentTool, StreamFn } from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';
import { streamSimple } from '@mariozechner/pi-ai';
import { resolveModelFormat } from '../modelFormat';
import { budgetModelContext, localErrorStream } from '../modelContextBudget';
import type { CrewMainModel, ToolContext } from '../types';
import { buildCrewTaskMessage, CREW_SYSTEM_PROMPT } from './crewPrompt';
import {
  createMemberTools, deriveMemberContext, describeActivity, SUBMIT_REPORT_TOOL,
} from './crewTools';
import type { CrewTaskInput, MemberOutcome, MemberSnapshot, MemberUsage } from './crewTypes';
import {
  createSeenSet, parseDraftReport, recordSeen, verifyReport, type SeenSet,
} from './verifyReport';

export const MAX_MODEL_CALLS = 8;
export const MAX_TOOL_CALLS = 10;
const MEMBER_MAX_TOKENS = 2048;
/** Conservative window for the fast tier, whose real size resolve/fast does not report. */
const DEFAULT_WINDOW_TOKENS = 32768;
const DEFAULT_MAX_CANDIDATES = 4;

export interface CrewMemberInput {
  crewId: string;
  index: number;
  task: CrewTaskInput;
  model: CrewMainModel;
  /** The parent turn's tool context; the member derives its own from it. */
  parent: ToolContext;
  timeoutMs: number;
  onProgress?: (snapshot: MemberSnapshot) => void;
}

/** Test seams; production passes none. */
export interface CrewMemberDeps {
  /** Replaces the provider call, after the member's own budget checks. */
  streamModel?: StreamFn;
  now?: () => number;
}

export interface CrewMember {
  run(): Promise<MemberOutcome>;
}

function buildMemberModel(config: CrewMainModel) {
  const { api, provider } = resolveModelFormat(config.providerType, config.apiType);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model: Model<any> = {
    id: config.model, name: config.model, api, provider, baseUrl: config.apiUrl,
    reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.contextWindowTokens ?? DEFAULT_WINDOW_TOKENS,
    maxTokens: MEMBER_MAX_TOKENS,
  };
  return model;
}

/** `AbortSignal.any` where it exists (Node 20.3+); a manual relay elsewhere. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  if ('any' in AbortSignal) return AbortSignal.any(signals);
  const relay = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) { relay.abort(); break; }
    signal.addEventListener('abort', () => relay.abort(), { once: true });
  }
  return relay.signal;
}

const streamProvider: StreamFn = (model, context, options) => {
  try {
    const budget = budgetModelContext(context, model.contextWindow);
    return streamSimple(model, budget.context,
      { ...options, maxTokens: Math.min(MEMBER_MAX_TOKENS, budget.maxTokens) });
  } catch (error) {
    return localErrorStream(error instanceof Error ? error.message : 'context_budget_exceeded', model);
  }
};

/** Maps a provider failure to a stable code; the raw text may echo credentials. */
function classifyFailure(message: string): string {
  if (!message) return 'no_report';
  if (/\b401\b|unauthorized|invalid[_ ]api[_ ]key/i.test(message)) return 'provider_auth';
  if (/\b429\b|rate.?limit/i.test(message)) return 'provider_rate_limit';
  return 'member_error';
}

const refusal = (code: string) => ({
  content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error_code: code }) }],
  details: { success: false, error_code: code },
});

/**
 * One read-only research member: a pi-agent-core `Agent` with the allowlisted
 * tools, hard model/tool/time budgets, and a closure that captures its report.
 */
class CrewMemberRun implements CrewMember {
  private readonly agent: Agent;
  private readonly signal: AbortSignal;
  private readonly seen: SeenSet = createSeenSet();
  private readonly timeout = new AbortController();
  private readonly now: () => number;
  private readonly started: number;
  private readonly idPrefix: string;
  private timedOut = false;
  private report: unknown;
  private hasReport = false;
  private budgetHit: string | null = null;
  private modelCalls = 0;
  private toolCalls = 0;
  private callSeq = 0;
  private lastText = '';
  private failure = '';
  private activity: string | undefined;

  constructor(private readonly input: CrewMemberInput, private readonly deps: CrewMemberDeps) {
    this.now = deps.now ?? Date.now;
    this.started = this.now();
    this.idPrefix = `crew-${input.crewId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8)}-${input.index}`;
    // Why not AbortSignal.timeout: this timer must honour fake timers in tests
    // and must let us tell a timeout from a user stop.
    this.signal = this.combine(input.parent.abortSignal, this.timeout.signal);
    const context = deriveMemberContext(input.parent, this.signal);
    const tools = createMemberTools(context, report => this.acceptReport(report))
      .map(tool => this.guard(tool));
    this.agent = new Agent({
      streamFn: (...args) => this.stream(...args),
      initialState: { systemPrompt: CREW_SYSTEM_PROMPT, model: buildMemberModel(input.model),
        thinkingLevel: 'off', tools, messages: [] },
      getApiKey: () => input.model.apiKey,
    });
    this.agent.subscribe(event => this.observe(event));
    this.signal.addEventListener('abort', () => this.agent.abort(), { once: true });
  }

  private combine(parent: AbortSignal | undefined, own: AbortSignal): AbortSignal {
    return parent ? anySignal([parent, own]) : own;
  }

  private get halted(): boolean {
    return this.hasReport || this.budgetHit !== null || this.signal.aborted;
  }

  private acceptReport(report: unknown): void {
    if (this.hasReport) return;
    this.hasReport = true;
    this.report = report;
  }

  private nextCallId(): string {
    this.callSeq += 1;
    return `${this.idPrefix}-${this.callSeq}`;
  }

  private publish(): void {
    try {
      this.input.onProgress?.({ activity: this.activity, toolCalls: this.toolCalls,
        modelCalls: this.modelCalls, elapsedMs: this.now() - this.started });
    } catch { /* a broken observer must not fail the member */ }
  }

  private stream(...args: Parameters<StreamFn>): ReturnType<StreamFn> {
    const [model] = args;
    if (this.halted) return localErrorStream('crew_member_stopped', model);
    if (this.modelCalls >= MAX_MODEL_CALLS) {
      this.budgetHit = 'crew_model_budget';
      return localErrorStream('crew_model_budget', model);
    }
    this.modelCalls += 1;
    this.publish();
    // pi-agent-core never catches a throw from here (the turn would hang until
    // the member timeout), so a failing provider call becomes an error stream.
    try {
      return (this.deps.streamModel ?? streamProvider)(...args);
    } catch (error) {
      return localErrorStream(error instanceof Error ? error.message : 'member_error', model);
    }
  }

  /**
   * Wraps a tool with the member's budgets. The call id is generated here, not
   * taken from the model: vendors differ in id shape and the backend rejects
   * odd ones (crew spec R-09).
   */
  private guard(tool: AgentTool): AgentTool {
    const isReport = tool.name === SUBMIT_REPORT_TOOL;
    return { ...tool, execute: async (_modelId, params, signal, update) => {
      if (this.halted) return refusal('crew_member_stopped');
      if (!isReport && this.toolCalls >= MAX_TOOL_CALLS) {
        this.budgetHit = 'crew_tool_budget';
        this.agent.abort();
        return refusal('crew_tool_budget');
      }
      if (!isReport) this.toolCalls += 1;
      this.activity = describeActivity(tool.name, params);
      this.publish();
      const result = await tool.execute(this.nextCallId(), params, signal, update);
      if (!isReport) recordSeen(result.details, this.seen);
      this.publish();
      return result;
    } };
  }

  private observe(event: AgentEvent): void {
    if (event.type === 'tool_execution_end' && event.toolName === SUBMIT_REPORT_TOOL && !event.isError) {
      this.agent.abort();
    }
    if (event.type !== 'message_end' || event.message.role !== 'assistant') return;
    const { content, stopReason, errorMessage } = event.message;
    const text = content.flatMap(block => block.type === 'text' ? [block.text] : []).join('');
    if (text) this.lastText = text;
    if (stopReason === 'error') this.failure = errorMessage ?? 'error';
  }

  private usage(): MemberUsage {
    return { model_calls: this.modelCalls, tool_calls: this.toolCalls,
      elapsed_ms: this.now() - this.started };
  }

  /** Resolves once the member is stopped (timeout or parent abort). */
  private whenStopped(): { stopped: Promise<void>; dispose: () => void } {
    let dispose: () => void = () => undefined;
    const stopped = new Promise<void>(resolve => {
      if (this.signal.aborted) { resolve(); return; }
      const onAbort = () => resolve();
      this.signal.addEventListener('abort', onAbort, { once: true });
      dispose = () => this.signal.removeEventListener('abort', onAbort);
    });
    return { stopped, dispose };
  }

  async run(): Promise<MemberOutcome> {
    this.publish();
    const timer = setTimeout(() => { this.timedOut = true; this.timeout.abort(); }, this.input.timeoutMs);
    const { stopped, dispose } = this.whenStopped();
    // pi-agent-core resolves prompt() after abort() today; if a future version
    // rejects instead, the stored report still decides the outcome (spec R-9).
    // The race also means a model that ignores its signal cannot hold the
    // member past a stop.
    const prompt = this.agent.prompt(buildCrewTaskMessage(this.input.task))
      .catch((error: unknown) => { this.failure ||= error instanceof Error ? error.message : String(error); });
    try {
      await Promise.race([prompt, stopped]);
    } finally {
      clearTimeout(timer);
      dispose();
      this.agent.abort();
    }
    return this.settle();
  }

  private settle(): MemberOutcome {
    const usage = this.usage();
    const limit = this.input.task.max_candidates ?? DEFAULT_MAX_CANDIDATES;
    if (this.hasReport) {
      return { status: 'done', report: verifyReport(this.report, this.seen, limit), usage };
    }
    const draft = parseDraftReport(this.lastText);
    const salvaged = draft ? verifyReport(draft, this.seen, limit) : undefined;
    const report = salvaged && (salvaged.summary || salvaged.candidates.length) ? salvaged : undefined;
    if (this.timedOut) return { status: 'timeout', report, error_code: 'member_timeout', usage };
    if (this.input.parent.abortSignal?.aborted) return { status: 'cancelled', report, usage };
    if (this.budgetHit) {
      return { status: report ? 'partial' : 'failed', report, error_code: this.budgetHit, usage };
    }
    return { status: report ? 'partial' : 'failed', report, usage,
      error_code: classifyFailure(this.failure) };
  }
}

export function createCrewMember(input: CrewMemberInput, deps: CrewMemberDeps = {}): CrewMember {
  return new CrewMemberRun(input, deps);
}
