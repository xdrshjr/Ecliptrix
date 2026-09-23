import { describe, expect, it } from 'vitest';
import type { AsyncTask } from '@/stores/slices/asyncTaskSlice';
import type { SegmentIndexEntry } from '../../lib/segments/segmentLinks';
import {
  collectActiveTasks,
  sanitizeTaskError,
  type CollectActiveTasksInput,
} from '../collectActiveTasks';

function task(taskId: string, patch: Partial<AsyncTask> = {}): AsyncTask {
  return {
    taskId, type: 'ai_video', status: 'pending', progress: 0,
    result: null, error: null, createdAt: 1, metadata: {}, ...patch,
  };
}

function entry(segmentId: string, ordinal: number): SegmentIndexEntry {
  const badge = String(ordinal).padStart(2, '0');
  return { segmentId, ordinal, title: 't', badge, label: `${badge} t` };
}

function input(patch: Partial<CollectActiveTasksInput> = {}): CollectActiveTasksInput {
  return {
    tasks: {},
    convertingSegmentIds: new Set(),
    segmentIndex: new Map(),
    exportTask: { isExporting: false, progress: 0 },
    ...patch,
  };
}

describe('collectActiveTasks', () => {
  it('counts_only_pending_and_processing_tasks', () => {
    const summary = collectActiveTasks(input({
      tasks: {
        a: task('a', { status: 'pending' }),
        b: task('b', { status: 'processing', progress: 40 }),
        c: task('c', { status: 'completed', progress: 100 }),
        d: task('d', { status: 'failed', error: 'boom' }),
      },
    }));
    expect(summary.activeCount).toBe(2);
    expect(summary.active.map((row) => row.id)).toEqual(['agent:a', 'agent:b']);
    expect(summary.recent.map((row) => row.status).sort())
      .toEqual(['completed', 'failed']);
  });

  it('counts_converting_segments_from_script_panel', () => {
    const summary = collectActiveTasks(input({
      convertingSegmentIds: new Set(['seg-3', 'seg-2']),
      segmentIndex: new Map([
        ['seg-2', entry('seg-2', 2)], ['seg-3', entry('seg-3', 3)],
      ]),
    }));
    expect(summary.activeCount).toBe(2);
    expect(summary.active.map((row) => [row.kind, row.segmentOrdinal]))
      .toEqual([['segment_voice', 2], ['segment_voice', 3]]);
  });

  it('counts_export_in_progress', () => {
    const idle = collectActiveTasks(input());
    const exporting = collectActiveTasks(input({
      exportTask: { isExporting: true, progress: 42.4 },
    }));
    expect(idle.activeCount).toBe(0);
    expect(exporting.activeCount).toBe(1);
    expect(exporting.active[0]).toMatchObject({ kind: 'export', progress: 42 });
  });

  it('segment_without_index_entry_still_counts_with_unknown_ordinal', () => {
    const summary = collectActiveTasks(input({
      convertingSegmentIds: new Set(['ghost']),
    }));
    expect(summary.activeCount).toBe(1);
    expect(summary.active[0].segmentOrdinal).toBeNull();
  });
});

describe('sanitizeTaskError', () => {
  it('keeps_first_line_capped_at_120_chars', () => {
    const long = `${'x'.repeat(200)}\nstack line`;
    expect(sanitizeTaskError(long)).toBe('x'.repeat(120));
  });

  it('hides_driver_internals', () => {
    expect(sanitizeTaskError('Traceback (most recent call last)')).toBeNull();
  });
});
