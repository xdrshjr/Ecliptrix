import 'server-only';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { TimelineState } from '@/types';
import { EffectError } from '@/types/effects';
import { hashEffectValue } from '@/lib/effects/provenance';
import type { EffectsApplyAck, EffectsApplyRequest,
  EffectsApplyResult } from './types';

interface Receipt {
  request: EffectsApplyRequest;
  finish: (result: EffectsApplyResult) => void;
  onTimeline: (timeline: TimelineState) => void;
  state: 'pending' | 'completed' | 'expired';
  digest?: string;
  purgeAt: number;
  cleanup: () => void;
}
const RECEIPTS = Symbol.for('ecliptrix.effects.apply-receipts.v1');
const shared = globalThis as typeof globalThis & {
  [RECEIPTS]?: Map<string, Receipt>;
};
const receipts = shared[RECEIPTS] ??= new Map<string, Receipt>();

function purge(): void {
  const now = Date.now();
  for (const [id, receipt] of Array.from(receipts)) {
    if (receipt.purgeAt < now) { receipt.cleanup(); receipts.delete(id); }
  }
}

/** A ticket is request-scoped and never doubles as timeline authorization. */
export function createEffectApplyReceipt(options: {
  runId: string; operation: EffectsApplyRequest['operation'];
  signal?: AbortSignal; onTimeline: (timeline: TimelineState) => void;
}) {
  options.signal?.throwIfAborted(); purge();
  const request: EffectsApplyRequest = { type: 'effects_apply_request',
    operation: options.operation, runId: options.runId,
    receiptId: randomUUID(), token: randomBytes(32).toString('hex'),
    expiresAt: Date.now() + 15_000 };
  let finish!: (result: EffectsApplyResult) => void;
  const result = new Promise<EffectsApplyResult>(resolve => { finish = resolve; });
  const expire = () => {
    if (receipt.state !== 'pending') return;
    receipt.state = 'expired'; receipt.cleanup();
    finish({ state: 'dispatched_unknown', assetId: request.operation.assetId });
    const purgeTimer = setTimeout(purge, Math.max(1, receipt.purgeAt - Date.now() + 1));
    purgeTimer.unref?.();
  };
  const timer = setTimeout(expire, 15_000); timer.unref?.();
  const receipt: Receipt = { request, finish, onTimeline: options.onTimeline,
    state: 'pending', purgeAt: request.expiresAt + 120_000,
    cleanup: () => { clearTimeout(timer);
      options.signal?.removeEventListener('abort', expire); } };
  receipts.set(request.receiptId, receipt);
  options.signal?.addEventListener('abort', expire, { once: true });
  return { request, result };
}

function verifyIdentity(receipt: Receipt, ack: EffectsApplyAck): void {
  const { request } = receipt;
  const token = Buffer.from(ack.token ?? '');
  const expected = Buffer.from(request.token);
  if (token.length !== expected.length || !timingSafeEqual(token, expected)
    || ack.run_id !== request.runId
    || ack.project_id !== request.operation.projectId
    || ack.operation_id !== request.operation.operationId
    || ack.asset_id !== request.operation.assetId) {
    throw new EffectError('EFFECT_RECEIPT_FORBIDDEN');
  }
}

/** Accept exactly one authenticated result; duplicates must be identical. */
export function acknowledgeEffectApply(id: string, ack: EffectsApplyAck,
  bodyDigest = hashEffectValue(ack)) {
  purge();
  const receipt = receipts.get(id);
  if (!receipt) throw new EffectError('EFFECT_RECEIPT_EXPIRED');
  verifyIdentity(receipt, ack);
  const digest = bodyDigest;
  if (receipt.state === 'completed') {
    if (receipt.digest !== digest) throw new EffectError('EFFECT_RECEIPT_CONFLICT');
    return { accepted: true };
  }
  if (receipt.state === 'expired' || Date.now() >= receipt.request.expiresAt) {
    throw new EffectError('EFFECT_RECEIPT_EXPIRED');
  }
  if ((ack.state === 'applied' || ack.state === 'noop') && !ack.timeline) {
    throw new EffectError('EFFECT_INVALID_ARGUMENT');
  }
  if (ack.timeline && (ack.state === 'applied' || ack.state === 'noop')) {
    receipt.onTimeline(ack.timeline);
  }
  receipt.state = 'completed'; receipt.digest = digest;
  receipt.purgeAt = Date.now() + 120_000; receipt.cleanup();
  const timer = setTimeout(purge, 120_001); timer.unref?.();
  receipt.finish({ state: ack.state, assetId: ack.asset_id,
    clipId: ack.clip_id, errorCode: ack.error_code });
  return { accepted: true };
}
