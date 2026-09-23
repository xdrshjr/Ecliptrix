/**
 * useEditorExportWiring — the top-bar export is the single useVideoExport
 * instance and exports at the ratio the preview shows (spec §3.2, R2, RV-14).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { TimelineState } from '@/types';
import { getTranslations } from '@/lib/i18n';

const exportHook = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  handleExport: vi.fn(async () => undefined),
  state: { isExporting: false, exportProgress: 0 },
}));

vi.mock('../../hooks/useVideoExport', () => ({
  useVideoExport: (props: Record<string, unknown>) => {
    exportHook.calls.push(props);
    return {
      isExporting: exportHook.state.isExporting,
      exportProgress: exportHook.state.exportProgress,
      exportStartTime: null,
      exportStage: undefined,
      canCancelExport: false,
      handleExport: exportHook.handleExport,
      cancelExport: vi.fn(),
    };
  },
}));
vi.mock('../../components/VideoPlayerPanel/VideoExportProgressModal', () => ({
  default: () => null,
}));
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ locale: 'zh-CN', t: getTranslations('zh-CN') }),
}));

import { useEditorExportWiring } from '../useEditorExportWiring';

function timeline(itemCount: number): TimelineState {
  return {
    currentTime: 0, totalDuration: 10, zoomLevel: 1, selectedItems: [],
    playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [{
      id: 'v1', type: 'video', name: 'V1',
      items: Array.from({ length: itemCount }, (_, index) => ({ id: `i${index}` })),
    }],
  } as unknown as TimelineState;
}

function wiring(aspectRatioId: string, timelineState: TimelineState | null = timeline(1)) {
  return renderHook(() => useEditorExportWiring({
    taskId: 'task-1', projectId: 'p1', timelineState, materials: [], aspectRatioId,
  }));
}

beforeEach(() => {
  exportHook.calls.length = 0;
  exportHook.handleExport.mockClear();
  exportHook.state = { isExporting: false, exportProgress: 0 };
});

describe('useEditorExportWiring', () => {
  it('export_uses_selected_aspect_ratio', () => {
    wiring('9:16');
    expect(exportHook.calls[exportHook.calls.length - 1]).toMatchObject({
      aspectRatio: '9:16', taskId: 'task-1', projectId: 'p1',
    });
  });

  it('passes_the_empty_timeline_fallback_before_a_timeline_loads', () => {
    wiring('16:9', null);
    expect(exportHook.calls[exportHook.calls.length - 1]?.timelineState).toMatchObject({ tracks: [], totalDuration: 0 });
  });

  it('handle_export_runs_the_single_export_hook', async () => {
    const { result } = wiring('16:9');
    await act(async () => { await result.current.handleExport(); });
    expect(exportHook.handleExport).toHaveBeenCalledTimes(1);
  });

  it('export_disabled_with_reason_when_timeline_empty', () => {
    const { result } = wiring('16:9', timeline(0));
    expect(result.current.exportState.canExport).toBe(false);
    expect(result.current.exportState.disabledReason).toBe('时间轴为空，先添加素材');
  });

  it('no_disabled_reason_while_exporting', () => {
    exportHook.state = { isExporting: true, exportProgress: 42 };
    const { result } = wiring('16:9', timeline(0));
    expect(result.current.exportState).toMatchObject({
      isExporting: true, progress: 42, disabledReason: undefined,
    });
  });

  it('exportable_timeline_has_no_disabled_reason', () => {
    const { result } = wiring('16:9');
    expect(result.current.exportState).toMatchObject({ canExport: true, disabledReason: undefined });
  });
});
