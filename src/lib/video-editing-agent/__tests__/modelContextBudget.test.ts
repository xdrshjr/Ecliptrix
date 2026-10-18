import { expect, it } from 'vitest';
import type { Context, Message } from '@mariozechner/pi-ai';
import { createAssistantMessageEventStream } from '@mariozechner/pi-ai';
import { assistantErrorMessage, budgetModelContext, budgetThinkingMessages, bytesToTokens, compactResearchReference, localErrorStream, retryOnContextOverflow, tokensToBytes, utf8Slice } from '../modelContextBudget';

const MODEL = { id: 'test', api: 'openai-completions' as const, provider: 'test' };

it('重复压缩仍保留经过校验的质量、覆盖与来源引用', () => {
  const input = { artifact_id: 'report', quality: 'mixed', degraded: null,
    coverage: { selected: 2, page_text: 1, search_snippet: 1, unavailable: 0 },
    sources: [{ id: 'a', evidence_kind: 'page_text', text: 'secret body' },
      { id: 'b', evidence_kind: 'search_snippet' }],
    model_usage: { synthesis: { status: 'failed' } }, brief: '资料'.repeat(4000) };
  const first = compactResearchReference(input);
  const second = compactResearchReference(first);
  expect(second).toEqual(first);
  expect(first).toMatchObject({ quality: 'mixed', degraded: null,
    coverage: input.coverage, model_status: 'failed', source_refs: [
      { id: 'a', evidence_kind: 'page_text' }, { id: 'b', evidence_kind: 'search_snippet' }] });
  expect(JSON.stringify(first)).not.toContain('secret body');
  expect(first).toHaveProperty('evidence_note');
});

it.each([
  { selected: 2, page_text: 1, search_snippet: 0, unavailable: 0 },
  { selected: 6, page_text: 6, search_snippet: 0, unavailable: 0 },
  { selected: 1, page_text: 0.5, search_snippet: 0.5, unavailable: 0 },
])('压缩拒绝非法覆盖计数 %o', coverage => {
  const result = compactResearchReference({ coverage, quality: 'future', degraded: 'future',
    model_status: 'future', source_refs: [{ id: '中'.repeat(50), evidence_kind: 'page_text' }] });
  expect(result).not.toHaveProperty('coverage');
  expect(result).not.toHaveProperty('quality');
  expect(result).not.toHaveProperty('degraded');
  expect(result.model_status).toBe('unknown');
  expect(result.source_refs).toEqual([]);
});

it('未知枚举不得通过字符串强制转换升级为已知值', () => {
  const result = compactResearchReference({ quality: ['mixed'], degraded: ['excerpts_only'],
    model_status: ['succeeded'] });
  expect(result).not.toHaveProperty('quality');
  expect(result).not.toHaveProperty('degraded');
  expect(result.model_status).toBe('unknown');
});

it('已有来源引用优于旧ID且不会携带全文', () => {
  const result = compactResearchReference({ source_refs: [
    { id: 'one', evidence_kind: 'page_text', text: 'body' },
    { id: 'one', evidence_kind: 'search_snippet' },
  ], source_ids: ['old'], model_status: 'disabled' });
  expect(result.source_refs).toEqual([{ id: 'one', evidence_kind: 'page_text' }]);
  expect(result).not.toHaveProperty('source_ids');
  expect(result.model_status).toBe('disabled');
});

it('preserves Unicode code points within byte limits', () => {
  expect(utf8Slice('中文🙂abc', 8)).toBe('中文');
});
it('rejects oversized mandatory input without mutating persistence', () => {
  const context: Context = { systemPrompt: 'safe', messages: [
    { role: 'user', content: '中'.repeat(20000), timestamp: 1 },
  ] };
  expect(() => budgetModelContext(context, 16384)).toThrow('context_budget_exceeded');
  expect(context.messages[0].content).toHaveLength(20000);
});
it('removes old complete tool batches, never orphaning results', () => {
  const messages: Message[] = [{ role: 'user', content: 'research', timestamp: 1 }];
  for (let i = 0; i < 40; i++) {
    messages.push({ role: 'assistant', content: [{ type: 'toolCall', id: String(i),
      name: 'web_fetch', arguments: {} }], api: 'openai-completions', provider: 'test',
      model: 'test', stopReason: 'toolUse', timestamp: i,
      usage: { input: 0, output: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0,
        cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } } });
    messages.push({ role: 'toolResult', toolCallId: String(i), toolName: 'web_fetch',
      content: [{ type: 'text', text: JSON.stringify({ artifact_id: String(i),
        text: '资料'.repeat(2000) }) }], isError: false, timestamp: i });
  }
  const result = budgetModelContext({ systemPrompt: 'safe', messages }, 16384);
  const calls = new Set(result.context.messages.flatMap(m => m.role === 'assistant'
    ? m.content.flatMap(c => c.type === 'toolCall' ? [c.id] : []) : []));
  for (const message of result.context.messages) {
    if (message.role === 'toolResult') expect(calls.has(message.toolCallId)).toBe(true);
  }
  expect(result.estimatedTokens + result.maxTokens + 2048).toBeLessThanOrEqual(16384);
});
it('schema allowance uses the same unit as the message budget (D-07)', () => {
  expect(bytesToTokens(2048)).toBe(1024);
  expect(tokensToBytes(1024)).toBe(2048);
  expect(bytesToTokens(tokensToBytes(1000))).toBe(1000);
  // Window floor: the request still fits, so the schema allowance is positive.
  const floor = budgetModelContext({ systemPrompt: 'rules', messages: [
    { role: 'user', content: 'hi', timestamp: 1 }] }, 16384);
  expect(floor.estimatedTokens + floor.maxTokens + 2048)
    .toBeLessThanOrEqual(16384);
  expect(tokensToBytes(16384 - floor.maxTokens - 2048 - floor.estimatedTokens))
    .toBeGreaterThan(0);
});

it('closes both the SDK iterator and result promise on local refusal', async () => {
  const stream = localErrorStream('context_budget_exceeded', {
    id: 'test', api: 'openai-completions', provider: 'test',
  });
  const events = [];
  for await (const event of stream) events.push(event.type);
  expect(events).toEqual(['error']);
  expect((await stream.result()).stopReason).toBe('error');
});

it('closes the retried stream when the smaller budget refuses the retry', async () => {
  // A provider overflow whose conservative retry cannot fit either: the local
  // refusal must become a terminal error event, never an open stream (R-01).
  const overflow = createAssistantMessageEventStream();
  overflow.push({ type: 'error', reason: 'error',
    error: assistantErrorMessage(MODEL, 'context length exceeded') });
  overflow.end(assistantErrorMessage(MODEL, 'context length exceeded'));
  const stream = retryOnContextOverflow(overflow,
    () => localErrorStream('context_budget_exceeded', MODEL),
    text => text.includes('context length'), MODEL);
  const events = [];
  for await (const event of stream) events.push(event.type);
  expect(events).toEqual(['error']);
  expect((await stream.result()).errorMessage).toBe('context_budget_exceeded');
});

it('closes the stream even when the retry factory throws', async () => {
  const overflow = createAssistantMessageEventStream();
  overflow.push({ type: 'error', reason: 'error',
    error: assistantErrorMessage(MODEL, 'context length exceeded') });
  overflow.end(assistantErrorMessage(MODEL, 'context length exceeded'));
  const stream = retryOnContextOverflow(overflow, () => {
    throw new Error('context_budget_exceeded');
  }, () => true, MODEL);
  const events = [];
  for await (const event of stream) events.push(event.type);
  expect(events).toEqual(['error']);
  expect((await stream.result()).errorMessage).toBe('context_budget_exceeded');
});

it('keeps snapshot references when compressing a large browser result', () => {
  const messages: Message[] = [{ role: 'user', content: 'inspect', timestamp: 1 }, {
    role: 'toolResult', toolCallId: 'read', toolName: 'browser_read',
    content: [{ type: 'text', text: JSON.stringify({ snapshot_artifact_id: 'snapshot-id',
      session_id: 'session-id', snapshot_version: 3, text: '资料'.repeat(10000) }) }],
    isError: false, timestamp: 2,
  }];
  const result = budgetModelContext({ systemPrompt: 'safe', messages }, 16384);
  expect(JSON.stringify(result.context.messages)).toContain('snapshot-id');
  expect(JSON.stringify(result.context.messages)).toContain('session-id');
});

it('budgets the planning request while preserving the system and newest user input', () => {
  const input = [{ role: 'system', content: 'rules' },
    { role: 'assistant', content: '旧'.repeat(20000) }, { role: 'user', content: 'current' }];
  expect(budgetThinkingMessages(input, 16384).messages).toEqual([input[0], input[2]]);
  expect(input).toHaveLength(3);
  expect(() => budgetThinkingMessages([{ role: 'user', content: '中'.repeat(20000) }], 16384))
    .toThrow('context_budget_exceeded');
});

it('excludes SDK display details and inline images from the provider view only', () => {
  const result: Message = { role: 'toolResult', toolCallId: 'read', toolName: 'web_fetch',
    content: [{ type: 'text', text: '{"artifact_id":"saved-id","text":"excerpt"}' },
      { type: 'image', data: 'A'.repeat(80000), mimeType: 'image/png' }],
    details: { text: '全文'.repeat(30000) }, isError: false, timestamp: 2 };
  const budget = budgetModelContext({ systemPrompt: 'safe', messages: [
    { role: 'user', content: 'inspect', timestamp: 1 }, result,
  ] }, 16384);
  expect(JSON.stringify(budget.context.messages)).toContain('saved-id');
  expect(JSON.stringify(budget.context.messages)).not.toContain('全文');
  expect(result.details.text).toHaveLength(60000);
  expect(result.content).toHaveLength(2);
});
