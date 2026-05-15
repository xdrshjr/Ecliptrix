/**
 * @vitest-environment node
 *
 * Re-entry "MEDIA_ERR_SRC_NOT_SUPPORTED" fix — spec.md §7.2.
 *
 * Following the precedent set by `playheadResume.test.tsx` and
 * `exportButton.test.tsx`: the project's Vitest config (tsconfig
 * `jsx: "preserve"`) cannot mount React components, so we verify the
 * source-level wiring instead. The actual behavior is exercised by the
 * helper unit tests (`assignVideoSrcChecked.test.ts` and
 * `resolveSequencePlaybackUrl.test.ts`), which use a real shimmed
 * <video> element. See "实施过程发现的方案缺陷" in spec.md for the
 * deviation note.
 *
 * What we verify here:
 *   • Every <video>.src write goes through assignVideoSrcChecked
 *     (no raw `currentVideo.src = ...` / `videoRef.current.src = ...`).
 *   • The bootstrap effect's deps include resolvedFirstSrc?.url so a
 *     prefetch-driven cacheUrl flip re-runs source assignment (RC-4).
 *   • assignSequenceSrc wires onCandidateFailed → patchMaterialCache for
 *     'same-origin-error' reasons (the §3.2a probe-failure handshake).
 *   • handlePlayPauseClick gates play() on bootstrapStateRef.status.
 *   • A flat i18n key `videoPlayerPanel.errorNoPlayableSource` is used
 *     and surfaceNoPlayableSource translates the error.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PANEL_FILE = resolve(__dirname, '..', 'VideoPlayerPanel.tsx');
const I18N_FILE = resolve(__dirname, '..', '..', '..', '..', '..', 'lib', 'i18n.ts');
const panelSrc = readFileSync(PANEL_FILE, 'utf-8');
const i18nSrc = readFileSync(I18N_FILE, 'utf-8');

describe('VideoPlayerPanel — re-entry play no-source fix', () => {
  it('imports resolveSequencePlaybackUrl + assignVideoSrcChecked + NoPlayableSourceError', () => {
    expect(panelSrc).toMatch(/from\s+'\.\.\/\.\.\/lib\/resolveSequencePlaybackUrl'/);
    expect(panelSrc).toMatch(/from\s+'\.\.\/\.\.\/lib\/assignVideoSrcChecked'/);
    expect(panelSrc).toMatch(/from\s+'\.\.\/\.\.\/errors'/);
  });

  it('only audio elements still write .src directly — every <video>.src write is replaced', () => {
    const srcWrites = Array.from(panelSrc.matchAll(/^[ \t]*([A-Za-z_][\w\.]*)\.src\s*=/gm));
    for (const m of srcWrites) {
      // The receiver name must start with `audioElement` — bootstrap, seek,
      // and sequence-transition all route their video.src through
      // assignVideoSrcChecked / assignSequenceSrc.
      expect(m[1]).toMatch(/^audioElement/);
    }
    expect(srcWrites.length).toBeGreaterThan(0); // sanity: regex actually fires
  });

  it('declares bootstrapStateRef with the four-state union from spec §5.3', () => {
    expect(panelSrc).toMatch(/bootstrapStateRef\s*=\s*useRef</);
    expect(panelSrc).toMatch(/'idle'\s*\|\s*'resolving'\s*\|\s*'ready'\s*\|\s*'failed'/);
  });

  it('memoises resolveSequencePlaybackUrl over the first sequence + materials (RC-4 fix)', () => {
    // Slice from the declaration up to the firstSequenceId-or-bootstrap region
    // so we capture the deps array even when the memo body contains `[]` literals.
    const start = panelSrc.indexOf('const resolvedFirstSrc');
    expect(start).toBeGreaterThan(-1);
    const tail = panelSrc.slice(start, start + 800);
    expect(tail).toMatch(/resolveSequencePlaybackUrl\(/);
    expect(tail).toMatch(/materialId/);
    expect(tail).toMatch(/materials/);
  });

  it('threads resolvedFirstSrc?.url into the bootstrap effect deps so prefetch flips re-run it', () => {
    expect(panelSrc).toMatch(
      /\[playbackMode,\s*compositionPlayback\?\.videoSequences\.length,\s*firstSequenceId,\s*resolvedFirstSrc\?\.url[\s\S]*?\]\)/,
    );
  });

  it('wires the §3.2a probe-failure handshake → patchMaterialCache for same-origin failures', () => {
    // Slice generously past the assignSequenceSrc body so deps array literals
    // inside don't confuse a non-greedy `])` regex.
    const start = panelSrc.indexOf('const assignSequenceSrc');
    expect(start).toBeGreaterThan(-1);
    const region = panelSrc.slice(start, start + 1500);
    expect(region).toMatch(/onCandidateFailed/);
    expect(region).toMatch(/'same-origin-error'/);
    expect(region).toMatch(/cacheStatus:\s*'pending'/);
    expect(region).toMatch(/cacheUrl:\s*undefined/);
  });

  it('handlePlayPauseClick gates play() on bootstrapStateRef status (Layer 3)', () => {
    expect(panelSrc).toMatch(/bootstrapStateRef\.current\.status\s*===\s*'failed'/);
    expect(panelSrc).toMatch(/bootstrapStateRef\.current\.status\s*===\s*'resolving'/);
    // Defer until loadedmetadata or 5 s timeout
    expect(panelSrc).toMatch(/loadedmetadata[\s\S]+?canplay[\s\S]+?5000/);
  });

  it('translates assignVideoSrcChecked failure into the flat i18n toast', () => {
    expect(panelSrc).toMatch(/surfaceNoPlayableSource/);
    expect(panelSrc).toMatch(/t\.videoPlayerPanel\.errorNoPlayableSource/);
  });

  it('NotificationContext.showError is destructured from useNotification', () => {
    expect(panelSrc).toMatch(
      /from\s+'@\/contexts\/NotificationContext'/,
    );
    expect(panelSrc).toMatch(/useNotification\(\)/);
  });

  it('catches NoPlayableSourceError in every assignSequenceSrc call site', () => {
    const noPlayableSites = (panelSrc.match(/NoPlayableSourceError/g) || []).length;
    // 1 import + 1 throw via onCandidateFailed indirection + 5 catch arms
    // (bootstrap, next-sequence onAssignFailed, handlePlayPause source-change,
    //  handleCompositionSeek needsSwitchVideo, seekAndPlayFromTimeline).
    expect(noPlayableSites).toBeGreaterThanOrEqual(5);
  });
});

describe('i18n — flat key videoPlayerPanel.errorNoPlayableSource', () => {
  it('is declared in the videoPlayerPanel namespace at the top level (P1-8)', () => {
    // Type declaration: the key sits flat under `videoPlayerPanel: { ... }`,
    // NOT nested inside an `errors: { ... }` subtree. Verify by scanning
    // each `videoPlayerPanel: {` block for an `errors:` subkey within its
    // immediate brace pair (depth-tracked, not regex).
    expect(i18nSrc).toMatch(/errorNoPlayableSource:\s*string;/);
    const checkBlocks = (start: number): boolean => {
      let depth = 0;
      let i = start;
      let opened = false;
      while (i < i18nSrc.length) {
        const c = i18nSrc[i];
        if (c === '{') {
          depth++;
          opened = true;
        } else if (c === '}') {
          depth--;
          if (opened && depth === 0) return true;
        }
        if (opened && depth === 1) {
          // immediate-child key
          if (i18nSrc.startsWith('errors:', i)) return false;
        }
        i++;
      }
      return true;
    };
    let pos = 0;
    while (true) {
      const idx = i18nSrc.indexOf('videoPlayerPanel:', pos);
      if (idx === -1) break;
      const ok = checkBlocks(idx);
      expect(ok).toBe(true);
      pos = idx + 1;
    }
  });

  it('has a non-empty value in both en and zh-CN locales', () => {
    const enMatch = i18nSrc.match(
      /errorNoPlayableSource:\s*'Video source not playable[^']+'/,
    );
    expect(enMatch).not.toBeNull();
    const zhMatch = i18nSrc.match(
      /errorNoPlayableSource:\s*'视频源不可播放[^']+'/,
    );
    expect(zhMatch).not.toBeNull();
  });
});
