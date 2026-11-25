/**
 * Approval banner (spec §4.5.3, §4.6.3): the three human gates, keyboard and focus.
 */
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/contexts/LocaleContext';
import ApprovalBanner from '../ApprovalBanner';
import { makeApproval } from './testUtils';

afterEach(cleanup);

function mount(approval = makeApproval(), onResolve = vi.fn()) {
  const utils = render(
    <LocaleProvider>
      <ApprovalBanner approval={approval} profileName="Work" onResolve={onResolve} />
    </LocaleProvider>,
  );
  return { onResolve, ...utils };
}

describe('ApprovalBanner', () => {
  it('is_an_assertive_alertdialog_marked_in_flow', () => {
    mount();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.getAttribute('aria-live')).toBe('assertive');
    expect(dialog.getAttribute('data-native-inflow')).toBe('true');
  });

  it('consent_names_the_profile_and_discloses_content_goes_to_the_model_provider', () => {
    mount();
    expect(screen.getByRole('alertdialog').getAttribute('aria-label'))
      .toBe('Let the Agent use "Work" sign-ins?');
    expect(screen.getByRole('alertdialog').textContent)
      .toContain('sent to your configured model provider');
    expect(screen.getByRole('alertdialog').textContent).toContain('Applies to "Work" only');
  });

  it('consent_maps_its_three_buttons_to_decisions', () => {
    const { onResolve } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'This time only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Always allow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onResolve.mock.calls.map((call) => call[1])).toEqual(['approve', 'approve_scope', 'deny']);
  });

  it('risky_action_shows_the_target_and_offers_scope_allow', () => {
    mount(makeApproval({
      kind: 'risky_action', reason: 'Posts publicly', target: { host: 'weibo.com', label: 'Publish' },
    }));
    expect(screen.getByRole('alertdialog').getAttribute('aria-label'))
      .toBe('The Agent wants to: Publish · weibo.com');
    expect(screen.getByRole('button', { name: 'Allow similar actions on this site this run' })).toBeTruthy();
  });

  it('handoff_has_done_and_cancel', () => {
    const { onResolve } = mount(makeApproval({ kind: 'handoff', reason: 'sign in to Zhihu' }));
    expect(screen.getByRole('alertdialog').getAttribute('aria-label'))
      .toBe('The Agent needs you to: sign in to Zhihu');
    fireEvent.click(screen.getByRole('button', { name: "I'm done" }));
    expect(onResolve).toHaveBeenCalledWith('ap-1', 'approve');
  });

  it('escape_denies_and_enter_allows_once', () => {
    const { onResolve } = mount();
    const dialog = screen.getByRole('alertdialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onResolve).toHaveBeenLastCalledWith('ap-1', 'deny');
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(onResolve).toHaveBeenLastCalledWith('ap-1', 'approve');
  });

  it('moves_focus_to_the_first_button_and_returns_it_afterwards', () => {
    render(<button type="button" data-testid="origin">origin</button>);
    const origin = screen.getByTestId('origin');
    origin.focus();
    const view = render(
      <LocaleProvider>
        <ApprovalBanner approval={makeApproval()} profileName="Work" onResolve={vi.fn()} />
      </LocaleProvider>,
    );
    expect(document.activeElement?.textContent).toBe('This time only');
    view.unmount();
    expect(document.activeElement).toBe(origin);
  });
});
