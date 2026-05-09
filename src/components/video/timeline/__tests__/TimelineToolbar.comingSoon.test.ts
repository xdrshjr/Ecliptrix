/**
 * @vitest-environment node
 *
 * iter4 Bug #4: the timeline effects/transitions buttons are unimplemented and
 * must be marked Coming Soon — disabled and showing the existing
 * timeline.messages.featureComingSoon i18n string in their tooltip/aria-label.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TOOLBAR = resolve(__dirname, '..', 'TimelineToolbar.tsx');
const PANEL = resolve(__dirname, '..', 'TimelinePanel.tsx');

const toolbarSrc = readFileSync(TOOLBAR, 'utf-8');
const panelSrc = readFileSync(PANEL, 'utf-8');

describe('TimelineToolbar — coming-soon flag', () => {
  it('marks the effects entry comingSoon + disabled', () => {
    expect(toolbarSrc).toMatch(/id:\s*'effects',[\s\S]{0,800}?comingSoon:\s*true,/);
    expect(toolbarSrc).toMatch(/id:\s*'effects',[\s\S]{0,800}?disabled:\s*true,/);
  });

  it('marks the transitions entry comingSoon + disabled', () => {
    expect(toolbarSrc).toMatch(/id:\s*'transitions',[\s\S]{0,800}?comingSoon:\s*true,/);
    expect(toolbarSrc).toMatch(/id:\s*'transitions',[\s\S]{0,800}?disabled:\s*true,/);
  });

  it('renderIconButton swaps title / aria-label to featureComingSoon', () => {
    expect(toolbarSrc).toMatch(/button\.comingSoon[\s\S]{0,200}?t\.timeline\.messages\.featureComingSoon/);
  });
});

describe('TimelinePanel — handler toast unifies on featureComingSoon', () => {
  it('handleAddEffect uses featureComingSoon', () => {
    expect(panelSrc).toMatch(/handleAddEffect[\s\S]{0,200}?featureComingSoon/);
  });

  it('handleAddTransition uses featureComingSoon', () => {
    expect(panelSrc).toMatch(/handleAddTransition[\s\S]{0,200}?featureComingSoon/);
  });
});
