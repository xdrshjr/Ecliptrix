import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import modalSource from '../SubtitleEditModal.tsx?raw';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import dialogSource from '../../../../ui/ConfirmationDialog.tsx?raw';
import * as focusTrap from '@/components/ui/focusTrap';
import { getTranslations, type SupportedLocale } from '@/lib/i18n';
import { shouldTimelineHandleKeyEvent } from '@/components/video/timeline/shortcutOwnership';
import type { TimelineItem } from '@/types';

/**
 * tsconfig keeps JSX as `preserve`, so the dialog cannot be imported directly
 * under Vitest. Compile the raw sources with the TypeScript API (as the
 * ConfirmationDialog focus test does) and render the real components; only
 * the logger and the locale context are stubbed.
 */
type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (subtitles: TimelineItem[]) => boolean | void;
  subtitles: TimelineItem[];
  taskId: string;
  isEditLocked?: boolean;
};

function compileModule(source: string, modules: Record<string, unknown>): Record<string, unknown> {
  const { outputText } = ts.transpileModule(String(source), {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const compiled = { exports: {} as Record<string, unknown> };
  const requireModule = (id: string) => {
    if (id in modules) return modules[id];
    throw new Error(`unmapped import ${id}`);
  };
  new Function('require', 'module', 'exports', outputText)(requireModule, compiled, compiled.exports);
  return compiled.exports;
}

let activeLocale: SupportedLocale = 'zh-CN';
let SubtitleEditModal: React.FC<ModalProps>;

class StubLogger {
  info(): void {}
  warn(): void {}
  error(): void {}
  debug(): void {}
}

beforeAll(() => {
  const base = { react: React, 'react/jsx-runtime': jsxRuntime };
  const localeContext = {
    useLocale: () => ({ locale: activeLocale, setLocale: () => {}, t: getTranslations(activeLocale) }),
  };
  const dialogModule = compileModule(dialogSource, {
    ...base,
    './focusTrap': focusTrap,
    '@/contexts/LocaleContext': localeContext,
  });
  const modalModule = compileModule(modalSource, {
    ...base,
    '../../utils': { VideoEditingLogger: StubLogger },
    '@/contexts/LocaleContext': localeContext,
    '@/components/ui/ConfirmationDialog': dialogModule,
    '@/components/ui/focusTrap': focusTrap,
  });
  SubtitleEditModal = modalModule.default as React.FC<ModalProps>;
});

function subtitle(id: string, startTime: number, text: string): TimelineItem {
  return { id, name: id, type: 'subtitle', startTime, duration: 2, trackId: 'subtitle-track-1', color: '#f59e0b', text };
}

function modalProps(overrides: Partial<ModalProps> = {}): ModalProps {
  return {
    isOpen: true,
    onClose: vi.fn(),
    onSave: vi.fn(),
    subtitles: [subtitle('s2', 4, 'second line'), subtitle('s1', 0, 'first line')],
    taskId: 'test',
    ...overrides,
  };
}

function renderModal(overrides: Partial<ModalProps> = {}) {
  const props = modalProps(overrides);
  render(React.createElement(SubtitleEditModal, props));
  return props;
}

beforeEach(() => {
  activeLocale = 'zh-CN';
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('SubtitleEditModal modal semantics', () => {
  it('dialog carries aria-modal and focuses the first field on open', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(dialog.getAttribute('aria-labelledby') ?? '');
    expect(title?.textContent).toBe(getTranslations('zh-CN').timeline.subtitleEditModal.title);
    const focused = document.activeElement as HTMLTextAreaElement;
    expect(focused.tagName).toBe('TEXTAREA');
    expect(focused.value).toBe('first line');
  });

  it('Escape closes when there are no changes', () => {
    const props = renderModal();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape with unsaved changes asks before discarding', () => {
    const labels = getTranslations('zh-CN').timeline.subtitleEditModal;
    const props = renderModal();
    const field = document.activeElement as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'edited' } });
    fireEvent.keyDown(field, { key: 'Escape' });

    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByText(labels.discardChangesTitle)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: labels.discardChangesConfirm }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('a press that starts inside the card and ends on the backdrop does not close', () => {
    const props = renderModal();
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement as HTMLElement;
    fireEvent.mouseDown(dialog);
    fireEvent.mouseUp(backdrop);
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('a press on the bare backdrop keeps focus inside the dialog', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement as HTMLElement;
    // fireEvent returns false when the default (blurring focus to <body>) was prevented.
    expect(fireEvent.mouseDown(backdrop)).toBe(false);
    expect(fireEvent.mouseDown(dialog)).toBe(true);
  });

  it('closing hands focus back to the element that opened the dialog', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const props = modalProps();
    const { rerender } = render(React.createElement(SubtitleEditModal, props));
    expect(document.activeElement?.tagName).toBe('TEXTAREA');

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    rerender(React.createElement(SubtitleEditModal, { ...props, isOpen: false }));
    expect(document.activeElement).toBe(opener);
  });

  it('timeline shortcuts ignore keys inside the dialog', () => {
    const labels = getTranslations('zh-CN').timeline.subtitleEditModal;
    renderModal();
    const preset = screen.getByText(labels.presets.classic).closest('button') as HTMLButtonElement;
    fireEvent.click(preset);
    preset.focus();
    expect(shouldTimelineHandleKeyEvent({ defaultPrevented: false, target: preset }, document.activeElement)).toBe(false);
  });

  it('Tab from the last control wraps back into the dialog', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    const controls = focusTrap.focusableElementsWithin(dialog);
    const last = controls[controls.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(controls[0]);
  });
});

describe('SubtitleEditModal saving', () => {
  it('keeps the dialog open when the owner refuses the save', () => {
    const labels = getTranslations('zh-CN').timeline.subtitleEditModal;
    const props = renderModal({ onSave: vi.fn(() => false) });
    fireEvent.change(document.activeElement as HTMLTextAreaElement, { target: { value: 'edited' } });
    fireEvent.click(screen.getByRole('button', { name: labels.save }));
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('disables saving and explains why while the agent holds the edit lock', () => {
    const t = getTranslations('zh-CN');
    renderModal({ isEditLocked: true });
    fireEvent.change(document.activeElement as HTMLTextAreaElement, { target: { value: 'edited' } });
    const save = screen.getByRole('button', { name: t.timeline.subtitleEditModal.save }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe(t.timeline.messages.editLockedByAgent);
  });
});

describe('SubtitleEditModal localisation', () => {
  it('renders English labels in the en locale', () => {
    activeLocale = 'en';
    const labels = getTranslations('en').timeline.subtitleEditModal;
    renderModal();
    expect(screen.getByText(labels.presetsHeading)).toBeTruthy();
    expect(screen.getByRole('button', { name: labels.save })).toBeTruthy();
    expect(screen.getByRole('button', { name: labels.closeAriaLabel })).toBeTruthy();
    expect(document.body.textContent ?? '').not.toMatch(/[一-龥]/);
  });
});
