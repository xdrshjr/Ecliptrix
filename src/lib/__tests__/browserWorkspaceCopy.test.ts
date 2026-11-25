/**
 * @vitest-environment node
 *
 * Copy parity (zh-CN ⇄ en), the v2 disclosure wording (AC-C11) and the colour
 * contrast of the Dock's accent tokens in both themes (AC-D12).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { browserWorkspaceCopy, fillCopy } from '../browserWorkspaceCopy';
import { getTranslations } from '../i18n';

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((all, [key, value]) => (
    typeof value === 'string'
      ? { ...all, [`${prefix}${key}`]: value }
      : { ...all, ...leaves(value, `${prefix}${key}.`) }
  ), {});
}
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe('browser workspace copy', () => {
  const zh = leaves(browserWorkspaceCopy['zh-CN'] as unknown as Tree);
  const en = leaves(browserWorkspaceCopy.en as unknown as Tree);

  it('has_the_same_keys_in_both_languages', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });

  it('never_leaves_an_empty_string_and_keeps_placeholders_in_step', () => {
    for (const key of Object.keys(zh)) {
      expect(zh[key].trim(), `zh ${key}`).not.toBe('');
      expect(en[key].trim(), `en ${key}`).not.toBe('');
      expect(placeholders(en[key]), key).toEqual(placeholders(zh[key]));
    }
  });

  it('is_wired_into_both_locales_of_the_translation_table', () => {
    expect(getTranslations('en').browserWorkspace).toBe(browserWorkspaceCopy.en);
    expect(getTranslations('zh-CN').browserWorkspace).toBe(browserWorkspaceCopy['zh-CN']);
  });

  it('discloses_that_page_content_reaches_the_model_provider_in_both_languages', () => {
    expect(browserWorkspaceCopy['zh-CN'].consent.body).toContain('发送给你配置的模型服务');
    expect(browserWorkspaceCopy['zh-CN'].privacy.banner).toContain('发送给你配置的模型服务');
    expect(browserWorkspaceCopy.en.consent.body).toContain('sent to your configured model provider');
    expect(browserWorkspaceCopy.en.privacy.banner).toContain('sent to your configured model provider');
    expect(browserWorkspaceCopy['zh-CN'].consent.body).toContain('1 天');
    expect(browserWorkspaceCopy.en.consent.body).toContain('1 day');
  });

  it('carries_the_appendix_b_headline_strings', () => {
    expect(browserWorkspaceCopy['zh-CN'].footer.label).toBe('浏览器');
    expect(browserWorkspaceCopy['zh-CN'].footer.needsUser).toBe('需要你操作');
    expect(browserWorkspaceCopy['zh-CN'].footer.agentBackground).toBe('Agent 正在后台浏览 · 点击查看');
    expect(browserWorkspaceCopy.en.unavailable.dev).toBe('The browser workspace is desktop-only');
  });

  it('fills_placeholders_and_leaves_unknown_ones_visible', () => {
    expect(fillCopy('Hi {name}, {n} new, {missing}', { name: 'A', n: 3 })).toBe('Hi A, 3 new, {missing}');
  });
});

// ── contrast (AC-D12) ──

const css = readFileSync(resolve(__dirname, '../../styles/browser-workspace.css'), 'utf-8');
const globals = readFileSync(resolve(__dirname, '../../styles/globals.css'), 'utf-8');

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function token(source: string, name: string, from = 0): string {
  const match = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(source.slice(from));
  if (!match) throw new Error(`token ${name} not found`);
  return match[1];
}
const lightFrom = globals.search(/^\s*\.light\s*\{/m);

describe('accent contrast (AC-D12)', () => {
  const darkAgent = token(css, '--ws-agent');
  const lightAgent = token(css.slice(css.indexOf('.light .editor-workbench')), '--ws-agent');
  const darkSecure = token(css, '--ws-secure');
  const lightSecure = token(css.slice(css.indexOf('.light .editor-workbench')), '--ws-secure');

  it.each([
    ['dark agent clay on the dark panel', darkAgent, token(globals, '--card')],
    ['dark agent clay on the dark page', darkAgent, token(globals, '--background')],
    ['dark secure green on the dark panel', darkSecure, token(globals, '--card')],
    ['light agent clay on the light panel', lightAgent, token(globals, '--card', lightFrom)],
    ['light agent clay on the light page', lightAgent, token(globals, '--background', lightFrom)],
    ['light secure green on the light panel', lightSecure, token(globals, '--card', lightFrom)],
  ])('%s is at least 4.5:1', (_label, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});
