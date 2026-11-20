/**
 * The agent can write a clip's fade-in / fade-out; this badge is where the
 * user sees it and takes it back (one undo step, refused while locked).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import badgeSource from '../ClipTransitionBadge.tsx?raw';
// @ts-expect-error -- same
import menuSource from '../ClipContextMenu.tsx?raw';
// @ts-expect-error -- same
import itemSource from '../TimelineItem.tsx?raw';
import { getTranslations } from '@/lib/i18n';
import * as storeModule from '../store';
import type { SequenceTransitionData, TimelineData } from '../domain/types';
import {
  compileComponent, compileComponentModule, localeContextModule, reactModules,
} from './test-utils/compileComponent';

interface BadgeProps {
  itemId: string;
  transitionIn?: SequenceTransitionData;
  transitionOut?: SequenceTransitionData;
  widthPx: number;
  isTrackLocked: boolean;
}

const { useTimelineStore } = storeModule;
const t = getTranslations('en').timeline.transition;
const FADE_IN: SequenceTransitionData = { type: 'fade', duration: 0.5 };
const FADE_OUT: SequenceTransitionData = { type: 'fade', duration: 0.25 };

let Badge: React.FC<BadgeProps>;

beforeAll(() => {
  const menu = compileComponentModule(menuSource, reactModules());
  Badge = compileComponent<BadgeProps>(badgeSource, {
    ...reactModules(),
    ...localeContextModule(),
    './store': storeModule,
    './ClipContextMenu': menu,
  });
});

function timeline(): TimelineData {
  return {
    currentTime: 0, totalDuration: 4, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [{
      id: 'v1', name: 'v1', type: 'video', height: 80, isLocked: false, isMuted: false,
      isVisible: true, volume: 100, order: 0,
      items: [{
        id: 'a', name: 'a', type: 'video', startTime: 0, duration: 4, trackId: 'v1', color: '#000',
        materialId: 'm', clipStart: 0, clipEnd: 4, originalDuration: 4,
        transitionIn: FADE_IN, transitionOut: FADE_OUT,
      }],
    }],
  };
}

const stored = () => useTimelineStore.getState().tracks[0].items[0];

function renderBadge(patch: Partial<BadgeProps> = {}) {
  const item = stored();
  return render(React.createElement(Badge, {
    itemId: 'a', transitionIn: item.transitionIn, transitionOut: item.transitionOut,
    widthPx: 200, isTrackLocked: false, ...patch,
  }));
}

beforeEach(() => {
  useTimelineStore.getState().setExternalEditLock(null);
  useTimelineStore.getState().initTimeline(timeline());
  useTimelineStore.getState().clearHistory();
});
afterEach(cleanup);

describe('ClipTransitionBadge', () => {
  it('shows one marker per side that has a transition, titled with its length', () => {
    renderBadge();
    expect(screen.getByTestId('clip-transition-in').getAttribute('title')).toBe('Fade in 0.5s');
    expect(screen.getByTestId('clip-transition-out').getAttribute('title')).toBe('Fade out 0.25s');
  });

  it('renders only the side that exists, and nothing without any transition', () => {
    const { container, rerender } = renderBadge({ transitionOut: undefined });
    expect(screen.queryByTestId('clip-transition-in')).not.toBeNull();
    expect(screen.queryByTestId('clip-transition-out')).toBeNull();
    rerender(React.createElement(Badge, { itemId: 'a', widthPx: 200, isTrackLocked: false }));
    expect(container.innerHTML).toBe('');
  });

  it('steps aside on a clip too narrow to hit the markers', () => {
    const { container } = renderBadge({ widthPx: 20 });
    expect(container.innerHTML).toBe('');
  });

  it('clears one side from the menu as one undo step', () => {
    renderBadge();
    fireEvent.click(screen.getByTestId('clip-transition-in'));
    fireEvent.click(screen.getByRole('menuitem', { name: t.clearIn }));
    expect({ in: stored().transitionIn, out: stored().transitionOut }).toEqual({ in: undefined, out: FADE_OUT });

    useTimelineStore.getState().undo();
    expect({ in: stored().transitionIn, out: stored().transitionOut }).toEqual({ in: FADE_IN, out: FADE_OUT });
  });

  it('offers "remove both" only when both sides exist', () => {
    const { unmount } = renderBadge();
    fireEvent.click(screen.getByTestId('clip-transition-out'));
    expect(screen.getByRole('menuitem', { name: t.clearOut })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: t.clearAll }));
    expect({ in: stored().transitionIn, out: stored().transitionOut }).toEqual({ in: undefined, out: undefined });
    unmount();

    useTimelineStore.getState().initTimeline(timeline());
    renderBadge({ transitionOut: undefined });
    fireEvent.click(screen.getByTestId('clip-transition-in'));
    expect(screen.queryByRole('menuitem', { name: t.clearAll })).toBeNull();
  });

  it('is disabled on a locked track', () => {
    renderBadge({ isTrackLocked: true });
    expect((screen.getByTestId('clip-transition-in') as HTMLButtonElement).disabled).toBe(true);
  });

  it('is disabled while the agent holds the timeline, and says why', () => {
    useTimelineStore.getState().setExternalEditLock('agent');
    renderBadge();
    const marker = screen.getByTestId('clip-transition-in') as HTMLButtonElement;
    expect(marker.disabled).toBe(true);
    expect(marker.title).toContain(t.lockedHint);
    fireEvent.click(marker);
    expect(stored().transitionIn).toEqual(FADE_IN);
  });
});

describe('transition copy', () => {
  it.each(['en', 'zh'] as const)('%s defines every badge string', (locale) => {
    const copy = getTranslations(locale).timeline.transition;
    for (const key of ['badgeIn', 'badgeOut', 'clearIn', 'clearOut', 'clearAll', 'lockedHint'] as const) {
      expect(copy[key].length).toBeGreaterThan(0);
    }
    expect(copy.badgeIn).toContain('{seconds}');
    expect(copy.badgeOut).toContain('{seconds}');
  });
});

describe('wiring', () => {
  it('TimelineItem mounts the badge with the clip transitions', () => {
    expect(String(itemSource)).toMatch(/<ClipTransitionBadge[^>]*transitionIn=\{item\.transitionIn\}[^>]*transitionOut=\{item\.transitionOut\}/);
  });
});
