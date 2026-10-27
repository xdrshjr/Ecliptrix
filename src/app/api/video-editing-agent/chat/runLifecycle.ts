import type { Agent, AgentEvent } from '@mariozechner/pi-agent-core';
import {
  SteerError,
  MAX_PENDING_STEERS,
  validateSteerInput,
  type AgentRunHandle,
  type SteerAcceptance,
  type SteerInput,
} from '@/lib/server/agentRunRegistry';
import { STEER_WRAPPER } from '@/lib/video-editing-agent/promptParts';
import type { SSEEvent } from '@/lib/video-editing-agent/types';

/**
 * 一次 Agent 回合的「运行句柄」：把用户的插话交给 pi-agent-core 的
 * `agent.steer()`，并在它真正送达模型时发出 `steer_applied`。
 *
 * 设计基线：docs/plans/agent-steering-and-skills/spec.md §3.2.2。
 * 独立成模块是为了让 `chat/route.ts`（已近 800 行红线）只增加接线代码。
 */

export interface RunHandleDeps {
  agent: Agent;
  send: (event: SSEEvent) => void;
  /** 默认 `crypto.randomUUID()`；测试可注入固定值。 */
  newRunId?: () => string;
}

export interface RunHandle extends AgentRunHandle {
  /** 转交 agent 的每个事件；只关心 `message_start` 与 `tool_execution_end`。 */
  onAgentEvent(event: AgentEvent): void;
}

type SteerMessage = {
  role: 'user';
  content: Array<{ type: 'text'; text: string }>;
  timestamp: number;
};

/**
 * 创建运行句柄，并把 steering 模式设为 `'all'`：连发的多条插话在同一个模型
 * 回合里一次送达（默认 `one-at-a-time` 会让它们「分次生效」）。
 */
export function createRunHandle(deps: RunHandleDeps): RunHandle {
  const { agent, send } = deps;
  const runId = (deps.newRunId ?? (() => crypto.randomUUID()))();
  const pending = new Map<string, SteerMessage>();
  const knownSteerIds = new Set<string>();
  let lastToolCallId: string | null = null;
  let lastTimestamp = 0;
  let closed = false;

  agent.setSteeringMode('all');

  // 严格递增：回退匹配（引用不相等时）依赖 timestamp 不会误中别的消息。
  const nextTimestamp = (): number => {
    lastTimestamp = Math.max(Date.now(), lastTimestamp + 1);
    return lastTimestamp;
  };

  const steer = (input: SteerInput): SteerAcceptance => {
    if (closed) throw new SteerError('run_closed');
    const text = validateSteerInput(input);
    if (knownSteerIds.has(input.steerId)) throw new SteerError('duplicate_steer');
    if (pending.size >= MAX_PENDING_STEERS) throw new SteerError('steer_queue_full');
    const message: SteerMessage = {
      role: 'user',
      content: [{ type: 'text', text: STEER_WRAPPER(text) }],
      timestamp: nextTimestamp(),
    };
    knownSteerIds.add(input.steerId);
    pending.set(input.steerId, message);
    agent.steer(message as never);
    return { steerId: input.steerId, position: pending.size };
  };

  const matchDelivered = (candidate: unknown): string | null => {
    for (const [steerId, message] of Array.from(pending)) {
      if (message === candidate) return steerId;
    }
    // pi 若在传递中克隆了对象，回退为 timestamp + 首个文本块一致。
    const clone = candidate as Partial<SteerMessage> | null;
    if (!clone || clone.role !== 'user') return null;
    const firstText = clone.content?.[0]?.text;
    for (const [steerId, message] of Array.from(pending)) {
      if (message.timestamp === clone.timestamp
        && message.content[0].text === firstText) return steerId;
    }
    return null;
  };

  const onAgentEvent = (event: AgentEvent): void => {
    // The client stops reading at `agent_end`, so anything still undelivered
    // must be reported BEFORE that event reaches the SSE router (this handler
    // is subscribed ahead of it). Closing in `finally` would be too late.
    if (event.type === 'agent_end') {
      close();
      return;
    }
    if (event.type === 'tool_execution_end') {
      lastToolCallId = event.toolCallId;
      return;
    }
    if (event.type !== 'message_start') return;
    const steerId = matchDelivered((event as { message?: unknown }).message);
    if (!steerId) return;
    pending.delete(steerId);
    send({ type: 'steer_applied', steerId, afterToolCallId: lastToolCallId });
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    if (pending.size === 0) return;
    const steerIds = Array.from(pending.keys());
    pending.clear();
    send({ type: 'steer_dropped', steerIds });
  };

  return {
    runId,
    steer,
    pendingCount: () => pending.size,
    close,
    onAgentEvent,
  };
}
