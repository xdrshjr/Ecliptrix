import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- Vite raw source for the JSX-preserve test loader.
import cardSource from '../MaterialCard.tsx?raw';
// @ts-expect-error -- Vite raw source.
import menuSource from '../MaterialMoreMenu.tsx?raw';
// @ts-expect-error -- Vite raw source.
import overlaysSource from '../MaterialStatusOverlays.tsx?raw';
// @ts-expect-error -- Vite raw source.
import iconsSource from '../materialIcons.tsx?raw';
import {
  compileComponentModule, localeContextModule, reactModules,
} from '@/components/video/timeline/__tests__/test-utils/compileComponent';
import { getTranslations } from '@/lib/i18n';
import type { MaterialItem } from '@/types';
import * as focusStore from '@/stores/editorFocusStore';
import * as segmentLinksContext from '../../../lib/segments/SegmentLinksContext';
import * as dragTypes from '../../../timeline/lib/materialDragTypes';
import * as localMaterial from '../../../lib/localMaterial';
import type { MaterialCardActions, MaterialCardProps } from '../MaterialCard';

const zh = getTranslations('zh-CN');
let MaterialCard: React.FC<MaterialCardProps>;

beforeAll(() => {
  const shared = { ...reactModules(), ...localeContextModule(() => 'zh-CN') };
  const icons = compileComponentModule(iconsSource, shared);
  const withIcons = { ...shared, './materialIcons': icons };
  const exports = compileComponentModule(cardSource, {
    ...withIcons,
    '@/stores/editorFocusStore': focusStore,
    '../../lib/segments/SegmentLinksContext': segmentLinksContext,
    '../../timeline/lib/materialDragTypes': dragTypes,
    '../../lib/localMaterial': localMaterial,
    './MaterialThumbnail': { __esModule: true, default: () => null },
    '../MaterialCacheBadge': { __esModule: true, default: () => null },
    './MaterialMoreMenu': compileComponentModule(menuSource, withIcons),
    './MaterialStatusOverlays': compileComponentModule(overlaysSource, shared),
  });
  MaterialCard = exports.default as React.FC<MaterialCardProps>;
});

function makeActions(): MaterialCardActions {
  return {
    onAddToTimeline: vi.fn(), onPreview: vi.fn(), onAnalyze: vi.fn(),
    onImageToVideo: vi.fn(), onCut: vi.fn(), onRemoveWatermark: vi.fn(),
    onDownload: vi.fn(), onDelete: vi.fn(), onRetryDownload: vi.fn(),
    onDragStart: vi.fn(), onDragEnd: vi.fn(),
  };
}

function makeMaterial(extra: Partial<MaterialItem> = {}): MaterialItem {
  return {
    id: 'mat-1', name: 'Beach.mp4', type: 'video', format: 'mp4', size: 1,
    url: '/api/storage/files/video/beach.mp4', thumbnailUrl: '/thumb/beach.jpg',
    duration: 15, createdAt: new Date(0), ...extra,
  };
}

function cardProps(material: MaterialItem, actions: MaterialCardActions): MaterialCardProps {
  return {
    material, actions, analysisStatus: 'idle', isWaitingAnalysis: false,
    isDragging: false, isDownloading: false, isConvertingToVideo: false,
    showTypeIcon: false,
  };
}

function renderCard(material: MaterialItem, actions = makeActions()) {
  render(React.createElement(MaterialCard, cardProps(material, actions)));
  return { actions, card: screen.getByLabelText(material.name, { selector: '[data-material-id]' }) };
}

function expectNoActionCalled(actions: MaterialCardActions) {
  Object.values(actions).forEach((fn) => expect(fn).not.toHaveBeenCalled());
}

beforeEach(() => focusStore.useEditorFocusStore.getState().reset());
afterEach(cleanup);

describe('MaterialCard', () => {
  it('single_click_selects_without_side_effects', () => {
    const { actions, card } = renderCard(makeMaterial());
    fireEvent.click(card);
    const state = focusStore.useEditorFocusStore.getState();
    expect(state.selectedMaterialId).toBe('mat-1');
    expect(state.rightPanelTab).toBe('materials');
    expect(card.getAttribute('data-selected')).toBe('true');
    expectNoActionCalled(actions);
  });

  it('double_click_opens_preview', () => {
    const material = makeMaterial();
    const { actions, card } = renderCard(material);
    fireEvent.doubleClick(card);
    expect(actions.onPreview).toHaveBeenCalledWith(material);
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(actions.onPreview).toHaveBeenCalledTimes(2);
  });

  it('drag_payload_unchanged', () => {
    const material = makeMaterial();
    const { actions, card } = renderCard(material);
    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: 'none' };
    expect(card.getAttribute('draggable')).toBe('true');
    fireEvent.dragStart(card, { dataTransfer });
    expect(dataTransfer.setData.mock.calls).toEqual([
      ['application/json', JSON.stringify({ type: 'material', material })],
      ['application/x-ecliptrix-material-video', 'mat-1'],
    ]);
    expect(dataTransfer.effectAllowed).toBe('copy');
    expect(dataTransfer.setDragImage).toHaveBeenCalledWith(expect.any(Image), 50, 50);
    expect(actions.onDragStart).toHaveBeenCalledWith(material);
  });

  it('busy_material_is_not_draggable', () => {
    const { card } = renderCard(makeMaterial({ uploadStatus: 'uploading' }));
    expect(card.getAttribute('draggable')).toBe('false');
  });

  it('status_overlays_preserved', () => {
    renderCard(makeMaterial({ id: 'dl', name: 'dl.mp4', downloadStatus: 'downloading', downloadProgress: 40 }));
    expect(screen.getByText(zh.materialsPanel.downloadingVideo)).toBeTruthy();
    cleanup();

    const failed = makeMaterial({ id: 'err', name: 'err.mp4', downloadStatus: 'error' });
    const { actions } = renderCard(failed);
    expect(screen.getByText(zh.materialsPanel.downloadFailed)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: zh.materialsPanel.retryDownload }));
    expect(actions.onRetryDownload).toHaveBeenCalledWith(failed);
    // The retry click must not also select the card.
    expect(focusStore.useEditorFocusStore.getState().selectedMaterialId).toBeNull();
  });

  it('shows_used_in_segment_chip_from_segment_links', () => {
    const links = {
      segmentIndex: new Map([['seg-b', { segmentId: 'seg-b', ordinal: 2, title: 'B', badge: '02', label: '02 B' }]]),
      itemSegmentMap: new Map(), materialSegmentMap: new Map([['mat-1', 'seg-b']]),
      segmentRanges: new Map(), statusById: new Map(), latestVoiceById: new Map(),
      highlightedItemIds: new Set<string>(), isPlaceholderScript: false,
    };
    render(React.createElement(
      segmentLinksContext.SegmentLinksContext.Provider,
      { value: links },
      React.createElement(MaterialCard, cardProps(makeMaterial(), makeActions())),
    ));
    expect(screen.getByText('已用于第 2 段')).toBeTruthy();
  });

  it('more_menu_routes_delete_without_selecting', () => {
    const material = makeMaterial();
    const { actions } = renderCard(material);
    fireEvent.click(screen.getByRole('button', { name: zh.workbench.materials.more }));
    fireEvent.click(screen.getByRole('menuitem', { name: zh.workbench.materials.deleteMaterial }));
    expect(actions.onDelete).toHaveBeenCalledWith(material, expect.anything());
    expect(focusStore.useEditorFocusStore.getState().selectedMaterialId).toBeNull();
  });

  it('more_menu_renders_outside_the_card_stacking_context', () => {
    const { card, actions } = renderCard(makeMaterial());
    fireEvent.click(screen.getByRole('button', { name: zh.workbench.materials.more }));
    // Inside the card the menu shared `.ws-material-actions`' z-index, so the
    // next card's hover buttons painted (and took clicks) over it.
    expect(card.contains(screen.getByRole('menu'))).toBe(false);
    // React still bubbles through the portal: keys must not open the preview.
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key: 'Enter' });
    expect(actions.onPreview).not.toHaveBeenCalled();
  });
});
