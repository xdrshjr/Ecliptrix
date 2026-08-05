/**
 * @vitest-environment node
 *
 * iter4 Bug #4: unimplemented timeline buttons must be marked Coming Soon —
 * disabled and showing the timeline.messages.featureComingSoon i18n string in
 * their tooltip/aria-label.
 *
 * The EFFECTS button no longer belongs to that set: it now opens the camera-
 * motion panel (docs/plans/timeline-camera-motion). Its assertions were flipped
 * rather than deleted, so the button cannot silently regress into a dead
 * placeholder — it must stay wired, and must still refuse to open without a
 * selected clip.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TOOLBAR = resolve(__dirname, '..', 'TimelineToolbar.tsx');
const PANEL = resolve(__dirname, '..', 'TimelinePanel.tsx');

const toolbarSrc = readFileSync(TOOLBAR, 'utf-8');
const panelSrc = readFileSync(PANEL, 'utf-8');

describe('TimelineToolbar — coming-soon flag', () => {
  it('no longer marks the effects entry coming-soon — it opens camera motion', () => {
    const effectsEntry = toolbarSrc.slice(
      toolbarSrc.indexOf("id: 'effects'"),
      toolbarSrc.indexOf("id: 'transitions'"),
    );
    expect(effectsEntry).not.toMatch(/comingSoon:\s*true/);
    expect(effectsEntry).not.toMatch(/disabled:\s*true/);
    // Enabled only with a selection — camera motion applies to one clip.
    expect(effectsEntry).toMatch(/disabled:\s*selectedItemsCount === 0/);
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
  it('handleAddEffect opens the camera-motion panel instead of a toast', () => {
    expect(panelSrc).not.toMatch(/handleAddEffect = useCallback\(\(\) => \{[\s\S]{0,120}?featureComingSoon/);
    expect(panelSrc).toMatch(/handleAddEffect[\s\S]{0,900}?setCameraMotionItem/);
  });

  it('handleAddTransition uses featureComingSoon', () => {
    expect(panelSrc).toMatch(/handleAddTransition[\s\S]{0,200}?featureComingSoon/);
  });
});
