/**
 * AIMixingProgressModal — honest, cancellable, localized progress (AM-08).
 *
 * tsconfig keeps JSX untransformed ("jsx": "preserve"), so Vitest cannot
 * import the component module directly. The test compiles the component
 * source with the TypeScript compiler and evaluates it against the test's
 * own React, with the locale context replaced by the real English copy.
 */

import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { getTranslations } from '@/lib/i18n';
import type { AiMixRunState } from '../../../hooks/useAIMixedEditing';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import componentSource from '../AIMixingProgressModal.tsx?raw';

interface ProgressModalProps {
  runState: AiMixRunState;
  onCancel: () => void;
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

const ProgressModal = loadComponentModule(String(componentSource))
  .default as React.FC<ProgressModalProps>;

function renderModal(
  runState: Partial<AiMixRunState> = {},
  onCancel: () => void = vi.fn(),
): void {
  render(React.createElement(ProgressModal, {
    runState: { stage: 'analyzing', videoCount: 3, warningCount: 0, ...runState },
    onCancel,
  }));
}

const steps = () => within(screen.getByRole('list')).getAllByRole('listitem');
const cancelButton = () =>
  screen.queryByRole('button', { name: en.aiMixingProgress.cancel });

describe('AIMixingProgressModal', () => {
  it('renders English stage labels in the en locale', () => {
    renderModal();

    expect(steps().map((step) => step.querySelector('p')?.textContent))
      .toEqual(['Analyze footage', 'Plan the edit', 'Apply to timeline']);
  });

  it('tells how many videos are being analyzed', () => {
    renderModal({ videoCount: 3 });

    expect(within(steps()[0]).getByText('Analyzing 3 videos')).toBeInTheDocument();
  });

  it('marks the running step as the current step', () => {
    renderModal({ stage: 'applying' });

    expect(steps().map((step) => step.getAttribute('aria-current')))
      .toEqual([null, null, 'step']);
  });

  it('Escape and the cancel button call onCancel', () => {
    const onCancel = vi.fn();
    renderModal({ stage: 'planning' }, onCancel);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(cancelButton() as HTMLElement);

    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('focuses the cancel button when opened', () => {
    renderModal();

    expect(document.activeElement).toBe(cancelButton());
  });

  it('shows no percentage', () => {
    renderModal({ stage: 'planning' });

    expect(screen.getByRole('dialog').textContent).not.toMatch(/%/);
  });

  it('swaps cancel for a done label once the edit is applied', () => {
    renderModal({ stage: 'done' });

    expect({
      cancel: cancelButton(),
      busy: screen.getByRole('dialog').getAttribute('aria-busy'),
    }).toEqual({ cancel: null, busy: 'false' });
  });

  it('renders nothing while idle', () => {
    renderModal({ stage: 'idle' });

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
