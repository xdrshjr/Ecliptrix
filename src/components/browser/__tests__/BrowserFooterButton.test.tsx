/**
 * Footer button: four states, aria, compact mode, absent/disabled bridge
 * (spec §4.6.2, AC-D1/D2/D3).
 */
import * as React from 'react';
import { act, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BrowserFooterButton from '../BrowserFooterButton';
import {
  installBridge, makeApproval, makeState, makeStore, removeBridge, renderWithProviders,
} from './testUtils';

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { cleanup(); removeBridge(); vi.useRealTimers(); });

const button = () => document.querySelector<HTMLButtonElement>('.bw-footer-btn')!;

describe('BrowserFooterButton', () => {
  it('renders_nothing_without_the_desktop_bridge', () => {
    removeBridge();
    renderWithProviders(<BrowserFooterButton />, makeStore(null, { hasBridge: false }));
    expect(document.querySelector('.bw-footer-btn')).toBeNull();
  });

  it('is_a_ws_footer_btn_so_roving_focus_includes_it', () => {
    installBridge();
    renderWithProviders(<BrowserFooterButton />, makeStore());
    expect(button().classList.contains('ws-footer-btn')).toBe(true);
    expect(button().tabIndex).toBe(-1);
  });

  it('idle_state_reflects_pressed_false_and_toggles_the_dock', () => {
    installBridge();
    const store = makeStore();
    renderWithProviders(<BrowserFooterButton />, store);
    expect(button().getAttribute('data-bw-state')).toBe('idle');
    expect(button().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button());
    expect(store.getSnapshot().dockOpen).toBe(true);
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(button().getAttribute('data-bw-state')).toBe('open');
  });

  it('agent_active_state_announces_through_aria_label_and_a_debounced_live_region', () => {
    installBridge();
    const store = makeStore(makeState({ control: { holder: 'agent', since: 1 } }));
    renderWithProviders(<BrowserFooterButton />, store);
    expect(button().getAttribute('data-bw-state')).toBe('agent-active');
    expect(button().getAttribute('aria-label')).toBe('Browser — Agent is using it');
    expect(button().textContent).toContain('Agent');
    const live = document.querySelector('[role="status"].bw-sr-only')!;
    expect(live.textContent).toBe('');
    act(() => { vi.advanceTimersByTime(900); });
    expect(live.textContent).toBe('The Agent started using the browser');
  });

  it('needs_user_wins_over_agent_active_and_shows_the_badge', () => {
    installBridge();
    const store = makeStore(makeState({
      control: { holder: 'agent', since: 1 }, approvals: [makeApproval()],
    }));
    renderWithProviders(<BrowserFooterButton />, store);
    expect(button().getAttribute('data-bw-state')).toBe('needs-user');
    expect(button().querySelector('.bw-footer-badge')).not.toBeNull();
    expect(button().getAttribute('aria-label')).toBe('Needs your input');
  });

  it('shows_a_background_bubble_when_the_agent_works_with_the_dock_closed', () => {
    installBridge();
    const store = makeStore(makeState({ control: { holder: 'agent', since: 1 } }));
    renderWithProviders(<BrowserFooterButton />, store);
    const bubble = document.querySelector('.bw-bubble')!;
    expect(bubble.textContent).toBe('The Agent is browsing in the background · View');
    expect(bubble.getAttribute('data-native-occluder')).toBe('true');
    act(() => { vi.advanceTimersByTime(7000); });
    expect(document.querySelector('.bw-bubble')).toBeNull();
  });

  it('opening_from_the_bubble_activates_the_agent_tab', () => {
    const bridge = installBridge(makeState({
      control: { holder: 'agent', since: 1 },
    }));
    const store = makeStore(makeState({
      control: { holder: 'agent', since: 1 },
      tabs: [{ ...makeState().tabs[0], id: 'agent-tab', owner: 'agent' }],
      activeTabId: 'agent-tab',
    }));
    renderWithProviders(<BrowserFooterButton />, store);
    fireEvent.click(document.querySelector('.bw-bubble')!);
    expect(bridge.activateTab).toHaveBeenCalledWith('agent-tab');
    expect(store.getSnapshot().dockOpen).toBe(true);
  });

  it('keeps_its_state_markers_in_compact_mode_where_the_label_is_css_hidden', () => {
    installBridge();
    const store = makeStore(makeState({ control: { holder: 'agent', since: 1 } }));
    const { container } = renderWithProviders(
      <div className="ws-footer-tools" data-compact="true"><BrowserFooterButton /></div>, store);
    expect(container.querySelector('.ws-footer-tools[data-compact="true"]')).not.toBeNull();
    // The label span is what CSS hides; the state attribute and orbit icon stay.
    expect(button().getAttribute('data-bw-state')).toBe('agent-active');
    expect(button().querySelector('.bw-footer-icon')).not.toBeNull();
  });

  it('is_aria_disabled_with_a_reason_when_turned_off_or_unavailable', () => {
    installBridge();
    const store = makeStore(makeState({ enabled: false }));
    renderWithProviders(<BrowserFooterButton />, store);
    expect(button().getAttribute('aria-disabled')).toBe('true');
    expect(button().title).toBe('Turned off in Settings');
    fireEvent.click(button());
    expect(store.getSnapshot().dockOpen).toBe(false);
  });
});
