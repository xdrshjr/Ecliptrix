/**
 * @vitest-environment node
 *
 * iter9 Bugs #4, #6, #7 — VerticalTaskbar a11y + i18n.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(
  resolve(__dirname, '..', 'VerticalTaskbar.tsx'),
  'utf-8',
);
const TASKBAR_SRC = readFileSync(
  resolve(__dirname, '..', 'Taskbar.tsx'),
  'utf-8',
);
const I18N_SRC = readFileSync(
  resolve(__dirname, '../..', 'lib', 'i18n.ts'),
  'utf-8',
);

describe('VerticalTaskbar — Bug #4 hardcoded toast removed', () => {
  it('VerticalTaskbar uses the new i18n key', () => {
    expect(SRC).toMatch(/showWarning\(t\.auth\.loginRequiredForTasks, 4000\)/);
    expect(SRC).not.toMatch(/showWarning\('请先登录后再使用任务功能'/);
  });

  it('Taskbar.tsx also switched to the i18n key', () => {
    expect(TASKBAR_SRC).toMatch(/showWarning\(t\.auth\.loginRequiredForTasks, 4000\)/);
    expect(TASKBAR_SRC).not.toMatch(/showWarning\('请先登录后再使用任务功能'/);
  });

  it('i18n dictionary defines loginRequiredForTasks in EN + zh-CN + interface', () => {
    expect(I18N_SRC).toMatch(/loginRequiredForTasks: string;/);
    expect(I18N_SRC).toMatch(/loginRequiredForTasks: 'Please sign in to use task features'/);
    expect(I18N_SRC).toMatch(/loginRequiredForTasks: '请先登录后再使用任务功能'/);
  });
});

describe('VerticalTaskbar — Bug #6 close-button accessible name', () => {
  it('close button uses t.common.closeTab template + replaces {title}', () => {
    expect(SRC).toMatch(/aria-label=\{t\.common\.closeTab\.replace\('\{title\}', getTaskLabel\(tab\.type\)\)\}/);
  });

  it('close button is type="button" with aria-hidden svg', () => {
    // close button block
    const closeBlock = SRC.match(/<button[\s\S]*?className="tab-close"[\s\S]*?<\/button>/);
    expect(closeBlock).not.toBeNull();
    expect(closeBlock![0]).toMatch(/type="button"/);
    expect(closeBlock![0]).toMatch(/aria-hidden="true"/);
  });

  it('i18n defines closeTab template in interface + EN + zh-CN', () => {
    expect(I18N_SRC).toMatch(/closeTab: string;/);
    expect(I18N_SRC).toMatch(/closeTab: 'Close tab \{title\}'/);
    expect(I18N_SRC).toMatch(/closeTab: '关闭标签 \{title\}'/);
  });
});

describe('VerticalTaskbar — Bug #7 keyboard-reachable tab', () => {
  it('selectTab helper replaces handleTabClick (no event arg)', () => {
    expect(SRC).toMatch(/const selectTab = \(tab: Tab\) => \{/);
    expect(SRC).not.toMatch(/const handleTabClick =/);
  });

  it('tab div exposes role="button", tabIndex={0}, aria-label, aria-current', () => {
    expect(SRC).toMatch(/role="button"/);
    expect(SRC).toMatch(/tabIndex=\{0\}/);
    expect(SRC).toMatch(/aria-current=\{tab\.isActive \? 'page' : undefined\}/);
    expect(SRC).toMatch(/aria-label=\{getTaskLabel\(tab\.type\)\}/);
  });

  it('onKeyDown guards against bubbling from inner controls', () => {
    expect(SRC).toMatch(/if \(e\.target !== e\.currentTarget\) return;/);
    expect(SRC).toMatch(/if \(e\.key === 'Enter' \|\| e\.key === ' '\)/);
  });

  it('onClick still stops propagation to taskbar root', () => {
    expect(SRC).toMatch(/e\.stopPropagation\(\);\s+selectTab\(tab\);/);
  });
});
