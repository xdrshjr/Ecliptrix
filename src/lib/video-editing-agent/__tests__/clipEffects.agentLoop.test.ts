import { expect, it, vi } from 'vitest';
import { createAssistantMessageEventStream, streamSimple } from '@mariozechner/pi-ai';
import type { AssistantMessage, Context } from '@mariozechner/pi-ai';
import type { TimelineState } from '@/types';
import { createVideoEditingAgent } from '../agent';

vi.mock('@mariozechner/pi-ai', async importOriginal => {
  const original = await importOriginal<typeof import('@mariozechner/pi-ai')>();
  return { ...original, streamSimple: vi.fn() };
});

/**
 * 复现用户场景（真实 agent 循环 + 脚本化的模型）：
 * 「给第一个镜头加缓慢推镜头，第二个镜头开头加淡入」。
 *
 * 修复前：目录里没有 clip_effects，explore_tools 的合法 category 也没有它，
 * Agent 只能口头让用户手动设置。修复后：先 explore 才看到 schema，下一轮才可调用，
 * 并且时间线真的被写入。
 */

function timeline(): TimelineState {
  const item = (id: string, startTime: number) => ({
    id, name: id, type: 'video' as const, startTime, duration: 3, trackId: 'v1',
    color: '#000', clipStart: 0, clipEnd: 3, originalDuration: 10,
  });
  return {
    currentTime: 0, totalDuration: 6, zoomLevel: 1, selectedItems: [],
    tracks: [{ id: 'v1', name: 'Video', type: 'video', height: 80, isLocked: false,
      isMuted: false, isVisible: true, volume: 100, order: 0,
      items: [item('shot-1', 0), item('shot-2', 3)] }],
    playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
  };
}

const usage = { input: 0, output: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0,
  cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } };

it('Agent 经 explore_tools 发现 clip_effects，并真的给片段写入运镜与淡入', async () => {
  const payloads: Context[] = [];
  const script = [
    [{ type: 'toolCall', id: 'explore', name: 'explore_tools', arguments: { category: 'clip_effects' } }],
    [
      { type: 'toolCall', id: 'cam', name: 'set_camera_motion',
        arguments: { clipIds: ['shot-1'], presetId: 'push-in', intensity: 0.6 } },
      { type: 'toolCall', id: 'fade', name: 'set_clip_transition',
        arguments: { clipId: 'shot-2', transitionIn: { type: 'fade', duration: 0.5 } } },
    ],
    [{ type: 'text', text: 'done' }],
  ] as const;
  vi.mocked(streamSimple).mockImplementation((model, context) => {
    const content = script[payloads.length] as unknown as AssistantMessage['content'];
    payloads.push(context);
    const message: AssistantMessage = { role: 'assistant', api: model.api,
      provider: model.provider, model: model.id, timestamp: Date.now(), usage,
      stopReason: payloads.length < script.length ? 'toolUse' : 'stop', content };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
    stream.end(message);
    return stream;
  });

  const { agent, toolContext } = createVideoEditingAgent({
    llmApiUrl: 'https://example.com', llmApiKey: 'fake', llmModel: 'fake',
    apiBaseUrl: 'http://localhost:3000', materials: [], timelineState: timeline(),
    conversationHistory: [] });
  await agent.prompt('给第一个镜头加缓慢推镜头，第二个镜头开头加淡入');

  // L0 目录能让模型发现这个类别，但首轮没有任何 clip_effects 工具 schema。
  expect(JSON.stringify(payloads[0].systemPrompt)).toContain('- clip_effects:');
  expect((payloads[0].tools ?? []).some(tool => tool.name === 'set_camera_motion')).toBe(false);
  // explore 之后下一次请求才带 schema。
  const offered = (payloads[1].tools ?? []).map(tool => tool.name);
  expect(offered).toEqual(expect.arrayContaining(['set_camera_motion', 'set_clip_transition']));

  const [shot1, shot2] = toolContext.timelineState.tracks[0].items;
  expect(shot1.cameraMotion).toMatchObject({ presetId: 'push-in', mode: '2d', intensity: 0.6 });
  expect(shot2.transitionIn).toEqual({ type: 'fade', duration: 0.5 });
  expect([shot1, shot2].map(i => [i.startTime, i.duration])).toEqual([[0, 3], [3, 3]]);
  const results = JSON.stringify(agent.state.messages.filter(m => m.role === 'toolResult'));
  expect(results).not.toContain('tool_not_loaded');
  expect(results).toContain('update_clip_effects');
}, 30000);
