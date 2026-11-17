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
  it('activates effects while preserving the live edit/gesture guard', () => {
    const effects = toolbarSrc.split("id: 'effects'")[1]
      .split("id: 'transitions'")[0];
    expect(effects).not.toContain('comingSoon: true');
    expect(effects).toContain('disabled: isEditLocked || isInteracting');
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
  it('handleAddEffect routes a validated selection to the effects studio', () => {
    const handler = panelSrc.split('const handleAddEffect =')[1]
      .split('const handleAddTransition')[0];
    expect(handler).toContain('onOpenEffects?.(id)');
    expect(handler).not.toContain('featureComingSoon');
  });

  it('handleAddTransition uses featureComingSoon', () => {
    expect(panelSrc).toMatch(/handleAddTransition[\s\S]{0,200}?featureComingSoon/);
  });
});
