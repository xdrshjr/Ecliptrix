/**
 * @vitest-environment node
 *
 * Theme colours are hex CSS variables (globals.css) mapped to Tailwind as
 * `var(--x)` without `<alpha-value>`. Two consequences pinned here:
 *  - wrapping such a variable in the hsl function is invalid at computed-value
 *    time, so the declaration silently drops (invisible scrollbar thumbs,
 *    edge fades);
 *  - `bg-primary/10`-style opacity modifiers generate no CSS at all, so the
 *    timeline's state tints use the `*-a` color-mix aliases instead.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '..', '..');
const HSL_OF_THEME_VAR = /hsl\(\s*var\(--/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

const THEME_TOKEN_WITH_OPACITY =
  /\b(?:bg|text|border|ring|from|via|to)-(?:primary|secondary|muted|accent|foreground|background|destructive|card|popover|border|input|ring)(?:-foreground)?\/\d+/;

const TIMELINE_TINT_FILES = [
  'components/video/timeline/TimelineToolbar.tsx',
  'components/video/timeline/Track.tsx',
  'components/video/timeline/TrackContainer.tsx',
  'components/video/timeline/TimelineRuler.tsx',
  'components/video/timeline/VolumeSlider.tsx',
];

/** Dialog primary buttons whose hover state was the only visible feedback. */
const DIALOG_PRIMARY_BUTTON_FILES = [
  'components/video/components/SubtitleEditModal/SubtitleEditModal.tsx',
  'components/video/components/CameraMotionModal/CameraMotionModal.tsx',
];

describe('theme tokens', () => {
  it('no theme token is wrapped in hsl()', () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => !path.includes('__tests__'))
      .filter((path) => HSL_OF_THEME_VAR.test(readFileSync(path, 'utf-8')));
    expect(offenders).toEqual([]);
  });

  it('timeline slice uses alpha-capable aliases for theme tints', () => {
    const offenders = [
      ...TIMELINE_TINT_FILES.filter((file) =>
        THEME_TOKEN_WITH_OPACITY.test(readFileSync(join(SRC, file), 'utf-8')),
      ),
      ...DIALOG_PRIMARY_BUTTON_FILES.filter((file) =>
        /hover:bg-primary\/90/.test(readFileSync(join(SRC, file), 'utf-8')),
      ),
    ];
    const config = readFileSync(resolve(SRC, '..', 'tailwind.config.js'), 'utf-8');
    const aliases = ['primary-a', 'muted-a', 'foreground-a', 'accent-a', 'background-a', 'destructive-a', 'border-a']
      .filter((alias) => !new RegExp(`["']${alias}["']:\\s*["']color-mix\\(in srgb, var\\(--`).test(config));
    expect({ offenders, missingAliases: aliases }).toEqual({ offenders: [], missingAliases: [] });
  });

  it('toolbar buttons draw a single keyboard focus ring', () => {
    // A stylesheet :focus outline (specificity 0,2,1) beats the Tailwind
    // focus-visible:outline-none on the toolbar button: a mouse click drew an
    // outline and keyboard focus drew it around the focus-visible ring.
    const css = readFileSync(join(SRC, 'styles', 'video-editing.css'), 'utf-8');
    expect(css).not.toMatch(/\.timeline-toolbar button:focus\s*\{/);
  });
});
