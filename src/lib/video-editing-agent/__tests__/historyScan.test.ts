import { describe, it, expect } from 'vitest';
import type { ChatMessage, AgentToolCallRecord } from '@/types';
import { scanExploredCategories, extractAgentToolCalls } from '../historyScan';

function userMsg(id: string, content = 'hi'): ChatMessage {
  return { id, role: 'user', content, timestamp: new Date() };
}

function agentMsg(id: string, calls: AgentToolCallRecord[]): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: '',
    timestamp: new Date(),
    isAgentMessage: true,
    agentToolCalls: calls,
  };
}

function exploreCall(
  id: string,
  category: string,
  status: AgentToolCallRecord['status'] = 'completed'
): AgentToolCallRecord {
  return { id, name: 'explore_tools', params: { category }, status, result: 'ok' };
}

describe('extractAgentToolCalls', () => {
  it('returns [] for user messages', () => {
    expect(extractAgentToolCalls(userMsg('u1'))).toEqual([]);
  });

  it('returns [] for plain assistant messages without isAgentMessage', () => {
    const msg: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: 'plain reply',
      timestamp: new Date(),
    };
    expect(extractAgentToolCalls(msg)).toEqual([]);
  });

  it('returns the agentToolCalls array when present', () => {
    const calls = [exploreCall('t1', 'storyboard_tools')];
    expect(extractAgentToolCalls(agentMsg('a1', calls))).toEqual(calls);
  });
});

describe('scanExploredCategories', () => {
  it('returns [] for empty messages', () => {
    expect(scanExploredCategories([])).toEqual([]);
  });

  it('returns [] when no agentToolCalls are present', () => {
    expect(scanExploredCategories([userMsg('u1'), userMsg('u2')])).toEqual([]);
  });

  it('returns the category for one completed explore_tools call', () => {
    const msgs = [
      userMsg('u1'),
      agentMsg('a1', [exploreCall('t1', 'storyboard_tools')]),
    ];
    expect(scanExploredCategories(msgs)).toEqual(['storyboard_tools']);
  });

  it('dedupes and orders categories from 3 turns covering 2 unique categories', () => {
    const msgs = [
      agentMsg('a1', [exploreCall('t1', 'storyboard_tools')]),
      agentMsg('a2', [exploreCall('t2', 'tts_tools')]),
      agentMsg('a3', [exploreCall('t3', 'storyboard_tools')]), // duplicate
    ];
    expect(scanExploredCategories(msgs)).toEqual(['storyboard_tools', 'tts_tools']);
  });

  it('excludes explore_tools calls with status === error', () => {
    const msgs = [agentMsg('a1', [exploreCall('t1', 'tts_tools', 'error')])];
    expect(scanExploredCategories(msgs)).toEqual([]);
  });

  it('excludes explore_tools calls with status === undone (rolled-back turn)', () => {
    const msgs = [agentMsg('a1', [exploreCall('t1', 'tts_tools', 'undone')])];
    expect(scanExploredCategories(msgs)).toEqual([]);
  });

  it('excludes explore_tools calls with status === executing (still in flight)', () => {
    const msgs = [agentMsg('a1', [exploreCall('t1', 'tts_tools', 'executing')])];
    expect(scanExploredCategories(msgs)).toEqual([]);
  });

  it('excludes explore_tools calls with params.category not in ON_DEMAND_CATEGORY_IDS', () => {
    const msgs = [agentMsg('a1', [exploreCall('t1', 'totally_made_up')])];
    expect(scanExploredCategories(msgs)).toEqual([]);
  });

  it('only counts calls whose name === "explore_tools"', () => {
    const calls: AgentToolCallRecord[] = [
      { id: 't1', name: 'search_video', params: { category: 'storyboard_tools' }, status: 'completed' },
      exploreCall('t2', 'storyboard_tools'),
    ];
    expect(scanExploredCategories([agentMsg('a1', calls)])).toEqual(['storyboard_tools']);
  });
});
