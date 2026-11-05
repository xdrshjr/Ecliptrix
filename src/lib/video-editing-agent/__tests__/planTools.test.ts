import { describe, expect, it } from 'vitest';
import type { ChatMessage, AgentToolCallRecord, TimelineItem, MaterialItem } from '@/types';
import {
  createPlanTool, normalizePlanSteps, planIdFor, summarizePlan,
} from '../tools/planTool';
import { resolveEditingGoal, resolveTaskMessageId, scanLatestPlan } from '../planScan';
import { createDefaultAgentTimelineState } from '../defaultTimeline';
import type { ToolContext } from '../types';
import { compactHistoryForModel } from '../historyBudget';
import type { Message, ToolResultMessage } from '@mariozechner/pi-ai';

/** 计划工具：状态规范化、单 in_progress、跨轮恢复、LATEST_ONLY_TOOLS。 */

describe('normalizePlanSteps', () => {
  it('keeps only the first in_progress and flags the change', () => {
    const { steps, normalized } = normalizePlanSteps([
      { title: 'a', status: 'in_progress' },
      { title: 'b', status: 'in_progress' },
    ]);
    expect(normalized).toBe(true);
    expect(steps.map(step => step.status)).toEqual(['in_progress', 'pending']);
  });

  it('drops empty titles and enforces the step ceiling', () => {
    const { steps, normalized } = normalizePlanSteps([
      { title: '  ' }, { title: 'a' }, { title: 'b' },
    ], 1);
    expect(normalized).toBe(true);
    expect(steps.map(step => step.title)).toEqual(['a']);
  });

  it('defaults an unknown status to pending', () => {
    const { steps, normalized } = normalizePlanSteps([
      { title: 'a', status: 'wat' as unknown as 'pending' },
    ]);
    expect(normalized).toBe(true);
    expect(steps[0].status).toBe('pending');
  });
});

describe('planIdFor', () => {
  it('is deterministic for the same titles and statuses', () => {
    const steps = normalizePlanSteps([
      { title: 'a' }, { title: 'b', status: 'completed' },
    ]).steps;
    expect(planIdFor(steps)).toBe(planIdFor(steps));
    expect(planIdFor(steps)).toMatch(/^plan-[0-9a-f]{8}$/);
  });

  it('changes when a status changes', () => {
    const first = planIdFor(normalizePlanSteps([{ title: 'a' }]).steps);
    const second = planIdFor(
      normalizePlanSteps([{ title: 'a', status: 'completed' }]).steps);
    expect(first).not.toBe(second);
  });
});

describe('summarizePlan', () => {
  it('counts completed steps and exposes the active index', () => {
    const { steps } = normalizePlanSteps([
      { title: 'a', status: 'completed' },
      { title: 'b', status: 'in_progress' },
    ]);
    const plan = summarizePlan('plan-x', steps, 'note');
    expect(plan.doneCount).toBe(1);
    expect(plan.total).toBe(2);
    expect(plan.activeStep).toBe(1);
    expect(plan.note).toBe('note');
  });
});

function call(
  name: string, status: AgentToolCallRecord['status'], result?: unknown,
  params: Record<string, unknown> = { step: 1 },
): AgentToolCallRecord {
  return { id: `${name}-${status}-${Math.random()}`, name, params, status, result };
}

function assistant(calls: AgentToolCallRecord[]): ChatMessage {
  return {
    id: `m-${Math.random()}`, role: 'assistant', content: '',
    timestamp: new Date(), isAgentMessage: true, agentToolCalls: calls,
  };
}

const goalScope = { projectId: 'project-1', conversationId: 'chat-1' };
function user(id: string, content: string): ChatMessage {
  return { id, content, role: 'user', timestamp: new Date(0) };
}

describe('编辑目标与交付证据', () => {
  it.each([
    '在视频第10秒加入字幕',
    '把视频的第二个镜头改为3秒',
    '解释30秒视频的编码原理',
    '解释视频总时长30秒对码率的影响',
    'Research the best formats for a 30 second video',
    '给我写一个30秒视频的脚本',
  ])('does not turn a timestamp or text task into a film duration: %s', text => {
    expect(resolveEditingGoal([user('request', text)], goalScope)).toBeUndefined();
  });

  it('keeps the duration when the user explicitly rejects a change', () => {
    const original = user('request', '剪辑一个介绍约克夏的视频，30S');
    const history = [original,
      user('follow', '不要把总时长改为20秒，继续完成原来的30秒视频')];
    expect(resolveEditingGoal(history, goalScope)).toMatchObject({
      taskId: 'request', targetDurationSeconds: 30,
      sourceMessageId: 'request',
    });
  });

  it.each(['制作一个封面', '制作一个字幕轨', '制作一个视频封面'])
  ('preserves the task and commitments for an editing subtask: %s', text => {
    const original = user('request', '剪辑一个介绍约克夏的视频，30S');
    const goal = resolveEditingGoal([original], goalScope)!;
    goal.commitments.push('bgm', 'export');
    const saved = assistant([call('update_plan', 'completed', {
      success: true, plan_id: 'saved', editing_goal: goal,
      steps: [{ title: '音乐', status: 'blocked', deliverable: 'bgm' }],
    })]);
    const messages = [original, saved, user('follow', text)];
    expect(resolveEditingGoal(messages, goalScope)).toEqual(goal);
    expect(resolveTaskMessageId(messages)).toBe('request');
    expect(scanLatestPlan(messages)?.planId).toBe('saved');
  });

  it.each(['再制作一个20秒视频', 'Make another 20 second video'])
  ('starts a fresh goal for another whole video: %s', text => {
    const original = user('request', '剪辑一个介绍约克夏的视频，30S');
    const messages = [original, user('new-video', text)];
    expect(resolveEditingGoal(messages, goalScope)).toMatchObject({
      taskId: 'new-video', targetDurationSeconds: 20,
      commitments: ['editing'],
    });
    expect(resolveTaskMessageId(messages)).toBe('new-video');
  });

  it('用户明确时长在继续和省略参数时保留，明确改时长才更新', () => {
    const original = user('request', '剪辑一个介绍约克夏的视频，30S');
    const goal = resolveEditingGoal([original], goalScope)!;
    expect(goal).toMatchObject({ targetDurationSeconds: 30, sourceMessageId: 'request' });
    const saved = assistant([call('update_plan', 'completed', {
      success: true, plan_id: 'saved', editing_goal: goal,
      steps: [{ title: '编辑', status: 'pending' }],
    })]);
    expect(resolveEditingGoal([saved, user('continue', '继续')], goalScope)).toEqual(goal);
    expect(resolveEditingGoal([original, saved, user('change', '改为20秒')], goalScope))
      .toMatchObject({ targetDurationSeconds: 20, sourceMessageId: 'change' });
    expect(resolveEditingGoal([saved], { ...goalScope, projectId: 'other' })).toBeUndefined();
    expect(resolveEditingGoal([original, saved, user('new', '新任务：写一首诗')], goalScope))
      .toBeUndefined();
    for (const text of ['第二镜头改为3秒', '在视频第10秒加入字幕', '不要开始新任务，继续', '旁白长25秒', '总时长不变，旁白改为25秒']) {
      expect(resolveEditingGoal([original, saved, user('follow', text)], goalScope))
        .toMatchObject({ targetDurationSeconds: 30, taskId: 'request' });
    }
    const newTask = user('new', '新任务：写一首诗');
    expect(resolveTaskMessageId([original, saved, newTask])).toBe('new');
    expect(scanLatestPlan([original, saved, newTask])).toBeNull();
  });

  it('空时间线的编辑不能完成，但通用文字计划可以完成', async () => {
    const context = { timelineState: createDefaultAgentTimelineState(), materials: [],
      turnState: { editingGoal: resolveEditingGoal([user('u', '制作30秒视频')], goalScope) },
    } as unknown as ToolContext;
    const result = await createPlanTool(context).execute('finish', {
      steps: [{ title: '完成', status: 'completed', deliverable: 'editing' }],
    });
    expect(result.details).toMatchObject({ success: false, error_code: 'delivery_incomplete' });
    expect(context.turnState.plan?.steps.some(step => step.status !== 'completed')).toBe(true);
    context.turnState = {};
    expect((await createPlanTool(context).execute('text', {
      steps: [{ title: '文章', status: 'completed' }],
    })).details).toMatchObject({ success: true });
  });

  it('改标题与省略步骤不能抹掉已承诺的导出', async () => {
    const context = { timelineState: createDefaultAgentTimelineState(), materials: [],
      lastCompositionId: 'old-export',
      turnState: { editingGoal: resolveEditingGoal([user('u', '制作30秒视频')], goalScope) },
    } as unknown as ToolContext;
    await createPlanTool(context).execute('start', {
      steps: [{ title: '导出', status: 'blocked', deliverable: 'export' }],
    });
    const result = await createPlanTool(context).execute('finish', {
      steps: [{ title: '文字总结', status: 'completed' }],
    });
    expect(result.details).toMatchObject({ success: false, error_code: 'delivery_incomplete' });
    expect(context.turnState.editingGoal?.commitments).toContain('export');
    expect(context.turnState.plan?.steps).toContainEqual(expect.objectContaining({
      status: 'blocked', deliverable: 'export',
    }));
    const recorded = assistant([call('update_plan', 'error', result.details)]);
    const restoredGoal = resolveEditingGoal([recorded, user('continue', '继续')], goalScope);
    expect(restoredGoal?.commitments).toContain('export');
    expect(scanLatestPlan([recorded], restoredGoal)?.steps).toContainEqual(
      expect.objectContaining({ status: 'blocked', deliverable: 'export' }));
    expect(scanLatestPlan([recorded], { ...restoredGoal!, taskId: 'different' })).toBeNull();
  });
  it('拒绝无效目标且读取历史只保留白名单字段', async () => {
    const goal = resolveEditingGoal([user('u', '制作30秒视频')], goalScope)!;
    const saved = assistant([call('update_plan', 'completed', {
      success: true, editing_goal: { ...goal, untrusted: 'not carried' },
      steps: [{ title: '编辑', status: 'pending' }],
    })]);
    expect(resolveEditingGoal([saved], goalScope)).not.toHaveProperty('untrusted');
    const context = { turnState: { editingGoal: { ...goal, targetDurationSeconds: Infinity } } } as ToolContext;
    const result = await createPlanTool(context).execute('invalid', {
      steps: [{ title: '完成', status: 'completed' }],
    });
    expect(result.details).toMatchObject({ success: false });
    expect(context.turnState.plan?.steps[0].status).toBe('blocked');
  });
  it('本任务候选没有下载回执不能完成，旧远端媒体仍兼容', async () => {
    const timeline = createDefaultAgentTimelineState();
    timeline.totalDuration = 30;
    timeline.tracks[0].items = [{ id: 'clip', name: 'clip', type: 'video',
      trackId: timeline.tracks[0].id, materialId: 'remote', startTime: 0, duration: 30,
      color: '#000', url: 'https://example.com/video.mp4',
    } as TimelineItem];
    const media: MaterialItem = { id: 'remote', name: 'remote', type: 'video', format: 'mp4',
      size: 0, createdAt: new Date(0), url: 'https://example.com/video.mp4',
      metadata: { candidate: true, materialized: false } };
    const context = { timelineState: timeline, materials: [media], turnState: {
      editingGoal: resolveEditingGoal([user('u', '制作30秒视频')], goalScope),
    } } as unknown as ToolContext;
    const params = { steps: [{ title: '完成', status: 'completed' as const, deliverable: 'editing' as const }] };
    expect((await createPlanTool(context).execute('candidate', params)).details)
      .toMatchObject({ success: false });
    delete media.metadata;
    expect((await createPlanTool(context).execute('legacy', params)).details)
      .toMatchObject({ success: true });
    const audio: MaterialItem = { ...media, id: 'music', type: 'audio',
      url: '/api/storage/files/music.mp3', metadata: undefined };
    context.materials.push(audio);
    timeline.tracks.push({ ...timeline.tracks[0], id: 'audio', type: 'audio',
      isVisible: false, isMuted: false, volume: 100, items: [{ ...timeline.tracks[0].items[0], id: 'bgm',
        trackId: 'audio', type: 'audio', materialId: 'music', url: audio.url }] });
    const musicParams = { steps: [params.steps[0], { title: '音乐', status: 'completed' as const,
      deliverable: 'bgm' as const, material_ids: ['music'] }] };
    const hiddenBgm = await createPlanTool(context).execute('hidden-bgm', musicParams);
    expect(hiddenBgm.details).toMatchObject({ success: false });
    expect(hiddenBgm.details.next_step).toContain('BGM');
    audio.metadata = { candidate: true, materialized: false };
    const hiddenCandidate = await createPlanTool(context).execute('hidden-candidate', {
      steps: [params.steps[0], { title: '音乐', status: 'blocked', deliverable: 'bgm' }],
    });
    // 隐藏轨本身仍沿用旧 lint blocker，但不把其候选误报为采用的素材。
    expect(hiddenCandidate.details.next_step).not.toContain('搜索候选');
  });
});

describe('scanLatestPlan', () => {
  it('returns the latest EFFECTIVE plan', () => {
    const messages: ChatMessage[] = [
      assistant([call('update_plan', 'completed', {
        success: true, plan_id: 'plan-aaaaaaaa',
        steps: [{ index: 0, title: 'a', status: 'in_progress' }],
      })]),
      assistant([call('update_plan', 'completed', {
        success: true, plan_id: 'plan-bbbbbbbb',
        steps: [{ index: 0, title: 'a', status: 'completed' }],
      })]),
    ];
    const plan = scanLatestPlan(messages);
    expect(plan?.planId).toBe('plan-bbbbbbbb');
    expect(plan?.doneCount).toBe(1);
  });

  it('skips cancelled and errored plans and keeps looking backwards', () => {
    const messages: ChatMessage[] = [
      assistant([call('update_plan', 'completed', {
        success: true, plan_id: 'plan-aaaaaaaa',
        steps: [{ index: 0, title: 'a', status: 'pending' }],
      })]),
      assistant([call('update_plan', 'cancelled')]),
      assistant([call('update_plan', 'error', { success: false })]),
    ];
    expect(scanLatestPlan(messages)?.planId).toBe('plan-aaaaaaaa');
  });

  it('never guesses from params alone', () => {
    const messages = [assistant([
      call('update_plan', 'cancelled', undefined,
        { steps: [{ title: 'a', status: 'completed' }] }),
    ])];
    expect(scanLatestPlan(messages)).toBeNull();
  });
});

describe('LATEST_ONLY_TOOLS history compaction', () => {
  function toolResult(name: string, text: string): ToolResultMessage {
    return {
      role: 'toolResult', toolCallId: `c-${Math.random()}`,
      toolName: name, content: [{ type: 'text', text }],
      isError: false, timestamp: Date.now(),
    } as ToolResultMessage;
  }

  it('replaces every older update_plan result with a stub', () => {
    const messages: Message[] = [
      { role: 'user', content: 'go', timestamp: 1 },
      toolResult('update_plan', '{"success":true,"plan_id":"plan-1"}'),
      { role: 'user', content: 'again', timestamp: 2 },
      toolResult('update_plan', '{"success":true,"plan_id":"plan-2"}'),
      { role: 'user', content: 'again', timestamp: 3 },
      toolResult('update_plan', '{"success":true,"plan_id":"plan-3"}'),
    ];
    const compacted = compactHistoryForModel(messages, 120_000);
    const plans = compacted.filter(
      message => message.role === 'toolResult'
        && message.toolName === 'update_plan');
    expect(plans).toHaveLength(3);
    // 只有最后一次（最近 2 轮里）保留原文，更早的被替换。
    const texts = plans.map(message =>
      (message.content[0] as { text: string }).text);
    expect(texts[0]).toContain('superseded plan');
    expect(texts[1]).toContain('superseded plan');
    expect(texts[2]).toContain('plan-3');
  });
});
