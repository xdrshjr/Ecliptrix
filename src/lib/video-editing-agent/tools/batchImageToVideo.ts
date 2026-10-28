import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { MaterialItem } from '@/types';
import type { ToolContext } from '../types';
import { mapWithConcurrency } from './boundedConcurrency';
import {
  stillAspectRatioSchema, stillDirectionSchema, stillEffectSchema,
} from './imageToVideo';
import {
  runStillClip, stillFailure, stillToolResponse,
  type StillClipFailure, type StillClipParams, type StillClipSuccess,
} from './stillClip';

/** Matches the backend queue (`max_concurrent=2`): more would only wait there. */
export const BATCH_CONCURRENCY = 2;
export const MAX_BATCH_ITEMS = 12;
const BATCH_TIMEOUT_MS = 240_000;

/** Alternating moves so a slideshow does not push in on every shot alike. */
const VARIETY_CYCLE: ReadonlyArray<Pick<StillClipParams, 'effect' | 'direction'>> = [
  { effect: 'ken_burns', direction: 'zoom_in' },
  { effect: 'pan', direction: 'left_to_right' },
  { effect: 'ken_burns', direction: 'zoom_out' },
  { effect: 'pan', direction: 'right_to_left' },
];

const parameters = Type.Object({
  items: Type.Array(Type.Object({
    material_id: Type.String(),
    duration: Type.Optional(Type.Number({ minimum: 1, maximum: 30 })),
    effect: stillEffectSchema,
    direction: stillDirectionSchema,
    focus_x: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    focus_y: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  }), { minItems: 1, maxItems: MAX_BATCH_ITEMS }),
  defaults: Type.Optional(Type.Object({
    duration: Type.Optional(Type.Number({ minimum: 1, maximum: 30 })),
    effect: stillEffectSchema,
    aspect_ratio: stillAspectRatioSchema,
    variety: Type.Optional(Type.Boolean({
      description: 'Default true: alternate zoom_in/zoom_out/pan across items that set no effect/direction, so shots do not all move alike',
    })),
  })),
});

type Params = Static<typeof parameters>;
type Item = Params['items'][number];
type SlotResult = StillClipSuccess | StillClipFailure;

interface BatchSlot {
  params: StillClipParams;
  key: string;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

/**
 * Per-item params after `defaults` and the variety cycle. Pure and indexed, so
 * a retried call produces identical parameters (and therefore cached clips).
 */
export function resolveBatchItem(
  item: Item, index: number, defaults: Params['defaults'],
): StillClipParams {
  const unspecified = item.effect === undefined && item.direction === undefined
    && defaults?.effect === undefined;
  const cycled = unspecified && defaults?.variety !== false
    ? VARIETY_CYCLE[index % VARIETY_CYCLE.length]
    : {};
  return {
    ...cycled,
    ...(defaults?.effect ? { effect: defaults.effect } : {}),
    ...(defaults?.duration !== undefined ? { duration: defaults.duration } : {}),
    ...(defaults?.aspect_ratio ? { aspect_ratio: defaults.aspect_ratio } : {}),
    ...stripUndefined(item),
  } as StillClipParams;
}

/** Same image with the same resolved params converts once per call. */
function dedupeKey(params: StillClipParams): string {
  return JSON.stringify(params, Object.keys(params).sort());
}

function interruptedResult(
  entry: { error?: unknown } | undefined, materialId: string,
): StillClipFailure {
  return stillFailure({
    code: 'request_failed', retryable: true,
    hint: 'This item did not run (cancelled or errored). Retry only the failed items.',
  }, entry && 'error' in entry
    ? `Conversion error: ${String(entry.error)}`
    : 'Skipped because the run was cancelled',
  materialId);
}

async function convertAll(
  context: ToolContext, slots: BatchSlot[],
): Promise<{ results: SlotResult[]; added: MaterialItem[] }> {
  const added: MaterialItem[] = [];
  const inFlight = new Map<string, Promise<SlotResult>>();
  const convert = (slot: BatchSlot): Promise<SlotResult> => {
    const existing = inFlight.get(slot.key);
    if (existing) return existing;
    const started = runStillClip(context, slot.params).then(outcome => {
      if (outcome.addedMaterial) added.push(outcome.addedMaterial);
      return outcome.result;
    });
    inFlight.set(slot.key, started);
    return started;
  };
  const settled = await mapWithConcurrency(
    slots, BATCH_CONCURRENCY, slot => convert(slot),
    () => !context.abortSignal?.aborted,
  );
  const results = settled.map((entry, index) => (entry && 'value' in entry
    ? entry.value
    : interruptedResult(entry, slots[index].params.material_id)));
  return { results, added };
}

function summarize(results: SlotResult[]) {
  const clips = results.flatMap((result, index) => result.success
    ? [{
        index, sourceMaterialId: result.sourceMaterialId,
        materialId: result.materialId, duration: result.duration,
        effect: result.effect, reused: result.reused,
      }]
    : []);
  const failed = results.flatMap((result, index) => result.success
    ? []
    : [{
        index, sourceMaterialId: result.sourceMaterialId,
        error_code: result.error_code, retryable: result.retryable,
        error: result.error,
      }]);
  return { clips, failed };
}

async function withDeadline<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new DOMException('batch image-to-video timed out', 'TimeoutError')),
      milliseconds,
    );
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function createBatchImageToVideoTool(
  context: ToolContext,
): AgentTool<typeof parameters> {
  return {
    name: 'batch_image_to_video',
    label: 'Batch Image to Video',
    description:
      'Turn up to 12 image materials into full-frame video clips in one call (slideshows, picture stories). ' +
      'Results keep input order; add_to_track each returned materialId in that order. ' +
      'Failed items are listed in failed[] — report them, do not substitute other images.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      const slots = params.items.map((item, index) => {
        const resolved = resolveBatchItem(item, index, params.defaults);
        return { params: resolved, key: dedupeKey(resolved) };
      });
      const { results, added } = await withDeadline(
        convertAll(context, slots), BATCH_TIMEOUT_MS);
      if (added.length > 0) {
        context.recordOperation(toolCallId, { type: 'add_materials', materials: added });
      }
      const { clips, failed } = summarize(results);
      return stillToolResponse({
        success: clips.length > 0,
        partial: clips.length > 0 && failed.length > 0,
        clips,
        failed,
        next_step: clips.length > 0
          ? 'add_to_track each clips[].materialId in order'
          : 'Nothing converted; read failed[] and report it',
      });
    },
  };
}
