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
const I18N_SRC = readFileSync(
  resolve(__dirname, '../..', 'lib', 'i18n.ts'),
  'utf-8',
);

describe('VerticalTaskbar — no login gate', () => {
  // The sign-in warning that used to fire on tab selection is gone with the
  // user system: a local desktop app has exactly one owner and nothing to
  // sign in to. Selecting a tab must never be gated.
  it('does not gate tab selection behind a sign-in check', () => {
    expect(SRC).not.toMatch(/useAuth/);
    expect(SRC).not.toMatch(/isAuthenticated/);
    expect(SRC).not.toMatch(/loginRequiredForTasks/);
    expect(SRC).not.toMatch(/showWarning\('请先登录后再使用任务功能'/);
  });

  it('the retired i18n key is gone from all three dictionary blocks', () => {
    expect(I18N_SRC).not.toMatch(/loginRequiredForTasks/);
  });
});

describe('VerticalTaskbar — new-task entry point', () => {
  // Without this control a second task type is unreachable once the first
  // tab exists, and the taskbar can only ever show tabs that already exist.
  // editor-shell-ui-consolidation W2: ONE "+" that opens a type menu.
  it('renders a single new-task button when onOpenTask is supplied', () => {
    expect(SRC).toMatch(/onOpenTask\?: \(type: TaskType, options\?: OpenTaskOptions\) => void;/);
    expect(SRC).not.toMatch(/NEW_TASK_TYPES/);
    expect(SRC).not.toMatch(/onCreateTask/);
    expect(SRC.match(/className="taskbar-tab new-task-button"/g)).toHaveLength(1);
  });

  it('the new-task button is a real menu button with an accessible name', () => {
    const block = SRC.match(/<button[\s\S]*?className="taskbar-tab new-task-button"[\s\S]*?<\/button>/);
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/type="button"/);
    expect(block![0]).toMatch(/aria-haspopup="menu"/);
    expect(block![0]).toMatch(/aria-expanded=\{isMenuOpen\}/);
    expect(block![0]).toMatch(/aria-label=\{t\.common\.newTask\}/);
    expect(block![0]).toMatch(/aria-hidden="true"/);
  });

  it('pauses auto-collapse while the portaled menu is open', () => {
    expect(SRC.match(/if \(isMenuOpenRef\.current\) return;/g)).toHaveLength(2);
  });

  it('menu hints live in the existing tasks namespace', () => {
    expect(I18N_SRC).toMatch(/newTaskMenu: \{ create: string; switchTo: string \};/);
    expect(I18N_SRC).toMatch(/switchTo: '已打开，点击切换'/);
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
