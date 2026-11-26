// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Type, validateToolArguments } from '@mariozechner/pi-ai';
import { createBrowserTools, BROWSER_IMAGE_SAVE_TIMEOUT_MS,
  BROWSER_READ_IMAGES_TIMEOUT_MS } from '../browserTools';
import type { ToolContext } from '../../types';

/**
 * `docs/plans/agent-browser-image-ingest/spec.md` AC-I4 / AC-I9 / AC-I10 / AC-I13:
 * the save tool must accept only a closed-set `image_id`, must publish exactly one
 * `add_materials` through `executeWebTool(importMaterial:'record')`, and must stay
 * registered under YOLO because it never waits on a human.
 */
const toolFetch = vi.hoisted(() => vi.fn());
vi.mock('../apiHelper', () => ({ toolFetch }));

const SID = '123e4567-e89b-42d3-a456-426614174000';

const MATERIAL = {
  id: 'web-abc', name: '新闻配图', type: 'image', format: 'png', size: 2048,
  width: 1600, height: 900, created_at: '2026-11-26T00:00:00Z',
  local_url: '/api/storage/files/cached_materials/web/x.png',
  provenance: { source: 'workspace', via: 'workspace_tab', tab_id: SID,
    source_page_url: 'https://x.test/news/1' },
};

function makeContext(extra: Partial<ToolContext> = {}): ToolContext {
  return { timelineState: {} as never, materials: [], apiBaseUrl: 'http://127.0.0.1:3000',
    operations: new Map(), updateTimeline: () => ({ applied: true as const }),
    recordOperation: vi.fn(), turnState: {}, callBudget: { used: 0 },
    researchRun: { lostReason: null, markLost: vi.fn(),
      headers: async () => ({ 'x-research-run': 'r' }), cancelCall: vi.fn(),
      controller: new AbortController() } as never, ...extra };
}

function validate(name: string, args: Record<string, unknown>, autonomy?: 'yolo'): boolean {
  const tool = createBrowserTools(makeContext({ autonomy })).find(item => item.name === name);
  if (!tool) return false;
  try {
    validateToolArguments(tool as never,
      { type: 'toolCall', id: 'x', name, arguments: args } as never);
    return true;
  } catch { return false; }
}

describe('browser_save_image schema (AC-I4)', () => {
  it('accepts a closed-set image_id and the optional fields', () => {
    expect(validate('browser_save_image', { session_id: SID, image_id: 'i1' })).toBe(true);
    expect(validate('browser_save_image', { session_id: SID, image_id: 'i99',
      name: '图', snapshot_version: 3 })).toBe(true);
  });

  it('rejects any URL, so the shape layer never forwards a remote target', () => {
    // `pattern` blocks the shape; the backend closed set blocks ownership. Two
    // independent layers — neither claims to stop SSRF alone (spec P1-8).
    expect(validate('browser_save_image', { session_id: SID, image_id: 'http://evil.test/a.jpg' }))
      .toBe(false);
    expect(validate('browser_save_image', { session_id: SID, image_id: 'i100' })).toBe(false);
    expect(validate('browser_save_image', { session_id: SID, image_id: 'i0' })).toBe(false);
    expect(validate('browser_save_image', { session_id: SID, image_id: 'e1' })).toBe(false);
    expect(validate('browser_save_image', { session_id: SID })).toBe(false);
  });

  it('keeps the description within 120 characters (AC-I13)', () => {
    const tool = createBrowserTools(makeContext())
      .find(item => item.name === 'browser_save_image')!;
    expect(Buffer.byteLength(tool.description, 'utf8')).toBeLessThanOrEqual(120);
  });

  it('is registered under YOLO because it never waits on a human (AC-I10)', () => {
    const names = createBrowserTools(makeContext({ autonomy: 'yolo' }))
      .map(tool => tool.name);
    expect(names).toContain('browser_save_image');
    expect(names).not.toContain('browser_request_user');
  });

  it('extends browser_read with the image parameters, keeping legacy calls valid', () => {
    expect(validate('browser_read', { session_id: SID })).toBe(true);
    expect(validate('browser_read', { session_id: SID, images: true })).toBe(true);
    expect(validate('browser_read', { session_id: SID, images: true, images_max: 100 })).toBe(true);
    expect(validate('browser_read', { session_id: SID, images_max: 10 })).toBe(false);
  });

  /**
   * Regression: `browser_read {images:true}` runs two main-process commands
   * (snapshot + images, 10 s each) and the route budget is now 25 s, so the
   * old flat 15 000 ms frontend ceiling sat inside the backend's own worst
   * case and would have timed the call out first.
   */
  it('gives an image read a longer ceiling than a plain read (AC-I20)', async () => {
    toolFetch.mockReset();
    toolFetch.mockImplementation(async () => Response.json(
      { success: true, data: { text: '', elements: [], images: [] } }));
    const read = createBrowserTools(makeContext()).find(tool => tool.name === 'browser_read')!;
    await read.execute('c1', { session_id: SID } as never);
    await read.execute('c2', { session_id: SID, images: true } as never);
    const plain = toolFetch.mock.calls[0]![2] as { timeout: number };
    const withImages = toolFetch.mock.calls[1]![2] as { timeout: number };
    expect(plain.timeout).toBe(15_000);
    expect(withImages.timeout).toBe(BROWSER_READ_IMAGES_TIMEOUT_MS);
    expect(BROWSER_READ_IMAGES_TIMEOUT_MS).toBeGreaterThan(plain.timeout);
  });
});

describe('browser_save_image execution (AC-I9)', () => {
  beforeEach(() => {
    toolFetch.mockReset();
    toolFetch.mockImplementation(async () => Response.json(
      { success: true, data: { status: 'ready', material: MATERIAL } }));
  });

  const call = async (context: ToolContext, args: Record<string, unknown>) => {
    const tool = createBrowserTools(context).find(item => item.name === 'browser_save_image')!;
    return await tool.execute('call-1', { session_id: SID, ...args } as never);
  };

  it('publishes exactly one add_materials with cacheStatus filled by localMaterial', async () => {
    const context = makeContext();
    const result = await call(context, { image_id: 'i3' });
    expect(context.recordOperation).toHaveBeenCalledTimes(1);
    const [, operation] = (context.recordOperation as never as
      { mock: { calls: [string, { type: string; materials: unknown[] }][] } })
      .mock.calls[0];
    expect(operation.type).toBe('add_materials');
    expect(operation.materials).toHaveLength(1);
    // `cacheStatus:'ready'` and `storageKind` come from webToolAdapter.localMaterial,
    // which is exactly why a hand-written recordOperation is forbidden (spec P1-6).
    expect(operation.materials[0]).toMatchObject({
      id: 'web-abc', cacheStatus: 'ready',
      metadata: { source: 'web', storageKind: 'cached_remote' } });
    expect((result.details as { success: boolean }).success).toBe(true);
  });

  it('uses the 60 000 ms timeout, not the 140 000 ms human-wait chain (AC-I20)', async () => {
    await call(makeContext(), { image_id: 'i1' });
    const options = toolFetch.mock.calls[0]![2] as { timeout: number };
    expect(options.timeout).toBe(60_000);
    expect(options.timeout).toBe(BROWSER_IMAGE_SAVE_TIMEOUT_MS);
  });

  it('posts to the session-scoped save-image path', async () => {
    await call(makeContext(), { image_id: 'i2' });
    expect(toolFetch.mock.calls[0]![1]).toBe(
      `/api/web-research/browser/${SID}/save-image`);
  });

  /**
   * Regression: the first cut sent `body: params`, which echoed `session_id`
   * into the body. `BrowserSaveImageRequest` is `extra="forbid"`, so the real
   * call answered 422 `extra_forbidden` — both unit suites passed while the
   * chain could never succeed, because each side was tested alone.
   */
  it('keeps session_id out of the body (extra="forbid" on the backend)', async () => {
    await call(makeContext(), { image_id: 'i2', name: '图' });
    const body = toolFetch.mock.calls[0]![2] as { body: string };
    expect(JSON.parse(body.body)).toEqual({ image_id: 'i2', name: '图' });
    expect(JSON.parse(body.body)).not.toHaveProperty('session_id');
  });

  it('omits absent optional fields instead of sending null or empty keys', async () => {
    await call(makeContext(), { image_id: 'i1' });
    const body = toolFetch.mock.calls[0]![2] as { body: string };
    expect(JSON.parse(body.body)).toStrictEqual({ image_id: 'i1' });
  });

  it('passes a backend error code straight through and publishes nothing', async () => {
    toolFetch.mockImplementation(async () => Response.json({ success: false,
      error_code: 'inline_image_unsupported',
      error_details: { failure_class: 'policy', retryable: false } }, { status: 400 }));
    const context = makeContext();
    const result = await call(context, { image_id: 'i1' });
    expect((result.details as { error_code: string }).error_code)
      .toBe('inline_image_unsupported');
    expect(context.recordOperation).not.toHaveBeenCalled();
  });

  it('does not re-publish a material that is already in the library', async () => {
    const context = makeContext({ materials: [{ id: 'web-abc' } as never] });
    const result = await call(context, { image_id: 'i1' });
    expect(context.recordOperation).not.toHaveBeenCalled();
    expect((result.details as { already_in_library: boolean }).already_in_library).toBe(true);
  });
});
