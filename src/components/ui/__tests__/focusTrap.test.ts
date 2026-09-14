import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusableElementsWithin, trapTabKey } from '../focusTrap';

function buildDialog(): { dialog: HTMLElement; first: HTMLButtonElement; field: HTMLTextAreaElement; last: HTMLButtonElement } {
  const dialog = document.createElement('div');
  dialog.tabIndex = -1;
  const first = document.createElement('button');
  first.textContent = 'Close';
  const disabled = document.createElement('button');
  disabled.disabled = true;
  const field = document.createElement('textarea');
  const last = document.createElement('button');
  last.textContent = 'Save';
  dialog.append(first, disabled, field, last);
  document.body.appendChild(dialog);
  return { dialog, first, field, last };
}

function tabEvent(shiftKey = false) {
  return { key: 'Tab', shiftKey, preventDefault: vi.fn() };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('focusTrap', () => {
  it('lists enabled tabbable elements in document order, excluding the container', () => {
    const { dialog, first, field, last } = buildDialog();
    expect(focusableElementsWithin(dialog)).toEqual([first, field, last]);
  });

  it('trapTabKey wraps focus from the last to the first element', () => {
    const { dialog, first, last } = buildDialog();
    last.focus();
    const event = tabEvent();
    trapTabKey(event, dialog);
    expect(document.activeElement).toBe(first);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('Shift+Tab from the first element wraps to the last', () => {
    const { dialog, first, last } = buildDialog();
    first.focus();
    trapTabKey(tabEvent(true), dialog);
    expect(document.activeElement).toBe(last);
  });

  it('Tab from the dialog element itself moves to the first element', () => {
    const { dialog, first } = buildDialog();
    dialog.focus();
    trapTabKey(tabEvent(), dialog);
    expect(document.activeElement).toBe(first);
  });

  it('leaves Tab between inner elements to the browser', () => {
    const { dialog, field } = buildDialog();
    field.focus();
    const event = tabEvent();
    trapTabKey(event, dialog);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores other keys and a missing container', () => {
    const { dialog, last } = buildDialog();
    last.focus();
    const escape = { key: 'Escape', shiftKey: false, preventDefault: vi.fn() };
    trapTabKey(escape, dialog);
    trapTabKey(tabEvent(), null);
    expect(escape.preventDefault).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(last);
  });
});
