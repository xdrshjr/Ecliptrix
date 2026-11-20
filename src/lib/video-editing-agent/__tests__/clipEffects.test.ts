import { describe, expect, it, vi } from 'vitest';
import { validateToolArguments } from '@mariozechner/pi-ai';
import type { TimelineItem, TimelineState, Track, UpdateClipEffectsOperation } from '@/types';
import { createVideoEditingAgent } from '../agent';
import { AgentEventRouter } from '../AgentEventRouter';
import { AgentStateManager } from '../AgentStateManager';
import { OperationApplier } from '../OperationApplier';
import { createToolRegistry } from '../tools';
import { createClipEffectsTools } from '../tools/clipEffectsTools';
import { UNDOABLE_TOOL_NAMES } from '../trackPatch';
import { findLockedTrackId, validateOperationTargets } from '../operationGuards';
import { isClipEffectsEligible } from '../clipEffectsOperation';
import { CAMERA_PRESETS } from '@/components/video/playback/camera/cameraPresets';
import { canApplyCameraMotion } from '@/components/video/playback/camera/eligibility';
import type { ToolContext } from '../types';

/**
 * `clip_effects`：set_camera_motion / set_clip_transition → update_clip_effects。
 *
 * 评审 R-1..R-4 都是「工具回 success:true、时间线却没变 / 被重排」的静默失败，
 * tsc 发现不了，所以这里走真实路径：服务端本地副本、浏览器 applier、真实
 * AgentEventRouter，不 mock 守卫与 reconcile。
 */

function clip(id: string, startTime: number, duration: number, trackId: string,
  extra: Partial<TimelineItem> = {}): TimelineItem {
  return { id, name: id, type: 'video', startTime, duration, trackId, color: '#000',
    clipStart: 0, clipEnd: duration, originalDuration: 20, ...extra };
}

function track(id: string, type: Track['type'], items: TimelineItem[],
  isLocked = false): Track {
  return { id, name: id, type, height: 80, isLocked, isMuted: false, isVisible: true,
    volume: 100, order: 0, items };
}

/** v1 has a deliberate gap (3→6) and v2 overlays it: reconcile must not touch either. */
function makeState(): TimelineState {
  return {
    currentTime: 0, totalDuration: 9, zoomLevel: 1, selectedItems: [],
    tracks: [
      track('v1', 'video', [clip('a', 0, 3, 'v1'), clip('b', 6, 3, 'v1'),
        clip('img', 12, 4, 'v1', { originalMaterialType: 'image' })]),
      track('v2', 'video', [clip('overlay', 4, 2, 'v2')]),
      track('a1', 'audio', [clip('voice', 0, 5, 'a1', { type: 'audio' })]),
      track('locked', 'video', [clip('frozen', 0, 2, 'locked')], true),
    ],
    playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
  };
}

function newContext(state = makeState()): ToolContext {
  return createVideoEditingAgent({
    llmApiUrl: 'http://localhost:9999', llmApiKey: 'sk-test', llmModel: 'gpt-4o-mini',
    timelineState: state, materials: [], apiBaseUrl: 'http://localhost:3088',
    conversationHistory: [{ id: 'u1', role: 'user', content: '加运镜', timestamp: new Date() }],
  }).toolContext;
}

function toolOf(context: ToolContext, name: string) {
  return createClipEffectsTools(context).find(item => item.name === name)!;
}

function layout(state: TimelineState) {
  return state.tracks.map(t => t.items.map(i => [i.id, i.startTime, i.duration]));
}

function findItem(state: TimelineState, id: string): TimelineItem {
  return state.tracks.flatMap(t => t.items).find(i => i.id === id)!;
}

function makeApplier(state: { value: TimelineState }) {
  return new OperationApplier({
    getTimelineState: () => state.value,
    setTimelineState: next => { state.value = next; },
  });
}

const FADE = { type: 'fade', duration: 0.5 } as const;

describe('update_clip_effects — 服务端副本与浏览器 applier 一致', () => {
  const operation: UpdateClipEffectsOperation = {
    type: 'update_clip_effects', clipId: 'a', transitionIn: FADE,
    transitionOut: { type: 'dissolve', duration: 1 },
  };

  it('两端 tracks 完全一致，且所有片段 startTime/duration 逐位不变（R-1）', async () => {
    const context = newContext();
    const before = layout(makeState());
    expect(context.updateTimeline('tc-1', operation)).toEqual({ applied: true });

    const browser = { value: makeState() };
    expect(await makeApplier(browser).apply(operation, 'tc-1')).toEqual({ status: 'applied' });

    expect(context.timelineState.tracks).toEqual(browser.value.tracks);
    // 刻意留的空隙与叠加片段不得被 reconcile 紧凑排列挪动。
    expect(layout(context.timelineState)).toEqual(before);
    expect(layout(browser.value)).toEqual(before);
    expect(findItem(browser.value, 'a').transitionIn).toEqual(FADE);
  });

  it('null 清除，缺省字段保持不动', async () => {
    const state = { value: makeState() };
    const applier = makeApplier(state);
    await applier.apply(operation, 'tc-1');
    await applier.apply({ type: 'update_clip_effects', clipId: 'a', transitionIn: null }, 'tc-2');
    const item = findItem(state.value, 'a');
    expect(item.transitionIn).toBeUndefined();
    expect(item.transitionOut).toEqual({ type: 'dissolve', duration: 1 });
  });

  it('撤销该工具调用后还原（含 cameraMotion / transition 字段）', async () => {
    const state = { value: makeState() };
    const applier = makeApplier(state);
    const initial = JSON.stringify(state.value.tracks);
    await applier.apply(operation, 'tc-1');
    expect(applier.undoOperation('tc-1')).toEqual({ ok: true });
    expect(JSON.stringify(state.value.tracks)).toBe(initial);
  });

  it('撤销白名单登记了两个新工具', () => {
    expect(UNDOABLE_TOOL_NAMES.has('set_camera_motion')).toBe(true);
    expect(UNDOABLE_TOOL_NAMES.has('set_clip_transition')).toBe(true);
  });
});

describe('update_clip_effects — 守卫（R-4）', () => {
  const base = { type: 'update_clip_effects' as const };

  it.each([
    ['clip 不存在', { ...base, clipId: 'nope', transitionIn: FADE }, 'clip-not-found'],
    ['音频轨上的片段', { ...base, clipId: 'voice', transitionIn: FADE }, 'target-track-missing'],
    ['没有任何效果字段', { ...base, clipId: 'a' }, 'invalid-time'],
    ['转场时长为 0', { ...base, clipId: 'a', transitionIn: { type: 'fade', duration: 0 } }, 'invalid-time'],
    ['转场时长 NaN', { ...base, clipId: 'a', transitionOut: { type: 'fade', duration: NaN } }, 'invalid-time'],
    ['未知转场类型', { ...base, clipId: 'a', transitionIn: { type: 'wipe', duration: 1 } }, 'invalid-time'],
    ['运镜结构非法', { ...base, clipId: 'a', cameraMotion: { version: 9 } }, 'invalid-time'],
  ])('拒绝 %s', (_label, op, reason) => {
    const result = validateOperationTargets(makeState(), op as unknown as UpdateClipEffectsOperation);
    expect(result).toMatchObject({ ok: false, reason });
  });

  it('锁定轨上的片段被识别并被 applier 跳过，内容不变', async () => {
    const op: UpdateClipEffectsOperation = { ...base, clipId: 'frozen', transitionIn: FADE };
    expect(findLockedTrackId(makeState(), op)).toBe('locked');
    const state = { value: makeState() };
    expect(await makeApplier(state).apply(op, 'tc-1'))
      .toMatchObject({ status: 'skipped', reason: 'locked-track' });
    expect(findItem(state.value, 'frozen').transitionIn).toBeUndefined();
  });

  it('可视性规则与 canApplyCameraMotion 同值（避免第二份规则漂移）', () => {
    const state = makeState();
    for (const t of state.tracks) {
      for (const item of t.items) {
        expect(isClipEffectsEligible(t, item)).toBe(canApplyCameraMotion(
          item as never, t as never));
      }
    }
  });
});

describe('set_camera_motion', () => {
  it('预设 enum 由 CAMERA_PRESETS 派生，并含 none', () => {
    const schema = JSON.stringify(createClipEffectsTools(newContext())[0].parameters);
    for (const preset of CAMERA_PRESETS) expect(schema).toContain(`"${preset.id}"`);
    expect(schema).toContain('"none"');
  });

  it('多 clip 进 result.operations 批次，本地副本全部落地，位置不变', async () => {
    const context = newContext();
    const before = layout(context.timelineState);
    const result = (await toolOf(context, 'set_camera_motion').execute('tc-1',
      { clipIds: ['a', 'b', 'img'], presetId: 'push-in', intensity: 1.5, easing: 'linear' } as never)).details as
      { success: boolean; operations: UpdateClipEffectsOperation[] };
    expect(result.success).toBe(true);
    expect(result.operations.map(op => op.clipId)).toEqual(['a', 'b', 'img']);
    for (const id of ['a', 'b', 'img']) {
      expect(findItem(context.timelineState, id).cameraMotion)
        .toMatchObject({ presetId: 'push-in', mode: '2d', intensity: 1.5, easing: 'linear' });
    }
    expect(layout(context.timelineState)).toEqual(before);
  });

  it('none 清除已有运镜', async () => {
    const context = newContext();
    const tool = toolOf(context, 'set_camera_motion');
    await tool.execute('tc-1', { clipIds: ['a'], presetId: 'orbit-left' } as never);
    expect(findItem(context.timelineState, 'a').cameraMotion?.mode).toBe('3d');
    const result = (await tool.execute('tc-2', { clipIds: ['a'], presetId: 'none' } as never)).details;
    expect(result).toMatchObject({ success: true, camera: 'cleared' });
    expect(findItem(context.timelineState, 'a').cameraMotion).toBeUndefined();
  });

  it('批内任一失败 → 整批不落地，返回结构化错误而不是 success:true', async () => {
    const context = newContext();
    const before = JSON.stringify(context.timelineState);
    for (const bad of ['voice', 'frozen', 'missing']) {
      const result = (await toolOf(context, 'set_camera_motion').execute('tc-1',
        { clipIds: ['a', bad], presetId: 'push-in' } as never)).details as Record<string, unknown>;
      expect(result).toMatchObject({ success: false, error_code: 'clip_effects_refused' });
      expect(String(result.error)).toContain(bad);
      expect(JSON.stringify(context.timelineState)).toBe(before);
      expect(context.operations.has('tc-1')).toBe(false);
    }
  });

  it('未知 presetId 报错，而不是静默得到中性运镜', async () => {
    const context = newContext();
    const result = (await toolOf(context, 'set_camera_motion').execute('tc-1',
      { clipIds: ['a'], presetId: 'whoosh' } as never)).details;
    expect(result).toMatchObject({ success: false, error_code: 'unknown_camera_preset' });
    expect(findItem(context.timelineState, 'a').cameraMotion).toBeUndefined();
  });

  it('intensity 被夹到 0..2（导入闸门）', async () => {
    const context = newContext();
    await toolOf(context, 'set_camera_motion').execute('tc-1',
      { clipIds: ['a'], presetId: 'push-in', intensity: 9 } as never);
    expect(findItem(context.timelineState, 'a').cameraMotion?.intensity).toBe(2);
  });

  it('真实 AgentEventRouter 路径：批次落进浏览器时间线并可整体撤销（R-2/R-3）', async () => {
    const context = newContext();
    const details = (await toolOf(context, 'set_camera_motion').execute('tc-1',
      { clipIds: ['a', 'b'], presetId: 'pan-left' } as never)).details;
    const state = { value: makeState() };
    const applier = makeApplier(state);
    const stateManager = new AgentStateManager('m');
    stateManager.addToolCall({ id: 'tc-1', name: 'set_camera_motion', params: {}, status: 'executing' });
    const onOperationApplied = vi.fn();
    const router = new AgentEventRouter({ stateManager, operationApplier: applier, onOperationApplied });
    const initial = layout(state.value);

    await router.handleEvent({ type: 'tool_result', toolCallId: 'tc-1', toolName: 'set_camera_motion',
      result: details, operation: context.operations.get('tc-1') } as never);

    expect(onOperationApplied).toHaveBeenCalled();
    expect(findItem(state.value, 'a').cameraMotion?.presetId).toBe('pan-left');
    expect(findItem(state.value, 'b').cameraMotion?.presetId).toBe('pan-left');
    expect(layout(state.value)).toEqual(initial);
    expect(applier.undoOperation('tc-1')).toEqual({ ok: true });
    expect(findItem(state.value, 'a').cameraMotion).toBeUndefined();
    expect(findItem(state.value, 'b').cameraMotion).toBeUndefined();
  });

  it('单条 operation 路径同样被路由（isTimelineOperation 名单）', async () => {
    const state = { value: makeState() };
    const stateManager = new AgentStateManager('m');
    stateManager.addToolCall({ id: 'tc-1', name: 'set_clip_transition', params: {}, status: 'executing' });
    const router = new AgentEventRouter({ stateManager, operationApplier: makeApplier(state) });
    await router.handleEvent({ type: 'tool_result', toolCallId: 'tc-1', toolName: 'set_clip_transition',
      result: { success: true },
      operation: { type: 'update_clip_effects', clipId: 'a', transitionIn: FADE } } as never);
    expect(findItem(state.value, 'a').transitionIn).toEqual(FADE);
  });
});

describe('set_clip_transition', () => {
  const transitionTool = (context: ToolContext) => toolOf(context, 'set_clip_transition');

  it('多 clip 一次设淡入淡出：result.operations 逐 clip 一个，位置/时长逐位不变', async () => {
    const context = newContext();
    const before = layout(context.timelineState);
    const result = (await transitionTool(context).execute('tc-1',
      { clipIds: ['a', 'b', 'img'], transitionIn: FADE, transitionOut: FADE } as never)).details as
      { success: boolean; operations: UpdateClipEffectsOperation[]; clips: { id: string }[] };
    expect(result.success).toBe(true);
    expect(result.operations.map(op => op.clipId)).toEqual(['a', 'b', 'img']);
    expect(result.clips.map(item => item.id)).toEqual(['a', 'b', 'img']);
    for (const id of ['a', 'b', 'img']) {
      expect(findItem(context.timelineState, id).transitionIn).toEqual(FADE);
      expect(findItem(context.timelineState, id).transitionOut).toEqual(FADE);
    }
    expect(layout(context.timelineState)).toEqual(before);
  });

  it('重复 clipId 去重，只产生一个 operation', async () => {
    const context = newContext();
    const result = (await transitionTool(context).execute('tc-1',
      { clipIds: ['a', 'a'], transitionIn: FADE } as never)).details as
      { operations: UpdateClipEffectsOperation[] };
    expect(result.operations).toHaveLength(1);
  });

  it('夹取按各 clip 自己的时长独立计算，并在 note 里点名被夹取的 clip', async () => {
    const context = newContext();
    // a: 3s (cap 1.5), img: 4s (cap 2) — 1.8s only exceeds a's cap.
    const result = (await transitionTool(context).execute('tc-1',
      { clipIds: ['a', 'img'], transitionIn: { type: 'fade', duration: 1.8 } } as never)).details as
      { success: boolean; note?: string };
    expect(result.success).toBe(true);
    expect(result.note).toContain('half');
    expect(result.note).toContain('on: a.');
    expect(result.note).not.toContain('img');
    expect(findItem(context.timelineState, 'a').transitionIn).toEqual({ type: 'fade', duration: 1.5 });
    expect(findItem(context.timelineState, 'img').transitionIn).toEqual({ type: 'fade', duration: 1.8 });
  });

  it('没有 clip 被夹取时回执不带 note', async () => {
    const context = newContext();
    const result = (await transitionTool(context).execute('tc-1',
      { clipIds: ['a', 'b'], transitionIn: FADE } as never)).details as object;
    expect(result).not.toHaveProperty('note');
  });

  it('null 清除、未给的一侧不变', async () => {
    const context = newContext();
    const tool = transitionTool(context);
    await tool.execute('tc-1', { clipIds: ['a'], transitionIn: FADE, transitionOut: FADE } as never);
    const result = (await tool.execute('tc-2', { clipIds: ['a'], transitionOut: null } as never)).details;
    expect(result).toMatchObject({ success: true, transitionIn: 'unchanged', transitionOut: 'cleared' });
    const item = findItem(context.timelineState, 'a');
    expect(item.transitionIn).toEqual(FADE);
    expect(item.transitionOut).toBeUndefined();
  });

  it('批内任一 clip 被拒 → 整批一个都不落地', async () => {
    for (const bad of ['voice', 'frozen', 'ghost']) {
      const context = newContext();
      const before = JSON.stringify(context.timelineState);
      const result = (await transitionTool(context).execute('tc-1',
        { clipIds: ['a', bad, 'b'], transitionIn: FADE } as never)).details;
      expect(result).toMatchObject({ success: false, error_code: 'clip_effects_refused' });
      expect(JSON.stringify(result)).toContain(bad);
      expect(JSON.stringify(context.timelineState)).toBe(before);
    }
  });

  it.each([
    ['两侧都没给', { clipIds: ['a'] }, 'clip_effects_empty'],
    ['时长为负', { clipIds: ['a'], transitionIn: { type: 'fade', duration: -1 } }, 'clip_effects_refused'],
    ['音频片段', { clipIds: ['voice'], transitionIn: FADE }, 'clip_effects_refused'],
    ['锁定轨', { clipIds: ['frozen'], transitionIn: FADE }, 'clip_effects_refused'],
    ['不存在的片段', { clipIds: ['ghost'], transitionIn: FADE }, 'clip_effects_refused'],
  ])('拒绝：%s', async (_label, params, code) => {
    const context = newContext();
    const before = JSON.stringify(context.timelineState);
    const result = (await transitionTool(context).execute('tc-1', params as never)).details;
    expect(result).toMatchObject({ success: false, error_code: code });
    expect(JSON.stringify(context.timelineState)).toBe(before);
  });

  describe('参数校验（agent 循环在 execute 之前跑的同一个校验器）', () => {
    const validate = (args: Record<string, unknown>) => validateToolArguments(
      transitionTool(newContext()) as never,
      { type: 'toolCall', id: 'tc', name: 'set_clip_transition', arguments: args });

    it('接受 1..12 个 clipIds', () => {
      expect(() => validate({ clipIds: ['a'], transitionIn: FADE })).not.toThrow();
      const twelve = Array.from({ length: 12 }, (_, i) => `c${i}`);
      expect(() => validate({ clipIds: twelve, transitionIn: FADE })).not.toThrow();
    });

    it('拒绝空 clipIds 与超过 12 个', () => {
      expect(() => validate({ clipIds: [], transitionIn: FADE })).toThrow();
      const thirteen = Array.from({ length: 13 }, (_, i) => `c${i}`);
      expect(() => validate({ clipIds: thirteen, transitionIn: FADE })).toThrow();
    });

    it('旧形状 {clipId} 被拒，并给出点名 clipIds 的可读错误', () => {
      expect(() => validate({ clipId: 'a', transitionIn: FADE })).toThrow(/clipIds/);
    });
  });
});

describe('与既有保护的交互', () => {
  it('effectsApplyUncertain 为 true 时两个工具被 EFFECT_TIMELINE_RESYNC_REQUIRED 拦截', async () => {
    const context = newContext();
    context.effectsApplyUncertain = true;
    const registry = createToolRegistry(context);
    for (const [name, params] of [
      ['set_camera_motion', { clipIds: ['a'], presetId: 'push-in' }],
      ['set_clip_transition', { clipIds: ['a'], transitionIn: FADE }],
    ] as const) {
      const tool = registry.getAllTools().find(item => item.name === name)!;
      const result = (await tool.execute('tc-1', params as never)).details;
      expect(result).toMatchObject({ error_code: 'EFFECT_TIMELINE_RESYNC_REQUIRED' });
    }
    expect(findItem(context.timelineState, 'a').cameraMotion).toBeUndefined();
  });
});
