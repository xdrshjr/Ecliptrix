/**
 * Dock integration: renders only with a bridge, glues the native view, freezes it
 * while a layer overlaps, hides it during the slide, and runs the user commands.
 */
import * as React from 'react';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BrowserDock from '../BrowserDock';
import { DOCK_ENTER_MS } from '../useDockLifecycle';
import {
  installBridge, makeApproval, makeState, makeStore, makeTab, removeBridge, renderWithProviders,
} from './testUtils';

vi.mock('@/lib/api/systemSettings', () => ({
  getCategorySettings: vi.fn(() => Promise.resolve({ success: true, settings: [] })),
}));

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
});
afterEach(() => { cleanup(); removeBridge(); vi.unstubAllGlobals(); });

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, DOCK_ENTER_MS + 60)); });

describe('BrowserDock', () => {
  it('renders_nothing_without_a_bridge_or_while_closed', () => {
    removeBridge();
    const absent = renderWithProviders(<BrowserDock />, makeStore(null, { hasBridge: false, open: true }));
    expect(absent.container.querySelector('[data-browser-dock-root]')).toBeNull();
    absent.unmount();
    installBridge();
    const closed = renderWithProviders(<BrowserDock />, makeStore());
    expect(closed.container.querySelector('[data-browser-dock-root]')).toBeNull();
  });

  it('is_a_labelled_complementary_region_with_the_tablist_toolbar_and_viewport', () => {
    installBridge();
    renderWithProviders(<BrowserDock />, makeStore(makeState(), { open: true }));
    expect(screen.getByRole('complementary', { name: 'Browser workspace' })).toBeTruthy();
    expect(screen.getByRole('tablist', { name: 'Tabs' })).toBeTruthy();
    expect(screen.getByRole('toolbar', { name: 'Browser toolbar' })).toBeTruthy();
    expect(document.querySelector('[data-browser-viewport]')).not.toBeNull();
  });

  it('does_not_render_a_dock_when_the_identity_gate_locks_the_app', () => {
    installBridge();
    renderWithProviders(<BrowserDock />, makeStore(makeState({ locked: true }), { open: true }));
    expect(document.querySelector('[data-browser-dock-root]')).toBeNull();
  });

  it('keeps_the_native_view_hidden_while_sliding_then_glues_and_shows_it', async () => {
    const bridge = installBridge();
    renderWithProviders(<BrowserDock />, makeStore(makeState(), { open: true }));
    // Opening: the view must not be shown or positioned yet.
    expect(bridge.setVisible).not.toHaveBeenCalledWith(true);
    expect(bridge.setBounds).not.toHaveBeenCalledWith(expect.objectContaining({ width: expect.any(Number) }));
    await settle();
    await waitFor(() => expect(bridge.setVisible).toHaveBeenCalledWith(true));
  });

  it('opens_a_first_tab_when_the_workspace_has_none', async () => {
    const bridge = installBridge(makeState({ tabs: [], activeTabId: null }));
    renderWithProviders(<BrowserDock />, makeStore(makeState({ tabs: [], activeTabId: null }), { open: true }));
    await waitFor(() => expect(bridge.openTab).toHaveBeenCalledTimes(1));
  });

  it('shows_the_start_page_for_a_blank_tab_and_navigates_from_a_site_card', () => {
    const bridge = installBridge();
    renderWithProviders(<BrowserDock />, makeStore(
      makeState({ tabs: [makeTab({ url: 'about:blank', title: '' })] }), { open: true }));
    expect(document.querySelector('.bw-start')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /BBC News/ }));
    expect(bridge.navigate).toHaveBeenCalledWith('tab-1', 'https://www.bbc.com/news');
  });

  it('submits_the_address_bar_through_the_omnibox', () => {
    const bridge = installBridge();
    renderWithProviders(<BrowserDock />, makeStore(makeState(), { open: true }));
    const input = screen.getByRole('textbox', { name: 'Address bar' });
    fireEvent.change(input, { target: { value: 'javascript:alert(1)' } });
    fireEvent.submit(input.closest('form')!);
    expect(bridge.navigate).toHaveBeenCalledTimes(1);
    expect(String((bridge.navigate as ReturnType<typeof vi.fn>).mock.calls[0][1]))
      .toMatch(/^https:\/\/www\.bing\.com\/search\?q=/);
  });

  it('shows_take_over_while_the_agent_holds_control_and_hand_back_after', () => {
    const bridge = installBridge();
    const agent = makeState({ control: { holder: 'agent', since: 1 } });
    const store = makeStore(agent, { open: true });
    renderWithProviders(<BrowserDock />, store);
    fireEvent.click(screen.getByRole('button', { name: /Take over/ }));
    expect(bridge.takeOver).toHaveBeenCalled();
    act(() => { store.setWorkspace(makeState({ control: { holder: 'user', since: 2 } })); });
    fireEvent.click(screen.getByRole('button', { name: /Hand back/ }));
    expect(bridge.returnControl).toHaveBeenCalled();
  });

  it('shows_the_approval_banner_in_flow_and_resolves_it', () => {
    const bridge = installBridge();
    renderWithProviders(<BrowserDock />, makeStore(
      makeState({ approvals: [makeApproval()] }), { open: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Always allow' }));
    expect(bridge.resolveApproval).toHaveBeenCalledWith('ap-1', 'approve_scope');
  });

  it('shows_a_dom_state_instead_of_the_native_view_for_a_crashed_tab', () => {
    installBridge();
    renderWithProviders(<BrowserDock />, makeStore(
      makeState({ tabs: [makeTab({ crashed: true })] }), { open: true }));
    expect(screen.getByRole('alert').textContent).toContain('This page crashed');
  });

  it('shows_the_unavailable_state_with_a_reason_when_the_workspace_is_off', () => {
    installBridge();
    renderWithProviders(<BrowserDock />, makeStore(makeState({ enabled: false }), { open: true }));
    expect(screen.getByText('The browser workspace is turned off in Settings')).toBeTruthy();
  });

  it('shows_the_privacy_note_once_and_remembers_the_acknowledgement', () => {
    installBridge();
    const store = makeStore(makeState(), { open: true });
    renderWithProviders(<BrowserDock />, store);
    expect(screen.getByRole('note').textContent).toContain('sent to your configured model provider');
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('note')).toBeNull();
    expect(store.getSnapshot().privacyAcked).toBe(true);
  });

  it('freezes_the_live_view_when_a_floating_layer_overlaps_the_viewport', async () => {
    const bridge = installBridge();
    const store = makeStore(makeState(), { open: true });
    renderWithProviders(<BrowserDock />, store);
    await settle();
    const viewport = document.querySelector<HTMLElement>('[data-browser-viewport]')!;
    viewport.getBoundingClientRect = () => ({
      left: 0, top: 40, right: 600, bottom: 500, width: 600, height: 460, x: 0, y: 40, toJSON: () => ({}),
    });
    const layer = document.createElement('div');
    layer.setAttribute('role', 'dialog');
    layer.getBoundingClientRect = () => ({
      left: 100, top: 100, right: 300, bottom: 300, width: 200, height: 200, x: 100, y: 100, toJSON: () => ({}),
    });
    act(() => { document.body.appendChild(layer); });
    await waitFor(() => expect(bridge.captureFrozen).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelector('.bw-frozen')).not.toBeNull());
    expect(bridge.setVisible).toHaveBeenLastCalledWith(false);

    act(() => { layer.remove(); });
    await waitFor(() => expect(bridge.setVisible).toHaveBeenLastCalledWith(true));
    await waitFor(() => expect(document.querySelector('.bw-frozen')).toBeNull());
  });
});
