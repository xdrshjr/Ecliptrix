import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTranslations } from '@/lib/i18n';
import type { ScriptSegment } from '@/types';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import type { SegmentStatus } from '../../../lib/segments/segmentLinks';
import {
  compileComponent, compileComponentModule, localeContextModule, reactModules,
} from '@/components/video/timeline/__tests__/test-utils/compileComponent';
// @ts-expect-error Vitest raw source loader for JSX-preserving projects.
import iconsSource from '../icons.tsx?raw';
// @ts-expect-error Vitest raw source loader for JSX-preserving projects.
import chipsSource from '../SegmentStatusChips.tsx?raw';
// @ts-expect-error Vitest raw source loader for JSX-preserving projects.
import menuSource from '../SegmentMoreMenu.tsx?raw';
// @ts-expect-error Vitest raw source loader for JSX-preserving projects.
import cardSource from '../SegmentCard.tsx?raw';
// @ts-expect-error Vitest raw source loader for JSX-preserving projects.
import listSource from '../SegmentCardList.tsx?raw';
import * as segmentLinks from '../../../lib/segments/segmentLinks';
import * as segmentLinksContext from '../../../lib/segments/SegmentLinksContext';
import type { SegmentLinksValue } from '../../../lib/segments/SegmentLinksContext';
import { useSegmentListFocus } from '../useSegmentListFocus';
import type { SegmentCardProps, SegmentCardState } from '../SegmentCard';
import type { SegmentMenuItem } from '../SegmentMoreMenu';

const zh = getTranslations('zh-CN');
const copy = zh.workbench.segmentCard;

const base = { ...reactModules(), ...localeContextModule(() => 'zh-CN') };
const icons = compileComponentModule(iconsSource, base);
const withIcons = { ...base, './icons': icons };
const chips = compileComponentModule(chipsSource, withIcons);
const menu = compileComponentModule(menuSource, withIcons);
const SegmentCard = compileComponent<SegmentCardProps>(cardSource, {
  ...withIcons,
  './SegmentStatusChips': chips,
  './SegmentMoreMenu': menu,
  '../MaterialsPanel/MaterialThumbnail': { default: () => React.createElement('span', null, 'thumb') },
});

afterEach(() => {
  cleanup();
  useEditorFocusStore.getState().reset();
});

function segment(id: string, title = '丝滑亮相'): ScriptSegment {
  return {
    id,
    title,
    narrationText: '看这身如丝般顺滑的毛发',
    sentences: [{ id: `${id}-s1`, text: '看这身如丝般顺滑的毛发' }],
  } as unknown as ScriptSegment;
}

const readyStatus: SegmentStatus = {
  visual: 'configured', voice: 'ready', voiceOnTimeline: 'current', subtitle: 'none',
};

function cardState(overrides: Partial<SegmentCardState> = {}): SegmentCardState {
  return {
    isSelected: false,
    isExpanded: false,
    isPlaying: false,
    isAuditioning: false,
    isPlaceholder: false,
    isHeaderTabStop: true,
    canAudition: true,
    replaceVisualBlockReason: null,
    isVoiceBusy: false,
    ...overrides,
  };
}

function actions() {
  return {
    onSelect: vi.fn(),
    onToggleExpanded: vi.fn(),
    onExpand: vi.fn(),
    onCollapse: vi.fn(),
    onNavigate: vi.fn(),
    onAudition: vi.fn(),
    onReplaceVisual: vi.fn(),
    onUpdateVoice: vi.fn(),
    registerHeader: vi.fn(),
    registerCard: vi.fn(),
  };
}

const deleteItem: SegmentMenuItem = {
  key: 'delete', label: copy.delete, onSelect: () => {}, danger: true, separatorBefore: true,
};

function renderCard(overrides: Partial<SegmentCardProps> = {}) {
  const props: SegmentCardProps = {
    segment: segment('seg-1'),
    index: { segmentId: 'seg-1', ordinal: 1, title: '丝滑亮相', badge: '01', label: '01 丝滑亮相' },
    status: readyStatus,
    durationSeconds: 8.5,
    state: cardState(),
    actions: actions(),
    menuItems: [deleteItem],
    renderExpanded: () => React.createElement('textarea', { 'aria-label': 'narration' }),
    ...overrides,
  };
  render(React.createElement('div', { role: 'list' }, React.createElement(SegmentCard, props)));
  return props;
}

describe('SegmentCard', () => {
  it('card_header_is_button_with_aria_expanded', () => {
    renderCard({ state: cardState({ isSelected: true, isExpanded: true }) });
    const header = screen.getByRole('button', { name: /01\s*丝滑亮相/ });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(header.getAttribute('aria-current')).toBe('true');
  });

  it('click_on_blank_area_selects_segment', () => {
    const props = renderCard();
    fireEvent.click(screen.getByRole('listitem'));
    expect(props.actions.onSelect).toHaveBeenCalledTimes(1);
  });

  it('click_inside_textarea_does_not_select', () => {
    const props = renderCard({ state: cardState({ isSelected: true, isExpanded: true }) });
    fireEvent.click(screen.getByRole('textbox', { name: 'narration' }));
    expect(props.actions.onSelect).not.toHaveBeenCalled();
  });

  it('delete_is_only_in_more_menu', () => {
    renderCard();
    expect(screen.queryByRole('button', { name: copy.delete })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: copy.more }));
    const menuElement = screen.getByRole('menu');
    expect(within(menuElement).getByRole('menuitem', { name: copy.delete }).className)
      .toContain('ws-menu-item--danger');
  });

  it('stale_voice_shows_update_voice_action', () => {
    const props = renderCard({ status: { ...readyStatus, voice: 'stale' } });
    fireEvent.click(screen.getByRole('button', { name: copy.updateVoice }));
    expect(props.actions.onUpdateVoice).toHaveBeenCalledTimes(1);
  });

  it('replace_visual_disabled_with_reason_before_tts', () => {
    renderCard({ state: cardState({ replaceVisualBlockReason: copy.replaceVisualDisabled }) });
    const button = screen.getByRole('button', { name: copy.replaceVisual });
    expect([button.hasAttribute('disabled'), button.getAttribute('title')])
      .toEqual([true, copy.replaceVisualDisabled]);
  });

  it('status_chips_render_text_not_only_color', () => {
    renderCard();
    expect(screen.getByText(copy.visualConfigured)).toBeTruthy();
    expect(screen.getByText(copy.voiceReady)).toBeTruthy();
    expect(screen.getByText(copy.subtitleNone)).toBeTruthy();
  });

  it('outdated_timeline_voice_shows_warning_chip', () => {
    renderCard({ status: { ...readyStatus, voiceOnTimeline: 'outdated' } });
    const chip = screen.getByText(copy.voiceOutdated).closest('.ws-chip');
    expect([chip?.className.includes('ws-chip--warn'), chip?.getAttribute('title')])
      .toEqual([true, copy.voiceOutdatedHint]);
  });

  it('placeholder_script_hides_chips_and_audition', () => {
    renderCard({ status: null, state: cardState({ isPlaceholder: true, canAudition: false }) });
    expect(screen.queryByText(copy.visualConfigured)).toBeNull();
    expect(screen.queryByRole('button', { name: copy.audition })).toBeNull();
  });

  it('playing_card_shows_now_playing_badge', () => {
    renderCard({ state: cardState({ isPlaying: true }) });
    expect(screen.getByText(copy.nowPlaying)).toBeTruthy();
  });
});

const Harness: React.FC<{ segments: ScriptSegment[] }> = ({ segments }) => {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const focus = useSegmentListFocus({
    segmentIds: segments.map((item) => item.id), playingSegmentId: null, panelRef,
  });
  return React.createElement('div', { ref: panelRef, role: 'list' }, segments.map((item, position) =>
    React.createElement(SegmentCard, {
      key: item.id,
      segment: item,
      index: {
        segmentId: item.id, ordinal: position + 1, title: item.title,
        badge: `0${position + 1}`, label: `0${position + 1} ${item.title}`,
      },
      status: readyStatus,
      durationSeconds: null,
      state: cardState({
        isSelected: focus.selectedSegmentId === item.id,
        isExpanded: focus.expandedSegmentId === item.id,
        isHeaderTabStop: focus.tabStopSegmentId === item.id,
      }),
      actions: {
        ...actions(),
        onToggleExpanded: () => focus.toggleExpanded(item.id),
        onExpand: () => focus.expand(item.id),
        onCollapse: () => {
          focus.collapse(item.id);
          focus.focusHeader(item.id);
        },
        onNavigate: (delta: 1 | -1) => focus.navigate(item.id, delta),
        registerHeader: (element: HTMLButtonElement | null) => focus.registerHeader(item.id, element),
        registerCard: (element: HTMLElement | null) => focus.registerCard(item.id, element),
      },
      menuItems: [deleteItem],
      renderExpanded: () => React.createElement('div', { 'data-narration-editor': true },
        React.createElement('button', { type: 'button' }, `edit-${item.id}`)),
    })));
};

describe('segment list keyboard model', () => {
  const segments = [segment('seg-1', '丝滑亮相'), segment('seg-2', '活泼天性')];
  const header = (name: RegExp) => screen.getByRole('button', { name });

  it('arrow_keys_move_between_card_headers', () => {
    render(React.createElement(Harness, { segments }));
    header(/01\s*丝滑亮相/).focus();
    fireEvent.keyDown(header(/01\s*丝滑亮相/), { key: 'ArrowDown' });
    const second = header(/02\s*活泼天性/);
    expect([document.activeElement === second, second.getAttribute('aria-current'), second.tabIndex])
      .toEqual([true, 'true', 0]);
  });

  it('enter_expands_and_focuses_narration_editor', () => {
    render(React.createElement(Harness, { segments }));
    fireEvent.keyDown(header(/01\s*丝滑亮相/), { key: 'Enter' });
    expect(document.activeElement?.textContent).toBe('edit-seg-1');
  });

  it('escape_collapses_and_returns_focus_to_header', () => {
    render(React.createElement(Harness, { segments }));
    fireEvent.keyDown(header(/01\s*丝滑亮相/), { key: 'Enter' });
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    const first = header(/01\s*丝滑亮相/);
    expect([document.activeElement === first, first.getAttribute('aria-expanded')])
      .toEqual([true, 'false']);
  });

  it('timeline_selection_scrolls_card_into_view', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(React.createElement(Harness, { segments }));
    act(() => useEditorFocusStore.getState().selectSegment('seg-2', 'timeline'));
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('timeline_selection_does_not_scroll_while_editing_in_panel', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(React.createElement(Harness, { segments }));
    fireEvent.click(header(/01\s*丝滑亮相/));
    const editor = document.createElement('textarea');
    screen.getAllByRole('listitem')[0].appendChild(editor);
    editor.focus();
    act(() => useEditorFocusStore.getState().selectSegment('seg-2', 'timeline'));
    expect(scroll).not.toHaveBeenCalled();
  });

  it('selecting_a_card_never_changes_right_panel_tab', () => {
    useEditorFocusStore.getState().setRightPanelTab('properties');
    render(React.createElement(Harness, { segments }));
    fireEvent.click(header(/02\s*活泼天性/));
    expect(useEditorFocusStore.getState().rightPanelTab).toBe('properties');
  });
});

type BuildMenu = (input: {
  segment: ScriptSegment;
  links: SegmentLinksValue;
  handlers: Record<string, unknown>;
  availability: Record<string, (id: string) => unknown>;
  copy: typeof copy;
}) => SegmentMenuItem[];

const listModule = compileComponentModule(listSource, {
  ...base,
  '../../lib/segments/segmentLinks': segmentLinks,
  '../../lib/segments/SegmentLinksContext': segmentLinksContext,
  '../../hooks/useSegmentAudition': {},
  './SegmentCard': { default: () => null },
  './useSegmentListFocus': {},
});
const buildSegmentMenuItems = listModule.buildSegmentMenuItems as BuildMenu;

function menuFor(status: SegmentStatus) {
  const voice = { id: 'voice-2' };
  const onRevealMaterial = vi.fn();
  const links = {
    latestVoiceById: new Map([['seg-1', voice]]),
    statusById: new Map([['seg-1', status]]),
    segmentRanges: new Map([['seg-1', { start: 0, end: 4 }]]),
  } as unknown as SegmentLinksValue;
  const items = buildSegmentMenuItems({
    segment: segment('seg-1'),
    links,
    handlers: {
      onGenerateVoice: vi.fn(), onReplaceVisual: vi.fn(), onAiMatchVisual: vi.fn(),
      onDeleteSegment: vi.fn(), onLocateSegment: vi.fn(), onRevealMaterial,
    },
    availability: {
      isVoiceBusy: () => false, replaceVisualBlockReason: () => null, aiMatchBlockReason: () => null,
    },
    copy,
  });
  return { items, onRevealMaterial };
}

describe('segment ⋯ menu', () => {
  it('menu_items_follow_spec_order_with_delete_last', () => {
    const { items } = menuFor({ ...readyStatus, voiceOnTimeline: 'outdated' });
    expect(items.map((item) => item.label)).toEqual([
      copy.regenerateVoice, copy.aiMatch, copy.locate, copy.revealNewVoice, copy.delete,
    ]);
  });

  it('reveal_new_voice_only_when_timeline_voice_outdated', () => {
    const { items } = menuFor(readyStatus);
    expect(items.some((item) => item.key === 'reveal')).toBe(false);
  });

  it('reveal_new_voice_passes_latest_voice_material_id', () => {
    const { items, onRevealMaterial } = menuFor({ ...readyStatus, voiceOnTimeline: 'outdated' });
    items.find((item) => item.key === 'reveal')?.onSelect();
    expect(onRevealMaterial).toHaveBeenCalledWith('voice-2');
  });
});
