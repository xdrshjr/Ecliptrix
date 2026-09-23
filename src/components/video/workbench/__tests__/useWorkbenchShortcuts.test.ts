import { describe, expect, it } from 'vitest';
import { resolveWorkbenchShortcut } from '../useWorkbenchShortcuts';

function keyEvent(code: string, target: Element, patch: Partial<KeyboardEvent> = {}) {
  return {
    code, ctrlKey: true, metaKey: false, altKey: true, shiftKey: false, repeat: false,
    defaultPrevented: false, target, ...patch,
  } as Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat' | 'target' | 'defaultPrevented'>;
}

describe('resolveWorkbenchShortcut', () => {
  it('ctrl_alt_digits_pick_layout_presets', () => {
    const body = document.body;
    expect([
      resolveWorkbenchShortcut(keyEvent('Digit1', body), body),
      resolveWorkbenchShortcut(keyEvent('Digit2', body), body),
      resolveWorkbenchShortcut(keyEvent('KeyA', body), body),
    ]).toEqual(['preset-script', 'preset-edit', 'toggle-assistant']);
  });

  it('bare_alt_does_not_fire_because_it_toggles_the_electron_menu', () => {
    const body = document.body;
    expect(resolveWorkbenchShortcut(keyEvent('Digit1', body, { ctrlKey: false }), body)).toBeNull();
  });

  it('ignored_inside_text_inputs', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(resolveWorkbenchShortcut(keyEvent('KeyA', input), input)).toBeNull();
    input.remove();
  });
});
