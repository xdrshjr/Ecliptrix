import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as httpModule from '@/lib/api/http-client';
import {
  createVideoProject,
  createVideoProjectCategory,
  deleteVideoProject,
  deleteVideoProjectCategory,
  getVideoProject,
  listVideoProjects,
  listVideoProjectCategories,
  normaliseProjectDataForSave,
  updateVideoProject,
  updateVideoProjectCategory,
} from '../videoProjects';
import type { VideoEditingTaskContent } from '@/types';

const okEnvelope = <T,>(data: T) =>
  ({ success: true, message: 'ok', data }) as never;

describe('videoProjects API client', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  // ── Categories ─────────────────────────────────────────────────────────

  it('listVideoProjectCategories hits /api/video-projects/categories via GET', async () => {
    const spy = vi
      .spyOn(httpModule.http, 'get')
      .mockResolvedValue(okEnvelope([]));
    const result = await listVideoProjectCategories();
    expect(spy).toHaveBeenCalledWith('/api/video-projects/categories');
    expect(result).toEqual([]);
  });

  it('createVideoProjectCategory POSTs the body', async () => {
    const spy = vi
      .spyOn(httpModule.http, 'post')
      .mockResolvedValue(okEnvelope({
        id: 'c1',
        name: 'X',
        sort_order: 0,
        created_at: 't',
        updated_at: 't',
      }));
    await createVideoProjectCategory({ name: 'X' });
    expect(spy).toHaveBeenCalledWith('/api/video-projects/categories', {
      name: 'X',
    });
  });

  it('updateVideoProjectCategory PUTs to a path-encoded id', async () => {
    const spy = vi
      .spyOn(httpModule.http, 'put')
      .mockResolvedValue(okEnvelope({
        id: 'c1',
        name: 'Y',
        sort_order: 0,
        created_at: 't',
        updated_at: 't',
      }));
    await updateVideoProjectCategory('a/b', { name: 'Y' });
    expect(spy).toHaveBeenCalledWith(
      '/api/video-projects/categories/a%2Fb',
      { name: 'Y' },
    );
  });

  it('deleteVideoProjectCategory DELETEs', async () => {
    const spy = vi
      .spyOn(httpModule.http, 'del')
      .mockResolvedValue(okEnvelope(null));
    await deleteVideoProjectCategory('c1');
    expect(spy).toHaveBeenCalledWith('/api/video-projects/categories/c1');
  });

  // ── Projects ───────────────────────────────────────────────────────────

  it('listVideoProjects with no params hits a clean GET', async () => {
    const spy = vi
      .spyOn(httpModule.http, 'get')
      .mockResolvedValue(okEnvelope({ items: [], total: 0, limit: 100, offset: 0 }));
    await listVideoProjects();
    expect(spy).toHaveBeenCalledWith('/api/video-projects');
  });

  it('listVideoProjects encodes params as querystring', async () => {
    const spy = vi
      .spyOn(httpModule.http, 'get')
      .mockResolvedValue(okEnvelope({ items: [], total: 0, limit: 50, offset: 25 }));
    await listVideoProjects({
      category_id: 'c1',
      search: 'hi there',
      sort: 'name',
      limit: 50,
      offset: 25,
    });
    const url = (spy.mock.calls[0]?.[0] as string) || '';
    expect(url.startsWith('/api/video-projects?')).toBe(true);
    expect(url).toContain('category_id=c1');
    expect(url).toContain('search=hi+there');
    expect(url).toContain('sort=name');
    expect(url).toContain('limit=50');
    expect(url).toContain('offset=25');
  });

  it('createVideoProject POSTs the body and never sends user_id', async () => {
    const spy = vi
      .spyOn(httpModule.http, 'post')
      .mockResolvedValue(okEnvelope({
        id: 'p1',
        name: 'X',
        created_at: 't',
        updated_at: 't',
      }));
    await createVideoProject({ name: 'X', description: 'd' });
    const [, body] = spy.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.name).toBe('X');
    expect(body).not.toHaveProperty('user_id');
  });

  it('getVideoProject hits the encoded id', async () => {
    const spy = vi
      .spyOn(httpModule.http, 'get')
      .mockResolvedValue(okEnvelope({
        id: 'p 1',
        name: 'X',
        created_at: 't',
        updated_at: 't',
      }));
    await getVideoProject('p 1');
    expect(spy).toHaveBeenCalledWith('/api/video-projects/p%201');
  });

  it('updateVideoProject PUTs', async () => {
    const spy = vi
      .spyOn(httpModule.http, 'put')
      .mockResolvedValue(okEnvelope({
        id: 'p1',
        name: 'X',
        created_at: 't',
        updated_at: 't',
      }));
    await updateVideoProject('p1', { name: 'X' });
    expect(spy).toHaveBeenCalledWith('/api/video-projects/p1', { name: 'X' });
  });

  it('deleteVideoProject DELETEs', async () => {
    const spy = vi
      .spyOn(httpModule.http, 'del')
      .mockResolvedValue(okEnvelope(null));
    await deleteVideoProject('p1');
    expect(spy).toHaveBeenCalledWith('/api/video-projects/p1');
  });
});

describe('normaliseProjectDataForSave (R-M)', () => {
  it('strips pendingTimelineData and pendingMaterials', () => {
    const content = {
      markdownContent: 'hello',
      lastModified: new Date('2026-01-01T00:00:00Z'),
      pendingTimelineData: { foo: 1 },
      pendingMaterials: [{ id: 'm1' }],
    } as unknown as VideoEditingTaskContent;
    const out = normaliseProjectDataForSave(content);
    expect(out).not.toHaveProperty('pendingTimelineData');
    expect(out).not.toHaveProperty('pendingMaterials');
    expect(out.markdownContent).toBe('hello');
  });

  it('strips transient uiState flags but keeps stable ones', () => {
    const content = {
      markdownContent: '',
      lastModified: new Date(),
      uiState: {
        isPolishModalOpen: true,
        isAIMixing: true,
        videoCutModal: { isOpen: true, material: null },
        timelineCurrentTime: 12.5,
        agentMode: false,
      },
    } as unknown as VideoEditingTaskContent;
    const out = normaliseProjectDataForSave(content);
    const ui = out.uiState as Record<string, unknown>;
    expect(ui).not.toHaveProperty('isPolishModalOpen');
    expect(ui).not.toHaveProperty('isAIMixing');
    expect(ui).not.toHaveProperty('videoCutModal');
    expect(ui.timelineCurrentTime).toBe(12.5);
    expect(ui.agentMode).toBe(false);
  });

  it('serialises Date lastModified to ISO', () => {
    const content = {
      markdownContent: '',
      lastModified: new Date('2026-04-29T00:00:00Z'),
    } as unknown as VideoEditingTaskContent;
    const out = normaliseProjectDataForSave(content);
    expect(typeof out.lastModified).toBe('string');
    expect(out.lastModified).toBe('2026-04-29T00:00:00.000Z');
  });

  it('returns {} for null/undefined input', () => {
    expect(normaliseProjectDataForSave(null)).toEqual({});
    expect(normaliseProjectDataForSave(undefined)).toEqual({});
  });
});
