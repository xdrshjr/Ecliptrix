/** 方案 A 的回归验收：运行真实面板与 Agent 入库链路。 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { getTranslations } from '@/lib/i18n';
import type { ScriptSegment } from '@/types';
import { useVideoEditingStore } from '@/stores';
import { useTimelineStore } from '@/components/video/timeline/store';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import { useSegmentLinks } from '@/components/video/hooks/useSegmentLinks';
import { SegmentLinksContext } from '@/components/video/lib/segments/SegmentLinksContext';
import { AgentEventRouter } from '@/lib/video-editing-agent/AgentEventRouter';
import { AgentStateManager } from '@/lib/video-editing-agent/AgentStateManager';
import { OperationApplier } from '@/lib/video-editing-agent/OperationApplier';
import { createDefaultAgentTimelineState } from '@/lib/video-editing-agent/defaultTimeline';
import { createGenerateTtsTool } from '@/lib/video-editing-agent/tools/generateTts';
import { createBatchGenerateTtsTool } from '@/lib/video-editing-agent/tools/batchGenerateTts';
import localAudioManager from '@/lib/utils/localAudioManager';
import type { ToolContext } from '@/lib/video-editing-agent/types';
import ScriptPanel from '@/components/video/ScriptPanel';
import SegmentMoreMenu from '@/components/video/components/SegmentCard/SegmentMoreMenu';
import type { MaterialItem } from '@/types';
import type { VideoAnalysisResponse } from '@/components/video/services/videoAnalysisService';

const copy = getTranslations('zh-CN');
const segment: ScriptSegment = {
  id: 'diagnosis-segment', title: '诊断段落', narrationText: '清晨的阳光照亮山谷。',
  sentences: [{ id: 'diagnosis-sentence', text: '清晨的阳光照亮山谷。' }],
};
const respond = (body: unknown) => new Response(JSON.stringify(body), {
  headers: { 'Content-Type': 'application/json' },
});

function ConnectedPanel({ analyzed = false }: { analyzed?: boolean }) {
  const materials = useVideoEditingStore(state => state.materials);
  const { links } = useSegmentLinks({
    segments: [segment], materials, isPlaceholderScript: false, currentTime: 0,
  });
  return <SegmentLinksContext.Provider value={links}>
    <ScriptPanel segments={[segment]} materials={materials}
      onAddMaterial={material => useVideoEditingStore.getState().addMaterial(material)}
      getVideoAnalysisResult={analyzed ? () => ({ success: true,
        frame_analyses: [{ frame_number: 1, timestamp: 0, analysis: '山谷' }],
      } as VideoAnalysisResponse) : undefined} />
  </SegmentLinksContext.Provider>;
}

function mountPanel(analyzed = false) {
  localStorage.setItem('ecliptrix-locale', 'zh-CN');
  return render(<LocaleProvider><NotificationProvider>
    <div className="diagnosis-shell">
      <aside className="vertical-taskbar">应用侧栏</aside>
      <div className="editor-workbench"><ConnectedPanel analyzed={analyzed} /></div>
    </div>
  </NotificationProvider></LocaleProvider>);
}

function agentHarness(scriptSegments = [segment]) {
  const context: ToolContext = {
    scriptSegments: structuredClone(scriptSegments),
    timelineState: createDefaultAgentTimelineState(), materials: [],
    operations: new Map(), apiBaseUrl: 'http://127.0.0.1:3000',
    turnState: {}, callBudget: { used: 0 },
    recordOperation: (id, operation) => { context.operations.set(id, operation); },
    updateTimeline: () => ({ applied: true }),
  };
  const applier = new OperationApplier({
    getTimelineState: () => context.timelineState,
    setTimelineState: state => { context.timelineState = state; },
  });
  const router = new AgentEventRouter({
    stateManager: new AgentStateManager('诊断回合'), operationApplier: applier,
    getScriptSegments: () => scriptSegments,
  });
  return { context, router };
}

async function generateAgentVoice() {
  const { context, router } = agentHarness();
  await router.handleEvent({
    type: 'tool_call', toolCallId: 'diagnosis-tts', toolName: 'generate_tts', params: {},
  });
  const result = await createGenerateTtsTool(context).execute('diagnosis-tts', {
    segment_id: segment.id, text: segment.narrationText!,
  });
  expect(result.details).toMatchObject({ success: true });
  await router.handleEvent({
    type: 'tool_result', toolCallId: 'diagnosis-tts', toolName: 'generate_tts',
    result: { success: true }, operation: context.operations.get('diagnosis-tts')!,
  });
  return context.materials[0];
}

function expectVoiceAvailable() {
  expect(screen.getByText('配音已生成')).toBeTruthy();
  const replace = screen.getByRole('button', { name: copy.workbench.segmentCard.replaceVisual });
  expect((replace as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: copy.workbench.segmentCard.more }));
  const aiMatch = screen.getByRole('menuitem', { name: copy.workbench.segmentCard.aiMatch });
  expect((aiMatch as HTMLButtonElement).disabled).toBe(true);
  expect(aiMatch.title).toBe(copy.scriptPanel.actions.aiMatchNotConfigured);
  fireEvent.keyDown(aiMatch, { key: 'Escape' });
}

afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  useVideoEditingStore.setState({ materials: [] });
  useTimelineStore.setState({ tracks: [] });
  useEditorFocusStore.getState().reset();
});

function stubResponses() {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) =>
    String(url).endsWith('/api/tts/convert')
      ? respond({ success: true, data: { audio_url: '/diagnosis.mp3', duration: 3 } })
      : respond({ success: true, voices: [], data: [] })));
}

describe('脚本卡菜单与语音可用性：修复后行为', () => {
  it('更多按钮位于卡头时长右侧，与展开按钮平级', () => {
    stubResponses(); mountPanel();
    const trigger = screen.getByRole('button', { name: copy.workbench.segmentCard.more });
    expect(trigger.closest('.segment-card__actions')).toBeNull();
    expect(trigger.parentElement?.className).toBe('segment-card__head');
    expect(trigger.closest('.segment-card__header')).toBeNull();
  });

  it('真实菜单优先向右展开，保留工作台 Portal', () => {
    stubResponses();
    // 旧配音对应旧文案：真实卡片会多出“更新配音”，在最小面板宽度换行。
    useVideoEditingStore.setState({ materials: [{
      id: 'stale-voice', type: 'audio', name: '旧配音', format: 'mp3', size: 0,
      duration: 3, url: '/stale.mp3', createdAt: new Date(0),
      metadata: { segment_id: segment.id, segment_text_hash: 'outdated' },
    }] });
    const view = mountPanel();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const isMenu = this.getAttribute('role') === 'menu';
      const rectangle = this.classList.contains('editor-workbench')
        ? { x: 48, y: 0, left: 48, top: 0, right: 1024, bottom: 768, width: 976, height: 768 }
        : isMenu
        ? { x: 0, y: 0, left: 0, top: 0, right: 232, bottom: 260, width: 232, height: 260 }
        : { x: 188, y: 200, left: 188, top: 200, right: 220, bottom: 232, width: 32, height: 32 };
      return { ...rectangle, toJSON: () => rectangle } as DOMRect;
    });
    fireEvent.click(screen.getByRole('button', { name: copy.workbench.segmentCard.more }));
    const menu = screen.getByRole('menu');
    expect(menu.style.left).toBe('224px');
    expect(menu.parentElement?.className).toBe('editor-workbench');
    console.log('按钮=[188,220]；菜单宽=232；菜单left=224；Portal=editor-workbench');

  });

  it('尚无配音时禁用提示成立（负向对照）', () => {
    stubResponses(); mountPanel();
    expect(screen.getByText('未生成配音')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: copy.workbench.segmentCard.more }));
    const aiMatch = screen.getByRole('menuitem', { name: copy.workbench.segmentCard.aiMatch });
    expect((aiMatch as HTMLButtonElement).disabled).toBe(true);
    expect(aiMatch.title).toBe('请先完成语音转换');
  });

  it('Agent真实工具→事件路由→素材仓库→真实面板：配音入库后立即解锁', async () => {
    stubResponses(); mountPanel();
    await act(async () => { await generateAgentVoice(); });
    expect(useVideoEditingStore.getState().materials[0].metadata?.segment_id).toBe(segment.id);
    expectVoiceAvailable();
  });

  it('面板重新挂载后保留的关联配音仍可用', async () => {
    stubResponses();
    await generateAgentVoice();
    const first = mountPanel();
    expectVoiceAvailable(); first.unmount();
    mountPanel(); expectVoiceAvailable();
  });

  it('删除最新版本后保留旧配音，删除最后版本才重新禁用', async () => {
    stubResponses();
    const latest = await generateAgentVoice();
    const older = { ...latest, id: 'older', metadata: { ...latest.metadata, segment_assigned_at: 0 } };
    useVideoEditingStore.setState({ materials: [older, latest] });
    mountPanel(); expectVoiceAvailable();
    act(() => useVideoEditingStore.setState({ materials: [older] }));
    expectVoiceAvailable();
    act(() => useVideoEditingStore.setState({ materials: [] }));
    expect(screen.getByRole('button', { name: copy.workbench.segmentCard.replaceVisual })).toBeDisabled();
  });

  it('旧配音过期仍可用；无关联和其他段落音频不能解锁', async () => {
    stubResponses();
    const audio = await generateAgentVoice();
    useVideoEditingStore.setState({ materials: [{ ...audio, metadata: { ...audio.metadata, segment_text_hash: 'old' } }] });
    mountPanel();
    expect(screen.getByText('配音待更新')).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.workbench.segmentCard.replaceVisual })).toBeEnabled();
    for (const metadata of [{}, { segment_id: 'other' }]) {
      act(() => useVideoEditingStore.setState({ materials: [{ ...audio, metadata }] }));
      expect(screen.getByRole('button', { name: copy.workbench.segmentCard.replaceVisual })).toBeDisabled();
    }
  });

  it('Agent 配音解锁后的 AI 匹配实际发送音频时长', async () => {
    stubResponses();
    await generateAgentVoice();
    const video = { id: 'video', type: 'video', name: '山谷', url: '/valley.mp4', createdAt: new Date() } as MaterialItem;
    useVideoEditingStore.setState(state => ({ materials: [...state.materials, video] }));
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/api/video-ai-match')) {
        requests.push(JSON.parse(String(init?.body)));
        return respond({ success: true, matches: [], totalAnalyzed: 1 });
      }
      return respond({ success: true, voices: [], data: [] });
    }));
    mountPanel(true);
    fireEvent.click(screen.getByRole('button', { name: copy.workbench.segmentCard.more }));
    const ai = screen.getByRole('menuitem', { name: copy.workbench.segmentCard.aiMatch });
    expect(ai).toBeEnabled();
    fireEvent.click(ai);
    await waitFor(() => expect(requests[0]?.segmentDuration).toBe(3));
  });

  it('Agent 配音解锁后的更换画面实际打开搜索', async () => {
    stubResponses(); await generateAgentVoice();
    const keywords = segment.keywords;
    segment.keywords = ['valley'];
    try {
      mountPanel();
      fireEvent.click(screen.getByRole('button', { name: copy.workbench.segmentCard.replaceVisual }));
      await waitFor(() => expect(screen.getByPlaceholderText(/输入搜索关键词/)).toBeTruthy());
    } finally { segment.keywords = keywords; }
  });

  it.each([false, true])('人工配音下载失败=%s 时按实际入库结果解锁', async downloadFails => {
    vi.spyOn(localAudioManager, 'storeAudioFile').mockResolvedValue('blob:test');
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/api/tts/convert-sentences')) return respond({ success: true,
        concatenated_audio_url: '/manual.mp3', total_duration: 3, sentence_results: [],
        total_sentences: 1, successful_sentences: 1, failed_sentences: 0,
      });
      if (String(url).endsWith('/manual.mp3')) return new Response('audio', { status: downloadFails ? 500 : 200 });
      return respond({ success: true, voices: [], data: [] });
    }));
    mountPanel();
    fireEvent.click(screen.getByRole('button', { name: copy.workbench.segmentCard.more }));
    fireEvent.click(screen.getByRole('menuitem', { name: copy.workbench.segmentCard.generateVoice }));
    if (downloadFails) {
      await waitFor(() => expect(screen.getAllByText(/音频下载失败/).length).toBeGreaterThan(0));
      expect(useVideoEditingStore.getState().materials).toHaveLength(0);
      expect(screen.getByRole('button', { name: copy.workbench.segmentCard.replaceVisual })).toBeDisabled();
    } else {
      await waitFor(() => expect(useVideoEditingStore.getState().materials).toHaveLength(1));
      await waitFor(() => expect(screen.getByText('配音已生成')).toBeTruthy());
      expectVoiceAvailable();
    }
  });

  it.each([false, true])('Agent 批量部分失败：当前段失败=%s，仅成功关联项解锁', async currentFails => {
    const other = { ...segment, id: 'other-segment' };
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).endsWith('/api/tts/batch-convert')) return respond({ success: true, voices: [], data: [] });
      const { segments } = JSON.parse(String(init?.body));
      return respond({ success: true, results: segments.map((item: {segment_id: string}, index: number) =>
        (index === 0) === currentFails
          ? { segment_id: item.segment_id, success: false, error_code: 'TTS_QUOTA_EXHAUSTED' }
          : { segment_id: item.segment_id, success: true, audio_url: '/batch.mp3', duration: 3 }) });
    }));
    mountPanel();
    const { context, router } = agentHarness([segment, other]);
    await act(async () => {
      const result = await createBatchGenerateTtsTool(context).execute('batch', {
        segments: [segment, other].map(item => ({ segment_id: item.id, text: item.narrationText! })),
      });
      expect(result.details).toMatchObject({ successful_segments: 1, failed_segments: 1 });
      await router.handleEvent({ type: 'tool_result', toolCallId: 'batch', toolName: 'batch_generate_tts',
        result: { success: true }, operation: context.operations.get('batch')! });
    });
    expect(useVideoEditingStore.getState().materials).toHaveLength(1);
    expect(screen.getByRole('button', { name: copy.workbench.segmentCard.replaceVisual }).hasAttribute('disabled')).toBe(currentFails);
  });
});

describe('菜单可见边界与动态键盘行为', () => {
  const rectangle = (left: number, top: number, width: number, height: number) => ({
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
    toJSON() { return {}; },
  } as DOMRect);
  it('右侧不足时翻转，限高滚动，resize 后仍不进入侧栏', () => {
    let root = rectangle(48, 0, 500, 200);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('editor-workbench')) return root;
      return this.getAttribute('role') === 'menu' ? rectangle(0, 0, 232, 700) : rectangle(490, 140, 32, 32);
    });
    render(<div className="editor-workbench"><SegmentMoreMenu label="测试菜单"
      items={[{ key: 'one', label: '第一项', onSelect() {} }]} /></div>);
    fireEvent.click(screen.getByRole('button', { name: '测试菜单' }));
    const menu = screen.getByRole('menu');
    expect(menu.style.left).toBe('254px');
    expect(menu.style.top).toBe('8px');
    expect(menu.style.maxHeight).toBe('184px');
    expect(menu.style.overflowY).toBe('auto');
    root = rectangle(48, 0, 220, 200);
    fireEvent(window, new Event('resize'));
    expect(menu.style.left).toBe('56px');
    expect(menu.style.maxWidth).toBe('204px');
  });

  it('聚焦项被禁用或删除后仍能导航，Esc 返回触发按钮', () => {
    const items = ['one', 'two', 'three'].map(key => ({ key, label: key, onSelect() {} }));
    const view = render(<SegmentMoreMenu label="测试菜单" items={items} />);
    const trigger = screen.getByRole('button', { name: '测试菜单' });
    fireEvent.click(trigger);
    expect(document.activeElement?.textContent).toBe('one');
    view.rerender(<SegmentMoreMenu label="测试菜单" items={items.map(item => ({ ...item, disabled: item.key === 'one' }))} />);
    expect(document.activeElement?.textContent).toBe('two');
    view.rerender(<SegmentMoreMenu label="测试菜单" items={items.filter(item => item.key !== 'two')} />);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' });
    expect(document.activeElement?.textContent).toBe('three');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
