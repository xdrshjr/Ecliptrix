/**
 * @vitest-environment node
 *
 * iter4 Bug #6: the top-bar "Brainstorm" task entry must show as Coming Soon
 * (badge + aria-disabled + opacity) and surface a toast instead of opening
 * a stub task tab. Container's brainstorm placeholder gets the badge too.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TASKBAR = resolve(__dirname, '..', 'Taskbar.tsx');
const CONTAINER = resolve(__dirname, '..', 'Container.tsx');

const taskbarSrc = readFileSync(TASKBAR, 'utf-8');
const containerSrc = readFileSync(CONTAINER, 'utf-8');

describe('Taskbar — brainstorm Coming Soon entry', () => {
  it('reads showInfo from the notification context', () => {
    expect(taskbarSrc).toMatch(/showWarning,\s*showInfo/);
  });

  it('renders the brainstorm entry as aria-disabled with the new toast key', () => {
    expect(taskbarSrc).toMatch(/aria-disabled="true"/);
    expect(taskbarSrc).toMatch(/t\.tasks\.brainstormingComingSoon/);
  });

  it('reuses the existing landing.comingSoonBadge i18n key', () => {
    expect(taskbarSrc).toMatch(/t\.landing\.comingSoonBadge/);
  });

  it('does not call handleCreateTask for brainstorm anymore', () => {
    // The brainstorm <button> body must not reference handleCreateTask('brainstorm').
    const brainBlock = taskbarSrc.match(/getTaskIcon\('brainstorm'\)[\s\S]{0,800}?<\/button>/);
    expect(brainBlock).not.toBeNull();
    if (brainBlock) {
      expect(brainBlock[0]).not.toMatch(/handleCreateTask\('brainstorm'\)/);
    }
  });
});

describe('Container — brainstorm placeholder badge', () => {
  it('renders the Coming Soon badge alongside the heading', () => {
    expect(containerSrc).toMatch(/t\.landing\.comingSoonBadge/);
  });
});
