/**
 * ProfileSwitcher / LoginSitesPanel / BrowserTabStrip / useViewBounds behaviour.
 */
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BrowserTabStrip from '../BrowserTabStrip';
import LoginSitesPanel from '../LoginSitesPanel';
import ProfileSwitcher from '../ProfileSwitcher';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { useViewBounds } from '../useViewBounds';
import {
  installBridge, makeState, makeStore, makeTab, removeBridge, renderWithProviders,
} from './testUtils';

afterEach(() => { cleanup(); removeBridge(); vi.unstubAllGlobals(); });

const twoProfiles = () => [
  ...makeState().profiles,
  { id: 'work', name: 'Work', color: '#D97757', loginSiteCount: 2, agentConsent: true },
];

describe('ProfileSwitcher', () => {
  it('switches_profile_through_the_bridge', async () => {
    const bridge = installBridge();
    renderWithProviders(
      <ProfileSwitcher profiles={twoProfiles()} activeId="default" agentBusy={false} />, makeStore());
    fireEvent.click(screen.getByRole('button', { name: /Browser profiles/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Work/ }));
    await waitFor(() => expect(bridge.profiles.switch).toHaveBeenCalledWith('work'));
  });

  it('refuses_to_switch_while_the_agent_is_using_the_browser', () => {
    const bridge = installBridge();
    renderWithProviders(
      <ProfileSwitcher profiles={twoProfiles()} activeId="default" agentBusy />, makeStore());
    fireEvent.click(screen.getByRole('button', { name: /Browser profiles/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Work/ }));
    expect(bridge.profiles.switch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('cannot be switched');
  });

  it('creates_a_profile_and_hides_the_form_at_the_limit_of_five', async () => {
    const bridge = installBridge();
    const { unmount } = renderWithProviders(
      <ProfileSwitcher profiles={twoProfiles()} activeId="default" agentBusy={false} />, makeStore());
    fireEvent.click(screen.getByRole('button', { name: /Browser profiles/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New profile' }), { target: { value: 'Side' } });
    fireEvent.click(screen.getByRole('button', { name: 'New profile' }));
    await waitFor(() => expect(bridge.profiles.create).toHaveBeenCalledWith({ name: 'Side' }));
    unmount();

    const five = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`, name: `P${i}`, color: '#fff', loginSiteCount: 0, agentConsent: false,
    }));
    renderWithProviders(<ProfileSwitcher profiles={five} activeId="p0" agentBusy={false} />, makeStore());
    fireEvent.click(screen.getByRole('button', { name: /Browser profiles/ }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Up to 5 profiles')).toBeTruthy();
  });

  it('asks_for_confirmation_before_clearing_data', async () => {
    const bridge = installBridge();
    renderWithProviders(
      <ProfileSwitcher profiles={twoProfiles()} activeId="default" agentBusy={false} />, makeStore());
    fireEvent.click(screen.getByRole('button', { name: /Browser profiles/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Clear data: Work/ }));
    expect(bridge.profiles.clearData).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Confirm' }));
    await waitFor(() => expect(bridge.profiles.clearData).toHaveBeenCalledWith('work'));
  });

  it('maps_a_duplicate_name_error_code_to_a_message', async () => {
    const bridge = installBridge();
    (bridge.profiles.create as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: false, code: 'duplicate_name' });
    renderWithProviders(
      <ProfileSwitcher profiles={twoProfiles()} activeId="default" agentBusy={false} />, makeStore());
    fireEvent.click(screen.getByRole('button', { name: /Browser profiles/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New profile' }), { target: { value: 'Work' } });
    fireEvent.click(screen.getByRole('button', { name: 'New profile' }));
    expect((await screen.findByRole('alert')).textContent).toBe('A profile with this name exists');
  });

  it('escape_closes_the_menu_and_returns_focus_to_the_trigger', () => {
    installBridge();
    renderWithProviders(
      <ProfileSwitcher profiles={twoProfiles()} activeId="default" agentBusy={false} />, makeStore());
    const trigger = screen.getByRole('button', { name: /Browser profiles/ });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('LoginSitesPanel', () => {
  it('lists_hosts_with_cookie_counts_and_removes_a_site', async () => {
    const bridge = installBridge();
    renderWithProviders(<LoginSitesPanel cookieTtlDays={30} activeProfileId="default" />, makeStore());
    fireEvent.click(screen.getByRole('button', { name: 'Signed-in sites' }));
    expect(await screen.findByText('weibo.com')).toBeTruthy();
    expect(screen.getByText('3 cookies')).toBeTruthy();
    expect(screen.getByRole('dialog').getAttribute('data-native-occluder')).toBe('true');
    expect(screen.getByText('Session cookies are kept for 30 days (change in Settings)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove sign-in: weibo.com' }));
    await waitFor(() => expect(bridge.removeSite).toHaveBeenCalledWith('weibo.com'));
  });

  it('renders_nothing_when_the_bridge_lacks_loginSites', () => {
    const bridge = installBridge();
    delete (bridge as Record<string, unknown>).loginSites;
    const { container } = renderWithProviders(
      <LoginSitesPanel cookieTtlDays={30} activeProfileId="default" />, makeStore());
    expect(container.querySelector('button')).toBeNull();
  });
});

describe('BrowserTabStrip', () => {
  const tabs = [makeTab({ id: 'a', title: 'Alpha' }), makeTab({ id: 'b', title: 'Beta', owner: 'agent' })];
  const mount = (props: Partial<React.ComponentProps<typeof BrowserTabStrip>> = {}) => {
    const handlers = { onActivate: vi.fn(), onClose: vi.fn(), onNewTab: vi.fn() };
    render(
      <LocaleProvider>
        <BrowserTabStrip tabs={tabs} activeTabId="a" maxTabs={8} {...handlers} {...props} />
      </LocaleProvider>,
    );
    return handlers;
  };

  it('exposes_tab_semantics_and_marks_agent_tabs', () => {
    mount();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: /Alpha/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /Beta/ }).querySelector('.bw-agent-dot')).not.toBeNull();
  });

  it('arrow_keys_activate_neighbours_and_delete_closes', () => {
    const handlers = mount();
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(handlers.onActivate).toHaveBeenCalledWith('b');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Delete' });
    expect(handlers.onClose).toHaveBeenCalledWith('a');
  });

  it('disables_the_new_tab_button_at_the_limit', () => {
    mount({ maxTabs: 2 });
    expect((screen.getByRole('button', { name: 'New tab' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('useViewBounds', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  });

  function Probe({ active }: { active: boolean }) {
    const ref = React.useRef<HTMLDivElement>(null);
    useViewBounds(ref, active);
    return <div ref={ref} data-testid="probe" />;
  }
  const stubRect = () => {
    (HTMLElement.prototype as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = () => ({
      x: 10.4, y: 20.6, width: 300.2, height: 200.7, left: 10.4, top: 20.6, right: 310, bottom: 221,
      toJSON: () => ({}),
    });
  };

  it('sends_one_rounded_rect_when_active_and_detaches_with_null_when_inactive', async () => {
    const bridge = installBridge();
    stubRect();
    const view = render(<Probe active />);
    await waitFor(() => expect(bridge.setBounds).toHaveBeenCalledWith({ x: 10, y: 21, width: 300, height: 201 }));
    expect(bridge.setBounds).toHaveBeenCalledTimes(1);
    view.rerender(<Probe active={false} />);
    await waitFor(() => expect(bridge.setBounds).toHaveBeenLastCalledWith(null));
  });

  it('detaches_the_view_when_the_placeholder_unmounts', async () => {
    const bridge = installBridge();
    stubRect();
    const view = render(<Probe active />);
    await waitFor(() => expect(bridge.setBounds).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(bridge.setBounds).toHaveBeenLastCalledWith(null);
  });

  it('coalesces_a_burst_of_resize_events_into_one_send', async () => {
    const bridge = installBridge();
    stubRect();
    render(<Probe active />);
    await waitFor(() => expect(bridge.setBounds).toHaveBeenCalledTimes(1));
    (HTMLElement.prototype as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = () => ({
      x: 0, y: 0, width: 640, height: 480, left: 0, top: 0, right: 640, bottom: 480, toJSON: () => ({}),
    });
    act(() => { for (let i = 0; i < 20; i += 1) window.dispatchEvent(new Event('resize')); });
    await waitFor(() => expect(bridge.setBounds).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 30));
    expect(bridge.setBounds).toHaveBeenCalledTimes(2);
  });

  it('does_nothing_without_a_bridge', () => {
    removeBridge();
    expect(() => render(<Probe active />)).not.toThrow();
  });
});
