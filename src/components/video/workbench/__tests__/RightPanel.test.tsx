/** RightPanel — the 「素材 | 属性」 tabs (spec §3.7). */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import panelSource from '../RightPanel.tsx?raw';
import { getTranslations } from '@/lib/i18n';
import * as focusStoreModule from '@/stores/editorFocusStore';
import type { RightPanelProps } from '../RightPanel';
import {
  compileComponent,
  localeContextModule,
  reactModules,
} from '../../timeline/__tests__/test-utils/compileComponent';

const { useEditorFocusStore } = focusStoreModule;
const en = getTranslations('en');
let RightPanel: React.FC<RightPanelProps>;

beforeAll(() => {
  RightPanel = compileComponent<RightPanelProps>(panelSource, {
    ...reactModules(),
    ...localeContextModule(),
    '@/stores/editorFocusStore': focusStoreModule,
  });
});

beforeEach(() => {
  useEditorFocusStore.getState().setRightPanelTab('materials');
});

afterEach(() => {
  cleanup();
});

function renderPanel() {
  render(React.createElement(RightPanel, {
    materialsPanel: React.createElement('input', { 'aria-label': 'search', defaultValue: '' }),
    inspectorPanel: React.createElement('p', null, 'inspector body'),
  }));
}

const tab = (name: string) => screen.getByRole('tab', { name });

describe('RightPanel', () => {
  it('both_panels_stay_mounted_when_switching_tabs', () => {
    renderPanel();
    const search = screen.getByLabelText('search') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'sunset' } });
    fireEvent.click(tab(en.workbench.side.tabProperties));
    fireEvent.click(tab(en.workbench.side.tabMaterials));
    expect({
      sameNode: screen.getByLabelText('search') === search,
      query: search.value,
      inspectorMounted: screen.getByText('inspector body', { selector: 'p' }) !== null,
    }).toEqual({ sameNode: true, query: 'sunset', inspectorMounted: true });
  });

  it('inactive_panel_is_hidden', () => {
    renderPanel();
    const panels = screen.getAllByRole('tabpanel', { hidden: true });
    expect(panels.map((panel) => panel.hidden)).toEqual([false, true]);
  });

  it('tab_click_sets_right_panel_tab', () => {
    renderPanel();
    fireEvent.click(tab(en.workbench.side.tabProperties));
    expect({
      store: useEditorFocusStore.getState().rightPanelTab,
      selected: tab(en.workbench.side.tabProperties).getAttribute('aria-selected'),
    }).toEqual({ store: 'properties', selected: 'true' });
  });

  it('arrow_keys_move_between_tabs', () => {
    renderPanel();
    fireEvent.keyDown(tab(en.workbench.side.tabMaterials), { key: 'ArrowRight' });
    const afterRight = useEditorFocusStore.getState().rightPanelTab;
    fireEvent.keyDown(tab(en.workbench.side.tabProperties), { key: 'ArrowLeft' });
    expect([afterRight, useEditorFocusStore.getState().rightPanelTab])
      .toEqual(['properties', 'materials']);
  });

  it('tabs_control_their_panels', () => {
    renderPanel();
    const materialsTab = tab(en.workbench.side.tabMaterials);
    const panel = document.getElementById(materialsTab.getAttribute('aria-controls') ?? '');
    expect(panel?.getAttribute('role')).toBe('tabpanel');
  });
});
