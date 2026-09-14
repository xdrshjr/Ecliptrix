import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import * as React from 'react';
import * as shallowModule from 'zustand/react/shallow';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import toolbarSource from '../TimelineToolbar.tsx?raw';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import tooltipSource from '../PortalTooltip.tsx?raw';
import * as storeModule from '../store';
import * as eligibility from '../../playback/camera/eligibility';
import { getTranslations } from '@/lib/i18n';
import {
  compileComponent,
  localeContextModule,
  reactModules,
} from './test-utils/compileComponent';

const { useTimelineStore } = storeModule;
const t = getTranslations('en');

let TimelineToolbar: React.FC<Record<string, () => void>>;

beforeAll(() => {
  const PortalTooltip = compileComponent(tooltipSource, reactModules());
  TimelineToolbar = compileComponent(toolbarSource, {
    ...reactModules(),
    ...localeContextModule(),
    '@/contexts/NotificationContext': { useNotification: () => ({ showError: vi.fn() }) },
    'zustand/react/shallow': shallowModule,
    './store': storeModule,
    './PortalTooltip': PortalTooltip,
    '../playback/camera/eligibility': eligibility,
  });
});

beforeEach(() => {
  useTimelineStore.getState().setExternalEditLock(null);
  useTimelineStore.getState().setActiveTool('select');
});

afterEach(() => {
  cleanup();
  act(() => useTimelineStore.getState().setActiveTool('select'));
  document.body.innerHTML = '';
});

function renderToolbar() {
  const handlers = Object.fromEntries(
    ['onExportJSON', 'onImportJSON', 'onOrganizeMaterials', 'onCopy', 'onOpenCameraMotion',
      'onAddEffect', 'onAddTransition', 'onAddSubtitle'].map((name) => [name, vi.fn()]),
  );
  render(React.createElement(TimelineToolbar, handlers));
}

function cutButton(): HTMLElement {
  const button = screen.getAllByRole('button')
    .find((candidate) => candidate.getAttribute('aria-label')?.startsWith(`${t.timeline.toolbar.cut} (`));
  if (!button) throw new Error('cut button not found');
  return button;
}

describe('TimelineToolbar — active tool', () => {
  it('status line names Cut when the cut tool is active', () => {
    act(() => useTimelineStore.getState().setActiveTool('cut'));
    renderToolbar();
    const status = screen.getByText(t.timeline.status.currentTool.replace('{tool}', t.timeline.toolbar.cut));
    expect(status.closest('[aria-live="polite"]')).not.toBeNull();
  });

  it('cut toggle exposes aria-pressed', () => {
    renderToolbar();
    const idle = cutButton().getAttribute('aria-pressed');
    act(() => useTimelineStore.getState().setActiveTool('cut'));
    expect([idle, cutButton().getAttribute('aria-pressed')]).toEqual(['false', 'true']);
  });

  it('buttons that are not toggles expose no aria-pressed', () => {
    renderToolbar();
    const undo = screen.getAllByRole('button')
      .find((candidate) => candidate.getAttribute('aria-label')?.startsWith(t.timeline.toolbar.undo));
    expect(undo?.hasAttribute('aria-pressed')).toBe(false);
  });
});
