import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MaterialItem, ScriptSegment } from '@/types';
import type { ToolContext } from '../types';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { useVideoEditingStore } from '@/stores';
import { useTimelineStore } from '@/components/video/timeline/store';
import { useSegmentLinks } from '@/components/video/hooks/useSegmentLinks';
import SegmentCard from '@/components/video/components/SegmentCard/SegmentCard';
import { AgentEventRouter } from '../AgentEventRouter';
import { AgentStateManager } from '../AgentStateManager';
import { OperationApplier } from '../OperationApplier';
import { createDefaultAgentTimelineState } from '../defaultTimeline';
import { createGenerateVideoScriptTool } from '../tools/generateVideoScript';
import { createGenerateTtsTool } from '../tools/generateTts';
import { createBatchGenerateTtsTool } from '../tools/batchGenerateTts';
import { createAddToTrackTool } from '../tools/addToTrack';
import { createAddSubtitlesTool } from '../tools/addSubtitles';
import { createComposeStoryboardTool } from '../tools/composeStoryboard';
import { deriveSegmentStatus, resolveItemSegmentId, deriveSegmentVisuals } from '@/components/video/lib/segments/segmentLinks';
import { SegmentLinksContext } from '@/components/video/lib/segments/SegmentLinksContext';
import { TimelineItem as TimelineEntity } from '@/components/video/timeline/domain/entities/TimelineItem';
import { createVideoEditingAgent } from '../agent';
import { readScriptSegments, formatScriptSegments } from '../editorContextPrompt';
import { segmentTextHash } from '@/components/video/lib/aiMix/segmentTextHash';

const TEXT = '清晨的阳光照亮山谷。 鸟儿开始歌唱。';
const SEGMENT: ScriptSegment = { id: '段落-A', title: '清晨', narrationText: TEXT, sentences: [] };
const respond = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const success = () => respond({ success: true, data: { audio_url: '/voice.mp3', duration: 3 } });

function harness(segments = [SEGMENT]) {
  let currentSegments = segments;
  const context: ToolContext = {
    scriptSegments: structuredClone(segments), timelineState: createDefaultAgentTimelineState(),
    materials: [], operations: new Map(), apiBaseUrl: 'http://127.0.0.1:3000',
    turnState: {}, callBudget: { used: 0 },
    recordOperation: (id, op) => { context.operations.set(id, op); },
    updateTimeline: (id, op) => { context.operations.set(id, op); return { applied: true }; },
  };
  const applier = new OperationApplier({
    getTimelineState: () => context.timelineState,
    setTimelineState: state => { context.timelineState = state; useTimelineStore.setState({ tracks: state.tracks as never }); },
  });
  const router = new AgentEventRouter({ stateManager: new AgentStateManager('测试回合'), operationApplier: applier,
    getScriptSegments: () => currentSegments });
  const deliver = async (id: string, name: string) => {
    await router.handleEvent({ type: 'tool_call', toolCallId: id, toolName: name, params: {} });
    await router.handleEvent({ type: 'tool_result', toolCallId: id, toolName: name,
      result: { success: true }, operation: context.operations.get(id) ?? null });
  };
  return { context, applier, router, deliver, setCurrent: (next: ScriptSegment[]) => { currentSegments = next; } };
}

function Panel({ segment }: { segment: ScriptSegment }) {
  const materials = useVideoEditingStore(state => state.materials);
  const { links } = useSegmentLinks({ segments: [segment], materials, isPlaceholderScript: false, currentTime: 0 });
  return createElement(SegmentCard, {
    segment, visualMaterials: links.visualsById?.get(segment.id),
    index: links.segmentIndex.get(segment.id)!, status: links.statusById.get(segment.id)!, durationSeconds: 3,
    state: { isSelected: false, isExpanded: false, isPlaying: false, isAuditioning: false, isPlaceholder: false,
      isHeaderTabStop: true, canAudition: !!links.latestVoiceById.get(segment.id), replaceVisualBlockReason: null, isVoiceBusy: false },
    actions: { onSelect: vi.fn(), onToggleExpanded: vi.fn(), onExpand: vi.fn(), onCollapse: vi.fn(), onNavigate: vi.fn(),
      onAudition: vi.fn(), onReplaceVisual: vi.fn(), onUpdateVoice: vi.fn(), registerHeader: vi.fn(), registerCard: vi.fn() },
    menuItems: [], renderExpanded: () => null,
  });
}

afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  useVideoEditingStore.getState().resetScript();
  useVideoEditingStore.setState({ materials: [] });
  useTimelineStore.setState({ tracks: [] });
});

describe('Agent 脚本段落关联回归', () => {
  it('脚本结果、操作与同回合上下文共用稳定 ID，重新生成不复用', async () => {
    const { context, deliver } = harness();
    vi.stubGlobal('fetch', vi.fn(async () => respond({ success: true, segments: [{ title: '清晨', scriptText: TEXT, narrationText: TEXT }] })));
    const first = await createGenerateVideoScriptTool(context).execute('脚本1', { topic: '山谷', duration_target: 3 });
    const id = (first.details as any).segments[0].segment_id;
    expect(id).toEqual(expect.any(String));
    expect(context.scriptSegments?.[0].id).toBe(id);
    await deliver('脚本1', 'generate_video_script');
    expect(useVideoEditingStore.getState().scriptSegmentsData?.[0].id).toBe(id);
    const second = await createGenerateVideoScriptTool(context).execute('脚本2', { topic: '山谷', duration_target: 3 });
    expect((second.details as any).segments[0].segment_id).not.toBe(id);
  });

  it('真实工具 → router/store → hook/card 自动更新配音、字幕，画面仍为空', async () => {
    const { context, deliver } = harness();
    localStorage.setItem('ecliptrix-locale', 'zh-CN');
    render(createElement(LocaleProvider, { children: createElement(Panel, { segment: SEGMENT }) }));
    expect(screen.getByText('未生成配音')).toBeTruthy();
    vi.stubGlobal('fetch', vi.fn(async () => success()));
    await act(async () => {
      const result = await createGenerateTtsTool(context).execute('配音', { text: TEXT, segment_id: SEGMENT.id });
      expect(result.details).toMatchObject({ success: true });
      await deliver('配音', 'generate_tts');
    });
    expect(screen.getByText('配音已生成')).toBeTruthy();
    expect(deriveSegmentStatus({ segment: SEGMENT, materials: context.materials, tracks: [], isConverting: false })).toMatchObject({ voiceOnTimeline: 'absent', candidate: { isStale: false } });
    await act(async () => {
      await createAddToTrackTool(context).execute('上轨', { materialId: context.materials[0].id, trackId: 'audio-track-1' });
      await deliver('上轨', 'add_to_track');
      await createAddSubtitlesTool(context).execute('字幕', { cues: [{ text: TEXT, startTime: 0, duration: 3 }] });
      await deliver('字幕', 'add_subtitles');
    });
    expect(screen.getByText('字幕已生成')).toBeTruthy();
    expect(screen.getByText('未配置画面')).toBeTruthy();
    const clip = context.timelineState.tracks.flatMap(t => t.items).find(i => i.type === 'audio')!;
    expect(resolveItemSegmentId(JSON.parse(JSON.stringify(clip)), new Map())).toBe(SEGMENT.id);
  });

  it('批量同段重复请求保留独立请求/素材 ID，乱序和部分失败按原始索引归属', async () => {
    const second = { ...SEGMENT, id: '段落-B' };
    const { context } = harness([SEGMENT, second]);
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      expect(new Set(body.segments.map((s: any) => s.segment_id)).size).toBe(3);
      expect(body.segments[0].segment_id).not.toBe(SEGMENT.id);
      return respond({ success: true, results: [2, 0].map(i => ({ segment_id: body.segments[i].segment_id, success: true, audio_url: '/voice.mp3', duration: 3 })) });
    }));
    const run = () => createBatchGenerateTtsTool(context).execute('批量', { segments: [SEGMENT, second, SEGMENT].map(s => ({ text: TEXT, segment_id: s.id })) });
    expect((await run()).details).toMatchObject({ successful_segments: 2, failed_segments: 1 });
    await run();
    expect(context.materials).toHaveLength(4);
    expect(new Set(context.materials.map(m => m.id)).size).toBe(4);
    expect(context.materials.every(m => m.metadata?.segment_id === SEGMENT.id)).toBe(true);
  });

  it.each(['', '   ', '不存在'])('显式无效段 ID %j 在服务调用前拒绝', async id => {
    const { context } = harness();
    const fetchMock = vi.fn(async () => success()); vi.stubGlobal('fetch', fetchMock);
    expect((await createGenerateTtsTool(context).execute('无效', { text: TEXT, segment_id: id })).details).toMatchObject({ success: false });
    expect(fetchMock).not.toHaveBeenCalled(); expect(context.materials).toHaveLength(0);
  });

  it('拒绝配音文本不匹配；不带 ID 的普通 TTS 保持无归属', async () => {
    const { context } = harness();
    vi.stubGlobal('fetch', vi.fn(async () => success()));
    expect((await createGenerateTtsTool(context).execute('错文', { text: '其他文案', segment_id: SEGMENT.id })).details).toMatchObject({ success: false });
    expect((await createGenerateTtsTool(context).execute('普通', { text: '其他文案' })).details).toMatchObject({ success: true });
    expect(context.materials[0].metadata?.segment_id).toBeUndefined();
  });

  it('响应到达时删除段落，前端丢弃关联产物', async () => {
    const { context, deliver, setCurrent } = harness();
    vi.stubGlobal('fetch', vi.fn(async () => success()));
    await createGenerateTtsTool(context).execute('迟到', { text: TEXT, segment_id: SEGMENT.id });
    setCurrent([]);
    await deliver('迟到', 'generate_tts');
    expect(useVideoEditingStore.getState().materials).toHaveLength(0);
  });

  it.each([false, true])('批量画面上轨统一校验段落，删除段落=%s', async removed => {
    const second = { ...SEGMENT, id: '段落-B' };
    const { context, applier } = harness([SEGMENT, second]);
    const stateManager = new AgentStateManager('批量校验');
    let currentSegments = [SEGMENT, second];
    const router = new AgentEventRouter({
      stateManager, operationApplier: applier,
      getScriptSegments: () => currentSegments,
    });
    context.materials.push(...[SEGMENT, second].map(segment => ({
      id: `画面-${segment.id}`, name: segment.title, type: 'video' as const,
      format: 'mp4', size: 1, url: '/valley.mp4', duration: 3,
      createdAt: new Date(), metadata: { segment_id: segment.id },
    })));
    const result = await createComposeStoryboardTool(context).execute('批量画面', {
      storyboard_id: '分镜',
      video_materials: context.materials.map(material => ({
        scene_id: material.id, material_id: material.id,
      })),
    });
    expect(result.details).toMatchObject({ success: true, clips_added: 2 });
    if (removed) currentSegments = [SEGMENT];
    await router.handleEvent({
      type: 'tool_call', toolCallId: '批量画面',
      toolName: 'compose_storyboard', params: {},
    });
    await router.handleEvent({
      type: 'tool_result', toolCallId: '批量画面',
      toolName: 'compose_storyboard', result: result.details,
      operation: context.operations.get('批量画面')!,
    });
    const clips = context.timelineState.tracks.flatMap(track => track.items);
    expect(clips).toHaveLength(removed ? 0 : 2);
    expect(stateManager.getToolCalls()[0].status)
      .toBe(removed ? 'error' : 'completed');
  });

  it('同一视频用于两段，片段关联优先且不重标源素材，卡片显示关联画面', async () => {
    const second = { ...SEGMENT, id: '段落-B' };
    const { context, deliver } = harness([SEGMENT, second]);
    const visual: MaterialItem = { id: 'valley', name: '山谷画面', type: 'video', format: 'mp4', size: 1,
      url: '/valley.mp4', duration: 3, createdAt: new Date(), metadata: { segment_id: SEGMENT.id } };
    context.materials.push(visual);
    localStorage.setItem('ecliptrix-locale', 'zh-CN');
    render(createElement(LocaleProvider, { children: createElement(Panel, { segment: second }) }));
    await act(async () => {
      expect((await createAddToTrackTool(context).execute('画面', { materialId: visual.id, segment_id: second.id })).details).toMatchObject({ success: true });
      await deliver('画面', 'add_to_track');
    });
    const clip = context.timelineState.tracks[0].items[0];
    expect(resolveItemSegmentId(clip, new Map([[visual.id, visual]]))).toBe(second.id);
    expect(visual.metadata?.segment_id).toBe(SEGMENT.id);
    expect(screen.getByText('画面已配置')).toBeTruthy();
    expect(screen.queryByText('未配置画面')).toBeNull();
  });

  it('请求中的段落快照经过校验，提示词暴露稳定 ID 和实际文本', () => {
    const snapshots = readScriptSegments([SEGMENT, SEGMENT, { id: '无效' }]);
    expect(snapshots).toHaveLength(1);
    expect(formatScriptSegments(snapshots)).toContain(SEGMENT.id);
    const { agent, toolContext } = createVideoEditingAgent({
      llmApiUrl: 'http://127.0.0.1:9999/v1', llmApiKey: '测试', llmModel: 'test',
      apiBaseUrl: 'http://127.0.0.1:3000', materials: [], timelineState: createDefaultAgentTimelineState(),
      conversationHistory: [], scriptSegments: snapshots,
    });
    expect(agent.state.systemPrompt).toContain(TEXT);
    expect(agent.state.systemPrompt).toContain(SEGMENT.id);
    expect(toolContext.scriptSegments).toEqual(snapshots);
  });

  it('旧脚本操作只在接收时分配 ID，保存、重排和恢复保留身份', async () => {
    const { context, deliver } = harness();
    context.recordOperation('旧脚本', { type: 'set_script_with_narration', scriptType: 'ai_generated',
      segments: [{ title: '清晨', scriptText: TEXT, narrationText: TEXT }, { title: '第二段', scriptText: '雨。', narrationText: '雨。' }] });
    await deliver('旧脚本', 'generate_video_script');
    const store = useVideoEditingStore.getState();
    const saved = JSON.parse(JSON.stringify(store.scriptSegmentsData));
    expect(new Set(saved.map((s: any) => s.id)).size).toBe(2);
    store.setScriptSegmentsData(saved.slice().reverse());
    expect(useVideoEditingStore.getState().scriptSegmentsData?.map(s => s.id)).toEqual(saved.map((s: any) => s.id).reverse());
    await deliver('旧脚本', 'generate_video_script');
    expect(useVideoEditingStore.getState().scriptSegmentsData?.[0].id).not.toBe(saved[0].id);
  });

  it('无解说的句子数组按真实边界校验与计算哈希', async () => {
    const segment = { ...SEGMENT, narrationText: undefined, sentences: [{ id: 's1', text: '第一句' }, { id: 's2', text: '第二句' }] };
    const { context } = harness([segment]);
    vi.stubGlobal('fetch', vi.fn(async () => success()));
    expect((await createGenerateTtsTool(context).execute('句子', { text: '第一句 第二句', segment_id: segment.id })).details).toMatchObject({ success: true });
    expect(context.materials[0].metadata?.segment_text_hash).toBe(segmentTextHash(segment));
    expect(context.materials[0].sentenceSegments).toBeUndefined();
    expect(deriveSegmentStatus({ segment, materials: context.materials, tracks: [], isConverting: false }).voice).toBe('ready');
  });

  it('同文不同段的批量结果明确区分脚本 ID；前端仅丢弃已删除段', async () => {
    const second = { ...SEGMENT, id: '段落-B' };
    const { context, deliver, setCurrent } = harness([SEGMENT, second]);
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const { segments } = JSON.parse(init.body);
      return respond({ success: true, results: segments.slice().reverse().map((s: any) => ({
        segment_id: s.segment_id, success: true, audio_url: '/voice.mp3', duration: 3,
      })) });
    }));
    const result = await createBatchGenerateTtsTool(context).execute('两段', {
      segments: [SEGMENT, second].map(s => ({ text: TEXT, segment_id: s.id })),
    });
    expect((result.details as any).results.map((row: any) => row.script_segment_id)).toEqual([SEGMENT.id, second.id]);
    expect(context.materials.map(m => m.metadata?.segment_id)).toEqual([SEGMENT.id, second.id]);
    setCurrent([second]);
    await deliver('两段', 'batch_generate_tts');
    expect(useVideoEditingStore.getState().materials.map(m => m.metadata?.segment_id)).toEqual([second.id]);
  });

  it('音色回退保存实际音色、裁剪后语速和时间戳，不伪造句级时间', async () => {
    const segment = { ...SEGMENT, voiceId: 'unavailable', voiceSpeed: 2 };
    const { context } = harness([segment]); context.defaultVoiceId = 'project-voice';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(respond({ success: false, error_code: 'TTS_VOICE_UNAVAILABLE',
      message: '音色不可用', error_details: { source: 'provider', retryable: false } })).mockResolvedValueOnce(success()));
    const started = Date.now();
    const result = await createGenerateTtsTool(context).execute('回退', { text: TEXT, segment_id: segment.id, speed: 3 });
    expect(result.details).toMatchObject({ success: true, voice_type: 'project-voice' });
    expect(context.materials[0].metadata).toMatchObject({ voice_type: 'project-voice', voice_speed: 2 });
    expect(context.materials[0].metadata?.segment_assigned_at).toBeGreaterThanOrEqual(started);
    expect(context.materials[0].sentenceSegments).toBeUndefined();
    expect(deriveSegmentStatus({ segment, materials: context.materials, tracks: [], isConverting: false }).voice).toBe('stale');
  });

  it('生成途中修改文字或设置，迟到产物使用原请求快照并显示待更新', async () => {
    const original = { ...SEGMENT, voiceId: 'voice-a', voiceSpeed: 1.2 };
    const { context } = harness([original]);
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const pending = createGenerateTtsTool(context).execute('慢配音', { text: TEXT, segment_id: SEGMENT.id });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const changed = { ...original, narrationText: '已修改的文案。', voiceId: 'voice-b', voiceSpeed: 1.5 };
    context.scriptSegments = [changed];
    finish(success()); await pending;
    expect(context.materials[0].metadata).toMatchObject({ segment_text_hash: segmentTextHash(original), voice_type: 'voice-a', voice_speed: 1.2 });
    expect(deriveSegmentStatus({ segment: changed, materials: context.materials, tracks: [], isConverting: false }).voice).toBe('stale');
  });

  it('服务返回前脚本被替换，服务端不创建旧段素材或操作', async () => {
    const { context } = harness();
    vi.stubGlobal('fetch', vi.fn(async () => { context.scriptSegments = [{ ...SEGMENT, id: '新段' }]; return success(); }));
    expect((await createGenerateTtsTool(context).execute('旧段', { text: TEXT, segment_id: SEGMENT.id })).details).toMatchObject({ success: false });
    expect(context.materials).toHaveLength(0);
    expect(context.operations.size).toBe(0);
  });

  it('工程已切换时 router 拒绝迟到写入', async () => {
    const { context, applier } = harness();
    vi.stubGlobal('fetch', vi.fn(async () => success()));
    await createGenerateTtsTool(context).execute('旧工程', { text: TEXT, segment_id: SEGMENT.id });
    const router = new AgentEventRouter({ stateManager: new AgentStateManager('旧工程'), operationApplier: applier,
      isCurrentProject: () => false, getScriptSegments: () => [SEGMENT] });
    await router.handleEvent({ type: 'tool_result', toolCallId: '旧工程', toolName: 'generate_tts',
      result: { success: true }, operation: context.operations.get('旧工程')! });
    expect(useVideoEditingStore.getState().materials).toHaveLength(0);
  });

  it('真实句级归属与显式目标冲突时拒绝上轨，不改源素材', async () => {
    const { context } = harness([SEGMENT, { ...SEGMENT, id: '段落-B' }]);
    const material = { id: '句级音频', type: 'audio', name: '音频', url: '/voice.mp3', duration: 3,
      sentenceSegments: { segment_id: SEGMENT.id, total_duration: 3, sentences: [] } } as unknown as MaterialItem;
    context.materials.push(material);
    expect((await createAddToTrackTool(context).execute('冲突', { materialId: material.id, segment_id: '段落-B' })).details).toMatchObject({ success: false });
    expect(context.operations.size).toBe(0);
    expect(material.sentenceSegments?.segment_id).toBe(SEGMENT.id);
  });

  it('服务端与前端片段字段一致；JSON、实体、撤销和重新应用保留关联', async () => {
    const material: MaterialItem = { id: '视频', name: '画面', type: 'video', format: 'mp4', url: '/v.mp4', size: 1, duration: 3, createdAt: new Date() };
    const { context, deliver, applier } = harness();
    const { toolContext } = createVideoEditingAgent({ llmApiUrl: 'http://127.0.0.1:9999/v1', llmApiKey: '测试', llmModel: 'test',
      apiBaseUrl: 'http://127.0.0.1:3000', materials: [material], timelineState: context.timelineState,
      conversationHistory: [], scriptSegments: [SEGMENT] });
    await createAddToTrackTool(toolContext).execute('片段', { materialId: material.id, segment_id: SEGMENT.id });
    const operation = JSON.parse(JSON.stringify(toolContext.operations.get('片段')));
    context.operations.set('片段', operation);
    await deliver('片段', 'add_to_track');
    const clip = context.timelineState.tracks[0].items[0];
    expect(clip.metadata).toEqual(toolContext.timelineState.tracks[0].items[0].metadata);
    const restored = TimelineEntity.fromPlainObject(JSON.parse(JSON.stringify(clip))).toPlainObject();
    expect(resolveItemSegmentId(restored, new Map())).toBe(SEGMENT.id);
    expect(applier.undoOperation('片段')).toEqual({ ok: true });
    expect(deriveSegmentVisuals(SEGMENT, context.timelineState.tracks, new Map())).toHaveLength(0);
    await applier.apply(operation, '重新应用');
    expect(resolveItemSegmentId(context.timelineState.tracks[0].items[0], new Map())).toBe(SEGMENT.id);
  });

  it('展示列表保留候选优先、时间顺序、去重和图片类型，删除后恢复空态', () => {
    const candidate = { id: '候选', name: '候选', type: 'video' } as MaterialItem;
    const item = (id: string, time: number, type = 'video') => ({ id, materialId: id, type: 'video', startTime: time, duration: 2,
      originalMaterialType: type, metadata: { linkedSegmentId: SEGMENT.id }, url: `/${id}` });
    const tracks = [{ id: 'v', type: 'video', items: [item('晚', 4), item('图片', 0, 'image'), item('图片', 2, 'image')] }];
    const visuals = deriveSegmentVisuals({ ...SEGMENT, videos: [candidate] }, tracks, new Map());
    expect(visuals.map(v => v.id)).toEqual(['候选', '图片', '晚']);
    expect(visuals[1].type).toBe('image');
    expect(deriveSegmentVisuals(SEGMENT, [], new Map())).toEqual([]);
  });

  it('真实 ScriptPanel 展开态显示时间轴画面、导航有效且删除后收敛索引', async () => {
    const { default: ScriptPanel } = await import('@/components/video/ScriptPanel');
    const segment = { ...SEGMENT, sentences: [{ id: 's', text: '画面描述' }] };
    const items = ['第一幅', '第二幅'].map((name, i) => ({ id: name, name, materialId: name, type: 'video',
      startTime: i * 3, duration: 3, trackId: 'v', color: '', originalMaterialType: 'image', url: `/${i}.png`,
      metadata: { linkedSegmentId: segment.id } }));
    useTimelineStore.setState({ tracks: [{ id: 'v', type: 'video', items }] as never });
    vi.stubGlobal('fetch', vi.fn(async () => respond({ success: true, voices: [], data: [] })));
    localStorage.setItem('ecliptrix-locale', 'zh-CN');
    function ExpandedPanel() {
      const { links } = useSegmentLinks({ segments: [segment], materials: [], isPlaceholderScript: false, currentTime: 0 });
      return createElement(SegmentLinksContext.Provider, { value: links,
        children: createElement(ScriptPanel, { segments: [segment] }) });
    }
    const view = render(createElement(LocaleProvider, { children: createElement(NotificationProvider, { children: createElement(ExpandedPanel) }) }));
    fireEvent.click(view.container.querySelector('button[aria-expanded="false"]')!);
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.getByAltText('第一幅')).toBeTruthy();
    const navigation = view.container.querySelectorAll('.ws-icon-btn');
    const next = Array.from(navigation).find(button => button.getAttribute('title')?.includes('下'))!;
    fireEvent.click(next);
    expect(screen.getByText('2 / 2')).toBeTruthy();
    expect(screen.getByAltText('第二幅')).toBeTruthy();
    act(() => useTimelineStore.setState({ tracks: [{ id: 'v', type: 'video', items: [items[0]] }] as never }));
    expect(screen.getByText('1 / 1')).toBeTruthy();
    expect(screen.getByAltText('第一幅')).toBeTruthy();
    expect(segment.videos).toBeUndefined();
  });
});
