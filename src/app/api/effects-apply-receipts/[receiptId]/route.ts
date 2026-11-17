import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { acknowledgeEffectApply } from '@/lib/video-editing-agent/effectApplyReceipts';
import { TimelineAggregate } from '@/components/video/timeline/domain/aggregates/TimelineAggregate';
import type { TimelineData } from '@/components/video/timeline/domain/types';
import type { TimelineState } from '@/types';
import { EffectError } from '@/types/effects';
import { hashEffectValue } from '@/lib/effects/provenance';

export const runtime = 'nodejs';
const MAX_BYTES = 8 * 1024 * 1024;
const schema = z.object({ token: z.string().length(64),
  run_id: z.string().min(1).max(128), project_id: z.string().min(1).max(128),
  operation_id: z.string().min(1).max(256),
  state: z.enum(['applied', 'noop', 'not_applied', 'error']),
  asset_id: z.string().min(1).max(128), clip_id: z.string().max(256).optional(),
  error_code: z.string().max(100).optional(), timeline: z.unknown().optional(),
}).strict();
const finite = z.number().finite();
const timelineSchema = z.object({ tracks: z.array(z.unknown()),
  currentTime: finite.min(0), totalDuration: finite.min(0), zoomLevel: finite.positive(),
  playbackRate: finite.positive(), isPlaying: z.boolean(), snapToGrid: z.boolean(),
  gridSize: finite.min(0), scrollLeft: finite.min(0), selectedItems: z.array(z.string()),
}).passthrough();

async function readBody(request: NextRequest): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > MAX_BYTES) {
    throw new EffectError('EFFECT_RECEIPT_TOO_LARGE');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new EffectError('EFFECT_INVALID_ARGUMENT');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > MAX_BYTES) {
        await reader.cancel(); throw new EffectError('EFFECT_RECEIPT_TOO_LARGE');
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Normalize the same aggregate used by the editor; inline media is UI-only. */
function normalizeTimeline(value: unknown): TimelineState {
  const sanitized = JSON.parse(JSON.stringify(value, (key, item) =>
    /thumbnail|proxy/i.test(key) && typeof item === 'string'
      && /^(data|blob):/i.test(item) ? undefined : item));
  timelineSchema.parse(sanitized);
  const aggregate = TimelineAggregate.fromPlainObject(sanitized as TimelineData);
  return { ...sanitized, ...aggregate.toPlainObject(),
    selectedItems: [] } as TimelineState;
}

/** This endpoint terminates locally; it never proxies to FastAPI. */
export async function POST(request: NextRequest, context: {
  params: Promise<{ receiptId: string }>;
}) {
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin) {
      throw new EffectError('EFFECT_RECEIPT_FORBIDDEN');
    }
    const parsed = schema.parse(await readBody(request));
    const timeline = parsed.timeline === undefined ? undefined
      : normalizeTimeline(parsed.timeline);
    const result = acknowledgeEffectApply((await context.params).receiptId,
      { ...parsed, timeline }, hashEffectValue(parsed));
    return Response.json({ success: true, data: result });
  } catch (error) {
    const code = error instanceof EffectError ? error.code : 'EFFECT_INVALID_ARGUMENT';
    const statuses: Record<string, number> = { EFFECT_RECEIPT_FORBIDDEN: 403,
      EFFECT_RECEIPT_EXPIRED: 410, EFFECT_RECEIPT_CONFLICT: 409,
      EFFECT_RECEIPT_TOO_LARGE: 413 };
    return Response.json({ success: false, data: null, error_code: code,
      error_details: null, message: code }, { status: statuses[code] ?? 400 });
  }
}
