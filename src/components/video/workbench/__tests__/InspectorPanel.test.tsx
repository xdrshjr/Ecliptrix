/**
 * InspectorPanel — the 「属性」 page (spec §3.7.2, §7.1).
 *
 * The real components are compiled from source (tsconfig keeps JSX as
 * `preserve`) against the real timeline / focus stores, so a commit is
 * observed where it lands: in the timeline store and its undo history.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import panelSource from '../InspectorPanel.tsx?raw';
// @ts-expect-error -- ?raw import
import iconsSource from '../inspector/icons.tsx?raw';
// @ts-expect-error -- ?raw import
import primitivesSource from '../inspector/InspectorPrimitives.tsx?raw';
// @ts-expect-error -- ?raw import
import segmentSource from '../inspector/SegmentInspector.tsx?raw';
// @ts-expect-error -- ?raw import
import subtitleSource from '../inspector/SubtitleTextField.tsx?raw';
// @ts-expect-error -- ?raw import
import audioSource from '../inspector/AudioClipControls.tsx?raw';
// @ts-expect-error -- ?raw import
import clipSource from '../inspector/ClipInspector.tsx?raw';
// @ts-expect-error -- ?raw import
import materialSource from '../inspector/MaterialInspector.tsx?raw';
import { getTranslations } from '@/lib/i18n';
import type { MaterialItem } from '@/types';
import * as focusStoreModule from '@/stores/editorFocusStore';
import * as storeModule from '../../timeline/store';
import * as updateItemFields from '../../timeline/store/actions/updateItemFields';
import * as timeFormat from '../../timeline/timeFormat';
import * as trackDisplayName from '../../timeline/trackDisplayName';
import * as segmentLinksContext from '../../lib/segments/SegmentLinksContext';
import * as eligibility from '../../playback/camera/eligibility';
import * as imageGeometry from '../../components/VideoPlayerPanel/imageOverlayGeometry';
import * as inspectorSelection from '../inspector/inspectorSelection';
import type { InspectorPanelProps } from '../InspectorPanel';
import type { TimelineData, TimelineItemData, TrackData } from '../../timeline/domain/types';
import {
  compileComponent,
  compileComponentModule,
  localeContextModule,
  reactModules,
  type ModuleMap,
} from '../../timeline/__tests__/test-utils/compileComponent';

const { useTimelineStore } = storeModule;
const { useEditorFocusStore } = focusStoreModule;
const en = getTranslations('en');
const Nothing = () => null;

const updateSubtitleText = vi.fn(updateItemFields.updateSubtitleTextAction);

let InspectorPanel: React.FC<InspectorPanelProps>;

beforeAll(() => {
  const modules: ModuleMap = {
    ...reactModules(),
    ...localeContextModule(),
    '@/stores/editorFocusStore': focusStoreModule,
    '../../timeline/store': storeModule,
    '../timeline/store': storeModule,
    '../../timeline/store/actions/updateItemFields': {
      ...updateItemFields,
      updateSubtitleTextAction: updateSubtitleText,
    },
    '../../timeline/timeFormat': timeFormat,
    '../timeline/timeFormat': timeFormat,
    '../../timeline/trackDisplayName': trackDisplayName,
    '../../lib/segments/SegmentLinksContext': segmentLinksContext,
    '../../playback/camera/eligibility': eligibility,
    '../../components/VideoPlayerPanel/imageOverlayGeometry': imageGeometry,
    '../../components/MaterialsPanel/MaterialThumbnail': { __esModule: true, default: Nothing },
    '../../components/MaterialCacheBadge': { __esModule: true, default: Nothing },
    '../../components/SegmentCard/SegmentVoiceOverride': { __esModule: true, default: Nothing },
    './inspector/inspectorSelection': inspectorSelection,
    '../components/MediaPreviewModal/MediaPreviewModal': {
      __esModule: true,
      default: (props: { material: MaterialItem | null; onClose(): void }) =>
        React.createElement(
          'div',
          { role: 'dialog', 'aria-label': 'preview' },
          React.createElement('button', { type: 'button', onClick: props.onClose }, 'close'),
          props.material?.name,
        ),
    },
  };
  const load = (key: string, source: string, aliases: string[] = []) => {
    const exports = compileComponentModule(source, modules);
    for (const id of [key, ...aliases]) modules[id] = exports;
  };
  load('./icons', iconsSource);
  load('./InspectorPrimitives', primitivesSource, ['./inspector/InspectorPrimitives']);
  load('./SegmentInspector', segmentSource, ['./inspector/SegmentInspector']);
  load('./SubtitleTextField', subtitleSource);
  load('./AudioClipControls', audioSource);
  load('./ClipInspector', clipSource, ['./inspector/ClipInspector']);
  load('./MaterialInspector', materialSource, ['./inspector/MaterialInspector']);
  InspectorPanel = compileComponent<InspectorPanelProps>(panelSource, modules);
});

function track(id: string, type: TrackData['type'], items: TimelineItemData[]): TrackData {
  return {
    id, name: '', type, height: 60, isLocked: false, isMuted: false,
    isVisible: true, volume: 100, order: 0, items,
  };
}

const subtitle: TimelineItemData = {
  id: 'sub-1', name: 'hello', type: 'subtitle', startTime: 1, duration: 2,
  trackId: 'subtitle-track-1', color: '#fff', text: 'hello',
};
const video: TimelineItemData = {
  id: 'vid-1', name: 'clip.mp4', type: 'video', startTime: 0, duration: 4,
  trackId: 'video-track-1', color: '#3b82f6', materialId: 'mat-1',
};
const audio: TimelineItemData = {
  id: 'aud-1', name: 'voice.mp3', type: 'audio', startTime: 0, duration: 3,
  trackId: 'audio-track-1', color: '#10b981',
};

function timeline(): TimelineData {
  return {
    currentTime: 0, totalDuration: 4, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [
      track('video-track-1', 'video', [video]),
      track('audio-track-1', 'audio', [audio]),
      track('subtitle-track-1', 'subtitle', [subtitle]),
    ],
  };
}

const material = {
  id: 'mat-1', name: 'clip.mp4', type: 'video', format: 'mp4', size: 1,
  url: '/a.mp4', createdAt: new Date(0), width: 1920, height: 1080, duration: 4,
} as MaterialItem;

function renderPanel(overrides: Partial<InspectorPanelProps> = {}) {
  const props: InspectorPanelProps = {
    materials: [material],
    onOpenCameraMotion: vi.fn(),
    onOpenSubtitleStyle: vi.fn(),
    onAddMaterialToTimeline: vi.fn(),
    onBeforePreview: vi.fn(),
    onLocateSegment: vi.fn(),
    taskId: 'task-1',
    ...overrides,
  };
  render(React.createElement(InspectorPanel, props));
  return props;
}

const subtitleText = (): string | undefined =>
  useTimelineStore.getState().tracks
    .find((t) => t.id === 'subtitle-track-1')?.items[0]?.text;

beforeEach(() => {
  useTimelineStore.getState().initTimeline(timeline());
  useTimelineStore.getState().deselectAll();
  useTimelineStore.getState().setExternalEditLock(null);
  useEditorFocusStore.getState().reset();
  useEditorFocusStore.getState().setRightPanelTab('materials');
  updateSubtitleText.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('InspectorPanel', () => {
  it('empty_state_when_nothing_selected', () => {
    renderPanel();
    expect(screen.getByText(en.workbench.inspector.empty)).toBeTruthy();
  });

  it('subtitle_text_commit_dispatches_update_item', () => {
    useTimelineStore.getState().selectItem('sub-1');
    renderPanel();
    const field = screen.getByLabelText(en.workbench.inspector.subtitleText);
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'hello world' } });
    fireEvent.blur(field);
    expect({
      call: updateSubtitleText.mock.calls[0]?.slice(1),
      text: subtitleText(),
      undoable: useTimelineStore.getState().canUndo,
    }).toEqual({ call: ['sub-1', 'hello world'], text: 'hello world', undoable: true });
  });

  it('subtitle_text_commits_on_ctrl_enter', () => {
    useTimelineStore.getState().selectItem('sub-1');
    renderPanel();
    const field = screen.getByLabelText(en.workbench.inspector.subtitleText);
    fireEvent.change(field, { target: { value: 'typed' } });
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });
    expect(subtitleText()).toBe('typed');
  });

  it('subtitle_draft_survives_switching_to_another_clip', () => {
    useTimelineStore.getState().selectItem('sub-1');
    renderPanel();
    const field = screen.getByLabelText(en.workbench.inspector.subtitleText);
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'typed then clicked away' } });
    act(() => useTimelineStore.getState().selectItem('vid-1'));
    expect(subtitleText()).toBe('typed then clicked away');
  });

  it('controls_disabled_under_edit_lock', () => {
    useTimelineStore.getState().setExternalEditLock('agent');
    useTimelineStore.getState().selectItem('sub-1');
    renderPanel();
    const field = screen.getByLabelText(en.workbench.inspector.subtitleText) as HTMLTextAreaElement;
    const style = screen.getByRole('button', { name: en.workbench.inspector.subtitleStyle });
    expect({
      notice: screen.getByRole('status').textContent,
      field: field.disabled,
      style: (style as HTMLButtonElement).disabled,
    }).toEqual({ notice: en.workbench.inspector.editLocked, field: true, style: true });
  });

  it('camera_motion_and_volume_disabled_under_edit_lock', () => {
    useTimelineStore.getState().setExternalEditLock('agent');
    useTimelineStore.getState().selectItem('vid-1');
    renderPanel();
    const camera = screen.getByRole('button', { name: /Camera motion/ }) as HTMLButtonElement;
    cleanup();
    useTimelineStore.getState().selectItem('aud-1');
    renderPanel();
    const volume = screen.getByRole('button', { name: /Track volume/ }) as HTMLButtonElement;
    expect([camera.disabled, volume.disabled]).toEqual([true, true]);
  });

  it('camera_motion_button_calls_opener_with_item_id', () => {
    useTimelineStore.getState().selectItem('vid-1');
    const props = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Camera motion/ }));
    expect(props.onOpenCameraMotion).toHaveBeenCalledWith('vid-1');
  });

  it('multi_selection_shows_count_and_total_duration', () => {
    useTimelineStore.getState().selectItems(['vid-1', 'aud-1']);
    renderPanel();
    expect(screen.getByText(en.workbench.inspector.multiSelected.replace('{count}', '2')))
      .toBeTruthy();
    expect(screen.getByText('0:07.00')).toBeTruthy();
  });

  it('material_selected_after_clip_wins', () => {
    useTimelineStore.getState().selectItem('vid-1');
    const props = renderPanel();
    React.act(() => useEditorFocusStore.getState().selectMaterial('mat-1'));
    fireEvent.click(screen.getByRole('button', { name: /Add to timeline/ }));
    expect(props.onAddMaterialToTimeline).toHaveBeenCalledWith(material);
  });

  it('preview_pauses_composition_then_opens_hosted_modal', () => {
    const order: string[] = [];
    React.act(() => useEditorFocusStore.getState().selectMaterial('mat-1'));
    renderPanel({ onBeforePreview: () => order.push('pause') });
    fireEvent.click(screen.getByRole('button', { name: /Preview/ }));
    order.push(screen.queryByRole('dialog') ? 'open' : 'closed');
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    expect({ order, afterClose: screen.queryByRole('dialog') })
      .toEqual({ order: ['pause', 'open'], afterClose: null });
  });

  it('selecting_never_switches_right_panel_tab', () => {
    renderPanel();
    React.act(() => {
      useTimelineStore.getState().selectItem('vid-1');
      useEditorFocusStore.getState().selectMaterial('mat-1');
    });
    expect(useEditorFocusStore.getState().rightPanelTab).toBe('materials');
  });
});
