import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MaterialItem } from '@/types';
import type { ToolContext } from '../../types';
import { createImageToVideoTool } from '../imageToVideo';
import { buildStillClipRequest, stillMaterialId } from '../stillClip';

const KEY = '3f9a1c0b2e7d4a55';

function image(overrides: Partial<MaterialItem> = {}): MaterialItem {
  return {
    id: 'photo', name: 'sunset.jpg', type: 'image', format: 'jpg', size: 1,
    url: '/api/storage/files/uploads/images/sunset.jpg', createdAt: new Date(),
    ...overrides,
  } as MaterialItem;
}

function makeContext(materials: MaterialItem[]) {
  const recordOperation = vi.fn();
  const context = {
    materials, operations: new Map(), apiBaseUrl: 'http://127.0.0.1:3000',
    recordOperation, updateTimeline: vi.fn(), turnState: {}, callBudget: { used: 0 },
  } as unknown as ToolContext;
  return { context, recordOperation };
}

function backendOk(extra: Record<string, unknown> = {}) {
  return {
    success: true, message: 'ok',
    video_url: `/api/storage/files/video/generated/i2v_${KEY}.mp4`,
    storage_key: `video/generated/i2v_${KEY}.mp4`,
    thumbnail_url: `/api/storage/files/video/generated/i2v_${KEY}_thumb.jpg`,
    file_size: 1234, duration: 5, width: 1920, height: 1080,
    effect_applied: 'ken_burns', reused: false, ...extra,
  };
}

function stubFetch(body: unknown, status = 200) {
  const fetch = vi.fn().mockImplementation(async () =>
    new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const run = (context: ToolContext, params: Record<string, unknown>, id = 'call-1') =>
  createImageToVideoTool(context).execute(id, { material_id: 'photo', ...params } as never);

const sentBody = (fetch: ReturnType<typeof vi.fn>) => JSON.parse(fetch.mock.calls[0][1].body);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('image_to_video', () => {
  it('returns a deterministic materialId usable by add_to_track in the same turn', async () => {
    const { context, recordOperation } = makeContext([image()]);
    stubFetch(backendOk());

    const result = await run(context, {});

    expect(result.details).toMatchObject({
      success: true,
      materialId: `i2v-${KEY}`,
      sourceMaterialId: 'photo',
      duration: 5, width: 1920, height: 1080,
      effect: 'ken_burns', reused: false,
      next_step: `add_to_track({ materialId: "i2v-${KEY}" })`,
    });
    const added = context.materials.find(m => m.id === `i2v-${KEY}`);
    expect(added).toMatchObject({
      type: 'video', format: 'mp4', storageKey: `video/generated/i2v_${KEY}.mp4`,
      metadata: { storageKind: 'local', generatedFromImage: true, sourceMaterialId: 'photo' },
    });
    expect(recordOperation).toHaveBeenCalledWith('call-1', {
      type: 'add_material', material: added,
    });
  });

  it('sends the storage key for a same-origin local image (never a relative URL)', async () => {
    const { context } = makeContext([image()]);
    const fetch = stubFetch(backendOk());

    await run(context, { aspect_ratio: '16:9', duration: 4, focus_x: 0.2 });

    expect(sentBody(fetch)).toEqual({
      storage_key: 'uploads/images/sunset.jpg',
      effect: 'ken_burns', duration: 4, focus_x: 0.2, aspect_ratio: '16:9',
    });
  });

  it('falls back to image_url for a remote image', async () => {
    const { context } = makeContext([image({ url: 'https://images.example.com/a.jpg' })]);
    const fetch = stubFetch(backendOk());

    await run(context, {});

    expect(sentBody(fetch)).toMatchObject({ image_url: 'https://images.example.com/a.jpg' });
    expect(sentBody(fetch)).not.toHaveProperty('storage_key');
  });

  it('is idempotent: a repeat call adds and records nothing new', async () => {
    const { context, recordOperation } = makeContext([image()]);
    stubFetch(backendOk());
    await run(context, {}, 'call-1');
    stubFetch(backendOk({ reused: true }));

    const second = await run(context, {}, 'call-2');

    expect(second.details).toMatchObject({ success: true, materialId: `i2v-${KEY}`, reused: true });
    expect(context.materials.filter(m => m.id === `i2v-${KEY}`)).toHaveLength(1);
    expect(recordOperation).toHaveBeenCalledTimes(1);
  });

  it('still registers a backend-cached clip the library does not know yet', async () => {
    const { context, recordOperation } = makeContext([image()]);
    stubFetch(backendOk({ reused: true }));

    const result = await run(context, {});

    expect(result.details).toMatchObject({ reused: true });
    expect(context.materials.some(m => m.id === `i2v-${KEY}`)).toBe(true);
    expect(recordOperation).toHaveBeenCalledTimes(1);
  });

  it('notes and drops a direction that does not belong to the effect', async () => {
    const { context } = makeContext([image()]);
    const fetch = stubFetch(backendOk({ effect_applied: 'static' }));

    const result = await run(context, { effect: 'static', direction: 'zoom_in' });

    expect(sentBody(fetch)).not.toHaveProperty('ken_burns_direction');
    expect((result.details as { notes: string[] }).notes[0]).toContain('zoom_in');
  });

  it('maps the direction to the right backend field per effect', () => {
    const kenBurns = buildStillClipRequest(image(), {
      material_id: 'photo', effect: 'ken_burns', direction: 'zoom_out',
    });
    const pan = buildStillClipRequest(image(), {
      material_id: 'photo', effect: 'pan', direction: 'right_to_left',
    });
    expect('body' in kenBurns && kenBurns.body).toMatchObject({ ken_burns_direction: 'zoom_out' });
    expect('body' in pan && pan.body).toMatchObject({ pan_direction: 'right_to_left' });
  });

  it('clamps the duration into 1-30 seconds', () => {
    const request = buildStillClipRequest(image(), { material_id: 'photo', duration: 99 });
    expect('body' in request && request.body.duration).toBe(30);
  });

  it('refuses a material that is not in the library', async () => {
    const { context } = makeContext([]);
    const fetch = stubFetch(backendOk());

    const result = await run(context, { material_id: 'ghost' });

    expect(result.details).toMatchObject({ success: false, error_code: 'material_not_found' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a video material and points at add_to_track', async () => {
    const { context } = makeContext([image({ type: 'video' })]);
    const fetch = stubFetch(backendOk());

    const result = await run(context, {});

    expect(result.details).toMatchObject({
      success: false, error_code: 'not_an_image', hint: expect.stringContaining('add_to_track'),
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['blob:http://localhost/abc', 'data:image/png;base64,AAAA'])(
    'refuses %s without calling the backend', async url => {
      const { context } = makeContext([image({ url })]);
      const fetch = stubFetch(backendOk());

      const result = await run(context, {});

      expect(result.details).toMatchObject({ success: false, error_code: 'image_not_local' });
      expect(fetch).not.toHaveBeenCalled();
    });

  it.each([
    ['IMAGE_UNREADABLE', 'image_unreadable', false],
    ['IMAGE_TOO_LARGE', 'image_too_large', false],
    ['IMAGE_NOT_FOUND', 'material_not_found', false],
    ['FFMPEG_UNAVAILABLE', 'ffmpeg_unavailable', false],
    ['QUEUE_TIMEOUT', 'queue_timeout', true],
    ['FFMPEG_ERROR', 'conversion_failed', true],
    ['CONVERSION_ERROR', 'conversion_failed', true],
    ['INVALID_ARGUMENT', 'request_failed', false],
  ])('maps backend %s to %s (retryable %s)', async (backendCode, agentCode, retryable) => {
    const { context } = makeContext([image()]);
    stubFetch({ success: false, message: 'nope', error_code: backendCode });

    const result = await run(context, {});

    expect(result.details).toMatchObject({
      success: false, error_code: agentCode, retryable, hint: expect.any(String),
      sourceMaterialId: 'photo',
    });
    expect(context.materials).toHaveLength(1);
  });

  it('tells the model how to degrade when FFmpeg is missing, without hiding it', async () => {
    const { context } = makeContext([image()]);
    stubFetch({ success: false, message: 'no ffmpeg', error_code: 'FFMPEG_UNAVAILABLE' });

    const result = await run(context, {});

    expect((result.details as { hint: string }).hint).toMatch(/tell the user/i);
    expect((result.details as { hint: string }).hint).toContain('as_still:true');
  });

  it('reports an HTTP failure with its status', async () => {
    const { context } = makeContext([image()]);
    stubFetch({ detail: 'bad gateway' }, 502);

    const result = await run(context, {});

    expect(result.details).toMatchObject({
      success: false, error_code: 'request_failed', retryable: true,
      error: expect.stringContaining('502'),
    });
  });

  it('turns a client timeout into queue_timeout', async () => {
    const { context } = makeContext([image()]);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('t', 'TimeoutError')));

    const result = await run(context, {});

    expect(result.details).toMatchObject({ success: false, error_code: 'queue_timeout', retryable: true });
  });

  it('survives a network error without registering anything', async () => {
    const { context, recordOperation } = makeContext([image()]);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const result = await run(context, {});

    expect(result.details).toMatchObject({ success: false, error_code: 'request_failed' });
    expect(recordOperation).not.toHaveBeenCalled();
  });

  it('rejects a success body that carries no usable video', async () => {
    const { context } = makeContext([image()]);
    stubFetch({ success: true, message: 'ok' });

    const result = await run(context, {});

    expect(result.details).toMatchObject({ success: false });
  });

  it('keeps the text and details payloads identical', async () => {
    const { context } = makeContext([image()]);
    stubFetch(backendOk());
    const result = await run(context, {});
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(result.details);
  });
});

describe('stillMaterialId', () => {
  it('derives the id from the content-addressed file name', () => {
    expect(stillMaterialId({ storage_key: `video/generated/i2v_${KEY}.mp4` })).toBe(`i2v-${KEY}`);
    expect(stillMaterialId({ video_url: `/api/storage/files/video/generated/i2v_${KEY}.mp4` }))
      .toBe(`i2v-${KEY}`);
  });

  it('returns undefined for a name that is not content addressed', () => {
    expect(stillMaterialId({ storage_key: 'video/generated/legacy.mp4' })).toBeUndefined();
  });
});
