import { describe, expect, it, vi } from 'vitest';
import { Type } from '@mariozechner/pi-ai';
import { ToolRegistry } from '../registry/ToolRegistry';
import { ToolActivationState } from '../registry/ToolActivationState';
import { CATEGORY_IDS, ON_DEMAND_CATEGORY_IDS, createDefaultCategories } from '../registry/categories';
import { createVideoEditingAgent } from '../agent';
import { createDefaultAgentTimelineState } from '../defaultTimeline';
import { streamSimple, createAssistantMessageEventStream } from '@mariozechner/pi-ai';
import type { AssistantMessage, Context } from '@mariozechner/pi-ai';
import { buildAllAgentTools } from '../tools';

vi.mock('@mariozechner/pi-ai', async importOriginal => {
  const original = await importOriginal<typeof import('@mariozechner/pi-ai')>();
  return { ...original, streamSimple: vi.fn() };
});

it('refuses the 81st execution before the tool side effect', async () => {
  const execute = vi.fn().mockResolvedValue({ content: [], details: { success: true } });
  const registry = new ToolRegistry();
  registry.registerCategory({ id: 'core', name: 'core', description: '', alwaysAvailable: true,
    tools: [{ name: 'edit', label: '', description: '', parameters: Type.Object({}), execute }] });
  const state = new ToolActivationState(registry, ['edit', 'explore_tools']);
  state.offer();
  const tool = buildAllAgentTools(registry, state)[0];
  for (let i = 0; i < 80; i++) await tool.execute(String(i), {});
  const refused = await tool.execute('81', {});
  expect(execute).toHaveBeenCalledTimes(80);
  expect(JSON.stringify(refused)).toContain('tool_call_limit');
});

function setup() {
  const registry = new ToolRegistry();
  registry.registerCategory({ id: 'web', name: 'Web', description: '',
    alwaysAvailable: false, tools: Array.from({ length: 16 }, (_, i) => ({
      name: `web_${i}`, label: '', description: 'Read public data',
      parameters: Type.Object({}), execute: async () => ({ content: [], details: {} }),
    })) });
  return new ToolActivationState(registry, []);
}

describe('request-scoped tool disclosure', () => {
  it('only offers loaded tools on the next model request', () => {
    const state = setup();
    expect(state.offer().map(t => t.name)).toEqual([]);
    state.load('web', ['web_0']);
    expect(state.canExecute('web_0')).toBe(false);
    expect(state.offer().map(t => t.name)).toEqual(['web_0']);
    expect(state.canExecute('web_0')).toBe(true);
  });
  it('evicts least recently used tools and rejects invalid loads atomically', () => {
    const state = setup();
    for (let i = 0; i < 16; i += 4) {
      state.load('web', Array.from({ length: 4 }, (_, j) => `web_${i + j}`));
    }
    expect(state.offer()).toHaveLength(12);
    expect(state.canExecute('web_0')).toBe(false);
    expect(() => state.load('web', ['web_0', 'unknown'])).toThrow();
    expect(state.offer()).toHaveLength(12);
  });
});

it('loads tools at the window floor and keeps core schemas under 48 KiB', async () => {
  const payloads: Context[] = [];
  vi.mocked(streamSimple).mockImplementation((model, context, options) => {
    payloads.push(context);
    const message: AssistantMessage = { role: 'assistant', api: model.api,
      provider: model.provider, model: model.id, timestamp: Date.now(),
      stopReason: payloads.length === 1 ? 'toolUse' : 'stop',
      content: payloads.length === 1 ? [{ type: 'toolCall', id: 'explore',
        name: 'explore_tools',
        arguments: { category: 'web_tools',
          tool_names: ['web_search', 'web_fetch', 'web_research'] } }] :
        [{ type: 'text', text: 'done' }],
      usage: { input: 0, output: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0,
        cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } } };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
    stream.end(message);
    expect(options?.maxTokens).toBeLessThanOrEqual(4096);
    return stream;
  });
  const { agent } = createVideoEditingAgent({ llmApiUrl: 'https://example.com',
    llmApiKey: 'fake', llmModel: 'fake', apiBaseUrl: 'http://localhost:3000',
    materials: [], timelineState: createDefaultAgentTimelineState(),
    conversationHistory: [], contextWindowTokens: 16384 });
  await agent.prompt('research');
  const core = payloads[0].tools ?? [];
  expect(core.length).toBeGreaterThan(0);
  expect(Buffer.byteLength(JSON.stringify(core), 'utf8')).toBeLessThan(48 * 1024);
  // The explore call loaded tools instead of failing with tool_schema_budget.
  const loaded = payloads[1].tools ?? [];
  expect(loaded.some(tool => tool.name === 'web_search')).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(loaded), 'utf8')).toBeLessThan(48 * 1024);
  const asked = agent.state.messages.filter(message =>
    message.role === 'toolResult' && message.toolCallId === 'explore');
  expect(JSON.stringify(asked)).not.toContain('tool_schema_budget');
  expect(JSON.stringify(asked)).toContain('web_search');
}, 30000);

it('filters actual provider schemas and refuses a guessed tool in the explore response', async () => {
  const payloads: Context[] = [];
  vi.mocked(streamSimple).mockImplementation((model, context, options) => {
    payloads.push(context);
    expect(options?.maxTokens).toBe(4096);
    const message: AssistantMessage = { role: 'assistant', api: model.api,
      provider: model.provider, model: model.id, timestamp: Date.now(),
      stopReason: payloads.length === 1 ? 'toolUse' : 'stop',
      content: payloads.length === 1 ? [
        { type: 'toolCall', id: 'explore', name: 'explore_tools',
          arguments: { category: 'web_tools', tool_names: ['web_search'] } },
        { type: 'toolCall', id: 'guess', name: 'web_search', arguments: { query: 'topic' } },
      ] : [{ type: 'text', text: 'done' }],
      usage: { input: 0, output: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0,
        cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } } };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
    stream.end(message);
    return stream;
  });
  const { agent } = createVideoEditingAgent({ llmApiUrl: 'https://example.com',
    llmApiKey: 'fake', llmModel: 'fake', apiBaseUrl: 'http://localhost:3000',
    materials: [], timelineState: createDefaultAgentTimelineState(), conversationHistory: [] });
  await agent.prompt('research');
  expect(payloads).toHaveLength(2);
  expect(payloads[0].tools?.some(tool => tool.name === 'web_search')).toBe(false);
  expect(payloads[1].tools?.some(tool => tool.name === 'web_search')).toBe(true);
  expect(payloads[1].tools?.some(tool => tool.name === 'browser_open')).toBe(false);
  const rejected = agent.state.messages.find(message => message.role === 'toolResult' && message.toolCallId === 'guess');
  expect(JSON.stringify(rejected)).toContain('tool_not_loaded');
});

describe('category catalog (AC-01)', () => {
  it('declares 19 categories / 16 on-demand / 3 always-available', () => {
    const categories = createDefaultCategories();
    const ids = categories.map(category => category.id);
    expect(categories).toHaveLength(19);
    expect(ON_DEMAND_CATEGORY_IDS).toHaveLength(16);
    expect(categories.filter(category => category.alwaysAvailable)).toHaveLength(3);
    expect(ids.sort()).toEqual([...ON_DEMAND_CATEGORY_IDS,
      CATEGORY_IDS.WORKFLOW_TOOLS, CATEGORY_IDS.QUERY_TOOLS,
      CATEGORY_IDS.EDITING_TOOLS].sort());
  });

  it('keeps review_tools on-demand, one line and at most 4 tools', () => {
    const review = createDefaultCategories()
      .find(category => category.id === CATEGORY_IDS.REVIEW_TOOLS);
    expect(review).toBeTruthy();
    expect(review!.alwaysAvailable).toBe(false);
    expect(new TextEncoder().encode(review!.description).length)
      .toBeLessThanOrEqual(160);
    expect(ON_DEMAND_CATEGORY_IDS).toContain(CATEGORY_IDS.REVIEW_TOOLS);
    expect(review!.tools.length).toBeLessThanOrEqual(4);
  });
});
