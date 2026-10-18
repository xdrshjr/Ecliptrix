import { describe, expect, it } from 'vitest';
import type { ChatMessage, AgentToolCallRecord } from '@/types';
import {
  normalizePlanSteps, planIdFor, summarizePlan,
} from '../tools/planTool';
import { scanLatestPlan } from '../planScan';
import { compactHistoryForModel } from '../historyBudget';
import type { Message, ToolResultMessage } from '@mariozechner/pi-ai';

/** 计划工具：状态规范化、单 in_progress、跨轮恢复、LATEST_ONLY_TOOLS。 */

describe('normalizePlanSteps', () => {
  it('keeps only the first in_progress and flags the change', () => {
    const { steps, normalized } = normalizePlanSteps([
      { title: 'a', status: 'in_progress' },
      { title: 'b', status: 'in_progress' },
    ]);
    expect(normalized).toBe(true);
    expect(steps.map(step => step.status)).toEqual(['in_progress', 'pending']);
  });

  it('drops empty titles and enforces the step ceiling', () => {
    const { steps, normalized } = normalizePlanSteps([
      { title: '  ' }, { title: 'a' }, { title: 'b' },
    ], 1);
    expect(normalized).toBe(true);
    expect(steps.map(step => step.title)).toEqual(['a']);
  });

  it('defaults an unknown status to pending', () => {
    const { steps, normalized } = normalizePlanSteps([
      { title: 'a', status: 'wat' as unknown as 'pending' },
    ]);
    expect(normalized).toBe(true);
    expect(steps[0].status).toBe('pending');
  });
});

describe('planIdFor', () => {
  it('is deterministic for the same titles and statuses', () => {
    const steps = normalizePlanSteps([
      { title: 'a' }, { title: 'b', status: 'completed' },
    ]).steps;
    expect(planIdFor(steps)).toBe(planIdFor(steps));
    expect(planIdFor(steps)).toMatch(/^plan-[0-9a-f]{8}$/);
  });

  it('changes when a status changes', () => {
    const first = planIdFor(normalizePlanSteps([{ title: 'a' }]).steps);
    const second = planIdFor(
      normalizePlanSteps([{ title: 'a', status: 'completed' }]).steps);
    expect(first).not.toBe(second);
  });
});

describe('summarizePlan', () => {
  it('counts completed steps and exposes the active index', () => {
    const { steps } = normalizePlanSteps([
      { title: 'a', status: 'completed' },
      { title: 'b', status: 'in_progress' },
    ]);
    const plan = summarizePlan('plan-x', steps, 'note');
    expect(plan.doneCount).toBe(1);
    expect(plan.total).toBe(2);
    expect(plan.activeStep).toBe(1);
    expect(plan.note).toBe('note');
  });
});

function call(
  name: string, status: AgentToolCallRecord['status'], result?: unknown,
  params: Record<string, unknown> = { step: 1 },
): AgentToolCallRecord {
  return { id: `${name}-${status}-${Math.random()}`, name, params, status, result };
}

function assistant(calls: AgentToolCallRecord[]): ChatMessage {
  return {
    id: `m-${Math.random()}`, role: 'assistant', content: '',
    timestamp: new Date(), isAgentMessage: true, agentToolCalls: calls,
  };
}

describe('scanLatestPlan', () => {
  it('returns the latest EFFECTIVE plan', () => {
    const messages: ChatMessage[] = [
      assistant([call('update_plan', 'completed', {
        success: true, plan_id: 'plan-aaaaaaaa',
        steps: [{ index: 0, title: 'a', status: 'in_progress' }],
      })]),
      assistant([call('update_plan', 'completed', {
        success: true, plan_id: 'plan-bbbbbbbb',
        steps: [{ index: 0, title: 'a', status: 'completed' }],
      })]),
    ];
    const plan = scanLatestPlan(messages);
    expect(plan?.planId).toBe('plan-bbbbbbbb');
    expect(plan?.doneCount).toBe(1);
  });

  it('skips cancelled and errored plans and keeps looking backwards', () => {
    const messages: ChatMessage[] = [
      assistant([call('update_plan', 'completed', {
        success: true, plan_id: 'plan-aaaaaaaa',
        steps: [{ index: 0, title: 'a', status: 'pending' }],
      })]),
      assistant([call('update_plan', 'cancelled')]),
      assistant([call('update_plan', 'error', { success: false })]),
    ];
    expect(scanLatestPlan(messages)?.planId).toBe('plan-aaaaaaaa');
  });

  it('never guesses from params alone', () => {
    const messages = [assistant([
      call('update_plan', 'cancelled', undefined,
        { steps: [{ title: 'a', status: 'completed' }] }),
    ])];
    expect(scanLatestPlan(messages)).toBeNull();
  });
});

describe('LATEST_ONLY_TOOLS history compaction', () => {
  function toolResult(name: string, text: string): ToolResultMessage {
    return {
      role: 'toolResult', toolCallId: `c-${Math.random()}`,
      toolName: name, content: [{ type: 'text', text }],
      isError: false, timestamp: Date.now(),
    } as ToolResultMessage;
  }

  it('replaces every older update_plan result with a stub', () => {
    const messages: Message[] = [
      { role: 'user', content: 'go', timestamp: 1 },
      toolResult('update_plan', '{"success":true,"plan_id":"plan-1"}'),
      { role: 'user', content: 'again', timestamp: 2 },
      toolResult('update_plan', '{"success":true,"plan_id":"plan-2"}'),
      { role: 'user', content: 'again', timestamp: 3 },
      toolResult('update_plan', '{"success":true,"plan_id":"plan-3"}'),
    ];
    const compacted = compactHistoryForModel(messages, 120_000);
    const plans = compacted.filter(
      message => message.role === 'toolResult'
        && message.toolName === 'update_plan');
    expect(plans).toHaveLength(3);
    // 只有最后一次（最近 2 轮里）保留原文，更早的被替换。
    const texts = plans.map(message =>
      (message.content[0] as { text: string }).text);
    expect(texts[0]).toContain('superseded plan');
    expect(texts[1]).toContain('superseded plan');
    expect(texts[2]).toContain('plan-3');
  });
});
