import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createEffectApplyReceipt, acknowledgeEffectApply } from '../effectApplyReceipts';
import { createDefaultAgentTimelineState } from '../defaultTimeline';
import type { EffectsApplyAck, EffectsOperation } from '../types';

const operation: EffectsOperation & { action: 'apply_asset' } = {
  type: 'effects_action', projectId: 'p', operationId: 'op',
  action: 'apply_asset', assetId: 'asset', mode: 'insert', startTime: 0,
};
function acknowledge(request: ReturnType<typeof createEffectApplyReceipt>['request']) {
  return { token: request.token, run_id: request.runId, project_id: 'p',
    operation_id: 'op', state: 'applied', asset_id: 'asset',
    timeline: createDefaultAgentTimelineState() } as EffectsApplyAck;
}
afterEach(() => vi.useRealTimers());
describe('真实时间线应用票据', () => {
  it('仅有效回执更新镜像；同体幂等，异体冲突', async () => {
    const accepted = vi.fn();
    const ticket = createEffectApplyReceipt({ runId: 'run', operation,
      onTimeline: accepted });
    const ack = acknowledge(ticket.request);
    expect(() => acknowledgeEffectApply(ticket.request.receiptId,
      { ...ack, token: 'wrong' })).toThrow('EFFECT_RECEIPT_FORBIDDEN');
    expect(accepted).not.toHaveBeenCalled();
    for (const field of ['run_id', 'project_id', 'operation_id', 'asset_id'] as const) {
      expect(() => acknowledgeEffectApply(ticket.request.receiptId,
        { ...ack, [field]: 'other' })).toThrow('EFFECT_RECEIPT_FORBIDDEN');
    }
    acknowledgeEffectApply(ticket.request.receiptId, ack);
    acknowledgeEffectApply(ticket.request.receiptId, { ...ack });
    expect(accepted).toHaveBeenCalledTimes(1);
    expect((await ticket.result).state).toBe('applied');
    expect(() => acknowledgeEffectApply(ticket.request.receiptId,
      { ...ack, state: 'noop' })).toThrow('EFFECT_RECEIPT_CONFLICT');
  });
  it('过期/中止保守返回未知，不接受跨项目或迟到确认', async () => {
    vi.useFakeTimers();
    const ticket = createEffectApplyReceipt({ runId: 'run', operation,
      onTimeline: vi.fn() });
    const ack = acknowledge(ticket.request);
    expect(() => acknowledgeEffectApply(ticket.request.receiptId,
      { ...ack, project_id: 'other' })).toThrow();
    await vi.advanceTimersByTimeAsync(15001);
    expect((await ticket.result).state).toBe('dispatched_unknown');
    expect(() => acknowledgeEffectApply(ticket.request.receiptId, ack))
      .toThrow('EFFECT_RECEIPT_EXPIRED');
    const aborted = new AbortController();
    const second = createEffectApplyReceipt({ runId: 'run2', operation,
      signal: aborted.signal, onTimeline: vi.fn() });
    aborted.abort();
    expect((await second.result).state).toBe('dispatched_unknown');
  });
});
