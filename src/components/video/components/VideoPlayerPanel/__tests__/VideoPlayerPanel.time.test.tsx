/**
 * VideoPlayerPanel — the play bar shows the restored playhead
 * (segment-centric-editor-workbench §3.6, RV-06).
 *
 * Reproduces 「播放器 0:00、播放头 0:03」: a project saved paused at 3.34 s
 * restores `currentTimelineTime=3.34` while the panel-internal composition
 * cursor starts at 0. The play bar must follow the timeline value (the one the
 * compositor paints), not the internal cursor.
 *
 * The real panel is compiled with the shared `?raw` loader; the compositor,
 * canvas and modal children are stubbed, the transport + time logic are real.
 */

import * as React from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
// @ts-expect-error -- Vite raw source for the JSX-preserve test loader.
import panelSource from '../VideoPlayerPanel.tsx?raw';
import {
  compileComponentModule, installResizeObserverStub, localeContextModule, reactModules,
} from '@/components/video/timeline/__tests__/test-utils/compileComponent';
import * as logger from '../../../utils/logger';
import * as aspectRatios from '../aspectRatios';
import * as imageOverlays from '../imageOverlays';
import * as transport from '../useCompositionTransport';
import * as consoleTime from '../consoleTime';
import * as subtitleLayout from '../../../lib/subtitleLayout';

type PanelProps = Record<string, unknown>;
let Panel: React.FC<PanelProps>;
let restoreResizeObserver: () => void;
const nothing = () => null;
const PreviewCanvasStub = React.forwardRef<HTMLDivElement>(
  function PreviewCanvasStub(_props, ref) { return React.createElement('div', { ref }); },
);

beforeAll(() => {
  restoreResizeObserver = installResizeObserverStub();
  const timelineState = { externalEditLock: null };
  const useTimelineStore = Object.assign(
    (selector: (state: typeof timelineState) => unknown) => selector(timelineState),
    { getState: () => timelineState },
  );
  // forwardRef components are objects, so take the default export directly.
  Panel = compileComponentModule(panelSource, {
    ...reactModules(),
    ...localeContextModule(() => 'zh-CN'),
    '@/contexts/NotificationContext': { useNotification: () => ({ showWarning: vi.fn() }) },
    '../../utils/logger': logger,
    './ImageOverlay': { __esModule: true, default: nothing },
    '../VideoCoverModal': { CoverButton: nothing, VideoCoverModal: nothing },
    '@/lib/playbackFlags': {
      isPreviewProxyEnabled: () => false, isLocalPreviewEnabled: () => false,
    },
    './PreviewCanvas': { __esModule: true, default: PreviewCanvasStub },
    './CameraDegradeBadge': { __esModule: true, default: nothing },
    '../../hooks/useCompositionPlayback': {
      useCompositionPlayback: () => ({
        hostRef: { current: null }, seek: vi.fn(), camera3DDegraded: false,
      }),
    },
    './aspectRatios': aspectRatios,
    './imageOverlays': imageOverlays,
    './useCompositionTransport': transport,
    './usePlayStateMirror': { usePlayStateMirror: () => undefined },
    './consoleTime': consoleTime,
    './CanvasMenu': { __esModule: true, default: nothing },
    '../../lib/subtitleLayout': subtitleLayout,
    '../../timeline/store': { useTimelineStore },
    '../../timeline/store/actions/updateItemFields': { fitImagePositionAction: () => false },
  }).default as React.FC<PanelProps>;
});

afterAll(() => {
  cleanup();
  restoreResizeObserver();
});

function formatTime(seconds: number): string {
  const whole = Math.floor(seconds);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(whole / 60))}:${pad(whole % 60)}`;
}

function renderRestoredPanel(currentTimelineTime: number) {
  return render(React.createElement(Panel, {
    isPlaying: false, currentTime: 0, volume: 1,
    handlePlayPause: vi.fn(), handleTimeSeek: vi.fn(), handleVolumeChange: vi.fn(),
    formatTime,
    videoPreview: {}, taskId: 'task-1',
    compositionPlayback: {
      isCompositionMode: true, totalCompositionDuration: 25,
      videoSequences: [], audioSequences: [], currentSequenceIndex: 0,
    },
    currentTimelineTime,
    timelineState: {
      tracks: [{ id: 'v1', type: 'video', items: [{ id: 'i1', type: 'video', startTime: 0, duration: 25 }] }],
    },
    materials: [],
    aspectRatioId: '16:9',
    onAspectRatioChange: vi.fn(),
  }));
}

describe('VideoPlayerPanel play-bar time', () => {
  it('player_time_matches_restored_playhead', () => {
    const { container } = renderRestoredPanel(3.34);
    expect(container.querySelector('.current-time')?.textContent).toBe('00:03');
    const scrubber = container.querySelector<HTMLInputElement>('.console-scrubber');
    expect(Number(scrubber?.value)).toBeCloseTo(3.34);
  });
});
