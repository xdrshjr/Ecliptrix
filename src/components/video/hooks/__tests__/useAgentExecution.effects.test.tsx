import { act, cleanup, renderHook } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, TimelineState } from '@/types';
import type { EffectAsset } from '@/types/effects';
import type { SSEStreamManagerConfig } from '@/lib/video-editing-agent/SSEStreamManager';
import type { AgentOperation, EffectsApplyRequest, SSEEvent } from '@/lib/video-editing-agent/types';
import { createDefaultAgentTimelineState } from '@/lib/video-editing-agent/defaultTimeline';
import { createEffectsAgentBridge } from '@/components/video/effects/effectsAgentBridge';
import { replaceTimelineAction } from '@/components/video/timeline/store/actions/replaceTimeline';
import { useTimelineStore } from '@/components/video/timeline/store/useTimelineStore';
import { useAgentExecution } from '../useAgentExecution';

const mocks = vi.hoisted(() => ({ asset: vi.fn(), ack: vi.fn(),
  streams: [] as Array<{ config: SSEStreamManagerConfig; isRunning: boolean }> }));
vi.mock('@/lib/api/effects', () => ({ getEffectAsset: mocks.asset,
  attachEffectInput: vi.fn(), getEffectJob: vi.fn() }));
vi.mock('@/lib/api/http-client', () => ({ http: { post: mocks.ack } }));
vi.mock('@/lib/video-editing-agent/SSEStreamManager', () => ({
  SSEStreamManager: class {
    isRunning = false;
    constructor(public config: SSEStreamManagerConfig) { mocks.streams.push(this); }
    start() { this.isRunning = true; return new Promise<void>(() => {}); }
    cancel() { this.isRunning = false; }
  },
}));
vi.mock('@/contexts/LocaleContext', async () => {
  const { getTranslations } = await import('@/lib/i18n');
  return { useLocale: () => ({ t: getTranslations('en') }) };
});
const asset = { id: 'a', projectId: 'p', kind: 'output-video',
  url: '/api/storage/files/effects/projects/p/outputs/j/video.mp4',
  storageKey: 'effects/projects/p/outputs/j/video.mp4',
  width: 640, height: 360, durationSeconds: 1, bytes: 100,
  effects: { schemaVersion: 1, projectId: 'p', draftId: 'd', draftVersion: 1,
    assetId: 'a', jobId: 'j', templateId: 'title-rise', templateVersion: 1,
    documentHash: 'h' } } as EffectAsset;
const effectRequest = (): EffectsApplyRequest => ({ type: 'effects_apply_request',
  runId: 'run', receiptId: 'receipt', token: 't'.repeat(64), expiresAt: Date.now() + 15000,
  operation: { type: 'effects_action', action: 'apply_asset', operationId: 'effect',
    projectId: 'p', assetId: 'a', mode: 'insert', startTime: 2 } });
const addClip = (id: string, startTime: number): AgentOperation => ({ type: 'add_clip',
  clip: { id, materialId: 'm', trackId: 'video-track-1', startTime, duration: 1,
    clipStart: 0, clipEnd: 1, originalDuration: 5, volume: 1 },
  material: { id: 'm', type: 'video', name: '视频', url: '/api/storage/files/video/a.mp4' } });
const toolResult = (id: string, operation: AgentOperation): SSEEvent => ({
  type: 'tool_result', toolCallId: id, toolName: 'add_to_track',
  result: { success: true }, operation });
const ids = (state: Pick<TimelineState, 'tracks'>) => state.tracks.flatMap(t => t.items.map(i => i.id));

function setup() {
  let mirror = createDefaultAgentTimelineState();
  const conversation: Conversation = { id: 'c', title: 'c', messages: [],
    createdAt: new Date(0), updatedAt: new Date(0) };
  const externalUpdates = vi.fn();
  const bridge = createEffectsAgentBridge({ projectId: 'p', getProjectId: () => 'p',
    registerMaterial: vi.fn(), onWatchJob: vi.fn() });
  const hook = renderHook(() => {
    const [timeline, setTimeline] = useState<TimelineState | null>(mirror);
    const set = useCallback((value: TimelineState | null) => {
      mirror = value!; setTimeline(value);
    }, []);
    return useAgentExecution({ conversations: [conversation], activeConversationId: 'c',
      getConversation: () => conversation, timelineState: timeline, setTimelineState: set,
      updateConversationMessages: (_, messages) => { conversation.messages = messages; },
      materials: [], agentMode: true, setAgentMode: vi.fn(), projectId: 'p',
      effectsAgentBridge: bridge, onTimelineUpdate: externalUpdates });
  });
  return { ...hook, conversation, externalUpdates, mirror: () => mirror,
    // TimelinePanel consumes the latest owner value for an external update id.
    importOwner: (reason: 'agent' | 'agent-undo' = 'agent') =>
      replaceTimelineAction(useTimelineStore.getState, mirror, reason) };
}
async function advance(ms = 100) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
async function start(result: ReturnType<typeof setup>['result']) {
  await act(async () => { await result.current.sendAgentMessage('制作特效'); });
  return mocks.streams[0];
}
beforeEach(() => {
  vi.useFakeTimers(); mocks.streams.length = 0;
  mocks.asset.mockReset().mockResolvedValue(asset); mocks.ack.mockReset().mockResolvedValue({});
  useTimelineStore.getState().setExternalEditLock(null);
  useTimelineStore.setState({ isInteracting: false });
  useTimelineStore.getState().initTimeline(createDefaultAgentTimelineState());
  useTimelineStore.getState().clearHistory();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('特效 Hook 的事件链和镜像', () => {
  it.each(['server_timeout', 'client_aborted', 'thinking_aborted'] as const)(
    '收到 %s 立即撤销取资产中的应用，不等待事件队列排空', async reason => {
      const owner = setup(); const stream = await start(owner.result);
      let resolveAsset!: (value: EffectAsset) => void;
      mocks.asset.mockReturnValue(new Promise(resolve => { resolveAsset = resolve; }));
      act(() => {
        stream.config.onEvent({ type: 'tool_call', toolCallId: 'effect',
          toolName: 'apply_effect', params: {} });
        stream.config.onEvent(effectRequest());
      });
      await advance(1);
      expect(mocks.asset).toHaveBeenCalledTimes(1);
      act(() => {
        stream.config.onEvent({ type: 'cancelled', reason, timestamp: Date.now() });
        stream.config.onComplete(); stream.isRunning = false;
      });
      await act(async () => { resolveAsset(asset); });
      await advance(10);
      expect(ids(useTimelineStore.getState())).not.toContain('effect-clip:effect');
      expect(ids(owner.mirror())).not.toContain('effect-clip:effect');
      expect(mocks.ack).toHaveBeenCalledWith(expect.any(String),
        expect.objectContaining({ state: 'not_applied' }), expect.any(Object));
    },
  );

  it('普通→特效→普通保持镜像；只提交一次特效，单步和整轮撤销均能导入真实 store', async () => {
    const owner = setup(); const stream = await start(owner.result);
    mocks.ack.mockImplementation(async () => {
      expect(ids(owner.mirror())).toEqual(['first', 'effect-clip:effect']);
      expect(ids(useTimelineStore.getState())).toEqual(['first', 'effect-clip:effect']);
      // 特效没有生成新的 externalUpdateId；前一个 id 只能导入最新 owner。
      expect(owner.externalUpdates).toHaveBeenCalledTimes(1);
      expect(owner.importOwner()).toBe(false);
      return {};
    });
    act(() => {
      stream.config.onEvent(toolResult('first', addClip('first', 0)));
      stream.config.onEvent(effectRequest());
      stream.config.onEvent(toolResult('last', addClip('last', 1)));
      stream.config.onComplete(); stream.isRunning = false;
    });
    await advance(250);
    expect(ids(owner.mirror())).toEqual(['first', 'last', 'effect-clip:effect']);
    expect(owner.importOwner()).toBe(true);
    expect(ids(useTimelineStore.getState())).toEqual(ids(owner.mirror()));
    // Ctrl+Z first removes the final ordinary operation, then the one effect commit.
    useTimelineStore.getState().undo();
    expect(ids(useTimelineStore.getState())).toEqual(['first', 'effect-clip:effect']);
    useTimelineStore.getState().undo();
    expect(ids(useTimelineStore.getState())).toEqual(['first']);
    useTimelineStore.getState().redo(); useTimelineStore.getState().redo();
    const message = owner.conversation.messages[owner.conversation.messages.length - 1];
    expect(message.timelineTrackPatches).toHaveLength(2);
    act(() => owner.result.current.undoSingleOperation(message.id, 'effect'));
    owner.importOwner('agent-undo');
    expect(ids(useTimelineStore.getState())).toEqual(['first', 'last']);
    act(() => owner.result.current.undoAllOperations(message.id));
    owner.importOwner('agent-undo');
    expect(ids(useTimelineStore.getState())).toEqual([]);
    expect(mocks.asset).toHaveBeenCalledTimes(1);
  });

  it('排队期间过期和停止都不能把迟到意图提交到 store', async () => {
    const owner = setup(); const stream = await start(owner.result);
    const request = effectRequest(); request.expiresAt = Date.now() + 10;
    act(() => {
      stream.config.onEvent(toolResult('first', addClip('first', 0)));
      stream.config.onEvent(toolResult('delete', {
        type: 'delete_clip', clipId: 'first', trackId: 'video-track-1' }));
      stream.config.onEvent(request);
    });
    await advance();
    expect(mocks.asset).not.toHaveBeenCalled();
    expect(ids(owner.mirror())).toEqual([]);
    act(() => {
      stream.config.onEvent(effectRequest()); owner.result.current.cancelExecution();
    });
    await advance();
    expect(mocks.asset).not.toHaveBeenCalled();
    expect(ids(useTimelineStore.getState())).not.toContain('effect-clip:effect');
    expect(mocks.ack.mock.calls.every(call => call[1].state === 'not_applied')).toBe(true);
  });
});
