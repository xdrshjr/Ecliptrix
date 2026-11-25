/**
 * Native-view occlusion (spec §4.2.3, R1-5, AC-D8/D13).
 */
import * as React from 'react';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  OCCLUDER_SELECTOR, collectOccluderRects, computeOcclusion, type Rect,
} from '../occlusion';
import ProfileSwitcher from '../ProfileSwitcher';
import { installBridge, makeState, makeStore, removeBridge, renderWithProviders } from './testUtils';

const view: Rect = { left: 100, top: 100, right: 500, bottom: 400 };

describe('computeOcclusion', () => {
  it('is_true_when_any_rect_overlaps_the_view', () => {
    expect(computeOcclusion(view, [{ left: 450, top: 350, right: 600, bottom: 500 }])).toBe(true);
  });
  it('is_false_for_disjoint_and_edge_touching_rects', () => {
    expect(computeOcclusion(view, [{ left: 500, top: 100, right: 700, bottom: 400 }])).toBe(false);
    expect(computeOcclusion(view, [{ left: 0, top: 0, right: 50, bottom: 50 }])).toBe(false);
    expect(computeOcclusion(view, [])).toBe(false);
  });
  it('is_false_for_an_empty_view', () => {
    expect(computeOcclusion({ left: 0, top: 0, right: 0, bottom: 10 },
      [{ left: -5, top: -5, right: 50, bottom: 50 }])).toBe(false);
  });
});

describe('collectOccluderRects', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  function mount(html: string): HTMLElement {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    host.querySelectorAll('*').forEach((el) => {
      (el as HTMLElement).getBoundingClientRect = () => ({
        left: 10, top: 10, right: 110, bottom: 60, width: 100, height: 50, x: 10, y: 10,
        toJSON: () => ({}),
      });
    });
    return host;
  }

  it('collects_dialogs_menus_and_marked_layers', () => {
    mount('<div role="dialog"></div><div role="menu"></div><div data-native-occluder></div>'
      + '<div data-overlay="true"></div><div role="tooltip"></div>');
    expect(collectOccluderRects()).toHaveLength(5);
  });

  it('exempts_the_in_flow_approval_bar_and_its_descendants', () => {
    mount('<div data-native-inflow="true" role="alertdialog"><div role="menu"></div></div>');
    expect(collectOccluderRects()).toHaveLength(0);
  });

  it('exempts_the_dock_root_but_not_a_menu_inside_it', () => {
    mount('<div data-browser-dock-root data-overlay="true"><div role="menu"></div></div>');
    // The root is exempt; the menu inside it (a Dock popover) must still count.
    expect(collectOccluderRects()).toHaveLength(1);
  });

  it('skips_zero_size_layers', () => {
    const host = mount('<div role="dialog"></div>');
    (host.firstElementChild as HTMLElement).getBoundingClientRect = () => ({
      left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
    });
    expect(collectOccluderRects()).toHaveLength(0);
  });
});

describe('Dock popovers occlude the viewport (AC-D8, R1-5)', () => {
  beforeEach(() => { installBridge(); });
  afterEach(() => { cleanup(); removeBridge(); });

  it('profile_switcher_menu_is_a_geometric_occluder_when_open', () => {
    const store = makeStore();
    renderWithProviders(
      <ProfileSwitcher profiles={makeState().profiles} activeId="default" agentBusy={false} />, store);
    expect(document.querySelectorAll(OCCLUDER_SELECTOR)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /Browser profiles|浏览器用户/ }));
    const menu = screen.getByRole('menu');
    expect(menu.matches(OCCLUDER_SELECTOR)).toBe(true);
    menu.getBoundingClientRect = () => ({
      left: 120, top: 120, right: 380, bottom: 300, width: 260, height: 180, x: 120, y: 120,
      toJSON: () => ({}),
    });
    expect(computeOcclusion(view, collectOccluderRects())).toBe(true);
  });
});
