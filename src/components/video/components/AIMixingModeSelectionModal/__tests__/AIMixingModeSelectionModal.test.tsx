/**
 * AIMixingModeSelectionModal — replace warning, focus, frame interval
 * input and keyboard handling (AM-01 / AM-10).
 *
 * tsconfig keeps JSX untransformed ("jsx": "preserve"), so Vitest cannot
 * import the component module directly. The test compiles the component
 * source with the TypeScript compiler and evaluates it against the test's
 * own React, with the locale context replaced by the real English copy.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { getTranslations } from '@/lib/i18n';
import type { AiMixTimelineImpact } from '../../../hooks/useAIMixedEditing';
import type { AIMixingMode } from '../AIMixingModeSelectionModal';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import componentSource from '../AIMixingModeSelectionModal.tsx?raw';

interface ModeModalProps {
  isOpen: boolean;
  impact: AiMixTimelineImpact;
  onClose: () => void;
  onConfirm: (mode: AIMixingMode) => void;
}

const en = getTranslations('en');

function loadComponentModule(source: string): Record<string, unknown> {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
  });
  const modules: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    '@/contexts/LocaleContext': {
      useLocale: () => ({ t: en, locale: 'en', setLocale: () => {} }),
    },
  };
  const componentModule = { exports: {} as Record<string, unknown> };
  const requireModule = (id: string): unknown => {
    if (id in modules) return modules[id];
    throw new Error(`Unexpected import "${id}" in the component under test`);
  };
  new Function('require', 'module', 'exports', outputText)(
    requireModule,
    componentModule,
    componentModule.exports,
  );
  return componentModule.exports;
}

const componentModule = loadComponentModule(String(componentSource));
const ModeModal = componentModule.default as React.FC<ModeModalProps>;
const clampFrameInterval =
  componentModule.clampFrameInterval as (value: number) => number;

const NO_CLIPS: AiMixTimelineImpact = {
  replaceableItemCount: 0,
  preservedTrackNames: [],
};

function renderModal(overrides: Partial<ModeModalProps> = {}) {
  const props: ModeModalProps = {
    isOpen: true,
    impact: NO_CLIPS,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };
  const view = render(React.createElement(ModeModal, props));
  return { ...view, props };
}

function chooseProfessional(): HTMLInputElement {
  fireEvent.click(
    screen.getByRole('radio', { name: en.aiMixingModal.professionalMode }),
  );
  return screen.getByLabelText(en.aiMixingModal.frameIntervalLabel) as HTMLInputElement;
}

describe('AIMixingModeSelectionModal', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('moves focus into the dialog when opened', () => {
    vi.useFakeTimers();
    renderModal();

    act(() => { vi.advanceTimersByTime(20); }); // enter animation starts
    act(() => { vi.advanceTimersByTime(20); }); // next animation frame

    expect(document.activeElement)
      .toBe(screen.getByRole('radio', { checked: true }));
  });

  it('frame interval field can be cleared and retyped', () => {
    renderModal();
    const input = chooseProfessional();

    fireEvent.change(input, { target: { value: '' } });
    const cleared = input.value;
    fireEvent.change(input, { target: { value: '12' } });

    expect([cleared, input.value]).toEqual(['', '12']);
  });

  it('clamps the frame interval when the field loses focus', () => {
    renderModal();
    const input = chooseProfessional();

    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.blur(input);

    expect(input.value).toBe('30');
  });

  it('shows the replace warning only when the timeline has clips', () => {
    const { rerender, props } = renderModal();
    const withoutClips = screen.queryByRole('note');

    rerender(React.createElement(ModeModal, {
      ...props,
      impact: { replaceableItemCount: 3, preservedTrackNames: [] },
    }));

    expect({ withoutClips, withClips: screen.getByRole('note').textContent })
      .toEqual({
        withoutClips: null,
        withClips: expect.stringContaining(
          '3 clips on the video, image and audio tracks will be replaced',
        ),
      });
  });

  it('lists the tracks that stay unchanged in the replace warning', () => {
    renderModal({
      impact: { replaceableItemCount: 2, preservedTrackNames: ['Subtitles', 'Music'] },
    });

    expect(screen.getByRole('note'))
      .toHaveTextContent('These tracks stay unchanged: Subtitles, Music');
  });

  it('Enter inside the number input does not confirm', () => {
    const { props } = renderModal();
    const input = chooseProfessional();

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('Enter on the selected mode starts the edit', () => {
    const { props } = renderModal();

    fireEvent.keyDown(screen.getByRole('radio', { checked: true }), { key: 'Enter' });

    expect(props.onConfirm).toHaveBeenCalledWith({ type: 'quick' });
  });

  it('confirms professional mode with the clamped frame interval', () => {
    const { props } = renderModal();
    const input = chooseProfessional();

    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: en.aiMixingModal.confirm }));

    expect(props.onConfirm)
      .toHaveBeenCalledWith({ type: 'professional', frameInterval: 1 });
  });

  it('Escape closes the dialog', () => {
    const { props } = renderModal();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('Tab from the dialog container wraps into its controls', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    dialog.focus(); // e.g. after clicking the dialog's padding

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });

    expect(document.activeElement)
      .toBe(screen.getByRole('button', { name: en.aiMixingModal.confirm }));
  });

  it('gives the icon-only close button an accessible name', () => {
    renderModal();

    expect(screen.getAllByRole('button', { name: en.aiMixingModal.cancel }))
      .toHaveLength(2);
  });
});

describe('clampFrameInterval', () => {
  it('falls back to 5 and keeps whole seconds within 1-30', () => {
    expect([Number.NaN, 0, 7.4, 99].map(clampFrameInterval))
      .toEqual([5, 1, 7, 30]);
  });
});
