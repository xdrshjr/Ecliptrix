/**
 * normaliseProjectDataForSave — inline `data:` thumbnail stripping
 * (local-upload-video-thumbnail-fix §3.2 E1 / RV-1, file change plan #10).
 *
 * Client-side canvas posters live only in memory; embedding the base64 in the
 * autosave PUT payload would bloat the project JSON and re-transmit kilobytes
 * of derived data on every save (violating spec 06 §2.1). They must be stripped
 * before serialisation, while real backend posters (`/api/storage/files/...`)
 * are preserved verbatim.
 */
import { describe, it, expect } from 'vitest';
import { normaliseProjectDataForSave } from '../videoProjects';
import type { VideoEditingTaskContent } from '@/types';

const DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ';
const BACKEND_POSTER = '/api/storage/files/static/video/thumbnails/uuid/poster.jpg';

describe('normaliseProjectDataForSave — inline data: thumbnail stripping (RV-1)', () => {
  it('(a) removes a material thumbnailUrl that is a data: URL', () => {
    const content = {
      markdownContent: '',
      lastModified: new Date('2026-06-11T00:00:00Z'),
      materials: [
        {
          id: 'm1', name: 'a.mp4', type: 'video',
          thumbnailUrl: DATA_URL, metadata: { thumbnailSource: 'client' },
        },
      ],
    } as unknown as VideoEditingTaskContent;

    const out = normaliseProjectDataForSave(content);
    const mats = out.materials as Array<Record<string, unknown>>;
    expect(mats[0]).not.toHaveProperty('thumbnailUrl');
    expect(mats[0].id).toBe('m1'); // other fields untouched
  });

  it('(b) keeps a backend poster thumbnailUrl (non-data:)', () => {
    const content = {
      markdownContent: '',
      lastModified: new Date(),
      materials: [{ id: 'm1', name: 'a.mp4', type: 'video', thumbnailUrl: BACKEND_POSTER }],
    } as unknown as VideoEditingTaskContent;

    const out = normaliseProjectDataForSave(content);
    const mats = out.materials as Array<Record<string, unknown>>;
    expect(mats[0].thumbnailUrl).toBe(BACKEND_POSTER);
  });

  it('does not mutate the original material objects', () => {
    const material = { id: 'm1', name: 'a.mp4', type: 'video', thumbnailUrl: DATA_URL };
    const content = {
      markdownContent: '',
      lastModified: new Date(),
      materials: [material],
    } as unknown as VideoEditingTaskContent;

    normaliseProjectDataForSave(content);
    expect(material.thumbnailUrl).toBe(DATA_URL); // live object preserved
  });

  it('(c) strips data: thumbnails from timeline item snapshots, keeps posters', () => {
    const content = {
      markdownContent: '',
      lastModified: new Date(),
      uiState: {
        currentTimelineState: {
          tracks: [
            {
              id: 't1',
              items: [
                { id: 'i1', thumbnailUrl: DATA_URL },
                { id: 'i2', thumbnailUrl: BACKEND_POSTER },
              ],
            },
          ],
        },
      },
    } as unknown as VideoEditingTaskContent;

    const out = normaliseProjectDataForSave(content);
    const tracks = (
      (out.uiState as { currentTimelineState: { tracks: Array<{ items: Array<Record<string, unknown>> }> } })
        .currentTimelineState
    ).tracks;
    expect(tracks[0].items[0]).not.toHaveProperty('thumbnailUrl');
    expect(tracks[0].items[1].thumbnailUrl).toBe(BACKEND_POSTER);
  });

  it('(d) produces a payload free of any data: string when serialised', () => {
    const content = {
      markdownContent: '',
      lastModified: new Date(),
      materials: [{ id: 'm1', type: 'video', thumbnailUrl: DATA_URL }],
      uiState: {
        currentTimelineState: {
          tracks: [{ id: 't1', items: [{ id: 'i1', thumbnailUrl: DATA_URL }] }],
        },
      },
    } as unknown as VideoEditingTaskContent;

    const out = normaliseProjectDataForSave(content);
    expect(JSON.stringify(out)).not.toContain('data:');
  });
});
