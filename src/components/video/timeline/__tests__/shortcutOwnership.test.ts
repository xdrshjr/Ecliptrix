import { describe, expect, it } from 'vitest';

import { shouldTimelineHandleCopyShortcut } from '../shortcutOwnership';

function selection(text: string, isCollapsed = false): Pick<Selection, 'isCollapsed' | 'toString'> {
  return {
    isCollapsed,
    toString: () => text,
  };
}

describe('shouldTimelineHandleCopyShortcut', () => {
  it('lets native copy handle selected DOM text', () => {
    expect(shouldTimelineHandleCopyShortcut({
      selection: selection('copy me'),
      selectedItems: [],
    })).toBe(false);
  });

  it('lets native copy win when DOM text and timeline items are both selected', () => {
    expect(shouldTimelineHandleCopyShortcut({
      selection: selection('copy me'),
      selectedItems: ['clip-1'],
    })).toBe(false);
  });

  it('handles timeline copy when items are selected and no DOM text is selected', () => {
    expect(shouldTimelineHandleCopyShortcut({
      selection: null,
      selectedItems: ['clip-1'],
    })).toBe(true);
  });

  it('does not cancel copy when neither DOM text nor timeline items are selected', () => {
    expect(shouldTimelineHandleCopyShortcut({
      selection: null,
      selectedItems: [],
    })).toBe(false);
  });

  it('does not trim selected whitespace text', () => {
    expect(shouldTimelineHandleCopyShortcut({
      selection: selection('   '),
      selectedItems: ['clip-1'],
    })).toBe(false);
  });
});
