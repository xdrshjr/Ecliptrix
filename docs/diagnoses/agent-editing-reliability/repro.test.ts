import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, AgentEvent } from '@mariozechner/pi-agent-core';
import type { ChatMessage, MaterialItem, TimelineState } from '@/types';
import type { SSEEvent, ToolContext } from '@/lib/video-editing-agent/types';
import {
  createVideoEditingAgent, subscribeAgentEvents,
} from '@/lib/video-editing-agent/agent';
import { OperationApplier } from '@/lib/video-editing-agent/OperationApplier';
import {
  createDefaultAgentTimelineState,
} from '@/lib/video-editing-agent/defaultTimeline';
import { lintTimeline } from '@/lib/video-editing-agent/tools/qualityLint';
import { hostFailure } from '@/lib/video-editing-agent/tools/hostToolAdapter';
import {
  createGenerateAiVideoTool,
} from '@/lib/video-editing-agent/tools/generateAiVideo';
import { createPlanTool } from '@/lib/video-editing-agent/tools/planTool';
import {
  createAddSubtitlesTool,
} from '@/lib/video-editing-agent/tools/addSubtitles';
import { createSearchAudioTool } from '@/lib/video-editing-agent/tools/searchAudio';
import { planHasOpenSteps } from '@/lib/video-editing-agent/yoloAutonomy';
import { planVideoExport } from '@/components/video/hooks/videoExportItems';
import { DEFAULT_AGENT_SUBTITLE_STYLE } from '@/lib/video-editing-agent/subtitleClips';
import { useTimelineStore } from '@/components/video/timeline/store/useTimelineStore';
import { replaceTimelineAction } from '@/components/video/timeline/store/actions/replaceTimeline';

// 修复回归：断言正确行为，同时保留导出与字幕原子保护对照。
const material: MaterialItem = {
  id: 'local-video', name: '诊断视频', type: 'video', format: 'mp4',
  url: '/api/storage/files/diagnosis.mp4', size: 100,
  duration: 60, width: 1280, height: 720, createdAt: new Date(0),
};

function timeline(duration = 39.775): TimelineState {
  const state = createDefaultAgentTimelineState();
  state.totalDuration = duration;
  state.tracks[0].items.push({
    id: 'clip', name: '诊断片段', type: 'video',
    trackId: state.tracks[0].id, materialId: material.id,
    startTime: 0, duration, clipStart: 0, clipEnd: duration,
    originalDuration: 60, color: '#000', volume: 1,
    url: material.url,
  });
  return state;
}

function makeAgent(state = timeline(), history: ChatMessage[] = []) {
  return createVideoEditingAgent({
    llmApiUrl: 'http://127.0.0.1:1', llmApiKey: 'diagnosis-only',
    llmModel: 'diagnosis-only', apiBaseUrl: 'http://127.0.0.1:1',
    timelineState: state, materials: [{ ...material }],
    conversationHistory: history,
  });
}

function breaker() {
  let listener: (event: AgentEvent) => void = () => undefined;
  const abort = vi.fn();
  const agent = {
    subscribe: (callback: typeof listener) => {
      listener = callback;
      return () => undefined;
    },
    abort,
  } as unknown as Agent;
  const events: SSEEvent[] = [];
  subscribeAgentEvents(agent, {
    operations: new Map(),
  } as ToolContext, event => events.push(event));
  return {
    abort, events,
    emit: (toolName: string, details: unknown) => listener({
      type: 'tool_execution_end', toolName, toolCallId: 'diagnosis',
      isError: false, result: { content: [], details },
    } as AgentEvent),
  };
}

beforeEach(() => {
  // 所有网络请求默认失败；需要响应的用例只替换 fetch，不访问真实供应商。
  vi.stubGlobal('fetch', vi.fn(() => {
    throw new Error('诊断用例禁止真实网络访问');
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('剪辑可靠性离线回归', () => {
  it('R1：浏览器裁短到 30 秒同步内容总时长', async () => {
    let state = timeline();
    const applier = new OperationApplier({
      getTimelineState: () => state,
      setTimelineState: next => { state = next; },
    });
    await applier.apply({
      type: 'resize_clip', clipId: 'clip', newDuration: 30, clipEnd: 30,
    }, 'resize');
    const report = lintTimeline({
      timelineState: state, materials: [material],
      targetWidth: 1280, targetHeight: 720,
    });
    expect(state.tracks[0].items[0].duration).toBe(30);
    expect(state.totalDuration).toBe(30);
    expect(report.ok).toBe(true);
    expect(report.issues).not.toContainEqual(expect.objectContaining({
      code: 'duration_mismatch', severity: 'warning',
    }));
    // 反例：当前导出规划不使用陈旧 totalDuration，不应推断必有黑尾。
    expect(planVideoExport(state.tracks, new Map([[material.id, material]])))
      .toEqual({ status: 'ready', renderEnd: 30, blackTailSeconds: 0 });
  });

  it('R2：Agent 裁短及删除最后片段后重算总时长', () => {
    const { toolContext } = makeAgent();
    toolContext.updateTimeline('resize', {
      type: 'resize_clip', clipId: 'clip', newDuration: 30, clipEnd: 30,
    });
    expect(toolContext.timelineState.tracks[0].items[0].duration).toBe(30);
    expect(toolContext.timelineState.totalDuration).toBe(30);
    toolContext.updateTimeline('delete', {
      type: 'delete_clip', clipId: 'clip', trackId: 'video-track-1',
    });
    expect(toolContext.timelineState.tracks[0].items).toEqual([]);
    expect(toolContext.timelineState.totalDuration).toBe(0);
  });

  it('R3：首次上轨无须重排时，两端总时长同为 10', async () => {
    let state = createDefaultAgentTimelineState();
    const { toolContext } = makeAgent(state);
    const operation = {
      type: 'add_clip' as const,
      clip: {
        id: 'first', materialId: material.id, trackId: 'video-track-1',
        startTime: 0, duration: 10, clipStart: 0, clipEnd: 10,
        originalDuration: 60, volume: 1,
      },
      material: {
        id: material.id, name: material.name,
        type: 'video' as const, url: material.url,
      },
    };
    toolContext.updateTimeline('first', operation);
    const applier = new OperationApplier({
      getTimelineState: () => state,
      setTimelineState: next => { state = next; },
    });
    await applier.apply(operation, 'first');
    expect(toolContext.timelineState.totalDuration).toBe(10);
    expect(state.totalDuration).toBe(10);
  });

  it('R4：同样的策略拒绝不因工具名称误触全局熔断', () => {
    const details = hostFailure('robots_disallowed', {
      failure_class: 'policy', retryable: false, sticky: true,
    }).details;
    const host = breaker();
    const research = breaker();
    for (let index = 0; index < 5; index++) {
      host.emit('download_url', details);
      research.emit('download_web_media', details);
    }
    expect(host.abort).not.toHaveBeenCalled();
    expect(host.events).not.toContainEqual(expect.objectContaining({
      type: 'error', code: 'tool_failures',
    }));
    expect(research.abort).not.toHaveBeenCalled();
  });

  it('旧快照在首次读取前归一化，不改调用者快照', () => {
    const stale = timeline(30);
    stale.totalDuration = 39.775;
    expect(makeAgent(stale).toolContext.timelineState.totalDuration).toBe(30);
    expect(stale.totalDuration).toBe(39.775);
  });

  it('字幕替换可缩短末端，两端保持一致并可撤销', async () => {
    let state = timeline(10);
    const { toolContext } = makeAgent(state);
    const applier = new OperationApplier({
      getTimelineState: () => state,
      setTimelineState: next => { state = next; },
    });
    for (const duration of [40, 5]) {
      const operation = {
        type: 'add_subtitle_clips' as const, trackId: 'subtitle-track-1',
        mode: 'replace' as const, style: DEFAULT_AGENT_SUBTITLE_STYLE,
        clips: [{ id: 's', name: '字幕', text: '字幕', startTime: 0, duration }],
      };
      toolContext.updateTimeline(`sub-${duration}`, operation);
      await applier.apply(operation, `sub-${duration}`);
      expect(state.totalDuration).toBe(Math.max(10, duration));
      expect(toolContext.timelineState.totalDuration).toBe(state.totalDuration);
    }
    expect(applier.undoOperation('sub-5')).toEqual({ ok: true });
    expect(state.totalDuration).toBe(40);
  });

  it('真实 Store 接收裁短和删除，保持播放头、撤销与重做边界', async () => {
    const get = () => useTimelineStore.getState();
    get().setExternalEditLock(null);
    get().initTimeline(timeline());
    get().clearHistory();
    get().setCurrentTime(38);
    const applier = new OperationApplier({
      getTimelineState: () => ({ ...get().exportToData(), selectedItems: [] }),
      setTimelineState: next => { replaceTimelineAction(get, next, 'agent'); },
    });
    const operation = {
      type: 'resize_clip' as const, clipId: 'clip', newDuration: 30, clipEnd: 30,
    };
    await applier.apply(operation, 'store-resize');
    expect(get().totalDuration).toBe(30);
    expect(get().currentTime).toBe(30);
    await applier.apply(operation, 'store-resize');
    expect(get()._historyService.getHistory()).toHaveLength(1);
    get().undo();
    expect(get().totalDuration).toBe(39.775);
    get().redo();
    expect(get().totalDuration).toBe(30);
    await applier.apply({
      type: 'delete_clip', clipId: 'clip', trackId: 'video-track-1',
    }, 'store-delete');
    expect(get().totalDuration).toBeLessThanOrEqual(0.001);
    expect(get().currentTime).toBeLessThanOrEqual(0.001);
  });

  it('锁轨、取消和无效操作不改变 Agent 状态', () => {
    const { toolContext } = makeAgent();
    toolContext.timelineState.tracks[0].isLocked = true;
    const before = structuredClone(toolContext.timelineState);
    expect(toolContext.updateTimeline('locked', {
      type: 'resize_clip', clipId: 'clip', newDuration: 30,
    }).applied).toBe(false);
    expect(toolContext.timelineState).toEqual(before);
    const controller = new AbortController();
    toolContext.abortSignal = controller.signal;
    controller.abort();
    expect(toolContext.updateTimeline('cancel', {
      type: 'delete_clip', clipId: 'clip', trackId: 'video-track-1',
    }).applied).toBe(false);
    expect(toolContext.timelineState).toEqual(before);
    toolContext.abortSignal = undefined;
    expect(toolContext.updateTimeline('invalid', {
      type: 'resize_clip', clipId: 'clip', newDuration: NaN,
    }).applied).toBe(false);
    expect(toolContext.timelineState).toEqual(before);
  });

  it('预期拒绝既不累加也不清零真实异常，成功清零', () => {
    const subject = breaker();
    for (let index = 0; index < 4; index++) {
      subject.emit('some_tool', { success: false });
    }
    subject.emit('http_request', { success: false,
      error_details: { failure_class: 'user_input' } });
    expect(subject.abort).not.toHaveBeenCalled();
    subject.emit('some_tool', { success: false });
    expect(subject.abort).toHaveBeenCalledOnce();
    const reset = breaker();
    for (let index = 0; index < 4; index++) reset.emit('x', { success: false });
    reset.emit('x', { success: true });
    for (let index = 0; index < 4; index++) reset.emit('x', { success: false });
    expect(reset.abort).not.toHaveBeenCalled();
  });

  it('R5：同一不可用生成能力只请求一次并保留错误分类', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: false,
      message: 'Failed to create video task: Ark API 400: '
        + 'The request targeted an endpoint that is currently closed '
        + 'or temporarily unavailable.',
      error_code: 'provider_unavailable',
      error_details: { failure_class: 'configuration', retryable: false },
    }), { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const tool = createGenerateAiVideoTool(makeAgent().toolContext);
    for (let index = 0; index < 3; index++) {
      const result = await tool.execute(`generation-${index}`, {
        prompt: `约克夏镜头 ${index}`, duration: 5,
      });
      expect(result.details).toMatchObject({ success: false });
      expect(result.details).toMatchObject({
        error_code: 'provider_unavailable',
        error_details: { failure_class: 'configuration', retryable: false },
      });
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('R6：暂时性下载失败给出一致且有预算的重试提示', () => {
    expect(hostFailure('download_failed', {
      failure_class: 'transient', retryable: true, sticky: false,
    }).details).toMatchObject({
      next_step: expect.stringContaining('Retry once'),
      error_details: { retryable: true, sticky: false },
    });
  });

  it('真实 Agent 初始化从失败历史恢复能力限制，继续不重发，新任务允许探测', async () => {
    const first: ChatMessage = { id: 'task-1', role: 'user',
      content: '剪辑约克夏视频30秒', timestamp: new Date() };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: false, error_code: 'provider_unavailable',
      error_details: { failure_class: 'configuration', retryable: false },
    }), { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);
    const start = makeAgent(timeline(30), [first]);
    const failed = await createGenerateAiVideoTool(start.toolContext)
      .execute('generate', { prompt: '约克夏' });
    const history: ChatMessage[] = [first, {
      id: 'reply', role: 'assistant', content: '', timestamp: new Date(),
      isAgentMessage: true, agentToolCalls: [{ id: 'generate',
        name: 'generate_ai_video', params: {}, status: 'error', result: failed.details }],
    }, { id: 'continue', role: 'user', content: '继续完成', timestamp: new Date() }];
    const resumed = makeAgent(timeline(30), history);
    await createGenerateAiVideoTool(resumed.toolContext)
      .execute('generate-again', { prompt: '另一个镜头' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const fresh = makeAgent(timeline(30), [...history, {
      id: 'task-2', role: 'user', content: '新任务：做一段猫的视频', timestamp: new Date(),
    }]);
    await createGenerateAiVideoTool(fresh.toolContext)
      .execute('new-task', { prompt: '猫' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('R7：明确编辑目标下空时间线及无导出回执不能全部完成', async () => {
    const { toolContext, registry } = makeAgent(
      createDefaultAgentTimelineState(), [{ id: 'user-target', role: 'user',
        content: '剪辑一个介绍约克夏的视频，30S', timestamp: new Date() }],
    );
    const result = await createPlanTool(toolContext).execute('finish', {
      steps: [{ title: '导出约克夏 30 秒成片', status: 'completed', deliverable: 'export' }],
    });
    expect(result.details).toMatchObject({ success: false, error_code: 'delivery_incomplete', done_count: 0 });
    expect(toolContext.turnState.plan!.steps.every(step => step.status === 'blocked')).toBe(true);
    expect(planHasOpenSteps(toolContext.turnState.plan!)).toBe(false);
    const names = registry.getAllTools().map(tool => tool.name);
    expect(names).toContain('inspect_export');
    expect(names.filter(name => /export/.test(name))).toEqual(['inspect_export']);
  });

  it('R7对照：没有编辑目标的一般文字计划可在空时间线完成', async () => {
    const { toolContext } = makeAgent(createDefaultAgentTimelineState());
    const result = await createPlanTool(toolContext).execute('text', {
      steps: [{ title: '整理研究结论', status: 'completed' }],
    });
    expect(result.details).toMatchObject({ success: true, done_count: 1 });
  });

  it('R8：远端音频候选明确未下载', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      audios: [{ id: 1, name: '背景音乐', duration: 40,
        preview_url: 'https://example.invalid/bgm.mp3' }],
    }), { status: 200 })));
    const { toolContext } = makeAgent();
    const result = await createSearchAudioTool(toolContext).execute('search', {
      query: 'warm acoustic background music',
    });
    expect(result.details).toMatchObject({ success: true, total_found: 1 });
    expect(result.details).toMatchObject({ materialized: false });
    expect(toolContext.materials.find(entry => entry.id === 'freesound-1'))
      .toMatchObject({ size: 0, url: 'https://example.invalid/bgm.mp3' });
  });

  it('R9：字幕重叠属于正确拒绝，错误返回后不会部分写入', async () => {
    const { toolContext } = makeAgent();
    const result = await createAddSubtitlesTool(toolContext).execute('overlap', {
      cues: [
        { text: '第一句', startTime: 0, duration: 3 },
        { text: '第二句', startTime: 2, duration: 3 },
      ],
    });
    expect(result.details).toMatchObject({
      success: false, error_code: 'subtitle_cues_overlap',
    });
    expect(toolContext.operations.size).toBe(0);
    expect(toolContext.timelineState.tracks[toolContext.timelineState.tracks.length - 1]?.items).toEqual([]);
  });
});
