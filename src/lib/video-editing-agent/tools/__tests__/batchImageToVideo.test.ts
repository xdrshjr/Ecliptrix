import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MaterialItem } from '@/types';
import type { ToolContext } from '../../types';
import {
  BATCH_CONCURRENCY, MAX_BATCH_ITEMS, createBatchImageToVideoTool, resolveBatchItem,
} from '../batchImageToVideo';

function image(id: string): MaterialItem {
  return {
    id, name: `${id}.jpg`, type: 'image', format: 'jpg', size: 1,
    url: `/api/storage/files/uploads/images/${id}.jpg`, createdAt: new Date(),
  } as MaterialItem;
}

function makeContext(ids: string[], abortSignal?: AbortSignal) {
  const recordOperation = vi.fn();
  const context = {
    materials: ids.map(image), operations: new Map(), abortSignal,
    apiBaseUrl: 'http://127.0.0.1:3000', recordOperation, updateTimeline: vi.fn(),
    turnState: {}, callBudget: { used: 0 },
  } as unknown as ToolContext;
  return { context, recordOperation };
}

/** The 16-hex content key a backend would derive from a source image id. */
function keyFor(storageKey: string, effect: string, duration: number): string {
  let hash = 0;
  for (const char of `${storageKey}|${effect}|${duration}`) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash.toString(16).padStart(8, '0').repeat(2);
}

interface Tracker { inFlight: number; peak: number; bodies: Array<Record<string, unknown>> }

function stubBackend(options: {
  delay?: number;
  fail?: (body: Record<string, unknown>) => string | undefined;
} = {}): Tracker {
  const tracker: Tracker = { inFlight: 0, peak: 0, bodies: [] };
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    tracker.bodies.push(body);
    tracker.inFlight += 1;
    tracker.peak = Math.max(tracker.peak, tracker.inFlight);
    await new Promise(resolve => setTimeout(resolve, options.delay ?? 5));
    tracker.inFlight -= 1;
    const code = options.fail?.(body);
    if (code) {
      return new Response(JSON.stringify({ success: false, message: code, error_code: code }));
    }
    const key = keyFor(String(body.storage_key), String(body.effect), Number(body.duration));
    return new Response(JSON.stringify({
      success: true, video_url: `/api/storage/files/video/generated/i2v_${key}.mp4`,
      storage_key: `video/generated/i2v_${key}.mp4`, duration: body.duration,
      width: 1920, height: 1080, reused: false,
    }));
  }));
  return tracker;
}

const run = (context: ToolContext, params: Record<string, unknown>) =>
  createBatchImageToVideoTool(context).execute('call-1', params as never);

interface Summary {
  success: boolean; partial: boolean;
  clips: Array<{ index: number; sourceMaterialId: string; materialId: string }>;
  failed: Array<{ index: number; sourceMaterialId: string; error_code: string }>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('batch_image_to_video', () => {
  it('returns clips in input order even when later items finish first', async () => {
    const ids = ['a', 'b', 'c', 'd'];
    const { context } = makeContext(ids);
    const delays: Record<string, number> = { 'uploads/images/a.jpg': 40, 'uploads/images/b.jpg': 1 };
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      await new Promise(resolve => setTimeout(resolve, delays[body.storage_key] ?? 1));
      const key = keyFor(body.storage_key, body.effect, body.duration);
      return new Response(JSON.stringify({
        success: true, video_url: `/api/storage/files/video/generated/i2v_${key}.mp4`,
        storage_key: `video/generated/i2v_${key}.mp4`, duration: body.duration,
      }));
    }));

    const result = await run(context, { items: ids.map(material_id => ({ material_id })) });
    const summary = result.details as Summary;

    expect(summary.clips.map(clip => clip.sourceMaterialId)).toEqual(ids);
    expect(summary.clips.map(clip => clip.index)).toEqual([0, 1, 2, 3]);
  });

  it('never has more than two conversions in flight', async () => {
    const ids = Array.from({ length: 8 }, (_, index) => `m${index}`);
    const { context } = makeContext(ids);
    const tracker = stubBackend({ delay: 15 });

    await run(context, { items: ids.map(material_id => ({ material_id })) });

    expect(BATCH_CONCURRENCY).toBe(2);
    expect(tracker.peak).toBeLessThanOrEqual(2);
    expect(tracker.bodies).toHaveLength(8);
  });

  it('records ONE add_materials operation holding every new clip', async () => {
    const { context, recordOperation } = makeContext(['a', 'b', 'c']);
    stubBackend();

    await run(context, { items: ['a', 'b', 'c'].map(material_id => ({ material_id })) });

    expect(recordOperation).toHaveBeenCalledTimes(1);
    const [, operation] = recordOperation.mock.calls[0];
    expect(operation.type).toBe('add_materials');
    expect(operation.materials).toHaveLength(3);
    expect(context.materials.filter(m => m.type === 'video')).toHaveLength(3);
  });

  it('reports a partial result and keeps the successful clips', async () => {
    const { context } = makeContext(['a', 'b', 'c']);
    stubBackend({ fail: body => (String(body.storage_key).includes('/b.') ? 'IMAGE_UNREADABLE' : undefined) });

    const result = await run(context, { items: ['a', 'b', 'c'].map(material_id => ({ material_id })) });
    const summary = result.details as Summary;

    expect(summary).toMatchObject({ success: true, partial: true });
    expect(summary.clips.map(clip => clip.sourceMaterialId)).toEqual(['a', 'c']);
    expect(summary.failed).toEqual([expect.objectContaining({
      index: 1, sourceMaterialId: 'b', error_code: 'image_unreadable',
    })]);
  });

  it('fails as a whole when nothing converts', async () => {
    const { context, recordOperation } = makeContext(['a', 'b']);
    stubBackend({ fail: () => 'FFMPEG_UNAVAILABLE' });

    const result = await run(context, { items: [{ material_id: 'a' }, { material_id: 'b' }] });

    expect(result.details).toMatchObject({ success: false, partial: false, clips: [] });
    expect(recordOperation).not.toHaveBeenCalled();
  });

  it('converts an identical item once and fans the clip out to both entries', async () => {
    const { context } = makeContext(['a']);
    const tracker = stubBackend();

    const result = await run(context, {
      items: [{ material_id: 'a', effect: 'static' }, { material_id: 'a', effect: 'static' }],
    });
    const summary = result.details as Summary;

    expect(tracker.bodies).toHaveLength(1);
    expect(summary.clips).toHaveLength(2);
    expect(summary.clips[0].materialId).toBe(summary.clips[1].materialId);
    expect(context.materials.filter(m => m.type === 'video')).toHaveLength(1);
  });

  it('does not start items that have not begun once the run is aborted', async () => {
    const controller = new AbortController();
    const ids = Array.from({ length: 6 }, (_, index) => `m${index}`);
    const { context } = makeContext(ids, controller.signal);
    const tracker = stubBackend({ delay: 20 });

    const pending = run(context, { items: ids.map(material_id => ({ material_id })) });
    setTimeout(() => controller.abort(), 5);
    const result = await pending;
    const summary = result.details as Summary;

    expect(tracker.bodies.length).toBeLessThan(6);
    expect(summary.failed.length).toBeGreaterThan(0);
    expect(summary.failed.every(entry => entry.error_code === 'request_failed')).toBe(true);
  });

  it('lets an unknown material fail alone', async () => {
    const { context } = makeContext(['a']);
    stubBackend();

    const result = await run(context, { items: [{ material_id: 'a' }, { material_id: 'ghost' }] });

    expect(result.details).toMatchObject({
      partial: true,
      failed: [{ index: 1, error_code: 'material_not_found' }],
    });
  });

  it('declares the 12-item ceiling in its schema', () => {
    const tool = createBatchImageToVideoTool(makeContext([]).context);
    const items = (tool.parameters as { properties: { items: { maxItems: number; minItems: number } } })
      .properties.items;
    expect(MAX_BATCH_ITEMS).toBe(12);
    expect(items.maxItems).toBe(12);
    expect(items.minItems).toBe(1);
  });

  it('forwards defaults (duration, aspect ratio) to every item', async () => {
    const { context } = makeContext(['a', 'b']);
    const tracker = stubBackend();

    await run(context, {
      items: [{ material_id: 'a' }, { material_id: 'b', duration: 3 }],
      defaults: { duration: 4, aspect_ratio: '9:16' },
    });

    const durations = tracker.bodies.map(body => body.duration).sort();
    expect(durations).toEqual([3, 4]);
    expect(tracker.bodies.every(body => body.aspect_ratio === '9:16')).toBe(true);
  });
});

describe('resolveBatchItem variety', () => {
  const items = Array.from({ length: 5 }, (_, index) => ({ material_id: `m${index}` }));

  it('alternates push and pan by index when nothing is specified', () => {
    const moves = items.map((item, index) => resolveBatchItem(item, index, undefined));
    expect(moves.map(m => [m.effect, m.direction])).toEqual([
      ['ken_burns', 'zoom_in'], ['pan', 'left_to_right'],
      ['ken_burns', 'zoom_out'], ['pan', 'right_to_left'],
      ['ken_burns', 'zoom_in'],
    ]);
  });

  it('is deterministic, so a retry asks for identical clips', () => {
    const first = items.map((item, index) => resolveBatchItem(item, index, undefined));
    const again = items.map((item, index) => resolveBatchItem(item, index, undefined));
    expect(again).toEqual(first);
  });

  it('can be switched off', () => {
    const move = resolveBatchItem(items[1], 1, { variety: false });
    expect(move.effect).toBeUndefined();
    expect(move.direction).toBeUndefined();
  });

  it('never overrides an explicit effect or direction', () => {
    expect(resolveBatchItem({ material_id: 'x', effect: 'static' }, 1, undefined))
      .toMatchObject({ effect: 'static' });
    expect(resolveBatchItem({ material_id: 'x', direction: 'zoom_out' }, 1, undefined).effect)
      .toBeUndefined();
  });

  it('honours a default effect instead of cycling', () => {
    const move = resolveBatchItem(items[1], 1, { effect: 'ken_burns' });
    expect(move).toMatchObject({ effect: 'ken_burns' });
    expect(move.direction).toBeUndefined();
  });
});
