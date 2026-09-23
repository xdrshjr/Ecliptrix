import { afterEach, describe, expect, it } from 'vitest';

import {
  MUTATING_TIMELINE_SHORTCUTS,
  resolveGlobalSpaceAction,
  resolveTimelineShortcut,
  shouldGlobalSpaceTogglePlayback,
  shouldShortcutRunDuringInteraction,
  shouldTimelineHandleCopyShortcut,
  shouldTimelineHandleKeyEvent,
} from '../shortcutOwnership';

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

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

/** Dispatch a real keydown on `target`, optionally consumed by a listener first. */
function dispatchKey(target: Element, code: string, consume = false): KeyboardEvent {
  if (consume) {
    target.addEventListener('keydown', event => event.preventDefault(), { once: true });
  }
  const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

type ShortcutKey = Parameters<typeof resolveTimelineShortcut>[0];

function key(overrides: Partial<ShortcutKey>): ShortcutKey {
  return {
    key: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('shouldTimelineHandleKeyEvent', () => {
  it('ignores Delete while focus is inside an aria-modal dialog', () => {
    const host = mount('<div role="dialog" aria-modal="true"><button>Apply</button></div>');
    const button = host.querySelector('button')!;
    const event = dispatchKey(button, 'Delete');
    expect(shouldTimelineHandleKeyEvent(event, button)).toBe(false);
  });

  it('ignores a key whose target is inside a modal even if focus is elsewhere', () => {
    const host = mount('<div aria-modal="true"><input /></div><div class="clip" tabindex="0"></div>');
    const input = host.querySelector('input')!;
    const clip = host.querySelector('.clip')!;
    expect(shouldTimelineHandleKeyEvent({ defaultPrevented: false, target: input }, clip)).toBe(false);
  });

  it('timeline shortcuts ignore already default-prevented events', () => {
    const host = mount('<div class="clip" tabindex="0"></div>');
    const clip = host.querySelector('.clip')!;
    const event = dispatchKey(clip, 'Escape', true);
    expect(shouldTimelineHandleKeyEvent(event, clip)).toBe(false);
  });

  it('handles keys on the timeline outside any dialog', () => {
    const host = mount('<div class="clip" tabindex="0"></div>');
    const clip = host.querySelector('.clip')!;
    const event = dispatchKey(clip, 'Delete');
    expect(shouldTimelineHandleKeyEvent(event, clip)).toBe(true);
  });
});

describe('shouldGlobalSpaceTogglePlayback', () => {
  it('Space after clicking a clip still toggles playback even though the clip prevented default', () => {
    const host = mount('<div role="button" tabindex="0" class="clip"></div>');
    const clip = host.querySelector('.clip')!;
    const event = dispatchKey(clip, 'Space', true);
    expect({ consumed: event.defaultPrevented, plays: shouldGlobalSpaceTogglePlayback(event) })
      .toEqual({ consumed: true, plays: true });
  });

  it('Space on a focused toolbar button still toggles playback', () => {
    const host = mount('<button type="button">Undo</button>');
    const button = host.querySelector('button')!;
    expect(shouldGlobalSpaceTogglePlayback(dispatchKey(button, 'Space'))).toBe(true);
  });

  it('Space inside a text input, textarea or contenteditable is left alone', () => {
    const host = mount('<input /><textarea></textarea><div contenteditable="true"><span>x</span></div>');
    const targets = [
      host.querySelector('input')!,
      host.querySelector('textarea')!,
      host.querySelector('span')!,
    ];
    expect(targets.map(target => shouldGlobalSpaceTogglePlayback(dispatchKey(target, 'Space'))))
      .toEqual([false, false, false]);
  });

  it('Space inside an aria-modal dialog is left alone', () => {
    const host = mount('<div role="dialog" aria-modal="true"><button>Cancel</button></div>');
    const button = host.querySelector('button')!;
    expect(shouldGlobalSpaceTogglePlayback(dispatchKey(button, 'Space'))).toBe(false);
  });

  it('Space without an element target toggles playback', () => {
    expect(shouldGlobalSpaceTogglePlayback({ target: null })).toBe(true);
  });
});

function spaceEvent(target: Element | null, repeat = false) {
  return { code: 'Space', target, repeat };
}

describe('resolveGlobalSpaceAction', () => {
  it('Space yields to a keyboard-focused toolbar button', () => {
    const host = mount('<button type="button">Cut</button>');
    expect(resolveGlobalSpaceAction(spaceEvent(host.querySelector('button')), 'keyboard')).toBe('yield');
  });

  it('Space still plays after a button was clicked with the mouse', () => {
    const host = mount('<button type="button">Cut</button>');
    expect(resolveGlobalSpaceAction(spaceEvent(host.querySelector('button')), 'pointer')).toBe('toggle');
  });

  it('auto-repeated Space is swallowed without toggling', () => {
    const host = mount('<div role="button" tabindex="0" class="clip"></div>');
    expect(resolveGlobalSpaceAction(spaceEvent(host.querySelector('.clip'), true), 'pointer')).toBe('swallow');
  });

  it('Space inside text editing or a modal dialog yields in either modality', () => {
    const host = mount('<input /><div role="dialog" aria-modal="true"><span>x</span></div>');
    expect([
      resolveGlobalSpaceAction(spaceEvent(host.querySelector('input')), 'pointer'),
      resolveGlobalSpaceAction(spaceEvent(host.querySelector('span'), true), 'pointer'),
    ]).toEqual(['yield', 'yield']);
  });

  // Workbench text fields (spec §3.11) are plain inputs, so typing a space
  // into them must never reach the global play/pause handler.
  it('space_in_project_name_input_does_not_toggle_playback', () => {
    const host = mount('<header><input type="text" aria-label="项目名" value="我的项目" /></header>');
    const input = host.querySelector('input');
    expect([
      resolveGlobalSpaceAction(spaceEvent(input), 'pointer'),
      resolveGlobalSpaceAction(spaceEvent(input), 'keyboard'),
    ]).toEqual(['yield', 'yield']);
  });

  it('space_in_material_search_does_not_toggle_playback', () => {
    const host = mount('<div role="search"><input type="search" placeholder="搜索素材" /></div>');
    const input = host.querySelector('input');
    expect([
      resolveGlobalSpaceAction(spaceEvent(input), 'pointer'),
      resolveGlobalSpaceAction(spaceEvent(input, true), 'keyboard'),
    ]).toEqual(['yield', 'yield']);
  });

  it('keys other than Space yield', () => {
    expect(resolveGlobalSpaceAction({ code: 'KeyK', target: null, repeat: false }, 'pointer')).toBe('yield');
  });
});

describe('shouldShortcutRunDuringInteraction', () => {
  it('Escape during a drag only cancels the drag', () => {
    const shortcut = resolveTimelineShortcut(key({ key: 'Escape' }), false);
    expect({ shortcut, runs: shouldShortcutRunDuringInteraction(shortcut!) })
      .toEqual({ shortcut: 'deselect', runs: false });
  });

  it('Escape when idle deselects', () => {
    // Idle keys never consult the interaction predicate: the resolved shortcut runs.
    expect(resolveTimelineShortcut(key({ key: 'Escape' }), false)).toBe('deselect');
  });

  it('export still runs mid-drag while timeline edits do not', () => {
    expect([
      shouldShortcutRunDuringInteraction('export'),
      shouldShortcutRunDuringInteraction('delete'),
    ]).toEqual([true, false]);
  });
});

describe('resolveTimelineShortcut', () => {
  it('Ctrl+Shift+Z redoes (the browser reports an upper-case key)', () => {
    expect(resolveTimelineShortcut(key({ key: 'Z', ctrlKey: true, shiftKey: true }), false)).toBe('redo');
  });

  it('CapsLock Ctrl+Z still undoes', () => {
    expect(resolveTimelineShortcut(key({ key: 'Z', ctrlKey: true }), false)).toBe('undo');
  });

  it('Cmd+Z undoes and Ctrl+Y redoes', () => {
    expect([
      resolveTimelineShortcut(key({ key: 'z', metaKey: true }), false),
      resolveTimelineShortcut(key({ key: 'y', ctrlKey: true }), false),
    ]).toEqual(['undo', 'redo']);
  });

  it('Ctrl+X toggles the cut tool', () => {
    expect(resolveTimelineShortcut(key({ key: 'x', ctrlKey: true }), false)).toBe('toggle-cut');
  });

  it('a held Ctrl+X does not flicker the cut tool', () => {
    expect(resolveTimelineShortcut({ key: 'x', ...{ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, repeat: true } }, false)).toBeNull();
  });

  it('a held Ctrl+C duplicates the selection only once', () => {
    expect(resolveTimelineShortcut({ key: 'c', ...{ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, repeat: true } }, false)).toBeNull();
  });

  it('a held Ctrl+Z keeps stepping back through history', () => {
    expect(resolveTimelineShortcut({ key: 'z', ...{ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, repeat: true } }, false)).toBe('undo');
  });

  it('repeated S is ignored', () => {
    expect(resolveTimelineShortcut(key({ key: 's', repeat: true }), false)).toBeNull();
  });

  it('bare letters are ignored while an interactive widget has focus', () => {
    expect(resolveTimelineShortcut(key({ key: 's' }), true)).toBeNull();
  });

  it('maps bare letters, Delete/Backspace and Escape', () => {
    expect(['m', 'E', 't', 'S', 'Delete', 'Backspace', 'Escape'].map(value =>
      resolveTimelineShortcut(key({ key: value }), false),
    )).toEqual(['camera-motion', 'effect', 'transition', 'subtitles', 'delete', 'delete', 'deselect']);
  });

  it('marks every timeline-rewriting shortcut as mutating, but not export or deselect', () => {
    const mutating = ['undo', 'redo', 'copy', 'toggle-cut', 'subtitles', 'delete'] as const;
    expect({
      mutating: mutating.every(shortcut => MUTATING_TIMELINE_SHORTCUTS.has(shortcut)),
      export: MUTATING_TIMELINE_SHORTCUTS.has('export'),
      deselect: MUTATING_TIMELINE_SHORTCUTS.has('deselect'),
    }).toEqual({ mutating: true, export: false, deselect: false });
  });
});
