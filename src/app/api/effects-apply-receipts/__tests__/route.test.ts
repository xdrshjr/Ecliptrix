import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createEffectApplyReceipt } from '@/lib/video-editing-agent/effectApplyReceipts';
import { createDefaultAgentTimelineState } from '@/lib/video-editing-agent/defaultTimeline';
import { POST } from '../[receiptId]/route';

function ticket() {
  return createEffectApplyReceipt({ runId: 'run', onTimeline: vi.fn(),
    operation: { type: 'effects_action', action: 'apply_asset',
      projectId: 'p', operationId: 'op', assetId: 'a', mode: 'insert', startTime: 0 } });
}
function ack(request: ReturnType<typeof ticket>['request']) {
  return { token: request.token, run_id: request.runId, project_id: 'p',
    operation_id: 'op', asset_id: 'a', state: 'applied',
    timeline: createDefaultAgentTimelineState() };
}
function send(id: string, body: unknown, origin = 'http://localhost:3000') {
  return POST(new NextRequest(`http://localhost:3000/api/effects-apply-receipts/${id}`,
    { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body) }), { params: Promise.resolve({ receiptId: id }) });
}
afterEach(() => vi.useRealTimers());
describe('客户端应用回执路由', () => {
  it('确认真实timeline且同体重放200、异体409', async () => {
    const pending = ticket(); const body = ack(pending.request);
    expect((await send(pending.request.receiptId, body)).status).toBe(200);
    expect((await pending.result).state).toBe('applied');
    expect((await send(pending.request.receiptId, body)).status).toBe(200);
    expect((await send(pending.request.receiptId, { ...body, state: 'noop' })).status).toBe(409);
    expect((await send(pending.request.receiptId, { ...body, timeline: {
      ...body.timeline, selectedItems: ['different-body'] } })).status).toBe(409);
  });
  it('拒绝跨origin、无timeline、额外字段与超大请求', async () => {
    const pending = ticket(); const body = ack(pending.request);
    expect((await send(pending.request.receiptId, body, 'https://other.test')).status).toBe(403);
    expect((await send(pending.request.receiptId, { ...body, timeline: undefined })).status).toBe(400);
    expect((await send(pending.request.receiptId, { ...body, extra: true })).status).toBe(400);
    const oversized = new NextRequest('http://localhost:3000/api/effects-apply-receipts/x', {
      method: 'POST', headers: { Origin: 'http://localhost:3000',
        'Content-Length': String(9 * 1024 * 1024) }, body: '{}' });
    expect((await POST(oversized, { params: Promise.resolve({ receiptId: 'x' }) })).status).toBe(413);
    const actualOversized = new NextRequest('http://localhost:3000/api/effects-apply-receipts/x', {
      method: 'POST', headers: { Origin: 'http://localhost:3000' },
      body: ' '.repeat(8 * 1024 * 1024 + 1) });
    expect(actualOversized.headers.has('content-length')).toBe(false);
    expect((await POST(actualOversized, { params: Promise.resolve({ receiptId: 'x' }) })).status).toBe(413);
  });
  it('过期410，非法时间线400且不能更新服务端', async () => {
    vi.useFakeTimers();
    const pending = ticket(); const body = ack(pending.request);
    expect((await send(pending.request.receiptId, { ...body,
      timeline: { tracks: 'invalid' } })).status).toBe(400);
    expect((await send(pending.request.receiptId, { ...body,
      timeline: { tracks: [] } })).status).toBe(400);
    await vi.advanceTimersByTimeAsync(15001);
    expect((await send(pending.request.receiptId, body)).status).toBe(410);
  });
});
