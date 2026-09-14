import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MaterialItem, VideoCutClipRequest, VideoCutClipResult } from '@/types';
import {
  buildClipPlaceholder,
  buildCutClipMaterial,
  matchClipCutResults,
} from '../clipCutResults';
import { SCRIPT_SEGMENT_METADATA_FIELDS } from '../derivedMaterial';

const ORIGINAL_URL = '/api/storage/files/video/orig.mp4';

const original: MaterialItem = {
  id: 'orig',
  name: 'orig.mp4',
  type: 'video',
  format: 'mp4',
  size: 10,
  duration: 20,
  url: ORIGINAL_URL,
  cacheUrl: ORIGINAL_URL,
  storageKey: 'video/orig.mp4',
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  metadata: {
    storageKey: 'video/orig.mp4',
    localResolvedUrl: ORIGINAL_URL,
    segment_id: 'segment-1',
    segment_number: 1,
    segment_title: 'Intro',
    segment_assigned_at: 1000,
    video_index_in_segment: 1,
    segment_text_hash: 'hash-1',
  },
};

function request(id: string, start: number, end: number): VideoCutClipRequest {
  return { id, name: id, start_time: start, end_time: end, duration: end - start };
}

function result(id: string): VideoCutClipResult {
  return {
    id, name: id, video_url: `/api/storage/files/video/${id}.mp4`, file_size: 1,
    duration: 5, width: 1920, height: 1080, format: 'mp4',
  };
}

const requests = [request('c1', 0, 5), request('c2', 5, 10), request('c3', 10, 15)];
const DESCRIPTION = 'Clip from "{name}", {start} - {end}';
const placeholders = () => requests.map((entry, index) =>
  buildClipPlaceholder(original, entry, index, requests.length, DESCRIPTION));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('clipCutResults', () => {
  it('a failed middle clip leaves the other results on their own placeholders', () => {
    const { matched, unmatched } = matchClipCutResults(placeholders(), [result('c1'), result('c3')]);

    expect({
      matched: matched.map((pair) => [pair.pending.material.id, pair.result.video_url]),
      unmatched: unmatched.map((entry) => entry.material.id),
    }).toEqual({
      matched: [
        ['orig_clip_c1', '/api/storage/files/video/c1.mp4'],
        ['orig_clip_c3', '/api/storage/files/video/c3.mp4'],
      ],
      unmatched: ['orig_clip_c2'],
    });
  });

  it('placeholders without a result are reported as unmatched', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { matched, unmatched } = matchClipCutResults(placeholders(), [result('c2'), result('stray')]);

    expect({
      matched: matched.map((pair) => pair.pending.clipId),
      unmatched: unmatched.map((entry) => entry.clipId),
      warned: warn.mock.calls,
    }).toEqual({
      matched: ['c2'],
      unmatched: ['c1', 'c3'],
      warned: [['[clipCut] result for unknown clip id', { id: 'stray' }]],
    });
  });

  it('the clip description follows the localized template it is given', () => {
    const [, second] = placeholders();

    expect(second.material.description).toBe('Clip from "orig.mp4", 00:05 - 00:10');
  });

  it('a cut clip carries no script segment membership', () => {
    const [first] = placeholders();
    const material = buildCutClipMaterial(original, first, result('c1'));
    const inherited = (metadata: MaterialItem['metadata']) =>
      SCRIPT_SEGMENT_METADATA_FIELDS.filter((field) => metadata !== undefined && field in metadata);

    expect({
      placeholder: inherited(first.material.metadata),
      final: inherited(material.metadata),
      isClip: material.metadata?.isClip,
      clipStartTime: material.metadata?.clipStartTime,
      url: material.url,
      uploadStatus: [first.material.uploadStatus, material.uploadStatus],
    }).toEqual({
      placeholder: [],
      final: [],
      isClip: true,
      clipStartTime: 0,
      url: '/api/storage/files/video/c1.mp4',
      uploadStatus: ['uploading', 'completed'],
    });
  });
});
