/**
 * previewDebug tests (spec composition-preview-playback-fix §5.4).
 *
 * Pure formatting + classification + the (default-off) flag read. No DOM
 * ownership, so these are plain deterministic assertions / snapshots.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  classifyTrackDiagnosis,
  formatTrackDiagnosticRow,
  formatTrackDiagnostics,
  isPreviewDebugEnabled,
  PREVIEW_DEBUG_STORAGE_KEY,
  type TrackDiagnosticRow,
} from '../internal/previewDebug';

function row(over: Partial<TrackDiagnosticRow> & { trackId: string }): TrackDiagnosticRow {
  return { resolvedSrc: '/api/storage/files/video/a.mp4', readyState: 4, ...over };
}

describe('classifyTrackDiagnosis — §5.4 judging quick-reference', () => {
  it('OK when the source is drawable (readyState >= 2)', () => {
    expect(classifyTrackDiagnosis(row({ trackId: 't', readyState: 2 }))).toBe('OK');
    expect(classifyTrackDiagnosis(row({ trackId: 't', readyState: 4 }))).toBe('OK');
  });

  it('H1 when paused + unmuted + not drawable (autoplay-gate signature)', () => {
    expect(
      classifyTrackDiagnosis(row({ trackId: 't', readyState: 0, paused: true, muted: false })),
    ).toBe('H1');
  });

  it('H6 when playing but not drawable with no source / a media error', () => {
    expect(
      classifyTrackDiagnosis(
        row({ trackId: 't', readyState: 1, paused: false, networkState: 3 }),
      ),
    ).toBe('H6');
    expect(
      classifyTrackDiagnosis(
        row({ trackId: 't', readyState: 0, paused: false, errorCode: 4 }),
      ),
    ).toBe('H6');
  });

  it('unknown when the not-ready row matches no tell', () => {
    expect(
      classifyTrackDiagnosis(row({ trackId: 't', readyState: 1, paused: false, networkState: 2 })),
    ).toBe('unknown');
  });
});

describe('formatTrackDiagnostics — deterministic, snapshot-stable output', () => {
  it('reports an explicit "no tracks" line for an empty list', () => {
    expect(formatTrackDiagnostics([])).toBe('[preview-debug] no video tracks');
  });

  it('formats one row with a fixed field order', () => {
    const line = formatTrackDiagnosticRow(
      row({
        trackId: 't1',
        readyState: 0,
        networkState: 3,
        paused: false,
        muted: true,
        errorCode: null,
        currentTime: 1.5,
        desiredSourceTime: 1.25,
        drawn: 0,
        dropped: 42,
      }),
    );
    expect(line).toBe(
      'track=t1 verdict=H6 readyState=0 networkState=3 paused=false muted=true error=null t=1.500 want=1.250 drawn=0 dropped=42 src=/api/storage/files/video/a.mp4',
    );
  });

  it('renders missing fields as "-" and joins rows under a header', () => {
    const out = formatTrackDiagnostics([
      row({ trackId: 'a', readyState: 4, resolvedSrc: null }),
      row({ trackId: 'b', readyState: 0, paused: true, muted: false }),
    ]);
    expect(out).toMatchInlineSnapshot(`
      "[preview-debug] track diagnostics
      track=a verdict=OK readyState=4 networkState=- paused=- muted=- error=- t=- want=- drawn=- dropped=- src=null
      track=b verdict=H1 readyState=0 networkState=- paused=true muted=false error=- t=- want=- drawn=- dropped=- src=/api/storage/files/video/a.mp4"
    `);
  });
});

describe('isPreviewDebugEnabled — default OFF, opt-in via localStorage', () => {
  const hasStorage = typeof window !== 'undefined' && !!window.localStorage;

  beforeEach(() => {
    if (hasStorage) window.localStorage.removeItem(PREVIEW_DEBUG_STORAGE_KEY);
  });
  afterEach(() => {
    if (hasStorage) window.localStorage.removeItem(PREVIEW_DEBUG_STORAGE_KEY);
  });

  it('is false by default', () => {
    expect(isPreviewDebugEnabled()).toBe(false);
  });

  it('is true when the localStorage flag is set (browser env only)', () => {
    if (!hasStorage) return;
    window.localStorage.setItem(PREVIEW_DEBUG_STORAGE_KEY, 'true');
    expect(isPreviewDebugEnabled()).toBe(true);
  });
});
