import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../types';
import type { TimelineState } from '@/types';
import { createAskUserTool, questionIdFor } from '../tools/askUserTool';

/** `ask_user`：单轮一次、确定性 id、可答性约束（AC-09 / AC-32 / R-15 / R-16）。 */

function makeContext(): ToolContext {
  const timelineState: TimelineState = {
    currentTime: 0, totalDuration: 0, zoomLevel: 1, selectedItems: [],
    tracks: [], playbackRate: 1, isPlaying: false, snapToGrid: false,
    gridSize: 0.1, scrollLeft: 0,
  };
  return {
    timelineState, materials: [], apiBaseUrl: 'http://127.0.0.1:3000',
    operations: new Map(), updateTimeline: () => undefined,
    recordOperation: () => undefined, turnState: {},
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Exec = (id: string, params: any) => Promise<any>;

function executor(context: ToolContext): Exec {
  const tool = createAskUserTool(context);
  return tool.execute as unknown as Exec;
}

const OPTIONS = [{ label: '男声' }, { label: '女声' }];

describe('ask_user', () => {
  it('returns an awaiting_user envelope with a deterministic id', async () => {
    const context = makeContext();
    const run = executor(context);
    const first = await run('call-1', {
      question: '用男声还是女声？', options: OPTIONS,
    });
    expect(first.details.success).toBe(true);
    expect(first.details.status).toBe('awaiting_user');
    expect(first.details.question_id).toMatch(/^q-[0-9a-f]{8}$/);
    expect(first.details.instruction).toContain('Stop the turn');
    expect(context.turnState.askedQuestionId).toBe(first.details.question_id);

    // 同一组问题在**另一个**请求里得到同一个 id（SSE 重试安全性）。
    const retried = await executor(makeContext())('call-1', {
      question: '用男声还是女声？', options: OPTIONS,
    });
    expect(retried.details.question_id).toBe(first.details.question_id);
  });

  it('refuses a second question in the same turn', async () => {
    const run = executor(makeContext());
    await run('call-1', { question: 'A?', options: OPTIONS });
    const second = await run('call-2', { question: 'B?', options: OPTIONS });
    expect(second.details.success).toBe(false);
    expect(second.details.error).toBe('already_asked');
    expect(String(second.details.next_step)).toContain('do not ask twice');
  });

  it('rejects a question the user cannot answer', async () => {
    const result = await executor(makeContext())('call-1', {
      question: '怎么改？',
    });
    expect(result.details.success).toBe(false);
    expect(result.details.error_code).toBe('invalid_argument');
    expect(String(result.details.next_step))
      .toContain('allow_free_text=true');
  });

  it('accepts a free-text-only question', async () => {
    const result = await executor(makeContext())('call-1', {
      question: '还有别的偏好吗？', allow_free_text: true,
    });
    expect(result.details.success).toBe(true);
    expect(result.details.allow_free_text).toBe(true);
    expect(result.details.options).toEqual([]);
  });

  it('differs when the options differ', () => {
    const first = questionIdFor('q', [{ label: 'a' }, { label: 'b' }]);
    const second = questionIdFor('q', [{ label: 'a' }, { label: 'c' }]);
    expect(first).not.toBe(second);
  });
});
