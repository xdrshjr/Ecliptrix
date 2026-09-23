/**
 * Spec §3.8: while a clip is moved or trimmed a badge shows
 * 「start – end · duration」 above it; the trimmed edge is bold and the badge
 * gives way to the swap hint.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import * as React from 'react';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import badgeSource from '../DragTimeBadge.tsx?raw';
import * as storeModule from '../store';
import * as timeFormat from '../timeFormat';
import type { TimelineStore } from '../store/useTimelineStore';
import { compileComponent, reactModules } from './test-utils/compileComponent';

type BadgeProps = { containerRef: React.RefObject<HTMLElement | null> };

const { useTimelineStore } = storeModule;
const initialState = useTimelineStore.getState();

let DragTimeBadge: React.FC<BadgeProps>;

beforeAll(() => {
  DragTimeBadge = compileComponent<BadgeProps>(badgeSource, {
    ...reactModules(),
    './store': storeModule,
    './timeFormat': timeFormat,
  });
});

beforeEach(() => {
  useTimelineStore.setState(initialState, true);
});

afterEach(() => {
  cleanup();
  useTimelineStore.setState(initialState, true);
});

/** A fake drag actor whose snapshot reports the trimmed edge. */
function actorFor(interactionType: 'move' | 'resize-start' | 'resize-end') {
  return { getSnapshot: () => ({ context: { interactionType } }) } as unknown as TimelineStore['_dragActor'];
}

function renderBadge() {
  const Host: React.FC = () => {
    const ref = React.useRef<HTMLDivElement>(null);
    return React.createElement(
      'div',
      { ref },
      React.createElement('div', { 'data-clip-id': 'clip-1' }),
      React.createElement(DragTimeBadge, { containerRef: ref }),
    );
  };
  return render(React.createElement(Host));
}

const preview = { itemId: 'clip-1', startTime: 3.34, duration: 8.5 };

describe('DragTimeBadge', () => {
  it('shows_start_end_duration_during_drag', () => {
    act(() => {
      useTimelineStore.setState({ isDragging: true, dragPreview: preview, _dragActor: actorFor('move') });
    });
    renderBadge();
    expect(screen.getByTestId('drag-time-badge').textContent).toBe('0:03.34 – 0:11.84 · 8.50s');
  });

  it('hidden_when_not_dragging', () => {
    renderBadge();
    expect(screen.queryByTestId('drag-time-badge')).toBeNull();
  });

  it('bolds_the_edge_being_trimmed', () => {
    act(() => {
      useTimelineStore.setState({ isResizing: true, dragPreview: preview, _dragActor: actorFor('resize-end') });
    });
    renderBadge();
    const bold = screen.getByTestId('drag-time-badge').querySelectorAll('.font-bold');
    expect(Array.from(bold).map((node) => node.textContent)).toEqual(['0:11.84']);
  });

  it('gives_way_to_the_swap_hint', () => {
    act(() => {
      useTimelineStore.setState({
        isDragging: true,
        dragPreview: preview,
        swapTargetItemId: 'clip-2',
        _dragActor: actorFor('move'),
      });
    });
    renderBadge();
    expect(screen.queryByTestId('drag-time-badge')).toBeNull();
  });
});
