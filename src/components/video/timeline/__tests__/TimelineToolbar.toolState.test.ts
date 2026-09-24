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
import * as audioClipDisplayPref from '../audioClipDisplayPref';

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
    './audioClipDisplayPref': audioClipDisplayPref,
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
    const copy = screen.getAllByRole('button')
      .find((candidate) => candidate.getAttribute('aria-label')?.startsWith(t.timeline.toolbar.copy));
    expect(copy?.hasAttribute('aria-pressed')).toBe(false);
  });
});

describe('TimelineToolbar — layout', () => {
  // Undo / redo moved to the editor top bar (spec §3.8); Ctrl+Z / Ctrl+Y stay
  // in TimelinePanel's keyboard handler.
  it('toolbar_has_no_undo_redo_buttons', () => {
    renderToolbar();
    const labels = screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? '');
    expect(labels.filter((label) =>
      label.startsWith(t.workbench.topBar.undo) || label.startsWith(t.workbench.topBar.redo),
    )).toEqual([]);
  });

  it('toolbar_keeps_every_other_entry_in_spec_group_order', () => {
    renderToolbar();
    const labels = screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? '');
    const order = [
      t.timeline.toolbar.cut,
      t.timeline.toolbar.copy,
      t.timeline.toolbar.delete,
      t.timeline.toolbar.organizeMaterials,
      t.timeline.toolbar.motion,
      t.timeline.toolbar.subtitles,
      t.timeline.toolbar.exportJson,
      t.timeline.toolbar.importProject,
      t.timeline.toolbar.effects,
      t.timeline.toolbar.transitions,
    ];
    expect(order.map((label) => labels.findIndex((candidate) => candidate.startsWith(label))))
      .toEqual(order.map((_, index) => index));
  });

  it('toolbar_buttons_have_28px_hit_areas', () => {
    renderToolbar();
    const buttons = screen.getAllByRole('button');
    expect(buttons.every((button) => button.className.includes('w-7') && button.className.includes('h-7')))
      .toBe(true);
  });
});
