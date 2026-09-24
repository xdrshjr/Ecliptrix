import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  document.body.innerHTML = '';
});

function renderToolbar(): HTMLElement {
  const handlers = Object.fromEntries(
    ['onExportJSON', 'onImportJSON', 'onOrganizeMaterials', 'onCopy', 'onOpenCameraMotion',
      'onAddEffect', 'onAddTransition', 'onAddSubtitle'].map((name) => [name, vi.fn()]),
  );
  const { container } = render(React.createElement(TimelineToolbar, handlers));
  return container;
}

describe('TimelineToolbar — tooltips', () => {
  it('hovering a toolbar button portals its tooltip to document.body', () => {
    const container = renderToolbar();
    const label = `${t.timeline.toolbar.cut} (${t.timeline.shortcuts.cutShortcut})`;
    const cut = screen.getAllByRole('button').find((button) => button.getAttribute('aria-label') === label)!;
    fireEvent.mouseEnter(cut);
    const tooltip = Array.from(document.body.querySelectorAll('div'))
      .find((element) => element.textContent === label && !container.contains(element));
    expect(tooltip).toBeDefined();
  });

  it('no native title alongside a custom tooltip', () => {
    const container = renderToolbar();
    expect(container.querySelectorAll('button[title]').length).toBe(0);
  });
});
