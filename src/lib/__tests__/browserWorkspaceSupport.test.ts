/**
 * Small pure pieces: quick-site registry, the Dock shortcut and the per-method
 * bridge detection (spec §4.6.1, §4.6.3, F15).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BROWSER_SITES, isAllowedBrowserSite } from '../browserSites';
import { isBrowserToggleShortcut } from '../browserShortcut';
import { resolveWorkbenchShortcut } from '@/components/video/workbench/useWorkbenchShortcuts';
import { bridgeCan, getBrowserBridge } from '../api/browserBridge';
import { installBridge, removeBridge } from '@/components/browser/__tests__/testUtils';

describe('browser quick sites', () => {
  it('are_all_https_allow_listed_and_unique', () => {
    const ids = new Set(BROWSER_SITES.map((site) => site.id));
    expect(ids.size).toBe(BROWSER_SITES.length);
    for (const site of BROWSER_SITES) {
      expect(site.url.startsWith('https://'), site.id).toBe(true);
      expect(isAllowedBrowserSite(site.url), site.id).toBe(true);
    }
  });

  it('rejects_http_lookalike_hosts_credentials_and_other_schemes', () => {
    expect(isAllowedBrowserSite('http://weibo.com/')).toBe(false);
    expect(isAllowedBrowserSite('https://weibo.com.evil.example/')).toBe(false);
    expect(isAllowedBrowserSite('https://evilweibo.com/')).toBe(false);
    expect(isAllowedBrowserSite('https://user:pw@weibo.com/')).toBe(false);
    expect(isAllowedBrowserSite('javascript:alert(1)')).toBe(false);
    expect(isAllowedBrowserSite('https://passport.bilibili.com/login')).toBe(true);
  });
});

describe('Dock shortcut', () => {
  const event = (patch: Partial<Parameters<typeof isBrowserToggleShortcut>[0]> = {}) => ({
    code: 'KeyB', ctrlKey: true, metaKey: false, altKey: true, shiftKey: false, repeat: false,
    target: document.body, defaultPrevented: false, ...patch,
  });

  it('is_ctrl_alt_b', () => {
    expect(isBrowserToggleShortcut(event(), null)).toBe(true);
    expect(isBrowserToggleShortcut(event({ ctrlKey: false, metaKey: true }), null)).toBe(true);
  });

  it('ignores_bare_alt_other_keys_repeat_and_shift', () => {
    expect(isBrowserToggleShortcut(event({ ctrlKey: false }), null)).toBe(false);
    expect(isBrowserToggleShortcut(event({ code: 'KeyA' }), null)).toBe(false);
    expect(isBrowserToggleShortcut(event({ repeat: true }), null)).toBe(false);
    expect(isBrowserToggleShortcut(event({ shiftKey: true }), null)).toBe(false);
  });

  it('never_fires_inside_text_fields', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(isBrowserToggleShortcut(event({ target: input }), input)).toBe(false);
    input.remove();
  });

  it('does_not_collide_with_any_workbench_chord', () => {
    for (const code of ['Digit1', 'Digit2', 'KeyA']) {
      expect(resolveWorkbenchShortcut(event({ code }), null)).not.toBeNull();
    }
    expect(resolveWorkbenchShortcut(event({ code: 'KeyB' }), null)).toBeNull();
  });
});

describe('browser bridge detection', () => {
  afterEach(removeBridge);

  it('is_null_without_a_bridge_or_without_state', () => {
    removeBridge();
    expect(getBrowserBridge()).toBeNull();
    (window as unknown as { ecliptrixDesktop: unknown }).ecliptrixDesktop = { browser: {} };
    expect(getBrowserBridge()).toBeNull();
  });

  it('detects_each_method_separately_including_nested_profiles', () => {
    installBridge();
    const bridge = getBrowserBridge();
    expect(bridgeCan(bridge, 'takeOver')).toBe(true);
    expect(bridgeCan(bridge, 'profiles.switch')).toBe(true);
    delete (bridge as Record<string, unknown>).revokeConsent;
    (bridge as { profiles: Record<string, unknown> }).profiles.remove = undefined;
    expect(bridgeCan(bridge, 'revokeConsent')).toBe(false);
    expect(bridgeCan(bridge, 'profiles.remove')).toBe(false);
    expect(bridgeCan(null, 'takeOver')).toBe(false);
  });
});
