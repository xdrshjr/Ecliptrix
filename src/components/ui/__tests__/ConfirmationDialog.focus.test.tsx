import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import dialogSource from '../ConfirmationDialog.tsx?raw';
import type { ConfirmationDialogProps } from '../ConfirmationDialog';
import * as focusTrap from '../focusTrap';
import { shouldTimelineHandleKeyEvent } from '@/components/video/timeline/shortcutOwnership';
import { getTranslations, type SupportedLocale } from '@/lib/i18n';

let activeLocale: SupportedLocale = 'en';

/**
 * tsconfig keeps JSX as `preserve`, which Vitest's esbuild honours, so the
 * component cannot be imported directly (and `fs` is externalised under
 * jsdom). Compile its raw source with the TypeScript API — its runtime
 * imports are React and the shared focus trap — and render the real component.
 */
function loadConfirmationDialog(): React.FC<ConfirmationDialogProps> {
  const { outputText } = ts.transpileModule(String(dialogSource), {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const modules: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    './focusTrap': focusTrap,
    '@/contexts/LocaleContext': {
      useLocale: () => ({ locale: activeLocale, setLocale: () => {}, t: getTranslations(activeLocale) }),
    },
  };
  const compiled = { exports: {} as { default?: React.FC<ConfirmationDialogProps> } };
  const requireModule = (id: string) => {
    if (id in modules) return modules[id];
    throw new Error(`unmapped import ${id}`);
  };
  new Function('require', 'module', 'exports', outputText)(requireModule, compiled, compiled.exports);
  return compiled.exports.default!;
}

let ConfirmationDialog: React.FC<ConfirmationDialogProps>;

beforeAll(() => {
  ConfirmationDialog = loadConfirmationDialog();
});

function dialogProps(overrides: Partial<ConfirmationDialogProps> = {}): ConfirmationDialogProps {
  return {
    isOpen: true,
    title: 'Replace existing subtitles?',
    message: '3 existing subtitles will be replaced',
    confirmText: 'Replace',
    cancelText: 'Cancel',
    type: 'warning',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  activeLocale = 'en';
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('ConfirmationDialog focus and keyboard behaviour', () => {
  it('focuses the cancel button when opened', () => {
    render(React.createElement(ConfirmationDialog, dialogProps()));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('Enter on the focused cancel button never confirms', () => {
    // A real button turns Enter into its own click (= cancel); the dialog-level
    // handler must not ALSO confirm on the same key press.
    const props = dialogProps();
    render(React.createElement(ConfirmationDialog, props));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Enter' });
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('Enter outside the buttons confirms', () => {
    const props = dialogProps();
    render(React.createElement(ConfirmationDialog, props));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('Escape cancels', () => {
    const props = dialogProps();
    render(React.createElement(ConfirmationDialog, props));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('focus from a click on the dialog text stays inside the modal, so timeline shortcuts stand down', () => {
    // Browsers move focus to the nearest focusable ancestor of a clicked
    // text node; that ancestor must be inside [aria-modal].
    render(React.createElement(ConfirmationDialog, dialogProps()));
    const focusTarget = screen
      .getByText('3 existing subtitles will be replaced')
      .closest('[tabindex]') as HTMLElement;
    focusTarget.focus();
    expect(
      shouldTimelineHandleKeyEvent({ defaultPrevented: false, target: focusTarget }, document.activeElement),
    ).toBe(false);
  });

  it('Tab from the last button wraps to the first', () => {
    render(React.createElement(ConfirmationDialog, dialogProps()));
    const confirm = screen.getByRole('button', { name: 'Replace' });
    confirm.focus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('Shift+Tab from the dialog element moves to the last button', () => {
    render(React.createElement(ConfirmationDialog, dialogProps()));
    const dialog = screen.getByRole('dialog');
    dialog.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Replace' }));
  });

  it('dialog root sits on the z-modal layer above the agent dock', () => {
    // The agent dock (z-dock 850 / z-dock-panel 860) must stay below every modal.
    render(React.createElement(ConfirmationDialog, dialogProps()));
    const rootClasses = screen.getByRole('dialog').parentElement!.className.split(/\s+/);
    expect({ modalLayer: rootClasses.includes('z-modal'), arbitraryLayer: rootClasses.some((c) => c.startsWith('z-[')) })
      .toEqual({ modalLayer: true, arbitraryLayer: false });
  });

  it('default button labels follow the active locale', () => {
    // Omitted labels fall back to the locale (`??`), exactly like props a caller never passed.
    const withoutLabels = dialogProps({ confirmText: undefined, cancelText: undefined });
    activeLocale = 'en';
    const { unmount } = render(React.createElement(ConfirmationDialog, withoutLabels));
    const english = screen.getAllByRole('button').map((button) => button.textContent);
    unmount();
    activeLocale = 'zh-CN';
    render(React.createElement(ConfirmationDialog, withoutLabels));
    const chinese = screen.getAllByRole('button').map((button) => button.textContent);
    const en = getTranslations('en').common;
    const zh = getTranslations('zh-CN').common;
    expect({ english, chinese }).toEqual({ english: [en.cancel, en.confirm], chinese: [zh.cancel, zh.confirm] });
  });

  it('Escape is marked handled so an enclosing modal does not also close', () => {
    render(React.createElement(ConfirmationDialog, dialogProps()));
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    cancel.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('restores focus after closing', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Subtitles';
    document.body.appendChild(trigger);
    trigger.focus();

    const props = dialogProps();
    const { rerender } = render(React.createElement(ConfirmationDialog, props));
    rerender(React.createElement(ConfirmationDialog, { ...props, isOpen: false }));

    expect(document.activeElement).toBe(trigger);
  });
});
