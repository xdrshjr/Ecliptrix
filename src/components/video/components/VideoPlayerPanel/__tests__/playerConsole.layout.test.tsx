/**
 * @vitest-environment node
 *
 * Player Console redesign — structure / a11y / CSS-contract regression
 * (docs/plans/preview-player-console-redesign/spec.md).
 *
 * Source-level assertions, matching the project's existing panel tests
 * (`VideoPlayerPanel.solePath.test.tsx`): the vitest config cannot compile
 * the panel's JSX under `jsx: "preserve"`, so we assert against the file
 * text instead of rendering. This guards the JSX↔CSS class contract so the
 * two cannot silently drift apart again (the very regression this feature
 * fixed — gutted CSS while the JSX still referenced the old classes).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PANEL = readFileSync(
  resolve(__dirname, '..', 'VideoPlayerPanel.tsx'),
  'utf-8',
);
const COVER_BTN = readFileSync(
  resolve(__dirname, '..', '..', 'VideoCoverModal', 'CoverButton.tsx'),
  'utf-8',
);
const CSS = readFileSync(
  resolve(__dirname, '..', '..', '..', '..', '..', 'styles', 'video-editing.css'),
  'utf-8',
);

describe('Player Console — JSX structure', () => {
  it('renders the single Player Console card with its four sections', () => {
    expect(PANEL).toMatch(/className="player-console"/);
    expect(PANEL).toMatch(/className="console-scrubber-row"/);
    expect(PANEL).toMatch(/className="console-transport-row"/);
    expect(PANEL).toMatch(/className="console-divider"/);
    expect(PANEL).toMatch(/className="console-settings-row"/);
  });

  it('drives the scrubber fill via the --progress custom property and gates seeking on duration', () => {
    expect(PANEL).toMatch(/className="console-scrubber"/);
    expect(PANEL).toMatch(/\['--progress'\]:\s*`\$\{progressPercent\}%`/);
    expect(PANEL).toMatch(/max=\{isSeekable \? totalForBar : 1\}/);
    expect(PANEL).toMatch(/disabled=\{!isSeekable\}/);
  });

  it('renders the time read-out as current / separator / total', () => {
    expect(PANEL).toMatch(/className="console-time"/);
    expect(PANEL).toMatch(/className="current-time"/);
    expect(PANEL).toMatch(/className="time-separator"/);
    expect(PANEL).toMatch(/className="total-time"/);
  });

  it('renders the aspect-ratio segmented control over ASPECT_RATIOS with aria-pressed', () => {
    expect(PANEL).toMatch(/className="console-ratio-segmented"[\s\S]*?role="group"/);
    expect(PANEL).toMatch(/ASPECT_RATIOS\.map\(\(aspectRatio\) =>/);
    expect(PANEL).toMatch(/className="console-ratio-seg"/);
    // Each segment's active state is driven purely by aria-pressed (no -active class).
    expect(PANEL).toMatch(/aria-pressed=\{isSelected\}/);
  });
});

describe('Player Console — accessibility preserved', () => {
  it('keeps the mute toggle aria-pressed / title / aria-label on the icon button', () => {
    expect(PANEL).toMatch(/className="console-icon-btn"/);
    expect(PANEL).toMatch(/aria-pressed=\{volume === 0\}/);
    expect(PANEL).toMatch(
      /title=\{volume === 0 \? t\.videoPlayerPanel\.controls\.unmute : t\.videoPlayerPanel\.controls\.mute\}/,
    );
    expect(PANEL).toMatch(
      /aria-label=\{volume === 0 \? t\.videoPlayerPanel\.controls\.unmute : t\.videoPlayerPanel\.controls\.mute\}/,
    );
  });

  it('keeps the play button disabled/aria-disabled guards intact', () => {
    expect(PANEL).toMatch(/className="console-play-btn"/);
    expect(PANEL).toMatch(/disabled=\{getTotalDuration\(\) === 0\}/);
    expect(PANEL).toMatch(/aria-disabled=\{!allTimelineMediaReady \|\| undefined\}/);
  });
});

describe('Player Console — old control classes fully retired', () => {
  it('removes every legacy control/info class from the panel JSX', () => {
    for (const dead of [
      'video-controls-info-container',
      'aspect-ratio-btn',
      'aspect-ratio-buttons',
      'aspect-ratio-group',
      'aspect-ratio-row',
      'video-info-panel',
      'play-pause-btn',
      'controls-row',
      'progress-slider',
    ]) {
      expect(PANEL).not.toContain(dead);
    }
  });

  it('styles the cover button with console-cover-btn, not the deleted aspect-ratio-btn', () => {
    expect(COVER_BTN).toMatch(/console-cover-btn/);
    expect(COVER_BTN).not.toContain('aspect-ratio-btn');
  });
});

describe('Player Console — CSS contract', () => {
  it('defines the authoritative console selectors', () => {
    expect(CSS).toMatch(/\.player-console\{/);
    expect(CSS).toMatch(/\.console-scrubber\{/);
    expect(CSS).toMatch(/\.console-ratio-seg\[aria-pressed="true"\]\{/);
    expect(CSS).toMatch(/\.console-cover-btn\{/);
  });

  it('lets the preview fill the column (flex:1 1 auto) instead of the old 70% lock', () => {
    expect(CSS).toMatch(/\.video-player-wrapper\s*\{[^}]*flex:\s*1 1 auto/);
    expect(CSS).not.toMatch(/\.video-player-wrapper\s*\{[^}]*flex:\s*0 0 70%/);
  });

  it('purges the duplicated/dead control selectors from the stylesheet', () => {
    expect(CSS).not.toMatch(/\.video-controls\s*\{/);
    expect(CSS).not.toMatch(/\.aspect-ratio-btn\b/);
    expect(CSS).not.toMatch(/\.video-controls-info-container\b/);
  });
});
