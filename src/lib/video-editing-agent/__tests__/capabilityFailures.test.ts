// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as expand } from '@/app/api/ai-video-script-expand/route';
import { POST as generate } from '@/app/api/ai-video-script-generation/route';
import { streamLlmChat } from '@/lib/llm/streamLlmChat';
import { createExpandVideoScriptTool } from '@/lib/video-editing-agent/tools/expandVideoScript';
import { subscribeAgentEvents } from '@/lib/video-editing-agent/agent';
import { createEgressTools } from '@/lib/video-editing-agent/tools/egressTools';
import type { ToolContext } from '@/lib/video-editing-agent/types';
import { createScriptTools } from '@/lib/video-editing-agent/tools/scriptTools';
import { scriptHash } from '@/lib/video-editing-agent/editorContextPrompt';
import { AgentEventRouter } from '@/lib/video-editing-agent/AgentEventRouter';
import { AgentStateManager } from '@/lib/video-editing-agent/AgentStateManager';
import { OperationApplier } from '@/lib/video-editing-agent/OperationApplier';
import { useVideoEditingStore } from '@/stores';
import type { VideoEditingTaskContent } from '@/types';
import { createListTtsVoicesTool, createGenerateTtsTool } from '@/lib/video-editing-agent/tools/generateTts';
import { createBatchGenerateTtsTool } from '@/lib/video-editing-agent/tools/batchGenerateTts';
import { createToolRegistry } from '@/lib/video-editing-agent/tools';
import { lintTimeline } from '@/lib/video-editing-agent/tools/qualityLint';
import { YOLO_DIRECTIVE } from '@/lib/video-editing-agent/promptParts';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const resolved = { success: true, api_url: 'https://configured.invalid/api', api_key: 'fixture-key', model_name: 'fixture', api_type: 'anthropic' };
const request = (body: unknown) => new NextRequest('http://localhost/api/script', {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
});
function context(): ToolContext {
  const operations = new Map();
  return { apiBaseUrl: 'http://localhost', projectId: 'project', materials: [], turnState: {}, callBudget: { used: 0 }, operations,
    scriptSegments: [{ id: 'old', title: '原稿', narrationText: '钩子。正文。', sentences: [{ id: 's', text: '旧画面。' }] }],
    recordOperation: (id: string, op: unknown) => operations.set(id, op),
  } as unknown as ToolContext;
}
function sse(text: string, api = 'anthropic') {
  return new Response(api === 'anthropic'
    ? `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\ndata: {"type":"message_stop"}\n\n`
    : `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
  { headers: { 'content-type': 'text/event-stream' } });
}
describe('脚本配置与流错误契约', () => {
  it.each(['openai', 'anthropic'])('%s 正常正文和思考保留，正常终止不报错', async apiType => {
    const reasoning = apiType === 'openai' ? 'data: {"choices":[{"delta":{"reasoning_content":"思考"}}]}\n\n'
      : 'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"思考"}}\n\n';
    const normal = await sse('正文。', apiType).text();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(reasoning + normal, { headers: { 'content-type': 'text/event-stream' } })));
    const events = [];
    for await (const event of streamLlmChat({ config: { apiUrl: 'https://fixture.invalid', apiKey: 'key', model: 'fixture', apiType: apiType as 'openai' | 'anthropic' }, messages: [] })) events.push(event);
    expect(events).toEqual([{ kind: 'reasoning', text: '思考' }, { kind: 'content', text: '正文。' }]);
  });
  it.each(['abort', 'timeout', 'network', 'empty'])('流的 %s 分类与清理', async kind => {
    const controller = new AbortController();
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (kind === 'network') throw new TypeError('secret fixture-key');
      if (kind === 'empty') return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
      return new Response(new ReadableStream({ start() { queueMicrotask(() => controller.abort(kind === 'timeout' ? new DOMException('deadline', 'TimeoutError') : undefined)); }, cancel }), { headers: { 'content-type': 'text/event-stream' } });
    }));
    const events = [];
    for await (const event of streamLlmChat({ config: { apiUrl: 'https://fixture.invalid', apiKey: 'fixture-key', model: 'fixture', apiType: 'openai' }, messages: [], signal: controller.signal })) events.push(event);
    expect(events[events.length - 1]).toMatchObject({ kind: 'error', code: kind === 'abort' ? 'LLM_CANCELLED' : kind === 'timeout' ? 'LLM_TIMEOUT' : kind === 'network' ? 'LLM_NETWORK_ERROR' : 'LLM_EMPTY_OUTPUT' });
    if (kind === 'abort' || kind === 'timeout') expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(['openai', 'anthropic'])('扩写使用设置中的 %s 模型', async api_type => {
    vi.stubEnv('LLM_API_KEY', ''); vi.stubEnv('OPENAI_API_KEY', '');
    const fetch = vi.fn(async (url: unknown) => String(url).includes('/resolve/chat')
      ? Response.json({ ...resolved, api_type }) : sse('扩写画面。', api_type));
    vi.stubGlobal('fetch', fetch);
    const response = await expand(request({ taskId: 'test', segmentIndex: 0, segmentText: '正文。' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ expandedText: '扩写画面。' });
    expect(String(fetch.mock.calls[1][0]).endsWith(api_type === 'openai' ? '/chat/completions' : '/v1/messages')).toBe(true);
  });
  it('解析明确拒绝时保留原因，禁止旧环境回退', async () => {
    vi.stubEnv('LLM_API_KEY', 'old-key');
    const fetch = vi.fn(async () => Response.json({ error_code: 'models_unavailable' }, { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    const response = await generate(request({ taskId: 'test', customPrompt: '资讯' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error_code: 'models_unavailable' });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('上游 JSON 显式报告协议不符', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => String(url).includes('/resolve/chat')
      ? Response.json(resolved) : Response.json({ content: [] })));
    const response = await generate(request({ taskId: 'test', customPrompt: '资讯' }));
    expect(await response.json()).toMatchObject({ success: false, error_code: 'LLM_PROTOCOL_ERROR' });
  });
  it.each(['openai', 'anthropic'])('%s 的正文后错误不能宣告成功', async apiType => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      apiType === 'openai'
        ? 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"error":{"type":"rate_limit_error","message":"secret fixture-key"}}\n\n'
        : 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"partial"}}\n\ndata: {"type":"error","error":{"type":"rate_limit_error","message":"secret fixture-key"}}\n\n',
      { headers: { 'content-type': 'text/event-stream' } })));
    const events = [];
    for await (const event of streamLlmChat({ config: { apiUrl: 'https://fixture.invalid', apiKey: 'fixture-key', model: 'fixture', apiType: apiType as 'openai' | 'anthropic' }, messages: [] })) events.push(event);
    expect(events[events.length - 1]).toMatchObject({ kind: 'error', status: 429, code: 'LLM_RATE_LIMITED' });
    expect(JSON.stringify(events)).not.toContain('fixture-key');
  });
  it('没有终止帧的流报告截断', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', { headers: { 'content-type': 'text/event-stream' } })));
    const events = [];
    for await (const event of streamLlmChat({ config: { apiUrl: 'https://fixture.invalid', apiKey: 'key', model: 'fixture', apiType: 'openai' }, messages: [] })) events.push(event);
    expect(events[events.length - 1]).toMatchObject({ kind: 'error', code: 'LLM_INCOMPLETE_STREAM' });
  });
});

describe('原稿与读取失败隔离', () => {
  it('目录及原稿工具注册在真实按需分类中，空工程依旧阻断导出', () => {
    const registry = createToolRegistry(context());
    const names = registry.getAllTools().map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(['get_video_script', 'set_video_script', 'list_tts_voices']));
    expect(YOLO_DIRECTIVE).toContain('仅文案/收集素材');
    expect(lintTimeline({ timelineState: { tracks: [], totalDuration: 0 } as never, materials: [], targetWidth: 1080, targetHeight: 1920 }).issues)
      .toContainEqual(expect.objectContaining({ code: 'timeline_empty', severity: 'blocker' }));
  });
  it('部分扩写保留失败段原文、ID、独立旁白及音色，同轮快照更新', async () => {
    const ctx = context();
    ctx.scriptSegments!.push({ id: 'two', title: '第二段', narrationText: '独立旁白。', voiceId: 'saved-voice', sentences: [{ id: 'two-s', text: '原画面。' }] });
    const original = structuredClone(ctx.scriptSegments);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ success: true, expandedText: '新视觉。' }))
      .mockResolvedValueOnce(Response.json({ error_code: 'LLM_RATE_LIMITED' }, { status: 429 })));
    const output = await createExpandVideoScriptTool(ctx).execute('partial', {});
    expect(output.details).toMatchObject({ success: true, script: { expanded_count: 1, failed_count: 1 } });
    expect(ctx.scriptSegments![0]).toMatchObject({ id: 'old', narrationText: original![0].narrationText, sentences: [{ text: '新视觉。' }] });
    expect(ctx.scriptSegments![1]).toEqual(original![1]);
  });
  it.each(['cancel', 'edit'])('扩写期间 %s 后不发布迟到结果或请求后续段', async action => {
    const ctx = context(), controller = new AbortController(); ctx.abortSignal = controller.signal;
    ctx.scriptSegments!.push({ id: 'two', title: '第二段', sentences: [{ id: 'two-s', text: '画面。' }] });
    const fetch = vi.fn(async () => {
      if (action === 'cancel') controller.abort();
      else ctx.scriptSegments![0].narrationText = '用户新稿。';
      return Response.json({ success: true, expandedText: '迟到画面。' });
    });
    vi.stubGlobal('fetch', fetch);
    const output = await createExpandVideoScriptTool(ctx).execute('late', {});
    expect(output.details).toMatchObject({ success: false, error_code: action === 'cancel' ? 'SCRIPT_CANCELLED' : 'SCRIPT_CONFLICT' });
    expect(ctx.operations.size).toBe(0);
    if (action === 'cancel') expect(fetch).toHaveBeenCalledOnce();
  });
  it('有 origin 证据的 robots unavailable 才抑制同源轮换', async () => {
    const ctx = context();
    const fetch = vi.fn(async () => Response.json({ success: false, error_code: 'robots_unavailable', error_details: { failure_class: 'policy', retryable: false,
      robots_scope: 'origin', robots_origin: 'https://fixture.invalid', robots_failure_stage: 'fetch', robots_failure_code: 'upstream_timeout' } }, { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    const tool = createEgressTools(ctx).find(t => t.name === 'download_url')!;
    await tool.execute('one', { url: 'https://fixture.invalid/a.mp3', kind: 'media' });
    expect((await tool.execute('two', { url: 'https://fixture.invalid/b.mp3', kind: 'media' })).details).toMatchObject({ cached: true });
    expect(fetch).toHaveBeenCalledOnce();
    expect(ctx.turnState.egressCalls).toBe(1);
  });
  it('同分支并发不重复请求，两次失败后缓存返回不消耗出口预算', async () => {
    const ctx = context(); let resolve!: (value: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; }))
      .mockImplementation(async () => Response.json({ success: false, error_code: 'upstream_timeout', error_details: { failure_class: 'transient', retryable: true } }, { status: 504 }));
    vi.stubGlobal('fetch', fetch);
    const tool = createEgressTools(ctx).find(t => t.name === 'download_url')!, params = { url: 'https://fixture.invalid/a.mp4', kind: 'media' };
    const one = tool.execute('one', params);
    expect((await tool.execute('parallel', params)).details).toMatchObject({ error_code: 'branch_probe_pending' });
    resolve(Response.json({ success: false, error_code: 'upstream_timeout', error_details: { failure_class: 'transient', retryable: true } }, { status: 504 }));
    await one;
    await tool.execute('two', params);
    expect((await tool.execute('cached', params)).details).toMatchObject({ cached: true });
    expect(fetch).toHaveBeenCalledTimes(2); expect(ctx.turnState.egressCalls).toBe(2);
  });
  it('音色目录可查且保留 stale 和权限边界', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, stale: true,
      data: { cantonese: { id: 'cantonese', name: '粤语', language: 'yue', description: '目录音色', category: '方言', gender: 'male' } } })));
    const output = await createListTtsVoicesTool(context()).execute('voices', {});
    expect(output.details).toMatchObject({ success: true, stale: true, availability: 'catalogue_only', voices: [{ id: 'cantonese', language: 'yue' }] });
  });
  it('音色回退回执保留请求、实际音色及降级', async () => {
    const ctx = context(); ctx.defaultVoiceId = 'default';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ success: false, error_code: 'TTS_VOICE_UNAVAILABLE', error_details: { source: 'provider', retryable: false } }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ success: true, data: { audio_url: '/test.mp3', duration: 3 } })));
    const output = await createGenerateTtsTool(ctx).execute('tts', { text: '正文。', voice_type: 'cantonese' });
    expect(output.details).toMatchObject({ success: true, requested_voice_type: 'cantonese', actual_voice_type: 'default', degraded: true });
  });
  it('批量配音失败只报告请求音色，不虚构实际生成音色', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      success: false, error_code: 'TTS_PROVIDER_ERROR',
      error_details: { source: 'provider', retryable: false,
        provider_code: 'capability_unavailable' },
    }, { status: 503 })));
    const output = await createBatchGenerateTtsTool(context()).execute('batch', {
      segments: [{ text: '正文。', voice_type: 'cantonese' }],
    });
    expect(output.details).toMatchObject({ success: false, results: [],
      failures: [{ requested_voice_type: 'cantonese' }] });
    expect(output.details.failures[0]).not.toHaveProperty('actual_voice_type');
    expect(output.details.failures[0]).not.toHaveProperty('degraded');
  });
  it('原稿逐字写入零 LLM 调用，读回完整钩子和稳定 ID', async () => {
    const ctx = context(), fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const tools = createScriptTools(ctx);
    const output = await tools[1].execute('write', { content: '钩子！\n完整正文。' });
    expect(output.details).toMatchObject({ success: true, persisted: false });
    expect(ctx.operations.get('write')).toMatchObject({ type: 'set_script_with_narration', baselineHash: expect.any(String), segments: [{ id: 'old', narrationText: '钩子！\n完整正文。' }] });
    const read = await tools[0].execute('read', {});
    expect(read.details).toMatchObject({ segments: [{ id: 'old', narrationText: '钩子！\n完整正文。' }] });
    expect(fetch).not.toHaveBeenCalled();
    const hash = scriptHash(ctx.scriptSegments);
    expect((await tools[1].execute('blank', { content: '  \n' })).details).toMatchObject({ success: false });
    expect(scriptHash(ctx.scriptSegments)).toBe(hash);
  });
  it('结构化应用拒绝迟到基线，重复结果不重放；撤销读取真实工程', async () => {
    let currentProject = true;
    let state: Pick<VideoEditingTaskContent, 'scriptSegments' | 'aiVideoScriptSegments'> = {
      scriptSegments: context().scriptSegments!, aiVideoScriptSegments: [],
    };
    const original = structuredClone(state);
    const applier = new OperationApplier({ getTimelineState: () => null, setTimelineState: () => undefined,
      isScriptProjectCurrent: () => currentProject,
      getScriptState: () => state, setScriptState: next => { state = next; } });
    const router = new AgentEventRouter({ stateManager: new AgentStateManager('script'), operationApplier: applier,
      getScriptSegments: () => state.scriptSegments, isCurrentProject: () => true });
    const operation = { type: 'set_script_with_narration' as const, scriptType: 'ai_generated', baselineHash: scriptHash(state.scriptSegments),
      segments: [{ id: 'old', title: '新稿', scriptText: '新画面。', narrationText: '新旁白。' }] };
    const event = { type: 'tool_result' as const, toolCallId: 'write', toolName: 'set_video_script', result: { success: true }, operation };
    await router.handleEvent(event);
    expect(state.scriptSegments?.[0].narrationText).toBe('新旁白。');
    useVideoEditingStore.getState().resetScript();
    await router.handleEvent(event);
    expect(applier.getNonTimelineHistory()).toHaveLength(1);
    currentProject = false;
    expect(applier.undoOperation('write')).toEqual({ ok: false, reason: 'conflict' });
    currentProject = true;
    expect(applier.undoOperation('write')).toEqual({ ok: true });
    expect(state).toEqual(original);
    state.scriptSegments![0].narrationText = '用户新编辑。';
    await router.handleEvent({ ...event, toolCallId: 'late' });
    expect(state.scriptSegments![0].narrationText).toBe('用户新编辑。');
  });
  it('扩写全失败不发布修改', async () => {
    const ctx = context();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error_code: 'LLM_AUTHENTICATION_ERROR' }, { status: 401 })));
    const result = await createExpandVideoScriptTool(ctx).execute('expand', { outline: '钩子。\n正文。' });
    expect(result.details).toMatchObject({ success: false, script: { expanded_count: 0, failed_count: 1 } });
    expect(ctx.operations.size).toBe(0);
    expect(ctx.scriptSegments?.[0].id).toBe('old');
  });
  it('五次独立下载超时不终止整轮，未知异常仍熔断', () => {
    let emit: (event: unknown) => void = () => undefined;
    const abort = vi.fn();
    subscribeAgentEvents({ subscribe: (listener: typeof emit) => { emit = listener; return () => undefined; }, abort } as never, context(), () => undefined);
    for (let i = 0; i < 5; i++) emit({ type: 'tool_execution_end', toolName: 'download_url', toolCallId: `d-${i}`, isError: false,
      result: { details: { success: false, error_code: 'upstream_timeout', error_details: { failure_class: 'transient', retryable: true } } } });
    expect(abort).not.toHaveBeenCalled();
    for (let i = 0; i < 5; i++) emit({ type: 'tool_execution_end', toolName: 'download_url', toolCallId: `unknown-${i}`, isError: true, result: {} });
    expect(abort).toHaveBeenCalledOnce();
  });
  it('下载建议仅包含可以执行的恢复动作', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false, error_code: 'upstream_timeout', error_details: { failure_class: 'transient', retryable: true } }, { status: 504 })));
    const tool = createEgressTools(context()).find(t => t.name === 'download_url')!;
    const result = await tool.execute('download', { url: 'https://fixture.invalid/a.mp4', kind: 'media' });
    expect(String(result.details.next_step)).not.toContain('timeout_ms');
  });
});
