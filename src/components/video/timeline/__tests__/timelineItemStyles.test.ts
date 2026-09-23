/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type { TimelineItemData } from '../domain/types';
import { computeItemStyles, type ItemStyleInputs } from '../timelineItemStyles';

function makeItem(overrides: Partial<TimelineItemData>): TimelineItemData {
  return {
    id: 'i1',
    name: 'clip',
    type: 'video',
    startTime: 0,
    duration: 5,
    trackId: 't1',
    color: '#3366ff',
    ...overrides,
  } as TimelineItemData;
}

function inputs(overrides: Partial<ItemStyleInputs>): ItemStyleInputs {
  return {
    item: makeItem({}),
    trackHeight: 48,
    left: 100,
    width: 200,
    isSelected: false,
    isThisItemDragging: false,
    isThisItemResizing: false,
    isSwapTarget: false,
    hasActiveSwapTarget: false,
    ...overrides,
  };
}

describe('computeItemStyles', () => {
  it('positions the bar from left + width with a 20px minimum width', () => {
    const s = computeItemStyles(inputs({ left: 100, width: 10 }));
    expect(s.left).toBe('100px');
    expect(s.width).toBe('20px'); // clamped to minimum
  });

  it('uses grab cursor when idle and grabbing while dragging', () => {
    expect(computeItemStyles(inputs({})).cursor).toBe('grab');
    expect(computeItemStyles(inputs({ isThisItemDragging: true })).cursor).toBe('grabbing');
  });

  it('disables transitions during drag or resize', () => {
    expect(computeItemStyles(inputs({})).transition).toBe('all 0.2s ease');
    expect(computeItemStyles(inputs({ isThisItemResizing: true })).transition).toBe('none');
  });

  it('raises zIndex for selected and swap-target items', () => {
    expect(computeItemStyles(inputs({})).zIndex).toBe(1);
    expect(computeItemStyles(inputs({ isSelected: true })).zIndex).toBe(10);
    expect(computeItemStyles(inputs({ isSwapTarget: true })).zIndex).toBe(9);
  });

  it('lifts a segment-linked clip above its neighbours but below the selection', () => {
    expect([
      computeItemStyles(inputs({ isLinked: true })).zIndex,
      computeItemStyles(inputs({ isLinked: true, isSelected: true })).zIndex,
    ]).toEqual([2, 10]);
  });

  it('fades the dragged item more heavily when a swap target is active', () => {
    expect(computeItemStyles(inputs({ isThisItemDragging: true })).opacity).toBe(0.8);
    expect(
      computeItemStyles(inputs({ isThisItemDragging: true, hasActiveSwapTarget: true })).opacity,
    ).toBe(0.65);
  });

  it('applies the swap-target outline + glow only on the target', () => {
    const target = computeItemStyles(inputs({ isSwapTarget: true }));
    expect(target.outline).toBe('2px dashed #22d3ee');
    expect(target.boxShadow).toContain('rgba(34, 211, 238, 0.25)');
    expect(computeItemStyles(inputs({})).outline).toBeUndefined();
  });

  it('uses the primary border for a selected video item', () => {
    const s = computeItemStyles(inputs({ item: makeItem({ type: 'video' }), isSelected: true }));
    expect(s.border).toBe('2px solid var(--primary)');
  });

  it('uses the emerald border for a selected audio item', () => {
    const s = computeItemStyles(inputs({ item: makeItem({ type: 'audio' }), isSelected: true }));
    expect(s.border).toBe('2px solid #10b981');
  });

  it('uses the amber border for a selected subtitle item and never carries a swap outline', () => {
    const s = computeItemStyles(
      inputs({ item: makeItem({ type: 'subtitle' }), isSelected: true, isSwapTarget: true }),
    );
    expect(s.border).toBe('2px solid #f59e0b');
    expect(s.outline).toBeUndefined();
  });
});
