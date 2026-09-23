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

describe('Player Console — single-row play bar (workbench §3.6, RV-13)', () => {
  const consoleBlock = PANEL.match(/className="player-console"[\s\S]*?Video Cover authoring modal/);

  it('renders play, time, scrubber and volume as direct children of one row', () => {
    expect(consoleBlock).not.toBeNull();
    const block = consoleBlock![0];
    const order = [
      'className="console-play-btn"',
      'className="console-time"',
      'className="console-scrubber"',
      'className="console-volume"',
    ].map((needle) => block.indexOf(needle));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('drops the old two-row structure and the settings row', () => {
    for (const dead of [
      'console-scrubber-row',
      'console-transport-row',
      'console-transport-left',
      'console-transport-right',
      'console-divider',
      'console-settings-row',
      'console-ratio-segmented',
    ]) {
      expect(PANEL).not.toContain(dead);
    }
  });

  it('drives the scrubber fill via the --progress custom property and gates seeking on duration', () => {
    expect(PANEL).toMatch(/\['--progress'\]:\s*`\$\{progressPercent\}%`/);
    expect(PANEL).toMatch(/max=\{isSeekable \? totalForBar : 1\}/);
    expect(PANEL).toMatch(/disabled=\{!isSeekable\}/);
  });

  it('renders the time read-out as current / separator / total from the console time', () => {
    expect(PANEL).toMatch(/className="current-time">\{formatTime\(consoleTime\)\}/);
    expect(PANEL).toMatch(/className="time-separator"/);
    expect(PANEL).toMatch(/className="total-time"/);
    expect(PANEL).toMatch(/value=\{consoleTime\}/);
  });

  it('moves the aspect ratio into the canvas menu, driven by the controlled id', () => {
    expect(PANEL).toMatch(/<CanvasMenu[\s\S]*?aspectRatios=\{ASPECT_RATIOS\}/);
    expect(PANEL).toMatch(/onSelect=\{handleAspectRatioChange\}/);
    expect(PANEL).not.toMatch(/selectedAspectRatioId/);
    expect(PANEL).toMatch(/ar\.id === aspectRatioId/);
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

  it('keeps the seek slider aria-label / aria-valuetext', () => {
    expect(PANEL).toMatch(/aria-label=\{t\.videoPlayerPanel\.controls\.seekAriaLabel\}/);
    expect(PANEL).toMatch(/aria-valuetext=\{formatTime\(consoleTime\)\}/);
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
    expect(CSS).toMatch(/\.player-console\{[^}]*height:44px/);
    expect(CSS).toMatch(/\.console-scrubber\{[^}]*flex:1 1 auto/);
    expect(CSS).toMatch(/\.console-volume-slider\{[^}]*width:80px/);
    expect(CSS).toMatch(/\.console-play-btn\{width:36px;height:36px;/);
    expect(CSS).toMatch(/\.console-cover-btn\{/);
  });

  it('removes the retired two-row console selectors', () => {
    expect(CSS).not.toMatch(/\.console-transport-row/);
    expect(CSS).not.toMatch(/\.console-settings-row/);
    expect(CSS).not.toMatch(/\.console-ratio-seg/);
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
